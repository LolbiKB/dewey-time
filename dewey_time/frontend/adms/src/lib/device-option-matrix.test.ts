import { describe, test, expect } from 'vitest'
import { buildOptionMatrix, countDrift, hasDrift } from './device-option-matrix'
import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * The fleet matrix decides what may be CONCLUDED from partial data, and every
 * way of getting that wrong produces a confident false alarm — the same failure
 * the capacity view already shipped once.
 *
 * Three traps, each pinned here:
 *   1. A withheld value is UNKNOWN, not different. authKey is redacted on every
 *      terminal; calling that agreement invents a fact, calling it drift
 *      invents an alarm.
 *   2. A device that has never reported is not a device that disagrees with
 *      everything. Otherwise approving a terminal turns all 78 rows red.
 *   3. A truncated row set makes present keys look absent, which renders as
 *      drift that is not real.
 */
const e = (
  device_sn: string,
  key: string,
  value: string | null,
  redacted = false
): DeviceOptionEntry => ({
  device_sn,
  key,
  value,
  redacted,
  reported_at: '2026-08-05T08:05:03.000Z',
})

const A = 'PYA8254100003'
const B = 'PYA8254100004'
const C = 'PYA8254100005'

describe('drift verdicts', () => {
  test('agrees when every reporting device reports the same value', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70'), e(B, 'VOLUME', '70')], [A, B])
    expect(m.rows[0].verdict).toBe('agree')
    expect(countDrift(m.rows)).toBe(0)
  })

  test('differs when they disagree', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70'), e(B, 'VOLUME', '20')], [A, B])
    expect(m.rows[0].verdict).toBe('differ')
    expect(hasDrift(m.rows[0])).toBe(true)
  })

  test('flags a key one terminal has and another does not', () => {
    const m = buildOptionMatrix(
      [e(A, 'QRCodeEnable', '1'), e(A, 'VOLUME', '70'), e(B, 'VOLUME', '70')],
      [A, B]
    )
    const qr = m.rows.find((r) => r.key === 'QRCodeEnable')!
    expect(qr.verdict).toBe('missing')
    expect(qr.cells[B].present).toBe(false)
  })
})

describe('withheld values are unknown, never a conclusion', () => {
  test('two withheld values are NOT agreement', () => {
    // authKey is redacted everywhere. Calling that "the fleet agrees" would
    // state a fact nobody has.
    const m = buildOptionMatrix(
      [e(A, 'authKey', null, true), e(B, 'authKey', null, true)],
      [A, B]
    )
    expect(m.rows[0].verdict).toBe('unknown')
    expect(hasDrift(m.rows[0])).toBe(false)
  })

  test('one withheld and one visible is NOT drift', () => {
    // We cannot know whether they match, so we must not raise an alarm.
    const m = buildOptionMatrix([e(A, 'authKey', null, true), e(B, 'authKey', 'x')], [A, B])
    expect(m.rows[0].verdict).toBe('unknown')
    expect(hasDrift(m.rows[0])).toBe(false)
  })

  test('a withheld cell still reads as withheld, not as unset', () => {
    const m = buildOptionMatrix([e(A, 'authKey', null, true), e(B, 'VOLUME', '1')], [A, B])
    const auth = m.rows.find((r) => r.key === 'authKey')!
    expect(auth.cells[A]).toMatchObject({ present: true, redacted: true })
    // B never reported authKey — that is absence, a different thing entirely.
    expect(auth.cells[B]).toMatchObject({ present: false, redacted: false })
  })
})

describe('a silent device is not a dissenting device', () => {
  test('excludes a device that has reported nothing from every verdict', () => {
    // The case that would otherwise turn all 78 rows red the moment a terminal
    // is approved.
    const m = buildOptionMatrix([e(A, 'VOLUME', '70'), e(B, 'VOLUME', '70')], [A, B, C])

    expect(m.silentDevices).toEqual([C])
    expect(m.reportingDevices).toEqual([A, B])
    expect(m.rows[0].verdict).toBe('agree')
    expect(countDrift(m.rows)).toBe(0)
  })

  test('still renders a column for the silent device', () => {
    // Hiding it would misrepresent the fleet as smaller than it is.
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A, C])
    expect(m.rows[0].cells[C]).toMatchObject({ present: false })
  })

  test('cannot judge drift from a single reporter', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A, B])
    expect(m.rows[0].verdict).toBe('unknown')
  })
})

describe('truncation', () => {
  test('reports truncation when the API bound was reached', () => {
    // A truncated row set makes present keys look absent, which renders as
    // drift that is not real. The UI has to be able to say so.
    const entries = Array.from({ length: 500 }, (_, i) => e(A, `K${i}`, 'v'))
    const m = buildOptionMatrix(entries, [A], { limit: 500 })
    expect(m.truncated).toBe(true)
  })

  test('is not truncated below the bound', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A], { limit: 500 })
    expect(m.truncated).toBe(false)
  })

  test('is not truncated when no bound was given', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A])
    expect(m.truncated).toBe(false)
  })
})

describe('shape', () => {
  test('ignores rows for serials the caller did not ask about', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70'), e(C, 'VOLUME', '20')], [A, B])
    expect(m.rows[0].verdict).toBe('unknown')
    expect(m.rows[0].cells[C]).toBeUndefined()
  })

  test('sorts rows by key so the grid is stable between loads', () => {
    const m = buildOptionMatrix(
      [e(A, 'VOLUME', '1'), e(A, 'Brightness', '2'), e(A, 'Language', '3')],
      [A]
    )
    expect(m.rows.map((r) => r.key)).toEqual(['Brightness', 'Language', 'VOLUME'])
  })

  test('gives every row a cell for every requested device', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A, B, C])
    expect(Object.keys(m.rows[0].cells).sort()).toEqual([A, B, C].sort())
  })

  test('handles an empty fleet without inventing rows', () => {
    const m = buildOptionMatrix([], [])
    expect(m.rows).toEqual([])
    expect(m.reportingDevices).toEqual([])
  })
})
