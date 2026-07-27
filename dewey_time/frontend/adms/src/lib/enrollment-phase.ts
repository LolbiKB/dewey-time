export type EnrollPhase =
  | 'idle'
  | 'queued'
  | 'enrolling'
  | 'accepted'
  | 'success'
  | 'failed'
  | 'cleaning_up'

/**
 * Backend-aligned enrollment phase (protocol §12.6.1 + §11.9).
 * Done only when template exists in cloud (`user_biometrics`).
 */
export function deriveEnrollPhase(
  sessionPhase: string | undefined,
  commandStatus: string | undefined | null,
  hasTemplate: boolean,
  isPullingTemplate: boolean,
  cleanupPending?: boolean,
  cleanupComplete?: boolean
): EnrollPhase {
  if (
    cleanupComplete &&
    (sessionPhase === 'failed' || sessionPhase === 'timed_out' || sessionPhase === 'cancelled')
  ) {
    return 'idle'
  }
  if (
    cleanupPending &&
    (sessionPhase === 'failed' || sessionPhase === 'timed_out' || sessionPhase === 'cancelled')
  ) {
    return 'cleaning_up'
  }
  if (sessionPhase === 'failed' || sessionPhase === 'timed_out' || sessionPhase === 'cancelled') {
    return 'failed'
  }
  if (commandStatus === 'failed' || commandStatus === 'cancelled') return 'failed'
  if (hasTemplate) return 'success'
  if (commandStatus === 'success' || isPullingTemplate) return 'accepted'
  if (sessionPhase === 'completed') return 'accepted'
  if (commandStatus === 'sent' || sessionPhase === 'awaiting_upload') return 'enrolling'
  if (commandStatus === 'pending' || sessionPhase === 'queued') return 'queued'
  return 'idle'
}

/**
 * Timing for the "still in progress" enrollment UI. The `awaiting_upload` clock starts when the
 * device opens its enroll dialog (bridge devicecmd Return=0), BEFORE the user scans, and there is
 * no device signal until the template uploads. A real fingerprint enrollment (walk to device +
 * 3 presses + occasional bad-read retries) routinely exceeds 30-45s, so a short timer makes a
 * normal in-progress scan read as a failure. Wait a realistic interactive scan first. Kept in
 * lockstep with the bridge's EARLY_RECOVERY_AFTER_MS (dewey-time-bridge enrollment-session.ts).
 */
export const ENROLL_SLOW_HINT_MS = 150_000
export const ENROLL_AUTO_RECOVERY_MS = 150_000

/**
 * Whether to surface the "taking longer than expected" hint. Only for an in-progress enrollment
 * (`enrolling` / `accepted`) that has clearly exceeded a realistic scan window — never a failure
 * signal, and never shown for terminal/idle/success phases.
 */
export function shouldShowSlowHint(phase: EnrollPhase, elapsedMs: number): boolean {
  if (phase !== 'enrolling' && phase !== 'accepted') return false
  return elapsedMs >= ENROLL_SLOW_HINT_MS
}
