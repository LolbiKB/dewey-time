import type { ApplyResult } from '@/services/device-service'

/**
 * What to tell the operator after an action on this page.
 *
 * Every sentence below is about NOT OVERCLAIMING, which is why they live here
 * rather than inline in the page: nothing this page does reaches a terminal at
 * the moment you click it. A desired value is stored and no command is sent at
 * all; a write is queued and the terminal collects it on its next poll.
 * "Applied", "refreshed" and "set" are all past-tense claims about hardware
 * that has not been asked yet.
 */

/**
 * A value was STORED. Nothing was sent anywhere.
 *
 * These three sit beside the two below rather than inline in the page because
 * they make the same class of claim and carry the same risk: a stored desired
 * value changes a row in the bridge's table and touches no terminal. An
 * operator who reads "saved" as "set" believes the fleet changed while every
 * terminal still reports what it did before — so each sentence says where the
 * value has got to and what is still needed to move it.
 */
export function standardStoredNote(key: string, value: string): string {
  return `Saved ${value} as the fleet standard for ${key}. Nothing is written to a terminal until you try it or apply it.`
}

export function overrideStoredNote(key: string, terminal: string, value: string): string {
  return `Saved ${value} for ${terminal}, overriding the fleet standard for ${key}. Nothing is written to a terminal until you apply it.`
}

export function overrideClearedNote(key: string, terminal: string): string {
  // Clearing an override changes what WOULD be pushed, never what the terminal
  // currently reports — the row that was pinning it is gone; the value on the
  // box is not.
  return `${terminal} follows the fleet standard for ${key} again. Its current value is unchanged until you apply.`
}

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
