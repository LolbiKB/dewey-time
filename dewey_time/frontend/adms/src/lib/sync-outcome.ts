/**
 * Turning per-device sync results into one honest notification.
 *
 * The device steps are waited on with a 30s poll timeout, so "the wait ended"
 * is not the same as "the device applied it": a timeout leaves commands queued
 * for the next device poll, and a failed command needs a retry. Only a
 * confirmed command is success.
 */

export type DeviceSyncOutcome = 'success' | 'timeout' | 'failed' | 'cancelled'

/** Which step decided a non-success outcome. */
export type DeviceSyncStage = 'queue' | 'user' | 'biometrics'

export interface DeviceSyncResult {
  deviceSn: string
  outcome: DeviceSyncOutcome
  stage?: DeviceSyncStage
}

export type SyncNoticeLevel = 'success' | 'warning' | 'error'

export interface SyncNotice {
  level: SyncNoticeLevel
  title: string
  description?: string
}

const STAGE_LABELS: Record<DeviceSyncStage, string> = {
  queue: 'no command queued',
  user: 'user record',
  biometrics: 'biometrics',
}

function describe(results: DeviceSyncResult[]): string {
  return results
    .map((r) => (r.stage ? `${r.deviceSn} (${STAGE_LABELS[r.stage]})` : r.deviceSn))
    .join(', ')
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function summarizeDeviceSyncResults(results: DeviceSyncResult[]): SyncNotice {
  if (results.length === 0) {
    return {
      level: 'warning',
      title: 'Nothing was synced',
      description: 'No device sync was queued for this user.',
    }
  }

  const failed = results.filter((r) => r.outcome === 'failed')
  const timedOut = results.filter((r) => r.outcome === 'timeout')

  if (failed.length > 0) {
    const parts = [`Failed: ${describe(failed)}.`]
    if (timedOut.length > 0) {
      parts.push(`Unconfirmed: ${describe(timedOut)}.`)
    }
    parts.push('Retry the sync for those devices.')
    return {
      level: 'error',
      title: `Sync failed on ${failed.length} of ${results.length} device${results.length === 1 ? '' : 's'}`,
      description: parts.join(' '),
    }
  }

  if (timedOut.length > 0) {
    return {
      level: 'warning',
      title: `Sync not confirmed on ${plural(timedOut.length, 'device')}`,
      description: `Still waiting on ${describe(timedOut)}. The commands are still queued and run on the next device poll.`,
    }
  }

  return {
    level: 'success',
    title: 'Sync completed',
    ...(results.length > 1 ? { description: `Confirmed on ${plural(results.length, 'device')}.` } : {}),
  }
}
