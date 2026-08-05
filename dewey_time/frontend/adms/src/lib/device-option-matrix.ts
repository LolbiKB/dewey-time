import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * The fleet matrix: rows are option keys, columns are terminals.
 *
 * Answers the question a per-device dialog structurally cannot — "are my
 * terminals configured the same?" — and it works before any desired-state
 * table exists, which is the state the fleet is actually in.
 *
 * Every judgement here is about what we may CONCLUDE from partial data, and
 * each way of getting that wrong produces a confident false alarm:
 *
 *   - A REDACTED value is unknown, not different. `authKey` is withheld on
 *     every device; reading two withheld values as "the same" would be a
 *     fabricated agreement, and reading them as "different" a fabricated
 *     conflict. Neither is knowable, so such a row is INCOMPARABLE.
 *   - A device that has reported NOTHING is not a device that disagrees with
 *     everything. Until it answers an INFO, it is excluded from comparison
 *     entirely — otherwise a newly approved terminal makes all 78 rows red.
 *   - A key absent on one terminal but present on another IS real drift, but
 *     only among devices that have actually reported.
 */

export type DriftVerdict =
  /** Every reporting device agrees. */
  | 'agree'
  /** Reporting devices disagree on the value. */
  | 'differ'
  /** Some reporting devices have this key and others do not. */
  | 'missing'
  /** Not enough is visible to say — withheld values, or only one reporter. */
  | 'unknown'
  /** Unique to each terminal by nature. Differing is CORRECT. */
  | 'per-device'
  /** Live telemetry. Differing is meaningless. */
  | 'volatile'

/**
 * What KIND of thing a key is — the difference between drift and normality.
 *
 * The first version of this matrix compared everything and reported "10
 * differ" on a healthy fleet: serial numbers, MAC addresses, IP addresses and
 * live counters were all flagged as configuration drift. Eight of the ten were
 * keys that MUST differ. Only firmware version and volume were real.
 *
 * Same failure as the capacity view before it — a confident claim on data that
 * does not support one — so keys are classified explicitly here.
 */
export type KeyKind =
  /** Should be uniform across the fleet. Drift here is actionable. */
  | 'setting'
  /** Unique per terminal: serial, MAC, IP. */
  | 'identity'
  /** Changes with use: counters, free space, the clock. */
  | 'counter'

/** Unique to each unit. Comparing these produces noise, never a finding. */
const IDENTITY_KEYS = new Set(
  ['~SerialNumber', 'IPAddress', 'MAC'].map((k) => k.toLowerCase())
)

/**
 * Changes as the terminal is used, so a difference says nothing about
 * configuration. FreeFlashSize shrinks with data; FlashSize is the hardware
 * total and stays a setting. MainTime is a clock and differs by the second.
 */
const COUNTER_KEYS = new Set(
  [
    'UserCount', 'FPCount', 'FaceCount', 'FvCount', 'PvCount',
    'UserPhotoCount', 'UserCardCount', 'ATTPhotoCount', 'TransactionCount',
    'FreeFlashSize', 'MainTime',
  ].map((k) => k.toLowerCase())
)

/**
 * Anything unclassified is treated as a SETTING, so it gets compared.
 *
 * Deliberate direction to fail in: an unknown key that differs shows up as a
 * finding someone can classify away, whereas defaulting to 'counter' would
 * silently hide real drift on every key nobody has thought about yet. Noise is
 * recoverable; silence is not.
 */
export function classifyKey(key: string): KeyKind {
  const k = key.trim().toLowerCase()
  if (IDENTITY_KEYS.has(k)) return 'identity'
  if (COUNTER_KEYS.has(k)) return 'counter'
  return 'setting'
}

export interface MatrixCell {
  /** The device reported this key at all. */
  present: boolean
  /** The value was withheld by the allowlist — unknown, NOT unset. */
  redacted: boolean
  value: string | null
}

export interface MatrixRow {
  key: string
  /** Keyed by device serial. Every column is present, so the grid is dense. */
  cells: Record<string, MatrixCell>
  kind: KeyKind
  verdict: DriftVerdict
}

export interface OptionMatrix {
  rows: MatrixRow[]
  /** Serials that have reported at least one key — the comparable columns. */
  reportingDevices: string[]
  /** Serials with no reported configuration yet. Shown, never compared. */
  silentDevices: string[]
  /**
   * The API bound was hit, so rows may be missing. Load-bearing: a truncated
   * row set makes present keys look absent, which renders as drift that is not
   * real. The UI must say so rather than show a confident grid.
   */
  truncated: boolean
}

const ABSENT: MatrixCell = { present: false, redacted: false, value: null }

export function buildOptionMatrix(
  entries: DeviceOptionEntry[],
  deviceSns: string[],
  options?: { limit?: number }
): OptionMatrix {
  const truncated = options?.limit != null && entries.length >= options.limit

  const reporting = new Set<string>()
  const byKey = new Map<string, Record<string, MatrixCell>>()

  for (const e of entries) {
    // Ignore rows for serials the caller did not ask about (e.g. a device
    // deleted or moved to rejected since it last reported).
    if (!deviceSns.includes(e.device_sn)) continue
    reporting.add(e.device_sn)

    let row = byKey.get(e.key)
    if (!row) {
      row = {}
      byKey.set(e.key, row)
    }
    row[e.device_sn] = { present: true, redacted: e.redacted, value: e.value }
  }

  const reportingDevices = deviceSns.filter((sn) => reporting.has(sn))
  const silentDevices = deviceSns.filter((sn) => !reporting.has(sn))

  const rows: MatrixRow[] = [...byKey.entries()]
    .map(([key, partial]) => {
      const cells: Record<string, MatrixCell> = {}
      for (const sn of deviceSns) cells[sn] = partial[sn] ?? ABSENT

      const kind = classifyKey(key)
      return { key, cells, kind, verdict: verdictFor(cells, reportingDevices, kind) }
    })
    .sort((a, b) => a.key.localeCompare(b.key))

  return { rows, reportingDevices, silentDevices, truncated }
}

