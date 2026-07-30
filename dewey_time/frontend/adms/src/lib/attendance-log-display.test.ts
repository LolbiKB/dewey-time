import { describe, expect, test } from 'vitest'
import { deviceDayWindowIso } from './attendance-log-display'

describe('deviceDayWindowIso', () => {
  test('brackets a device-local calendar day in the device timezone', () => {
    // Asia/Phnom_Penh is UTC+7 year-round: the local day starts at 17:00 UTC
    // the day before and ends at 16:59:59.999 UTC on the day itself.
    expect(deviceDayWindowIso('2026-07-15', 'Asia/Phnom_Penh')).toEqual({
      dateFrom: '2026-07-14T17:00:00.000Z',
      dateTo: '2026-07-15T16:59:59.999Z',
    })
  })

  test('defaults to the bridge default timezone when the device has none', () => {
    expect(deviceDayWindowIso('2026-07-15')).toEqual(
      deviceDayWindowIso('2026-07-15', 'Asia/Phnom_Penh')
    )
    expect(deviceDayWindowIso('2026-07-15', null)).toEqual(
      deviceDayWindowIso('2026-07-15', 'Asia/Phnom_Penh')
    )
  })

  test('is a no-op shift for a device on UTC', () => {
    expect(deviceDayWindowIso('2026-07-15', 'UTC')).toEqual({
      dateFrom: '2026-07-15T00:00:00.000Z',
      dateTo: '2026-07-15T23:59:59.999Z',
    })
  })

  test('uses the offset in force on that date, not today', () => {
    // America/New_York: UTC-4 in July (EDT), UTC-5 in January (EST).
    expect(deviceDayWindowIso('2026-07-15', 'America/New_York')).toEqual({
      dateFrom: '2026-07-15T04:00:00.000Z',
      dateTo: '2026-07-16T03:59:59.999Z',
    })
    expect(deviceDayWindowIso('2026-01-15', 'America/New_York')).toEqual({
      dateFrom: '2026-01-15T05:00:00.000Z',
      dateTo: '2026-01-16T04:59:59.999Z',
    })
  })

  test('falls back to the default timezone for an unusable timezone string', () => {
    expect(deviceDayWindowIso('2026-07-15', 'GMT+7')).toEqual(
      deviceDayWindowIso('2026-07-15', 'Asia/Phnom_Penh')
    )
  })
})
