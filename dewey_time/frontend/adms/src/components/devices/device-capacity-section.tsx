import { Gauge, Loader2 } from 'lucide-react'
import { signalText, signalDot, type Signal } from '@/lib/signal'
import { cn } from '@/lib/utils'
import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * How full a terminal is, derived from what it reports about itself.
 *
 * THIS SHIPPED WRONG ONCE, and the correction is the whole design.
 *
 * The first version paired each `*Count` counter with the `~Max*Count` key of
 * the matching name. Against the first real dump that rendered "Users 71/80 =
 * 89%" in danger red and "Attendance records 78/20 = 390%" — on a terminal
 * under 1% full. The 390% is the tell: a used/limit ratio cannot exceed 100%,
 * so the pairing was unsound, not merely imprecise.
 *
 * The `~Max*Count` keys are SCALED, and not by a consistent factor:
 *
 *   ~MaxFingerCount   reports 80    real 8000    x100
 *   ~MaxFaceCount     reports 6000  real 6000    x1
 *   ~MaxAttLogCount   reports 20    real >78     x1000 at least
 *
 * There is no rule to derive from three disagreeing samples, so they are not
 * used as denominators at all.
 *
 * The trustworthy source is `MaxMultiBioDataCount` — a colon-delimited vector
 * indexed by biometric type, unscaled, and corroborated twice over by
 * `MultiBioDataSupport` (which types the unit has) and `MultiBioVersion` (whose
 * entries match ~ZKFPVersion and FaceVersion). Only what that vector covers,
 * plus flash storage (a self-consistent free-of-total pair), gets a percentage.
 *
 * Everything else is a plain counter with NO denominator. A missing number is
 * honest; a wrong one shows an operator a crisis that does not exist.
 */

/**
 * Positions in the colon-delimited multi-bio vectors, 1-based.
 *
 * Confirmed against the 2026-08-05 dump: MultiBioDataSupport `0:1:0:0:0:0:0:0:0:1`
 * marks exactly two types on a unit reporting FingerFunOn=1 and FaceFunOn=1,
 * and MultiBioVersion `0:10.0:0:0:0:0:0:0:0:40.1` carries ~ZKFPVersion (10) at
 * the first and FaceVersion (40) at the second.
 */
const BIO_INDEX = { fingerprint: 2, face: 10 } as const

/** Fill thresholds. */
const ATTENTION_AT = 75
const DANGER_AT = 90

export interface CapacityMetric {
  label: string
  used: number | null
  limit: number | null
  /** Null whenever the figure cannot be trusted — never a fabricated 0. */
  percent: number | null
  /** False when the device reports it does not have this biometric at all. */
  supported: boolean
  /** Why there is no percentage, when there isn't one. */
  note?: string
}

export interface CounterMetric {
  label: string
  /** A figure the device reports with no trustworthy denominator. */
  value: number | null
}

/**
 * A device value as a number, or null.
 *
 * Values arrive as strings straight off the wire. `Number('')` is 0 and
 * `Number('x')` is NaN; both would render as a real figure if passed through.
 */
