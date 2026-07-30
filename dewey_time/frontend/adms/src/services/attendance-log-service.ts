import type { BaseFilters } from '@/components/ui/generic-data-table'
import { startOfDay, endOfDay, formatISO } from 'date-fns'
import { supabase } from '@/lib/supabase'

export type AttendanceLogPreset =
  | 'today'
  | 'pending_sync'
  | 'failed_sync'
  | 'suspicious'
  | 'unknown_pin'

export type AttendanceLogStatFilter = 'today' | 'pending_sync' | 'failed_sync' | 'suspicious'

export interface AttendanceLogFilters extends BaseFilters {
  device_sn?: string
  user_pin?: string
  status?: number
  verify_type?: number
  dateFrom?: string
  dateTo?: string
  sync_status?: string
  preset?: AttendanceLogPreset
}

export interface AttendanceLogEntry {
  id: number
  device_sn: string
  user_pin: string
  check_time: string
  status: number | string
  verify_type: number
  raw_data?: string | null
  created_at: string
  sync_status?: string | null
  synced_to_frappe?: boolean | null
  frappe_checkin_id?: string | null
  synced_at?: string | null
  last_error_message?: string | null
  retry_count?: number | null
  is_suspicious?: boolean | null
  suspicious_reason?: string | null
  devices?: {
    serial_number: string
    name?: string | null
    location?: string | null
    timezone?: string | null
  } | null
  users?: {
    id: string
    name: string
    frappe_employee_id?: string | null
    pin: string
  } | null
}

