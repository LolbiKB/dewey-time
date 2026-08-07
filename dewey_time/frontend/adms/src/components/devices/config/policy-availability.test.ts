import { describe, test, expect } from 'vitest'
import { policyAvailability } from './policy-availability'

describe('policyAvailability', () => {
  test('a failed read with nothing in hand is UNAVAILABLE, never "nothing is stored"', () => {
    // The defect: a 500 from /admin/device-option-policy left `desired` as []
    // and the pane then said "No fleet standard yet — save one first", which
    // invites overwriting a standard the operator could not see.
    expect(policyAvailability({ loading: false, failed: true, hasData: false })).toBe('unavailable')
  })

  test('data in hand wins over a failed refetch', () => {
    // React Query keeps the last good policy when a later poll errors. Those
    // values are real, merely possibly stale, and the page's "could not
    // refresh" alert already says so — blanking the pane would discard true
    // information because a background poll failed.
    expect(policyAvailability({ loading: false, failed: true, hasData: true })).toBe('available')
  })

  test('a first read still in flight is loading, not an empty policy', () => {
    expect(policyAvailability({ loading: true, failed: false, hasData: false })).toBe('loading')
  })

  test('nothing in hand and nothing wrong yet is still loading — never "nothing is stored"', () => {
    // The instant before the request starts. An empty policy is a FACT the
    // page may only state once the bridge has answered with one.
    expect(policyAvailability({ loading: false, failed: false, hasData: false })).toBe('loading')
  })

  test('a loaded policy is available even while it refetches', () => {
    expect(policyAvailability({ loading: false, failed: false, hasData: true })).toBe('available')
    expect(policyAvailability({ loading: true, failed: false, hasData: true })).toBe('available')
  })
})
