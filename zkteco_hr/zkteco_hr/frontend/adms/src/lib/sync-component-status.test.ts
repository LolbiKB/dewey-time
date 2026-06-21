import { describe, expect, it } from 'vitest'
import {
  buildComponentSyncOptions,
  getComponentSyncStatus,
  type SyncStatusRow,
} from './sync-component-status'

const baseStatus = (overrides: Partial<SyncStatusRow> = {}): SyncStatusRow => ({
  user_synced: false,
  photo_synced: false,
  face_synced: true,
  fingerprint_mask: 0b1010,
  actual_state: 'syncing',
  has_photo_in_db: true,
  ...overrides,
})

describe('getComponentSyncStatus — component-scoped activity', () => {
  it('shows User pending and FP syncing when only delete_fingerprint is active', () => {
    const commands = [
      {
        command_type: 'delete_fingerprint',
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ]
    const options = buildComponentSyncOptions(commands, {
      fingerprints: [{ type: 'fingerprint', finger_id: 1 }],
      hasPhotoInDb: true,
    })
    const status = baseStatus({ fingerprint_mask: 0b1010 })

    const user = getComponentSyncStatus('user', status, options)
    const fp = getComponentSyncStatus('fingerprint', status, options)
    const photo = getComponentSyncStatus('photo', status, options)

    expect(user.state).toBe('pending')
    expect(fp.state).toBe('syncing')
    expect(fp.label).toBe('Removing…')
    expect(photo.state).toBe('pending')
  })

  it('shows User syncing when sync_user is active', () => {
    const commands = [
      {
        command_type: 'sync_user',
        status: 'sent',
        created_at: new Date().toISOString(),
      },
    ]
    const options = buildComponentSyncOptions(commands, {})
    const user = getComponentSyncStatus('user', baseStatus(), options)
    expect(user.state).toBe('syncing')
  })

  it('keeps User synced during FP delete when user_synced is true', () => {
    const commands = [
      {
        command_type: 'delete_fingerprint',
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ]
    const options = buildComponentSyncOptions(commands, {
      fingerprints: [{ type: 'fingerprint', finger_id: 1 }],
    })
    const user = getComponentSyncStatus(
      'user',
      baseStatus({ user_synced: true }),
      options
    )
    const fp = getComponentSyncStatus(
      'fingerprint',
      baseStatus({ user_synced: true, fingerprint_mask: 2 }),
      options
    )
    expect(user.state).toBe('synced')
    expect(fp.state).toBe('syncing')
  })

  it('shows Photo pending (not syncing) during FP-only delete', () => {
    const commands = [
      {
        command_type: 'delete_fingerprint',
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ]
    const options = buildComponentSyncOptions(commands, { hasPhotoInDb: true })
    const photo = getComponentSyncStatus('photo', baseStatus(), options)
    expect(photo.state).toBe('pending')
    expect(photo.label).toBe('Pending')
  })
})
