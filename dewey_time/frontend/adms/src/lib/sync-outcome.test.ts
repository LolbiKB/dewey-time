import { describe, expect, test } from 'vitest'
import { summarizeDeviceSyncResults } from './sync-outcome'

describe('summarizeDeviceSyncResults', () => {
  test('claims success only when every device confirmed', () => {
    expect(summarizeDeviceSyncResults([{ deviceSn: 'A1', outcome: 'success' }])).toEqual({
      level: 'success',
      title: 'Sync completed',
    })
  })

  test('counts the devices confirmed when there is more than one', () => {
    const notice = summarizeDeviceSyncResults([
      { deviceSn: 'A1', outcome: 'success' },
      { deviceSn: 'B2', outcome: 'success' },
    ])
    expect(notice.level).toBe('success')
    expect(notice.title).toBe('Sync completed')
    expect(notice.description).toMatch(/2 devices/)
  })

  test('reports a timeout as unconfirmed, not as success', () => {
    const notice = summarizeDeviceSyncResults([
      { deviceSn: 'A1', outcome: 'timeout', stage: 'user' },
    ])
    expect(notice.level).toBe('warning')
    expect(notice.title).not.toMatch(/completed/i)
    expect(notice.description).toMatch(/A1/)
    expect(notice.description).toMatch(/still queued/i)
  })

  test('reports a failed command as an error naming the device and step', () => {
    const notice = summarizeDeviceSyncResults([
      { deviceSn: 'A1', outcome: 'failed', stage: 'biometrics' },
    ])
    expect(notice.level).toBe('error')
    expect(notice.title).not.toMatch(/completed/i)
    expect(notice.description).toMatch(/A1/)
    expect(notice.description).toMatch(/biometrics/)
  })

  test('a failure outranks a timeout and both are named', () => {
    const notice = summarizeDeviceSyncResults([
      { deviceSn: 'A1', outcome: 'success' },
      { deviceSn: 'B2', outcome: 'timeout', stage: 'user' },
      { deviceSn: 'C3', outcome: 'failed', stage: 'user' },
    ])
    expect(notice.level).toBe('error')
    expect(notice.title).toMatch(/1 of 3/)
    expect(notice.description).toMatch(/C3/)
    expect(notice.description).toMatch(/B2/)
  })

  test('does not claim success when no device was reached at all', () => {
    const notice = summarizeDeviceSyncResults([])
    expect(notice.level).toBe('warning')
    expect(notice.title).not.toMatch(/completed/i)
  })

  test('a device that never got a command queued is a failure', () => {
    const notice = summarizeDeviceSyncResults([
      { deviceSn: 'A1', outcome: 'failed', stage: 'queue' },
    ])
    expect(notice.level).toBe('error')
    expect(notice.description).toMatch(/A1/)
    expect(notice.description).toMatch(/no command queued/i)
  })
})
