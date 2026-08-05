import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  deriveCapacity,
  deriveCounters,
  capacitySignal,
  formatCapacityValue,
  DeviceCapacityPanel,
} from './device-capacity-section'
import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * Fleet capacity, derived from what a terminal reports about itself.
 *
 * THIS MODULE SHIPPED WRONG ONCE. The first version paired each `*Count`
 * counter with the `~Max*Count` key of the matching name and rendered a
 * percentage. Against the first real dump that produced "Users 71/80 = 89%"
 * and "Attendance records 78/20 = 390%" on a terminal that was under 1% full.
 *
 * The 390% is the tell: a used/limit ratio CANNOT exceed 100%. The `~Max*Count`
 * keys are scaled, and not consistently — ~MaxFingerCount reports 80 for a real
 * 8000 (x100), ~MaxFaceCount reports 6000 for a real 6000 (x1), and
 * ~MaxAttLogCount reports 20 for something above 78 (x1000 at least). There is
 * no rule to derive, so they are not used as denominators at all.
 *
 * The trustworthy source is `MaxMultiBioDataCount` — a colon-delimited vector
 * indexed by biometric type, unscaled, and corroborated by `MultiBioDataSupport`
 * (which types exist) and `MultiBioVersion` (whose values match ~ZKFPVersion and
 * FaceVersion). Everything it cannot cover is shown as a plain counter with no
 * denominator, because a missing number is honest and a wrong one is not.
 *
 * The tests that let the bug through checked the MECHANISM — pairing, nulls,
 * clamping — and never the PREMISE that two keys measure the same thing in the
 * same unit. The real dump is now a fixture here, which is the only thing that
 * would have caught it.
 */
const opt = (key: string, value: string | null, redacted = false): DeviceOptionEntry => ({
  device_sn: 'PYA8254100003',
  key,
  value,
  redacted,
  kind: 'setting',
  reported_at: '2026-08-05T08:05:03.000Z',
})

/**
 * The real SenseFace 4A dump, 2026-08-05 — the one that exposed the bug.
 * Trimmed to the keys this module reads.
 */
const REAL_DUMP: Record<string, string> = {
  '~MaxAttLogCount': '20',
  '~MaxBioPhotoCount': '6000',
  '~MaxFaceCount': '6000',
  '~MaxFingerCount': '80',
  '~MaxFvCount': '10',
  '~MaxPvCount': '0',
  '~MaxUserCount': '80',
  '~MaxUserPhotoCount': '8000',
  ATTPhotoCount: '0',
  FaceCount: '0',
  FPCount: '68',
  FvCount: '0',
  PvCount: '0',
  TransactionCount: '78',
  UserCardCount: '0',
  UserCount: '71',
  UserPhotoCount: '63',
  FlashSize: '5371080',
  FreeFlashSize: '5075920',
  MaxMultiBioDataCount: '0:8000:0:0:0:0:0:0:0:6000',
  MultiBioDataSupport: '0:1:0:0:0:0:0:0:0:1',
  MultiBioVersion: '0:10.0:0:0:0:0:0:0:0:40.1',
}

const asOptions = (raw: Record<string, string>): DeviceOptionEntry[] =>
  Object.entries(raw).map(([k, v]) => opt(k, v))

const realOptions = () => asOptions(REAL_DUMP)

