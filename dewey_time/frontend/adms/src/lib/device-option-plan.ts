import type { DesiredOptionEntry, DeviceOptionEntry } from '@/services/device-service'

/**
 * What one key looks like across the fleet, and what an apply would do.
 *
 * NOTHING HERE DECIDES ANYTHING. The bridge recomputes every comparison when it
 * applies, and its answer is the one that counts. This exists so the page can
 * say "3 terminals" before you click, and so each row can say why it is or is
 * not a target.
 */

export type TerminalVerdict =
  /** Reports the value that would be pushed. */
  | 'matches'
  /** Reports something else, and we know what — an apply would write here. */
  | 'will-change'
  /** Has never reported this key. Absence is not disagreement. */
  | 'not-reported'
  /** Reported, but the value was not stored. Unknown is not different. */
  | 'withheld'
  /** Nothing is desired for this terminal, so there is nothing to compare to. */
  | 'no-standard'

export interface TerminalPlan {
  deviceSn: string
  /** What the terminal last reported. Null when withheld or never reported. */
  reported: string | null
  redacted: boolean
  /** What WOULD be pushed: the override if there is one, else the fleet standard. */
  effective: string | null
  isOverride: boolean
  verdict: TerminalVerdict
}

export interface KeyPlan {
  key: string
  fleetStandard: string | null
  terminals: TerminalPlan[]
  /**
   * How many terminals an apply would write to — A PREVIEW, never a claim. The
   * server recomputes against current state and its result message carries the
   * real number.
   *
   * Mirrors `selectApplyTargets` (device-option-write.ts) step for step, via
   * `wouldBeWritten` below — NOT derived from `verdict`, which is honest for
   * DISPLAY but softer than what the server actually writes to.
   */
  targetCount: number
}

/**
 * The bridge's `optionValuesMatch`, restated for the preview only.
 *
 * Named so nobody mistakes it for the rule: the trim matters because the INFO
 * parser trims, so an untrimmed comparison reports drift the device does not
 * have. If this and the bridge ever disagree, the bridge is right.
 */
function valuesMatchPreview(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

/**
 * Mirrors selectApplyTargets step for step. Deliberately NOT derived from the
 * display verdict: `not-reported` is a target on the server, and a row whose
 * value is null without `redacted` set is one too (the server only skips on the
 * redacted FLAG). Anything that diverges here makes the page withhold an action
 * the bridge would have accepted.
 */
function wouldBeWritten(t: TerminalPlan): boolean {
  if (t.effective == null) return false
  if (t.redacted) return false
  return t.verdict !== 'matches'
}

export function buildKeyPlan(
  key: string,
  desired: DesiredOptionEntry[],
  observed: DeviceOptionEntry[],
  deviceSns: string[]
): KeyPlan {
  const forKey = desired.filter((d) => d.key === key)
  const fleetStandard = forKey.find((d) => d.device_sn === null)?.value ?? null
  const overrides = new Map(
    forKey
      .filter((d): d is DesiredOptionEntry & { device_sn: string } => d.device_sn !== null)
      .map((d) => [d.device_sn, d.value])
  )
  const reportedBySn = new Map(observed.filter((o) => o.key === key).map((o) => [o.device_sn, o]))

  const terminals: TerminalPlan[] = deviceSns.map((deviceSn) => {
    const row = reportedBySn.get(deviceSn)
    const override = overrides.get(deviceSn)
    const effective = override ?? fleetStandard

    let verdict: TerminalVerdict
    if (effective == null) verdict = 'no-standard'
    else if (!row) verdict = 'not-reported'
    // `value == null` is folded in deliberately: it should always coincide with
    // `redacted`, and if it ever does not, "unknown" is the honest reading.
    else if (row.redacted || row.value == null) verdict = 'withheld'
    else verdict = valuesMatchPreview(row.value, effective) ? 'matches' : 'will-change'

    return {
      deviceSn,
      reported: row && !row.redacted ? row.value : null,
      redacted: row?.redacted ?? false,
      effective,
      isOverride: override != null,
      verdict,
    }
  })

  return {
    key,
    fleetStandard,
    terminals,
    targetCount: terminals.filter(wouldBeWritten).length,
  }
}
