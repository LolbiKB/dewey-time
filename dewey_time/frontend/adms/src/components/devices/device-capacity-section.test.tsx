import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  deriveCapacity,
  capacitySignal,
  formatCapacityValue,
  DeviceCapacityPanel,
} from './device-capacity-section'
import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * Fleet capacity, derived from what a terminal reports about itself.
 *
 * The whole feature is a pair of numbers per resource — a live counter and its
 * hardware limit — and the only way it can hurt anyone is by showing a
 * confident number that is wrong. Three ways that happens, each pinned below:
 *
 *   1. A pairing that does not correspond. `ATTPhotoCount` and
 *      `~MaxBioPhotoCount` are DIFFERENT resources, and pairing them would
 *      render a plausible percentage of the wrong denominator. Only pairs whose
 *      correspondence is unambiguous are declared.
 *   2. A missing side rendered as zero. Every value is redacted today, and will
 *      stay redacted for keys nobody reviews. An unknown numerator must read as
 *      unknown, never as "0% full".
 *   3. Arithmetic on a non-number. Values arrive as strings straight off the
 *      wire; `Number('')` is 0 and `Number('x')` is NaN, and both would render.
 */
const opt = (key: string, value: string | null, redacted = false): DeviceOptionEntry => ({
  device_sn: 'PYA8254100003',
  key,
  value,
  redacted,
  reported_at: '2026-08-05T07:05:58.000Z',
})

/** The state the fleet is in right now: every key known, every value withheld. */
const allRedacted = (keys: string[]) => keys.map((k) => opt(k, null, true))

describe('deriveCapacity', () => {
  test('pairs a counter with its limit and computes the percentage', () => {
    const metrics = deriveCapacity([opt('UserCount', '340'), opt('~MaxUserCount', '1000')])
    const users = metrics.find((m) => m.label === 'Users')!

    expect(users.used).toBe(340)
    expect(users.limit).toBe(1000)
    expect(users.percent).toBe(34)
  })

  test('reports unknown — not zero — when the value is withheld', () => {
    // Today's state for every key. A withheld numerator rendered as 0 would
    // tell an admin a full terminal is empty.
    const metrics = deriveCapacity(allRedacted(['UserCount', '~MaxUserCount']))
    const users = metrics.find((m) => m.label === 'Users')!

    expect(users.used).toBeNull()
    expect(users.limit).toBeNull()
    expect(users.percent).toBeNull()
  })

  test('reports unknown when only one side of the pair is present', () => {
    const metrics = deriveCapacity([opt('UserCount', '340')])
    const users = metrics.find((m) => m.label === 'Users')!

    expect(users.used).toBe(340)
    expect(users.limit).toBeNull()
    expect(users.percent).toBeNull()
  })

  test('never returns NaN for a non-numeric or empty value', () => {
    // Values come off the wire as strings. Number('') is 0, Number('x') is NaN.
    const metrics = deriveCapacity([
      opt('UserCount', 'n/a'),
      opt('~MaxUserCount', ''),
      opt('FPCount', '12'),
      opt('~MaxFingerCount', 'unsupported'),
    ])

    for (const m of metrics) {
      expect(m.used).not.toBeNaN()
      expect(m.limit).not.toBeNaN()
      expect(m.percent).not.toBeNaN()
    }
    expect(metrics.find((m) => m.label === 'Users')!.used).toBeNull()
    expect(metrics.find((m) => m.label === 'Fingerprints')!.limit).toBeNull()
  })

  test('does not divide by a zero limit', () => {
    const metrics = deriveCapacity([opt('UserCount', '5'), opt('~MaxUserCount', '0')])
    const users = metrics.find((m) => m.label === 'Users')!

    expect(users.percent).toBeNull()
    expect(Number.isFinite(users.percent ?? 0)).toBe(true)
  })

  test('treats FreeFlashSize as remaining, not as used', () => {
    // The one inverted pair: the device reports what is FREE. Reading it as
    // used would invert the whole bar — a nearly-full disk shown as nearly
    // empty, which is the exact opposite of the operational signal.
    const metrics = deriveCapacity([opt('FlashSize', '1000'), opt('FreeFlashSize', '250')])
    const storage = metrics.find((m) => m.label === 'Storage')!

    expect(storage.used).toBe(750)
    expect(storage.percent).toBe(75)
  })

  test('clamps an inverted pair that reports more free than total', () => {
    // Firmware disagreeing with itself must not produce a negative bar.
    const metrics = deriveCapacity([opt('FlashSize', '100'), opt('FreeFlashSize', '150')])
    const storage = metrics.find((m) => m.label === 'Storage')!

    expect(storage.used).toBe(0)
    expect(storage.percent).toBe(0)
  })

  test('does NOT pair attendance photos with the bio-photo limit', () => {
    // ATTPhotoCount and ~MaxBioPhotoCount are different resources. Pairing them
    // would produce a confident percentage of the wrong denominator — the exact
    // class of error this module exists to avoid.
    const metrics = deriveCapacity([opt('ATTPhotoCount', '50'), opt('~MaxBioPhotoCount', '100')])

    expect(metrics.some((m) => m.percent === 50)).toBe(false)
  })

  test('returns every declared metric even when the device reported nothing', () => {
    // The panel must show the full resource list with "not reported" rather
    // than silently omitting rows, or a missing row reads as a missing feature.
    const metrics = deriveCapacity([])
    expect(metrics.length).toBeGreaterThanOrEqual(7)
    expect(metrics.every((m) => m.percent === null)).toBe(true)
  })

  test('rounds to a whole percent rather than showing false precision', () => {
    const metrics = deriveCapacity([opt('UserCount', '1'), opt('~MaxUserCount', '3')])
    expect(metrics.find((m) => m.label === 'Users')!.percent).toBe(33)
  })
})

