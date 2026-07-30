import { describe, it, expect } from 'vitest'
import { mapSyncStatusCache } from './sync-status-cache'

const syncing = (row: Record<string, unknown>) => ({ ...row, actual_state: 'syncing' })

describe('mapSyncStatusCache', () => {
  it('maps a bare array (the ["sync-status","all"] shape)', () => {
    const out = mapSyncStatusCache(
      [{ device_sn: 'A', actual_state: 'synced' }],
      syncing
    )
    expect(out).toEqual([{ device_sn: 'A', actual_state: 'syncing' }])
  })

  it('maps inside the { success, data } wrapper (the users.syncStatus shape)', () => {
    // This is the case the Array.isArray guard silently skipped, so the
    // optimistic "syncing" state never rendered.
    const out = mapSyncStatusCache(
      { success: true, data: [{ device_sn: 'A', actual_state: 'synced' }] },
      syncing
    )
    expect(out).toEqual({
      success: true,
      data: [{ device_sn: 'A', actual_state: 'syncing' }],
    })
  })

  it('leaves undefined, null and unrecognised shapes untouched', () => {
    expect(mapSyncStatusCache(undefined, syncing)).toBeUndefined()
    expect(mapSyncStatusCache(null, syncing)).toBeNull()
    const odd = { success: true }
    expect(mapSyncStatusCache(odd, syncing)).toBe(odd)
  })

  it('does not mutate the input', () => {
    const input = { success: true, data: [{ device_sn: 'A', actual_state: 'synced' }] }
    mapSyncStatusCache(input, syncing)
    expect(input.data[0].actual_state).toBe('synced')
  })
})
