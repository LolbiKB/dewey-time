import { describe, expect, it } from 'vitest'
import { deriveEnrollPhase } from './enrollment-phase'

describe('deriveEnrollPhase', () => {
  it('returns cleaning_up when terminal session has cleanup pending', () => {
    expect(
      deriveEnrollPhase('cancelled', 'failed', false, false, true, false)
    ).toBe('cleaning_up')
  })

  it('returns idle after cleanup completes on terminal session', () => {
    expect(
      deriveEnrollPhase('failed', 'failed', false, false, false, true)
    ).toBe('idle')
  })

  it('returns failed for terminal session without cleanup', () => {
    expect(deriveEnrollPhase('timed_out', 'failed', false, false)).toBe('failed')
  })

  it('returns success when cloud template exists', () => {
    expect(deriveEnrollPhase('awaiting_upload', 'sent', true, false)).toBe('success')
  })

  it('returns enrolling while awaiting upload on device', () => {
    expect(deriveEnrollPhase('awaiting_upload', 'sent', false, false)).toBe('enrolling')
  })

  it('returns accepted while pulling template', () => {
    expect(deriveEnrollPhase('awaiting_upload', 'sent', false, true)).toBe('accepted')
  })
})