function verdictFor(
  cells: Record<string, MatrixCell>,
  reportingDevices: string[],
  kind: KeyKind
): DriftVerdict {
  // Identity and telemetry are expected to differ. Comparing them at all is
  // what produced "10 differ" on a fleet with two real problems.
  if (kind === 'identity') return 'per-device'
  if (kind === 'counter') return 'volatile'

  // Only devices that have reported SOMETHING can disagree. A silent terminal
  // is missing every key, which is a fact about the terminal, not about drift.
  if (reportingDevices.length < 2) return 'unknown'

  const present = reportingDevices.filter((sn) => cells[sn].present)
  if (present.length === 0) return 'unknown'
  if (present.length !== reportingDevices.length) return 'missing'

  // A withheld value is unknown. Comparing it either way invents a conclusion.
  const comparable = present.filter((sn) => !cells[sn].redacted)
  if (comparable.length < 2) return 'unknown'
  if (comparable.length !== present.length) return 'unknown'

  const distinct = new Set(comparable.map((sn) => cells[sn].value))
  return distinct.size > 1 ? 'differ' : 'agree'
}

/**
 * Rows worth an operator's attention: a genuine, knowable disagreement on
 * something that is SUPPOSED to match. Identity and counters can never qualify.
 */
export function hasDrift(row: MatrixRow): boolean {
  if (row.kind !== 'setting') return false
  return row.verdict === 'differ' || row.verdict === 'missing'
}

export function countDrift(rows: MatrixRow[]): number {
  return rows.filter(hasDrift).length
}

/**
 * ── Scaling past a grid ───────────────────────────────────────────────────
 *
 * A matrix is rows x devices, so its width grows with the fleet. At four
 * terminals that is readable; at ten it is horizontal scrolling, and the two
 * settings that actually differ are somewhere off-screen.
 *
 * The fix is to notice that VALUES are few and DEVICES are many. `VOLUME`
 * across twenty terminals is still three distinct values, so grouping by value
 * collapses the axis that grows. What an operator needs is "which value should
 * this be, and who disagrees" — not a cell-by-cell read.
 */

export interface ValueGroup {
  /** Raw value; null when withheld or not reported. */
  value: string | null
  /** Serials reporting this value. */
  devices: string[]
  /** The single largest group. False for ALL groups when there is a tie. */
  isMajority: boolean
}

/** Distinct values for one row, largest group first. */
export function groupRowValues(row: MatrixRow, reportingDevices: string[]): ValueGroup[] {
  const buckets = new Map<string, { value: string | null; devices: string[] }>()

  for (const sn of reportingDevices) {
    const cell = row.cells[sn]
    // Withheld and absent are distinct from each other and from any value, and
    // neither may be silently folded into a real reading.
    const id = !cell?.present ? ' absent' : cell.redacted ? ' withheld' : `v:${cell.value}`
    const value = !cell?.present || cell.redacted ? null : cell.value

    const bucket = buckets.get(id) ?? { value, devices: [] }
    bucket.devices.push(sn)
    buckets.set(id, bucket)
  }

  const groups = [...buckets.values()].sort((a, b) => b.devices.length - a.devices.length)
  const top = groups[0]?.devices.length ?? 0
  // A tie has no majority. Declaring one would tell an operator to standardise
  // on a value with no more support than its rival.
  const tied = groups.filter((g) => g.devices.length === top).length > 1

  return groups.map((g) => ({ ...g, isMajority: !tied && g.devices.length === top }))
}

export interface DeviceDeviation {
  deviceSn: string
  /** Settings where this device is outside the majority. */
  count: number
  keys: string[]
}

/**
 * Which terminals are the odd ones out, worst first.
 *
 * With a large fleet the useful question inverts: not "which setting differs"
 * but "which box is wrong". One terminal deviating on six settings is a single
 * visit; six terminals deviating on one each is a different job entirely.
 */
export function deviceDeviations(
  rows: MatrixRow[],
  reportingDevices: string[]
): DeviceDeviation[] {
  const byDevice = new Map<string, string[]>(reportingDevices.map((sn) => [sn, []]))

  for (const row of rows) {
    if (!hasDrift(row)) continue
    const majority = groupRowValues(row, reportingDevices).find((g) => g.isMajority)
    // No majority means no one is the outlier — everybody is.
    if (!majority) continue
    for (const sn of reportingDevices) {
      if (!majority.devices.includes(sn)) byDevice.get(sn)?.push(row.key)
    }
  }

  return [...byDevice.entries()]
    .map(([deviceSn, keys]) => ({ deviceSn, count: keys.length, keys }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count || a.deviceSn.localeCompare(b.deviceSn))
}