describe('the regression this module exists to prevent', () => {
  test('NO metric ever exceeds 100% on the real dump', () => {
    // The single assertion that would have caught the shipped bug.
    for (const m of deriveCapacity(realOptions())) {
      if (m.percent != null) expect(m.percent).toBeLessThanOrEqual(100)
    }
  })

  test('reports the real dump as nearly empty, not nearly full', () => {
    const byLabel = new Map(deriveCapacity(realOptions()).map((m) => [m.label, m]))

    // 68 fingerprints against a real 8000, not the scaled 80 that read as 85%.
    expect(byLabel.get('Fingerprints')!.limit).toBe(8000)
    expect(byLabel.get('Fingerprints')!.percent).toBe(1)

    expect(byLabel.get('Faces')!.limit).toBe(6000)
    expect(byLabel.get('Faces')!.percent).toBe(0)
  })

  test('never renders a danger or attention signal for the real dump', () => {
    for (const m of deriveCapacity(realOptions())) {
      expect(capacitySignal(m.percent)).not.toBe('danger')
      expect(capacitySignal(m.percent)).not.toBe('attention')
    }
  })

  test('does not use ~MaxFingerCount as a denominator', () => {
    // The scaled key reports 80. Using it gave 85% for 68 fingerprints.
    const fp = deriveCapacity(realOptions()).find((m) => m.label === 'Fingerprints')!
    expect(fp.limit).not.toBe(80)
  })

  test('shows users and attendance records as counters with NO denominator', () => {
    // ~MaxUserCount (80) and ~MaxAttLogCount (20) are scaled by unknown and
    // differing factors. A counter with no denominator is honest; 89% and 390%
    // were not.
    const counters = deriveCounters(realOptions())
    expect(counters.find((c) => c.label === 'Users')!.value).toBe(71)
    expect(counters.find((c) => c.label === 'Attendance records')!.value).toBe(78)

    const capacityLabels = deriveCapacity(realOptions()).map((m) => m.label)
    expect(capacityLabels).not.toContain('Users')
    expect(capacityLabels).not.toContain('Attendance records')
  })
})

describe('deriveCapacity', () => {
  test('reads fingerprint capacity from the multi-bio vector, index 2', () => {
    const metrics = deriveCapacity([
      opt('FPCount', '100'),
      opt('MaxMultiBioDataCount', '0:8000:0:0:0:0:0:0:0:6000'),
      opt('MultiBioDataSupport', '0:1:0:0:0:0:0:0:0:1'),
    ])
    const fp = metrics.find((m) => m.label === 'Fingerprints')!
    expect(fp.limit).toBe(8000)
    expect(fp.percent).toBe(1)
  })

  test('reads face capacity from index 10', () => {
    const metrics = deriveCapacity([
      opt('FaceCount', '3000'),
      opt('MaxMultiBioDataCount', '0:8000:0:0:0:0:0:0:0:6000'),
      opt('MultiBioDataSupport', '0:1:0:0:0:0:0:0:0:1'),
    ])
    expect(metrics.find((m) => m.label === 'Faces')!.percent).toBe(50)
  })

  test('marks a biometric the device does not have as unsupported', () => {
    // MultiBioDataSupport index 2 is 0 — this unit has no fingerprint reader.
    const metrics = deriveCapacity([
      opt('FPCount', '0'),
      opt('MaxMultiBioDataCount', '0:0:0:0:0:0:0:0:0:6000'),
      opt('MultiBioDataSupport', '0:0:0:0:0:0:0:0:0:1'),
    ])
    const fp = metrics.find((m) => m.label === 'Fingerprints')!
    expect(fp.supported).toBe(false)
    expect(fp.percent).toBeNull()
  })

  test('refuses a percentage when used exceeds limit', () => {
    // Impossible for a real pair, so it is EVIDENCE the pairing is wrong.
    // Refuse the number rather than print an absurd one — this is the specific
    // defence against the 390% that shipped.
    const metrics = deriveCapacity([
      opt('FPCount', '9000'),
      opt('MaxMultiBioDataCount', '0:8000:0:0:0:0:0:0:0:6000'),
      opt('MultiBioDataSupport', '0:1:0:0:0:0:0:0:0:1'),
    ])
    const fp = metrics.find((m) => m.label === 'Fingerprints')!
    expect(fp.percent).toBeNull()
    expect(fp.note).toMatch(/exceed|more than|inconsist/i)
  })

  test('treats FreeFlashSize as remaining, not as used', () => {
    const metrics = deriveCapacity([opt('FlashSize', '1000'), opt('FreeFlashSize', '250')])
    const storage = metrics.find((m) => m.label === 'Storage')!
    expect(storage.used).toBe(750)
    expect(storage.percent).toBe(75)
  })

  test('clamps an inverted pair reporting more free than total', () => {
    const metrics = deriveCapacity([opt('FlashSize', '100'), opt('FreeFlashSize', '150')])
    expect(metrics.find((m) => m.label === 'Storage')!.used).toBe(0)
  })

  test('reports unknown — not zero — when values are withheld', () => {
    const metrics = deriveCapacity([
      opt('FPCount', null, true),
      opt('MaxMultiBioDataCount', null, true),
    ])
    const fp = metrics.find((m) => m.label === 'Fingerprints')!
    expect(fp.used).toBeNull()
    expect(fp.percent).toBeNull()
  })

  test('never returns NaN for a malformed vector or non-numeric value', () => {
    const metrics = deriveCapacity([
      opt('FPCount', 'n/a'),
      opt('MaxMultiBioDataCount', 'not:a:vector'),
      opt('FlashSize', ''),
      opt('FreeFlashSize', 'x'),
    ])
    for (const m of metrics) {
      expect(m.used).not.toBeNaN()
      expect(m.limit).not.toBeNaN()
      expect(m.percent).not.toBeNaN()
    }
  })

  test('does not divide by a zero limit', () => {
    const metrics = deriveCapacity([
      opt('FPCount', '5'),
      opt('MaxMultiBioDataCount', '0:0:0:0:0:0:0:0:0:0'),
      opt('MultiBioDataSupport', '0:1:0:0:0:0:0:0:0:1'),
    ])
    expect(metrics.find((m) => m.label === 'Fingerprints')!.percent).toBeNull()
  })

  test('returns every declared metric even when nothing was reported', () => {
    const metrics = deriveCapacity([])
    expect(metrics.length).toBe(3)
    expect(metrics.every((m) => m.percent === null)).toBe(true)
  })
})