export interface AttendanceLogsResponse {
  success: boolean
  data: AttendanceLogEntry[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface AttendanceLogSummary {
  totalToday: number
  pendingSync: number
  failedSync: number
  suspiciousToday: number
}

const TODAY_SCOPED_PRESETS: AttendanceLogPreset[] = [
  'today',
  'pending_sync',
  'failed_sync',
  'suspicious',
]

function applyPresetToFilters(filters: AttendanceLogFilters): AttendanceLogFilters {
  // Strip sync_status — preset-based Frappe status filters use synced_to_frappe/last_error_message
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sync_status: _sync, ...rest } = filters
  const next: AttendanceLogFilters = { ...rest }
  if (filters.preset && TODAY_SCOPED_PRESETS.includes(filters.preset)) {
    const now = new Date()
    next.dateFrom = formatISO(startOfDay(now))
    next.dateTo = formatISO(endOfDay(now))
  }
  // pending_sync / failed_sync: handled in applyFiltersToQuery via synced_to_frappe /
  // last_error_message — NOT via sync_status (DB only has 'SKIPPED' and 'SUCCESS')
  return next
}

function applyFiltersToQuery(
  query: ReturnType<ReturnType<typeof supabase.from>['select']>,
  filters: AttendanceLogFilters
) {
  let q = query
  if (filters.search) {
    const term = filters.search.trim()
    q = q.or(`device_sn.ilike.%${term}%,user_pin.ilike.%${term}%`)
  }
  if (filters.device_sn) {
    q = q.eq('device_sn', filters.device_sn)
  }
  if (filters.user_pin) {
    q = q.ilike('user_pin', `%${filters.user_pin}%`)
  }
  if (filters.status !== undefined) {
    q = q.eq('status', filters.status)
  }
  if (filters.verify_type !== undefined) {
    q = q.eq('verify_type', filters.verify_type)
  }
  if (filters.dateFrom) {
    q = q.gte('check_time', filters.dateFrom)
  }
  if (filters.dateTo) {
    q = q.lte('check_time', filters.dateTo)
  }
  if (filters.sync_status) {
    q = q.eq('sync_status', filters.sync_status)
  }
  if (filters.preset === 'pending_sync') {
    // Records not yet sent to Frappe: synced_to_frappe=false and not intentionally SKIPPED
    q = q.eq('synced_to_frappe', false).or('sync_status.is.null,sync_status.neq.SKIPPED')
  }
  if (filters.preset === 'failed_sync') {
    // Records that have a Frappe error message; use filter() for correct TS types
    q = q.filter('last_error_message', 'not.is', null)
  }
  if (filters.preset === 'suspicious') {
    q = q.eq('is_suspicious', true)
  }
  return q
}

async function attachUsers(logs: AttendanceLogEntry[]): Promise<AttendanceLogEntry[]> {
  const pins = [...new Set(logs.map((log) => log.user_pin).filter(Boolean))]
  const usersData: Record<
    string,
    { id: string; name: string; frappe_employee_id?: string | null; pin: string }
  > = {}

  if (pins.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, frappe_employee_id, pin')
      .in('pin', pins)

    users?.forEach((user) => {
      usersData[user.pin] = user
    })
  }

  return logs.map((log) => ({
    ...log,
    users: usersData[log.user_pin] || null,
  }))
}

export async function fetchAttendanceLogs(
  filters: AttendanceLogFilters
): Promise<AttendanceLogsResponse> {
  const effective = applyPresetToFilters(filters)
  const page = effective.page || 1
  const limit = effective.limit || 20
  const sortBy = effective.sort || 'check_time'
  const sortOrder = effective.order || 'desc'
  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from('attendance_logs')
    .select('*, devices(serial_number, name, location, timezone)', { count: 'exact' })

  query = applyFiltersToQuery(query, effective)

  query = query.order(sortBy, { ascending: sortOrder === 'asc' }).range(from, to)

  const { data, error, count } = await query

  if (error) {
    throw new Error(`Failed to fetch attendance logs: ${error.message}`)
  }

  let dataWithUsers = await attachUsers((data || []) as AttendanceLogEntry[])

  if (effective.preset === 'unknown_pin') {
    dataWithUsers = dataWithUsers.filter((log) => !log.users)
  }

  const total =
    effective.preset === 'unknown_pin' ? dataWithUsers.length : count || 0
  const totalPages = Math.ceil(total / limit)

  return {
    success: true,
    data: dataWithUsers,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  }
}

export async function fetchAttendanceLogSummary(): Promise<AttendanceLogSummary> {
  const todayStart = formatISO(startOfDay(new Date()))
  const todayEnd = formatISO(endOfDay(new Date()))

  const [totalRes, pendingRes, failedRes, suspiciousRes] = await Promise.all([
    supabase
      .from('attendance_logs')
      .select('*', { count: 'exact', head: true })
      .gte('check_time', todayStart)
      .lte('check_time', todayEnd),
    // pending: synced_to_frappe=false and not intentionally SKIPPED
    supabase
      .from('attendance_logs')
      .select('*', { count: 'exact', head: true })
      .gte('check_time', todayStart)
      .lte('check_time', todayEnd)
      .eq('synced_to_frappe', false)
      .or('sync_status.is.null,sync_status.neq.SKIPPED'),
    // failed: has a Frappe error message
    supabase
      .from('attendance_logs')
      .select('*', { count: 'exact', head: true })
      .gte('check_time', todayStart)
      .lte('check_time', todayEnd)
      .filter('last_error_message', 'not.is', null),
    supabase
      .from('attendance_logs')
      .select('*', { count: 'exact', head: true })
      .gte('check_time', todayStart)
      .lte('check_time', todayEnd)
      .eq('is_suspicious', true),
  ])

  return {
    totalToday: totalRes.count ?? 0,
    pendingSync: pendingRes.count ?? 0,
    failedSync: failedRes.count ?? 0,
    suspiciousToday: suspiciousRes.count ?? 0,
  }
}

/** PostgREST caps a single response; page through it rather than trusting one call. */
const EXPORT_PAGE_SIZE = 1000
/** Ceiling so a mis-filtered export cannot try to pull the entire table into memory. */
const EXPORT_MAX_ROWS = 50_000

export async function exportAttendanceLogs(filters: AttendanceLogFilters): Promise<Blob> {
  // This used to issue a single unpaginated select, so PostgREST's default
  // max-rows silently capped the CSV at 1000 records: an export of a busy month
  // looked complete and simply had the rest of the month missing — the worst
  // possible failure for a payroll artefact.
  const rows: AttendanceLogEntry[] = []
  for (let from = 0; from < EXPORT_MAX_ROWS; from += EXPORT_PAGE_SIZE) {
    let query = supabase.from('attendance_logs').select('*, devices(serial_number, name, location)')
    query = applyFiltersToQuery(query, applyPresetToFilters(filters))

    const { data, error } = await query
      .order('check_time', { ascending: false })
      .range(from, from + EXPORT_PAGE_SIZE - 1)

    if (error) {
      throw new Error(`Failed to export attendance logs: ${error.message}`)
    }

    rows.push(...((data || []) as AttendanceLogEntry[]))
    if (!data || data.length < EXPORT_PAGE_SIZE) break

    if (from + EXPORT_PAGE_SIZE >= EXPORT_MAX_ROWS) {
      // Refuse rather than hand over a file that is quietly incomplete.
      throw new Error(
        `Export exceeds ${EXPORT_MAX_ROWS.toLocaleString()} rows — narrow the date range or filters and try again.`
      )
    }
  }

  let logs = await attachUsers(rows)
  if (filters.preset === 'unknown_pin') {
    logs = logs.filter((log) => !log.users)
  }

  const csv = convertToCSV(logs)
  return new Blob([csv], { type: 'text/csv' })
}

function convertToCSV(logs: AttendanceLogEntry[]): string {
  const headers = [
    'ID',
    'Device SN',
    'Location',
    'User PIN',
    'Employee Name',
    'Check Time (UTC)',
    'Device Button Status',
    'Verify Type',
    'HR Sync Status',
    'Frappe Checkin ID',
    'Suspicious',
    'Suspicious Reason',
    'Ingested At',
  ]
  const rows = logs.map((log) => [
    log.id,
    log.device_sn,
    log.devices?.name || log.devices?.location || '',
    log.user_pin,
    log.users?.name || '',
    log.check_time,
    log.status,
    log.verify_type,
    log.sync_status || '',
    log.frappe_checkin_id || '',
    log.is_suspicious ? 'yes' : 'no',
    log.suspicious_reason || '',
    log.created_at,
  ])

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
}
