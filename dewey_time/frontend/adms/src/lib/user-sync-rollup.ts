/**
 * One user's overall sync state, rolled up from the SAME per-component
 * evaluation the tiles render.
 *
 * The device dialog's headline count used to come from the server's sync
 * summary while the tiles came from the per-item flags. Two independent
 * answers to "is this user synced?" will drift, and they did: on 2026-08-12
 * terminal PYA8261900039 read "256 synced" while 229 of those users still had
 * an undelivered photo in the queue. `sync-status.ts` sets
 * `actual_state='synced'` without requiring `photo_synced`, so the headline
 * counted users whose own photo tile simultaneously read "Pending".
 *
 * This does not re-implement the tile logic — it CALLS it. The count cannot
 * disagree with the tiles because it is derived from them.
 */
import {
  getComponentSyncStatus,
  type GetComponentSyncOptions,
  type SyncComponent,
  type SyncStatusRow,
} from './sync-component-status'

/** Every component a user can have. Inapplicable ones are dropped per user. */
export const SYNC_COMPONENTS: readonly SyncComponent[] = [
  'user',
  'fingerprint',
  'face',
  'photo',
] as const

export type UserSyncRollup = 'synced' | 'syncing' | 'pending' | 'failed'

/**
 * WORST APPLICABLE COMPONENT WINS: failed > syncing > pending > synced.
 *
 * A user with three delivered components and one outstanding is not synced —
 * that is the whole point. Inapplicable components (no photo on file, no
 * fingerprints enrolled) are skipped rather than counted as outstanding, or
 * every user without a photo would be held at "syncing" forever, which is the
 * same lie in the other direction.
 */
export function rollUpUserSyncState(
  status: SyncStatusRow,
  options: GetComponentSyncOptions = {}
): UserSyncRollup {
  const applicable = SYNC_COMPONENTS.map((component) =>
    getComponentSyncStatus(component, status, options)
  ).filter((result) => result.isApplicable)

  // Nothing applicable means nothing is outstanding — the user is provisioned
  // as far as anything can tell. Reporting "pending" here would strand a
  // record that has no work left to do.
  if (applicable.length === 0) return 'synced'

  if (applicable.some((r) => r.state === 'failed')) return 'failed'
  if (applicable.some((r) => r.state === 'syncing')) return 'syncing'
  if (applicable.some((r) => r.state === 'pending')) return 'pending'
  return 'synced'
}