function toNumber(entry: DeviceOptionEntry | undefined): number | null {
  if (!entry || entry.redacted) return null
  const raw = entry.value?.trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/** One position out of a `a:b:c:…` vector, 1-based. Null if absent or unparseable. */
function vectorAt(entry: DeviceOptionEntry | undefined, index: number): number | null {
  if (!entry || entry.redacted) return null
  const parts = entry.value?.split(':')
  if (!parts || parts.length < index) return null
  const n = Number(parts[index - 1]?.trim())
  return Number.isFinite(n) && n >= 0 ? n : null
}

function makeLookup(options: DeviceOptionEntry[]) {
  const byKey = new Map(options.map((o) => [o.key.toLowerCase(), o]))
  return (key: string) => byKey.get(key.toLowerCase())
}

/**
 * Percentage, or null with a reason.
 *
 * `used > limit` is impossible for a genuine pair, so it is treated as evidence
 * the pairing is wrong rather than rendered. This is the specific defence
 * against the 390% that shipped.
 */
function toPercent(used: number | null, limit: number | null): { percent: number | null; note?: string } {
  if (used == null || limit == null) return { percent: null, note: 'Limit not reported' }
  if (limit <= 0) return { percent: null, note: 'Limit not reported' }
  if (used > limit) {
    return { percent: null, note: 'Device reports more in use than its limit — figures inconsistent' }
  }
  return { percent: Math.round((used / limit) * 100) }
}

/** The three resources whose denominators this module can actually defend. */
export function deriveCapacity(options: DeviceOptionEntry[]): CapacityMetric[] {
  const get = makeLookup(options)
  const capacities = get('MaxMultiBioDataCount')
  const support = get('MultiBioDataSupport')

  const bio = (label: string, countKey: string, index: number): CapacityMetric => {
    // Absent support vector means unknown, not unsupported — only an explicit 0 disables.
    const supportFlag = vectorAt(support, index)
    const supported = supportFlag == null ? true : supportFlag > 0
    const used = toNumber(get(countKey))
    const limit = vectorAt(capacities, index)

    if (!supported) {
      return { label, used, limit, percent: null, supported, note: 'Not supported by this device' }
    }
    return { label, used, limit, supported, ...toPercent(used, limit) }
  }

  const total = toNumber(get('FlashSize'))
  const free = toNumber(get('FreeFlashSize'))
  // The one inverted pair: the device reports what REMAINS. Clamped, so
  // firmware disagreeing with itself cannot produce a negative bar.
  const storageUsed = total != null && free != null ? Math.max(0, total - free) : null

  return [
    bio('Fingerprints', 'FPCount', BIO_INDEX.fingerprint),
    bio('Faces', 'FaceCount', BIO_INDEX.face),
    { label: 'Storage', used: storageUsed, limit: total, supported: true, ...toPercent(storageUsed, total) },
  ]
}

/**
 * Figures the device reports with no denominator this module trusts.
 *
 * Users and attendance records belong here precisely because `~MaxUserCount`
 * and `~MaxAttLogCount` are scaled by unknown and differing factors. Showing
 * the count alone is honest; 89% and 390% were not.
 */
export function deriveCounters(options: DeviceOptionEntry[]): CounterMetric[] {
  const get = makeLookup(options)
  return [
    { label: 'Users', value: toNumber(get('UserCount')) },
    { label: 'Attendance records', value: toNumber(get('TransactionCount')) },
    { label: 'User photos', value: toNumber(get('UserPhotoCount')) },
    { label: 'Attendance photos', value: toNumber(get('ATTPhotoCount')) },
    { label: 'Cards', value: toNumber(get('UserCardCount')) },
  ]
}

/** Unknown is not healthy — it is idle, and must never render green. */
export function capacitySignal(percent: number | null): Signal {
  if (percent == null) return 'idle'
  if (percent >= DANGER_AT) return 'danger'
  if (percent >= ATTENTION_AT) return 'attention'
  return 'success'
}

export function formatCapacityValue(value: number | null): string {
  if (value == null) return 'Not reported'
  return value.toLocaleString()
}

export function DeviceCapacityPanel({ options }: { options: DeviceOptionEntry[] }) {
  const metrics = deriveCapacity(options)
  const counters = deriveCounters(options)
  const anyKnown =
    metrics.some((m) => m.percent != null) || counters.some((c) => c.value != null)

  return (
    <div className="space-y-3">
      <div className="space-y-2.5">
        {metrics.map((m) => {
          const signal = capacitySignal(m.percent)
          return (
            <div key={m.label} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium">{m.label}</span>
                {m.percent == null ? (
                  <span className={signalText.idle} title={m.note}>
                    {m.supported ? (m.note ?? 'Not reported') : 'Not supported'}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    <span className={cn('font-medium', signalText[signal])}>{m.percent}%</span>
                    {' · '}
                    {formatCapacityValue(m.used)} of {formatCapacityValue(m.limit)}
                  </span>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                {m.percent != null && (
                  <div
                    className={cn('h-full rounded-full', signalDot[signal])}
                    style={{ width: `${Math.min(100, m.percent)}%` }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-2.5 text-xs sm:grid-cols-3">
        {counters.map((c) => (
          <div key={c.label} className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{c.label}</span>
            <span className={cn('font-medium', c.value == null && signalText.idle)}>
              {formatCapacityValue(c.value)}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {anyKnown
          ? 'Counts without a limit are shown as figures only — this firmware reports those limits on a scale that cannot be compared to the counters.'
          : 'Capacity needs the counter and limit values, which are withheld until their keys are reviewed. Once they are, this fills in on the next read.'}
      </p>
    </div>
  )
}

interface DeviceCapacitySectionProps {
  options: DeviceOptionEntry[]
  loading?: boolean
}

/** Capacity card. Reads the same options query the configuration card uses. */
export function DeviceCapacitySection({ options, loading = false }: DeviceCapacitySectionProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        Capacity
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <DeviceCapacityPanel options={options} />
      )}
    </div>
  )
}
