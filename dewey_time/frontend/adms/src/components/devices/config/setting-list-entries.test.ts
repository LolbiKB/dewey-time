import { describe, test, expect } from 'vitest'
import { buildOptionMatrix } from '@/lib/device-option-matrix'
import type { DeviceOptionEntry, KeyKind } from '@/services/device-service'
import { settingListEntries, uncuratedDriftRows } from './setting-list-entries'

function entry(
  device_sn: string,
  key: string,
  value: string | null,
  extra: { redacted?: boolean; kind?: KeyKind } = {}
): DeviceOptionEntry {
  return {
    device_sn,
    key,
    value,
    redacted: extra.redacted ?? false,
    reported_at: '2026-01-01T00:00:00Z',
    kind: extra.kind ?? 'setting',
  }
}

/** The page's own derivation, so the verdicts under test are the real ones. */
function entriesFor(rows: DeviceOptionEntry[], sns: string[]) {
  const matrix = buildOptionMatrix(rows, sns)
  return settingListEntries(matrix.rows, matrix.reportingDevices)
}

function summaryOf(list: ReturnType<typeof entriesFor>, key: string) {
  return list.find((e) => e.key === key)
}

describe('settingListEntries', () => {
  test('lists every curated setting in catalogue order, labelled and keyed', () => {
    const list = entriesFor([entry('A', 'VOLUME', '50')], ['A'])
    expect(list.map((e) => e.key)).toEqual(['VOLUME', 'Brightness', 'Language', 'DtFmt', '~DSTF'])
    expect(summaryOf(list, 'VOLUME')?.label).toBe('Speaker volume')
  })

  test('a setting no terminal has reported says so, and is not drift', () => {
    // Absence everywhere is a fact about what the terminals sent, not a
    // disagreement between them.
    const list = entriesFor([entry('A', 'VOLUME', '50')], ['A', 'B'])
    expect(summaryOf(list, 'Brightness')?.summary).toBe('not reported')
    expect(summaryOf(list, 'Brightness')?.drifting).toBe(false)
  })

  test('agreement across every reporting terminal reads as agreement', () => {
    const list = entriesFor([entry('A', 'VOLUME', '50'), entry('B', 'VOLUME', '50')], ['A', 'B'])
    expect(summaryOf(list, 'VOLUME')?.summary).toBe('all agree')
    expect(summaryOf(list, 'VOLUME')?.drifting).toBe(false)
  })

  test('a disagreement counts the VALUES, not the terminals', () => {
    // "3 differ" beside three terminals reporting two values would be read as
    // "three terminals differ", which is not what the fleet is doing.
    const list = entriesFor(
      [entry('A', 'VOLUME', '50'), entry('B', 'VOLUME', '20'), entry('C', 'VOLUME', '20')],
      ['A', 'B', 'C']
    )
    expect(summaryOf(list, 'VOLUME')?.summary).toBe('2 values')
    expect(summaryOf(list, 'VOLUME')?.drifting).toBe(true)
  })

  test('a key some reporting terminals have and others do not is drift, and does not read as agreement', () => {
    const list = entriesFor([entry('A', 'VOLUME', '50'), entry('B', 'Language', '69')], ['A', 'B'])
    expect(summaryOf(list, 'VOLUME')?.summary).toBe('reported by 1 of 2')
    expect(summaryOf(list, 'VOLUME')?.drifting).toBe(true)
  })

  test('a value withheld on every terminal never reads as agreement', () => {
    // The fabricated-agreement trap: nobody can see the value, so "all agree"
    // would be a claim about something unknowable (device-option-matrix.ts).
    const list = entriesFor(
      [
        entry('A', 'VOLUME', null, { redacted: true }),
        entry('B', 'VOLUME', null, { redacted: true }),
      ],
      ['A', 'B']
    )
    expect(summaryOf(list, 'VOLUME')?.summary).toBe('withheld — cannot compare')
    expect(summaryOf(list, 'VOLUME')?.drifting).toBe(false)
  })

  test('one reporting terminal claims nothing about the fleet', () => {
    const list = entriesFor([entry('A', 'VOLUME', '50')], ['A', 'B'])
    expect(summaryOf(list, 'VOLUME')?.summary).toBe('one terminal reporting')
    expect(summaryOf(list, 'VOLUME')?.drifting).toBe(false)
  })
})

describe('uncuratedDriftRows', () => {
  test('is the drifting keys OUTSIDE the curated set — the ones the list cannot show', () => {
    const matrix = buildOptionMatrix(
      [
        entry('A', 'VOLUME', '50'),
        entry('B', 'VOLUME', '20'),
        entry('A', 'IsSupportNFC', '1'),
        entry('B', 'IsSupportNFC', '0'),
      ],
      ['A', 'B']
    )
    expect(uncuratedDriftRows(matrix.rows).map((r) => r.key)).toEqual(['IsSupportNFC'])
  })

  test('excludes identity and counter keys, which differ by nature', () => {
    const matrix = buildOptionMatrix(
      [
        entry('A', 'MAC', 'aa', { kind: 'identity' }),
        entry('B', 'MAC', 'bb', { kind: 'identity' }),
        entry('A', 'UserCount', '3', { kind: 'counter' }),
        entry('B', 'UserCount', '9', { kind: 'counter' }),
      ],
      ['A', 'B']
    )
    expect(uncuratedDriftRows(matrix.rows)).toEqual([])
  })
})
