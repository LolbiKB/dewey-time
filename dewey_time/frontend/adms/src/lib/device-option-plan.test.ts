import { describe, test, expect } from 'vitest'
import { buildKeyPlan } from './device-option-plan'
import type { DesiredOptionEntry, DeviceOptionEntry } from '@/services/device-service'

const SNS = ['A', 'B', 'C']

function observed(rows: Array<[string, string | null, boolean?]>): DeviceOptionEntry[] {
  return rows.map(([device_sn, value, redacted]) => ({
    device_sn, key: 'VOLUME', value, redacted: redacted ?? false,
    reported_at: '2026-08-06T00:00:00Z', kind: 'setting' as const,
  }))
}

function desired(rows: Array<[string | null, string]>): DesiredOptionEntry[] {
  return rows.map(([device_sn, value]) => ({
    device_sn, key: 'VOLUME', value, updated_by: 'a@b.c', updated_at: '2026-08-06T00:00:00Z',
  }))
}

describe('buildKeyPlan', () => {
  test('counts only the terminals that would actually change', () => {
    const plan = buildKeyPlan('VOLUME', desired([[null, '50']]),
      observed([['A', '50'], ['B', '20'], ['C', '60']]), SNS)

    expect(plan.targetCount).toBe(2)
    expect(plan.terminals.map((t) => t.verdict)).toEqual(['matches', 'will-change', 'will-change'])
  })

  test('an override beats the fleet standard', () => {
    const plan = buildKeyPlan('VOLUME', desired([[null, '50'], ['B', '20']]),
      observed([['A', '50'], ['B', '20'], ['C', '60']]), SNS)

    expect(plan.terminals[1]).toMatchObject({ effective: '20', isOverride: true, verdict: 'matches' })
    expect(plan.targetCount).toBe(1)
  })

  test('a withheld value is not a mismatch', () => {
    // The value is UNKNOWN, not different. Counting it as a target would push a
    // write on the strength of a comparison nobody made.
    const plan = buildKeyPlan('VOLUME', desired([[null, '50']]),
      observed([['A', null, true], ['B', '50'], ['C', '50']]), SNS)

    expect(plan.terminals[0].verdict).toBe('withheld')
    expect(plan.targetCount).toBe(0)
  })

  test('a null value counts as withheld even if the flag says otherwise', () => {
    // Fails safe. `value: null` with `redacted: false` should not happen, and
    // if it ever does, "unknown" is the honest reading — not "differs".
    const plan = buildKeyPlan('VOLUME', desired([[null, '50']]),
      observed([['A', null, false], ['B', '50'], ['C', '50']]), SNS)

    expect(plan.terminals[0].verdict).toBe('withheld')
    expect(plan.targetCount).toBe(0)
  })

  test('a terminal that has never reported is not a mismatch', () => {
    const plan = buildKeyPlan('VOLUME', desired([[null, '50']]),
      observed([['A', '50'], ['B', '50']]), SNS)

    expect(plan.terminals[2].verdict).toBe('not-reported')
    expect(plan.targetCount).toBe(0)
  })

  test('surrounding whitespace is not a difference', () => {
    // Matches the bridge's optionValuesMatch, which trims — the INFO parser
    // trims, so an untrimmed comparison would report drift the device does not
    // have and push a write that changes nothing.
    const plan = buildKeyPlan('VOLUME', desired([[null, '50']]),
      observed([['A', ' 50 '], ['B', '50'], ['C', '50']]), SNS)

    expect(plan.targetCount).toBe(0)
  })

  test('with nothing desired, no terminal is a target', () => {
    const plan = buildKeyPlan('VOLUME', [], observed([['A', '50'], ['B', '20'], ['C', '60']]), SNS)

    expect(plan.fleetStandard).toBeNull()
    expect(plan.terminals.every((t) => t.verdict === 'no-standard')).toBe(true)
    expect(plan.targetCount).toBe(0)
  })

  test('ignores desired and observed rows for other keys', () => {
    const other: DeviceOptionEntry[] = [{
      device_sn: 'A', key: 'Brightness', value: '0', redacted: false,
      reported_at: '2026-08-06T00:00:00Z', kind: 'setting',
    }]
    const plan = buildKeyPlan('VOLUME', desired([[null, '50']]),
      [...observed([['A', '50'], ['B', '50'], ['C', '50']]), ...other], SNS)

    expect(plan.targetCount).toBe(0)
  })
})
