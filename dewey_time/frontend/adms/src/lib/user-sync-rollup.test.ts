import { test, expect, describe } from 'vitest'
import { rollUpUserSyncState } from './user-sync-rollup'
import { getComponentSyncStatus } from './sync-component-status'

/**
 * The device dialog's headline count, derived from the SAME per-component
 * evaluation the tiles render.
 *
 * It used to come from the server's sync summary while the tiles came from the
 * per-item flags, so the two answered "is this user synced?" independently and
 * could — and did — disagree. On 2026-08-12, terminal PYA8261900039 read
 * "256 synced" while 229 of those users still had an undelivered photo sitting
 * in the queue: `actual_state='synced'` is set by sync-status.ts without
 * requiring `photo_synced`, so the headline counted users the tiles were
 * simultaneously showing as "Photo: Pending".
 *
 * Deriving the count from `getComponentSyncStatus` makes that disagreement
 * unrepresentable rather than merely fixed.
 */
describe('rollUpUserSyncState', () => {
  test('a user whose photo has not been delivered is not counted as synced', () => {
    // THE REGRESSION, exactly as seen in production: user record and
    // fingerprint are on the device, the photo is not, and `actual_state`
    // already says 'synced'. The tile said Pending; the count said Synced.
    const state = rollUpUserSyncState(
      {
        actual_state: 'synced',
        user_synced: true,
        fingerprint_synced: true,
        fingerprint_mask: 1,
        photo_synced: false,
      },
      { hasPhotoInDb: true, fingerprints: [{ finger_id: 0, type: 'fingerprint' }] }
    )
    expect(state).not.toBe('synced')
  })

  test('a user with no photo at all is synced once the rest is delivered', () => {
    // The other half — this is why the count must not simply require
    // photo_synced. Someone who has no photo has nothing to wait for, and
    // holding them at "syncing" forever would be the opposite lie.
    const state = rollUpUserSyncState(
      {
        actual_state: 'synced',
        user_synced: true,
        fingerprint_synced: true,
        fingerprint_mask: 1,
        photo_synced: false,
      },
      { hasPhotoInDb: false, fingerprints: [{ finger_id: 0, type: 'fingerprint' }] }
    )
    expect(state).toBe('synced')
  })

  test('everything delivered, including the photo, counts as synced', () => {
    const state = rollUpUserSyncState(
      {
        actual_state: 'synced',
        user_synced: true,
        fingerprint_synced: true,
        fingerprint_mask: 1,
        photo_synced: true,
      },
      { hasPhotoInDb: true, fingerprints: [{ finger_id: 0, type: 'fingerprint' }] }
    )
    expect(state).toBe('synced')
  })

  test('agrees with the tiles for every component, by construction', () => {
    // The property the module exists for: the rollup is not a second opinion.
    // If every applicable tile reads Synced the rollup must too, and if any
    // does not, it must not. Asserted against getComponentSyncStatus itself so
    // a future change to tile logic cannot silently desynchronise the count.
    const status = {
      actual_state: 'synced',
      user_synced: true,
      fingerprint_synced: true,
      fingerprint_mask: 1,
      photo_synced: false,
    }
    const options = { hasPhotoInDb: true, fingerprints: [{ finger_id: 0, type: 'fingerprint' }] }
    const tiles = (['user', 'fingerprint', 'face', 'photo'] as const).map((c) =>
      getComponentSyncStatus(c, status, options)
    )
    const applicable = tiles.filter((t) => t.isApplicable)
    const allTilesSynced = applicable.every((t) => t.state === 'synced')

    expect(allTilesSynced).toBe(false) // the photo tile reads Pending here
    expect(rollUpUserSyncState(status, options) === 'synced').toBe(allTilesSynced)
  })

  test('the worst applicable component decides — a failure is not hidden by successes', () => {
    // `failed` outranks everything: a user with three green tiles and one red
    // one is not "syncing", and certainly not synced.
    const state = rollUpUserSyncState(
      {
        actual_state: 'not_synced',
        error_message: 'device refused',
        user_synced: true,
        fingerprint_synced: true,
        fingerprint_mask: 1,
        photo_synced: true,
      },
      { hasPhotoInDb: true, fingerprints: [{ finger_id: 0, type: 'fingerprint' }] }
    )
    expect(state).toBe('failed')
  })

  test('a user with nothing enrolled and nothing outstanding is synced, not stuck', () => {
    // No fingerprints, no face, no photo: every biometric tile is
    // "Not enrolled" and therefore inapplicable. Only the user record counts.
    const state = rollUpUserSyncState(
      { actual_state: 'synced', user_synced: true, photo_synced: false },
      { hasPhotoInDb: false, fingerprints: [] }
    )
    expect(state).toBe('synced')
  })
})
