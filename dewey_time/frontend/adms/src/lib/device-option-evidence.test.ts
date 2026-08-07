import { describe, test, expect } from 'vitest'
import { toEvidenceLine } from './device-option-evidence'
import type { OptionWriteRecord } from '@/services/device-service'

const BASE: OptionWriteRecord = {
  id: 1, device_sn: 'PYA8254100003', key: 'VOLUME', desired_value: '50',
  observed_value: '50', status: 'applied', is_canary: true, error_code: null,
  created_at: '2026-08-06T14:22:00.000Z', resolved_at: '2026-08-06T14:22:13.000Z',
}

describe('toEvidenceLine', () => {
  test('reports how long the terminal took to answer', () => {
    expect(toEvidenceLine(BASE).elapsed).toBe('13s')
  })

  test('shows no duration for a write nobody has answered', () => {
    // NEVER a fabricated number. An unresolved write has no elapsed time, and
    // "0s" would read as an instant success.
    const line = toEvidenceLine({ ...BASE, status: 'pending', resolved_at: null })
    expect(line.elapsed).toBeNull()
    expect(line.outcome).toMatch(/waiting/i)
  })

  test('shows no duration rather than NaN for an unparsable timestamp', () => {
    expect(toEvidenceLine({ ...BASE, resolved_at: 'not-a-date' }).elapsed).toBeNull()
  })

  test('distinguishes a value that did not stick from a refusal', () => {
    // Different problems with different fixes. "mismatched" means every command
    // succeeded and the terminal still reports the old value; "rejected" means
    // the terminal said no, and its code is the actionable part.
    expect(toEvidenceLine({ ...BASE, status: 'mismatched', observed_value: '70' }).outcome)
      .toMatch(/did not stick/i)
    expect(toEvidenceLine({ ...BASE, status: 'rejected', error_code: '-1002' }).detail)
      .toMatch(/-1002/)
  })

  test('explains an abandoned write as a delivery failure, not a refusal', () => {
    // Blaming the hardware for a queue problem sends the operator to look at
    // firmware support for a key that was never asked about.
    expect(toEvidenceLine({ ...BASE, status: 'abandoned', error_code: 'never_answered' }).detail)
      .toMatch(/never answered/i)
  })

  test('says which value was tried on which terminal', () => {
    const line = toEvidenceLine(BASE)
    expect(line.what).toContain('50')
    expect(line.what).toContain('PYA8254100003')
  })

  test('never says "applied" for a write still in flight', () => {
    const line = toEvidenceLine({ ...BASE, status: 'pending', resolved_at: null })
    expect(line.outcome.toLowerCase()).not.toContain('applied')
  })

  test('shows no duration when the resolved timestamp is somehow before created', () => {
    // Same "never fabricate" rule as the unparsable case — a negative duration
    // is not a real elapsed time either.
    const line = toEvidenceLine({ ...BASE, created_at: '2026-08-06T14:22:13.000Z', resolved_at: '2026-08-06T14:22:00.000Z' })
    expect(line.elapsed).toBeNull()
  })

  test('marks a canary attempt as a try', () => {
    expect(toEvidenceLine({ ...BASE, is_canary: true }).what).toContain('(try)')
  })

  test('does not mark a fleet apply as a try', () => {
    expect(toEvidenceLine({ ...BASE, is_canary: false }).what).not.toContain('(try)')
  })

  test('passes a delivery-failure detail through describeLastError rather than restating it', () => {
    expect(toEvidenceLine({ ...BASE, status: 'abandoned', error_code: 'set_not_delivered' }).detail)
      .toMatch(/never reached the terminal/i)
    expect(toEvidenceLine({ ...BASE, status: 'abandoned', error_code: 'reload_not_delivered' }).detail)
      .toMatch(/never reloaded its configuration/i)
  })
})
