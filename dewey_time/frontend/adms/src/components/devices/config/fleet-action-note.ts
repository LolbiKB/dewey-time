import type { ApplyResult } from '@/services/device-service'

/**
 * What to tell the operator after a fleet-wide action.
 *
 * Both sentences below are about NOT OVERCLAIMING, which is why they are here
 * rather than inline in the page: nothing this page does reaches a terminal at
 * the moment you click it. A command is queued; the terminal collects it on
 * its next poll. "Applied" and "refreshed" are both past-tense claims about
 * hardware that has not been asked yet.
 */

/**
 * The result of an apply, stated in the SERVER's numbers.
 *
 * `KeyPlan.targetCount` is a preview computed from the last INFO dump. The
 * bridge recomputes against current state when it applies, so `result.queued`
 * is what actually happened and is the only number that may be reported.
 *
 * `queued: 0` reaching here means every comparable terminal already matched —
 * the cases where nothing could be compared at all arrive as thrown errors
 * carrying the bridge's own wording, not as this.
 */
export function applyNote(key: string, result: ApplyResult): string {
  const base =
    result.queued === 0
      ? (result.message ?? `Every terminal already matches ${key}.`)
      : `${key} queued for ${result.queued} terminal${result.queued === 1 ? '' : 's'} — each applies when it next polls.`

  if (!result.unverifiable?.length) return base
  // Named, not counted: these terminals were skipped because their current
  // value is withheld, so nothing about them was proven either way and the
  // operator needs to know WHICH boxes are still unaccounted for.
  return `${base} Could not compare ${result.unverifiable.join(', ')} — their value is withheld.`
}

export interface RereadOutcome {
  deviceSn: string
  /** The INFO command was accepted by the bridge. NOT that the terminal answered. */
  queued: boolean
}

/**
 * The result of re-reading the fleet, terminal by terminal.
 *
 * Each request is queued independently (`Promise.allSettled`), so a partial
 * failure is the normal case and a round number would hide it: "queued for 3
 * of 4" leaves the operator to work out which box is missing from a table of
 * near-identical serials. The ones that failed are named.
 */
export function rereadNote(outcomes: RereadOutcome[], label: (sn: string) => string): string {
  if (outcomes.length === 0) return 'No approved terminal to read from.'

  const failed = outcomes.filter((o) => !o.queued)
  const queued = outcomes.length - failed.length
  const names = failed.map((o) => label(o.deviceSn)).join(', ')

  if (failed.length === 0) {
    return `A configuration read is queued for ${queued} terminal${queued === 1 ? '' : 's'} — each answers when it next polls.`
  }
  if (queued === 0) {
    // No "queued for 0 terminals": nothing was queued, so nothing is pending.
    return `Could not queue a configuration read for ${names}.`
  }
  return `A configuration read is queued for ${queued} of ${outcomes.length} terminals — each answers when it next polls. Could not queue one for ${names}.`
}