describe('capacitySignal', () => {
  test('is idle when the percentage is unknown', () => {
    // Unknown is not healthy. It must not render green.
    expect(capacitySignal(null)).toBe('idle')
  })

  test('escalates as the resource fills', () => {
    expect(capacitySignal(10)).toBe('success')
    expect(capacitySignal(74)).toBe('success')
    expect(capacitySignal(75)).toBe('attention')
    expect(capacitySignal(89)).toBe('attention')
    expect(capacitySignal(90)).toBe('danger')
    expect(capacitySignal(100)).toBe('danger')
  })
})

describe('formatCapacityValue', () => {
  test('says not reported rather than printing a zero it does not have', () => {
    expect(formatCapacityValue(null)).toMatch(/not reported/i)
    expect(formatCapacityValue(null)).not.toContain('0')
  })

  test('groups large counts for readability', () => {
    expect(formatCapacityValue(1000000)).toMatch(/1[,.\s]000[,.\s]000/)
  })

  test('prints a genuine zero as zero', () => {
    expect(formatCapacityValue(0)).toBe('0')
  })
})

describe('DeviceCapacityPanel', () => {
  const REAL_KEYS = [
    'UserCount', '~MaxUserCount', 'FPCount', '~MaxFingerCount',
    'FaceCount', '~MaxFaceCount', 'TransactionCount', '~MaxAttLogCount',
  ]

  test('explains that nothing is reported yet instead of rendering empty bars', () => {
    const html = renderToStaticMarkup(<DeviceCapacityPanel options={allRedacted(REAL_KEYS)} />)
    expect(html).toMatch(/not reported/i)
    expect(html).not.toMatch(/\b0%/)
  })

  test('renders the used-of-limit figures once values arrive', () => {
    const html = renderToStaticMarkup(
      <DeviceCapacityPanel options={[opt('UserCount', '340'), opt('~MaxUserCount', '1000')]} />
    )
    expect(html).toContain('340')
    expect(html).toContain('1,000')
    expect(html).toContain('34%')
  })

  test('always lists every resource, so a silent omission never reads as absent', () => {
    const html = renderToStaticMarkup(<DeviceCapacityPanel options={[]} />)
    for (const label of ['Users', 'Fingerprints', 'Faces', 'Storage']) {
      expect(html).toContain(label)
    }
  })

  test('never claims a withheld resource is healthy', () => {
    // An unknown row must not be styled with the success signal.
    const html = renderToStaticMarkup(<DeviceCapacityPanel options={allRedacted(REAL_KEYS)} />)
    expect(html).not.toContain('text-primary')
  })
})
