/**
 * When the fleet config page should keep re-reading itself.
 *
 * A CONFIG WRITE RESOLVES ASYNCHRONOUSLY, ON THE DEVICE'S TERMS. The bridge
 * queues SET OPTION → RELOAD OPTIONS → INFO and the verdict only exists once the
 * terminal has polled, executed all three, and its INFO dump has come back —
 * about thirteen seconds on real hardware, but bounded only by the poll cycle,
 * and up to thirty minutes before the abandonment sweep gives up.
 *
 * The first version refetched ONCE, on mutation success, and then never again.
 * That is the worst possible moment to look: the write is still `pending`, so
 * the ladder correctly reports the PREVIOUS verdict and `canaryInFlight: true`,
 * and the page then sits frozen on that snapshot while the real answer arrives
 * seconds later. The component says "Queued — verifying on next poll" and does
 * not itself go and look on the next poll.
 *
 * Two conditions, because they cover different writes:
 *
 *   `canaryInFlight` is reported per key by the bridge, from the same predicate
 *   that gates apply. It survives a page reload, so opening the page while a
 *   canary is outstanding starts polling without any local state.
 *
 *   `watchUntil` covers a FLEET apply, whose writes are not canaries and so
 *   raise no flag. It is set locally when a mutation succeeds and expires on its
 *   own, so a page left open overnight is not polling forever.
 */

/** How often to re-read while something is unresolved. Comfortably under the
 *  ~13s a real chain took, so an operator sees the answer land. */
export const POLICY_POLL_MS = 5_000

/**
 * How long to keep watching after a write is queued.
 *
 * Matches the bridge's WRITE_ABANDON_MS: after thirty minutes the sweep resolves
 * the row either way, so there is nothing further to wait for.
 */
export const WATCH_WINDOW_MS = 30 * 60 * 1000

export interface PollableKey {
  canaryInFlight?: boolean
}

/**
 * Should the page re-read now?
 *
 * @param keys       per-key state from the policy endpoint, if it has loaded
 * @param watchUntil epoch ms set when a mutation succeeded, or null
 * @param now        epoch ms
 */
export function shouldPollPolicy(
  keys: PollableKey[] | undefined,
  watchUntil: number | null,
  now: number
): boolean {
  if (keys?.some((k) => k.canaryInFlight)) return true
  return watchUntil != null && now < watchUntil
}

/** The refetch interval React Query wants: a number to poll, or false to stop. */
export function policyRefetchInterval(
  keys: PollableKey[] | undefined,
  watchUntil: number | null,
  now: number
): number | false {
  return shouldPollPolicy(keys, watchUntil, now) ? POLICY_POLL_MS : false
}