describe('deriveCounters', () => {
  test('reports plain figures with no denominator', () => {
    const counters = deriveCounters(realOptions())
    expect(counters.find((c) => c.label === 'User photos')!.value).toBe(63)
    expect(counters.find((c) => c.label === 'Cards')!.value).toBe(0)
  })

  test('is null, not zero, when a counter is withheld', () => {
    const counters = deriveCounters([opt('UserCount', null, true)])
    expect(counters.find((c) => c.label === 'Users')!.value).toBeNull()
  })
})

describe('capacitySignal', () => {
  test('is idle when the percentage is unknown', () => {
    expect(capacitySignal(null)).toBe('idle')
  })

  test('escalates as the resource fills', () => {
    expect(capacitySignal(10)).toBe('success')
    expect(capacitySignal(74)).toBe('success')
    expect(capacitySignal(75)).toBe('attention')
    expect(capacitySignal(90)).toBe('danger')
  })
})

describe('formatCapacityValue', () => {
  test('says not reported rather than printing a zero it does not have', () => {
    expect(formatCapacityValue(null)).toMatch(/not reported/i)
    expect(formatCapacityValue(null)).not.toContain('0')
  })

  test('groups large counts and prints a genuine zero', () => {
    expect(formatCapacityValue(1000000)).toMatch(/1[,.\s]000[,.\s]000/)
    expect(formatCapacityValue(0)).toBe('0')
  })
})

describe('DeviceCapacityPanel', () => {
  test('renders the real dump without any alarming figure', () => {
    const html = renderToStaticMarkup(<DeviceCapacityPanel options={realOptions()} />)
    expect(html).not.toContain('390%')
    expect(html).not.toContain('89%')
    expect(html).not.toContain('85%')
    expect(html).not.toContain('text-destructive')
  })

  test('shows the real counters as plain figures', () => {
    const html = renderToStaticMarkup(<DeviceCapacityPanel options={realOptions()} />)
    expect(html).toContain('Users')
    expect(html).toContain('71')
    expect(html).toContain('78')
  })

  test('explains that nothing is reported yet instead of rendering empty bars', () => {
    const html = renderToStaticMarkup(<DeviceCapacityPanel options={[]} />)
    expect(html).toMatch(/not reported/i)
    expect(html).not.toMatch(/\b0%/)
  })

  test('never claims a withheld resource is healthy', () => {
    const html = renderToStaticMarkup(
      <DeviceCapacityPanel options={[opt('FPCount', null, true)]} />
    )
    expect(html).not.toContain('text-primary')
  })
})
