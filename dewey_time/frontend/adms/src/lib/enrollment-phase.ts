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
