import { describe, test, expect } from 'vitest'
import {
  shouldPollPolicy,
  policyRefetchInterval,
  POLICY_POLL_MS,
  WATCH_WINDOW_MS,
} from './device-option-polling'

/**
 * The bug this exists to prevent, stated once:
 *
 * The page refetched exactly once, on mutation success — the single worst moment
 * to look, because the write is still `pending` then. The ladder correctly
 * reported the PREVIOUS verdict and `canaryInFlight: true`, the Apply button was
 * therefore withheld, and the page then sat frozen on that snapshot while the
 * device answered thirteen seconds later. The operator saw "Queued — verifying
 * on next poll" and a UI that never verified on the next poll.
 */

const NOW = 1_800_000_000_000

describe('shouldPollPolicy', () => {
  test('polls while a canary is unanswered', () => {
    expect(shouldPollPolicy([{ canaryInFlight: true }], null, NOW)).toBe(true)
  })

  test('polls while a canary is unanswered even with no local watch window', () => {
    // The flag comes from the bridge, so it survives a reload — opening the page
    // while a canary is outstanding must start polling with no local state.
    expect(shouldPollPolicy([{ canaryInFlight: false }, { canaryInFlight: true }], null, NOW)).toBe(
      true
    )
  })

  test('polls inside the watch window even when no canary is in flight', () => {
    // A FLEET apply's writes are not canaries and raise no flag. Without this,
    // the drift view would sit stale after the operator applied to the fleet —
    // the same freeze, one action along.
    expect(shouldPollPolicy([{ canaryInFlight: false }], NOW + 60_000, NOW)).toBe(true)
  })

  test('stops once the watch window expires', () => {
    // A page left open overnight must not poll forever.
    expect(shouldPollPolicy([{ canaryInFlight: false }], NOW - 1, NOW)).toBe(false)
  })

  test('does not poll when nothing is outstanding', () => {
    expect(shouldPollPolicy([{ canaryInFlight: false }], null, NOW)).toBe(false)
    expect(shouldPollPolicy([], null, NOW)).toBe(false)
  })

  test('does not poll before the policy has loaded and nothing was queued', () => {
    // undefined keys is "not loaded yet", not "nothing in flight" — but with no
    // watch window there is also nothing to wait for.
    expect(shouldPollPolicy(undefined, null, NOW)).toBe(false)
  })

  test('polls before the policy has loaded IF a write was just queued', () => {
    expect(shouldPollPolicy(undefined, NOW + 1000, NOW)).toBe(true)
  })
})

describe('policyRefetchInterval', () => {
  test('returns false — not 0 — when idle', () => {
    // React Query treats 0 as "poll as fast as possible"; false is the stop
    // signal. Getting this wrong would hammer the bridge from every open tab.
    expect(policyRefetchInterval([{ canaryInFlight: false }], null, NOW)).toBe(false)
  })

  test('returns the interval while something is outstanding', () => {
    expect(policyRefetchInterval([{ canaryInFlight: true }], null, NOW)).toBe(POLICY_POLL_MS)
  })
})

describe('the constants', () => {
  test('polls faster than a real write takes to resolve', () => {
    // A real chain resolved in ~13s on hardware. An interval at or above that
    // would routinely miss the transition an operator is watching for.
    expect(POLICY_POLL_MS).toBeLessThan(13_000)
  })

  test('watches exactly as long as the bridge will leave a write unresolved', () => {
    // WRITE_ABANDON_MS: after this the sweep resolves the row either way, so
    // there is nothing further to wait for.
    expect(WATCH_WINDOW_MS).toBe(30 * 60 * 1000)
  })
})
