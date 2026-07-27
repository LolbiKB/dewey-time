import { describe, expect, it } from 'vitest'
import { deriveEnrollPhase, shouldShowSlowHint, ENROLL_SLOW_HINT_MS } from './enrollment-phase'

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

describe('shouldShowSlowHint', () => {
  // A real fingerprint enrollment (walk to device + 3 presses + occasional bad-read retries)
  // routinely exceeds 30-45s. The "taking longer than expected" hint must NOT appear inside that
  // window, or a normal in-progress scan reads as a failure ("timeout -> retrying -> succeeds
  // anyway"). Aligned with the bridge's EARLY_RECOVERY_AFTER_MS (150s).
  it('is not shown 30s into a normal in-progress scan', () => {
    expect(shouldShowSlowHint('enrolling', 30_000)).toBe(false)
    expect(shouldShowSlowHint('accepted', 30_000)).toBe(false)
  })

  it('is shown once the interactive scan window (2.5 min) is clearly exceeded', () => {
    expect(shouldShowSlowHint('enrolling', ENROLL_SLOW_HINT_MS)).toBe(true)
    expect(shouldShowSlowHint('accepted', ENROLL_SLOW_HINT_MS + 1)).toBe(true)
  })

  it('never shows for non-active phases regardless of elapsed time', () => {
    for (const phase of ['idle', 'queued', 'success', 'failed', 'cleaning_up'] as const) {
      expect(shouldShowSlowHint(phase, 10 * 60_000)).toBe(false)
    }
  })

  it('waits at least a realistic interactive scan (>= 150s)', () => {
    expect(ENROLL_SLOW_HINT_MS).toBeGreaterThanOrEqual(150_000)
  })
})
