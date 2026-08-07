import { describe, test, expect } from 'vitest'
import { valueLabel, isSoft } from './device-option-cell-label'
import type { MatrixCell } from './device-option-matrix'

describe('valueLabel / isSoft', () => {
  test('a present, non-redacted value is shown as-is', () => {
    const cell: MatrixCell = { present: true, redacted: false, value: '512' }
    expect(valueLabel(cell)).toBe('512')
    expect(isSoft(cell)).toBe(false)
  })

  test('a redacted value reads Withheld, not blank and not the same as absent', () => {
    const cell: MatrixCell = { present: true, redacted: true, value: null }
    expect(valueLabel(cell)).toBe('Withheld')
    expect(isSoft(cell)).toBe(true)
  })

  test('an absent value reads Not reported, not the same as withheld', () => {
    const cell: MatrixCell = { present: false, redacted: false, value: null }
    expect(valueLabel(cell)).toBe('Not reported')
    expect(isSoft(cell)).toBe(true)
  })

  test('a missing cell (undefined) reads the same as an absent one', () => {
    expect(valueLabel(undefined)).toBe('Not reported')
    expect(isSoft(undefined)).toBe(true)
  })

  test('a present value that is the empty string reads (empty), not blank', () => {
    const cell: MatrixCell = { present: true, redacted: false, value: '' }
    expect(valueLabel(cell)).toBe('(empty)')
  })

  test('withheld and absent never render the same word', () => {
    const withheld: MatrixCell = { present: true, redacted: true, value: null }
    const absent: MatrixCell = { present: false, redacted: false, value: null }
    expect(valueLabel(withheld)).not.toBe(valueLabel(absent))
  })
})
