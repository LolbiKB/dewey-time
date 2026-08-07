import { describe, test, expect } from 'vitest'
import { splitSilentTerminals } from './silent-terminals'

describe('splitSilentTerminals', () => {
  test('a terminal whose read SUCCEEDED and returned nothing is genuinely silent', () => {
    // The only case where "has not reported yet" is a statement about the
    // hardware: we asked, the answer came back, and it was empty.
    expect(
      splitSilentTerminals(['A'], [{ deviceSn: 'A', failed: false, rowCount: 0 }])
    ).toEqual({ silent: ['A'], unreadable: [] })
  })

  test('a terminal whose read FAILED with nothing in hand is unreadable, never silent', () => {
    // The defect this exists to stop: a failed request rendering as a fact
    // about the terminal — "has not reported yet … a terminal reports on
    // approval, when a watched setting changes, and at least twice a day"
    // sends the operator to check a box that may well have reported.
    expect(
      splitSilentTerminals(['A'], [{ deviceSn: 'A', failed: true, rowCount: 0 }])
    ).toEqual({ silent: [], unreadable: ['A'] })
  })

  test('a terminal with rows in hand is neither, even if its latest read failed', () => {
    // It reported; only the REFRESH failed, which the stale-values alert
    // already covers. It is not in `silentDevices` at all in that case.
    expect(
      splitSilentTerminals([], [{ deviceSn: 'A', failed: true, rowCount: 12 }])
    ).toEqual({ silent: [], unreadable: [] })
  })

  test('splits a mixed fleet without inventing membership or reordering it', () => {
    const reads = [
      { deviceSn: 'A', failed: false, rowCount: 0 },
      { deviceSn: 'B', failed: true, rowCount: 0 },
      { deviceSn: 'C', failed: false, rowCount: 78 },
      { deviceSn: 'D', failed: false, rowCount: 0 },
    ]
    expect(splitSilentTerminals(['A', 'B', 'D'], reads)).toEqual({
      silent: ['A', 'D'],
      unreadable: ['B'],
    })
  })

  test('a failed read for a terminal nobody called silent is ignored', () => {
    // Membership comes from the matrix, not from the query list: a terminal
    // that HAS reported must not be named as unreadable merely because a
    // later poll failed.
    expect(
      splitSilentTerminals(['A'], [
        { deviceSn: 'A', failed: false, rowCount: 0 },
        { deviceSn: 'Z', failed: true, rowCount: 0 },
      ])
    ).toEqual({ silent: ['A'], unreadable: [] })
  })
})
