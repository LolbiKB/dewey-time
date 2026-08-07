import { describe, test, expect } from 'vitest'
import type { MatrixRow } from '@/lib/device-option-matrix'
import { fleetSummaryLabel } from './fleet-summary-label'

function row(cells: MatrixRow['cells']): MatrixRow {
  // The verdict is not read by the label — it describes the CELLS — so it is
  // fixed here rather than hand-maintained per case.
  return { key: 'VOLUME', kind: 'setting', verdict: 'unknown', cells }
}

const value = (v: string) => ({ present: true, redacted: false, value: v })
const withheld = { present: true, redacted: true, value: null }
const absent = { present: false, redacted: false, value: null }

describe('fleetSummaryLabel', () => {
  test('a value nobody can see is not a value', () => {
    // The defect: `groupRowValues` buckets withheld and absent cells like any
    // other, so counting BUCKETS renders "2 values" for one known value and
    // one unknown — contradicting "unknown is not different", and
    // contradicting the rail, which calls the same state uncomparable.
    expect(fleetSummaryLabel(row({ A: value('50'), B: withheld }), ['A', 'B'])).toBe(
      '1 of 2 report 50 · 1 withheld'
    )
  })

  test('an absent cell is not a value either, and is named as its own thing', () => {
    expect(fleetSummaryLabel(row({ A: value('50'), B: absent }), ['A', 'B'])).toBe(
      '1 of 2 report 50 · 1 not reported'
    )
  })

  test('counts only the values that are actually known', () => {
    expect(
      fleetSummaryLabel(row({ A: value('50'), B: value('20'), C: withheld }), ['A', 'B', 'C'])
    ).toBe('2 values · 1 withheld')
  })

  test('real disagreement still reads as the number of values', () => {
    expect(fleetSummaryLabel(row({ A: value('50'), B: value('20') }), ['A', 'B'])).toBe('2 values')
  })

  test('agreement is claimed only when every reporting terminal is comparable', () => {
    expect(fleetSummaryLabel(row({ A: value('50'), B: value('50') }), ['A', 'B'])).toBe(
      'all 2 agree · 50'
    )
  })

  test('a value withheld everywhere never reads as agreement', () => {
    const text = fleetSummaryLabel(row({ A: withheld, B: withheld }), ['A', 'B'])
    expect(text).toBe('withheld on all 2')
    expect(text).not.toMatch(/agree/i)
  })

  test('a key nobody reported never reads as agreement or as withheld', () => {
    const text = fleetSummaryLabel(row({ A: absent, B: absent }), ['A', 'B'])
    expect(text).toBe('not reported by any of 2')
    expect(text).not.toMatch(/agree|withheld/i)
  })

  test('withheld here and absent there is neither of those sentences', () => {
    // Both buckets present and no known value at all: saying "withheld on all"
    // or "not reported by any" would each be false about half the fleet.
    expect(fleetSummaryLabel(row({ A: withheld, B: absent }), ['A', 'B'])).toBe(
      'no value on hand from any of 2'
    )
  })
})
