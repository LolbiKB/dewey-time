import { parseISO } from 'date-fns'
import type { AttendanceLogEntry } from '@/services/attendance-log-service'

/** Timezone assumed for a device row with no `timezone` (mirrors the bridge default). */
export const DEFAULT_DEVICE_TZ = 'Asia/Phnom_Penh'

/** Local calendar date (YYYY-MM-DD) for a UTC instant in device timezone. */
export function getLocalDateStringFromUtc(iso: string, timeZone: string = DEFAULT_DEVICE_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** The device timezone to assume when a device row carries none (bridge default). */
function resolveDeviceTimeZone(timeZone?: string | null): string {
  if (!timeZone) return DEFAULT_DEVICE_TZ
  try {
    // Throws RangeError for anything Intl does not accept (e.g. a raw "GMT+7").
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return DEFAULT_DEVICE_TZ
  }
}

/** Offset of `timeZone` from UTC, in ms, at the instant `date`. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  const wallAsUtc = Date.UTC(
    num('year'),
    num('month') - 1,
    num('day'),
    num('hour'),
    num('minute'),
    num('second')
  )
  // Compare whole seconds: formatToParts has no ms field.
  return wallAsUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** UTC epoch ms for a wall-clock time in `timeZone`. */
function zonedWallTimeToUtcMs(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  s: number,
  ms: number,
  timeZone: string
): number {
  const naive = Date.UTC(y, m - 1, d, h, min, s, ms)
  // Two passes: the first offset is read at the wrong instant when the guess
  // lands on the other side of a DST transition; the second settles it.
  let utc = naive - timeZoneOffsetMs(new Date(naive), timeZone)
  utc = naive - timeZoneOffsetMs(new Date(utc), timeZone)
  return utc
}

/**
 * UTC instant bounds of one device-LOCAL calendar day (YYYY-MM-DD), for
 * filtering `check_time` (timestamptz) on the Attendance Logs page.
 * Closure rows (`device_attlog_closure.local_date`) are device-local dates, so
 * a UTC-built window would show a shifted set of punches and never reconcile.
 */
export function deviceDayWindowIso(
  localDate: string,
  timeZone?: string | null
): { dateFrom: string; dateTo: string } {
  const tz = resolveDeviceTimeZone(timeZone)
  const [y, m, d] = localDate.split('-').map(Number)
  return {
    dateFrom: new Date(zonedWallTimeToUtcMs(y, m, d, 0, 0, 0, 0, tz)).toISOString(),
    dateTo: new Date(zonedWallTimeToUtcMs(y, m, d, 23, 59, 59, 999, tz)).toISOString(),
  }
}

/** Format a UTC instant in a specific IANA timezone (device site time). */
export function formatInstantInTimeZone(
  iso: string,
  timeZone: string = DEFAULT_DEVICE_TZ
): { date: string; time: string } {
  const d = new Date(iso)
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return { date: dateFmt.format(d), time: timeFmt.format(d) }
}

/** Device punch time — uses device timezone when available. */
export function formatCheckTimeForLog(
  iso: string,
  deviceTimeZone?: string | null
): { date: string; time: string; timeZoneLabel: string } {
  const tz = deviceTimeZone || DEFAULT_DEVICE_TZ
  const { date, time } = formatInstantInTimeZone(iso, tz)
  return { date, time, timeZoneLabel: tz }
}

/** When the bridge stored the row (browser local — usually when upload arrived). */
export function formatIngestedTime(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return { date: dateFmt.format(d), time: timeFmt.format(d) }
}

/** @deprecated Use formatCheckTimeForLog */
export function formatCheckTimeLocal(iso: string): { date: string; time: string } {
  return formatInstantInTimeZone(iso, DEFAULT_DEVICE_TZ)
}

export function normalizeStatus(status: number | string | null | undefined): number {
  if (status === null || status === undefined) return 255
  const n = typeof status === 'string' ? parseInt(status, 10) : status
  return Number.isNaN(n) ? 255 : n
}

export function erpPairingPreviewLabel(sequenceIndex: number): 'IN' | 'OUT' {
  return sequenceIndex % 2 === 1 ? 'IN' : 'OUT'
}

export function computeSequenceMap(logs: AttendanceLogEntry[]): Map<number, number> {
  const sorted = [...logs].sort(
    (a, b) => parseISO(a.check_time).getTime() - parseISO(b.check_time).getTime()
  )
  const map = new Map<number, number>()
  sorted.forEach((log, i) => map.set(log.id, i + 1))
  return map
}

export function daySequenceWarnings(logs: AttendanceLogEntry[]): string[] {
  if (logs.length === 0) return []
  const warnings: string[] = []
  if (logs.length % 2 !== 0) {
    warnings.push('Odd punch count for this day — ERP may treat the day as an exception.')
  }
  const byDevice = new Map<string, number>()
  for (const log of logs) {
    byDevice.set(log.device_sn, (byDevice.get(log.device_sn) || 0) + 1)
  }
  for (const [sn, count] of byDevice) {
    if (count % 2 !== 0) {
      const label = logs.find((l) => l.device_sn === sn)?.devices?.name || sn
      warnings.push(`Location ${label}: unclosed loop (${count} punches).`)
    }
  }
  return warnings
}
