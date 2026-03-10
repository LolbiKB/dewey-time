import type { BaseFilters } from '@/components/ui/generic-data-table'
import { supabase } from '@/lib/supabase'

// Attendance Log Filters
export interface AttendanceLogFilters extends BaseFilters {
  device_sn?: string
  user_pin?: string
  status?: number
  verify_type?: number
  dateFrom?: string // ISO format
  dateTo?: string // ISO format
}

// Attendance Log Entry (matches database schema)
export interface AttendanceLogEntry {
  id: number
  device_sn: string
  user_pin: string
  check_time: string // ISO timestamp
  status: number
  verify_type: number
  raw_data: string
  created_at: string
  // Joined data (if available)
  devices?: {
    serial_number: string
    name?: string
    location?: string
  }
  users?: {
    id: string
    name: string
    frappe_employee_id?: string
    pin: string
  }
}

// API Response
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

/**
 * Fetch attendance logs from database with RLS
 */
export async function fetchAttendanceLogs(
  filters: AttendanceLogFilters
): Promise<AttendanceLogsResponse> {
  const page = filters.page || 1
  const limit = filters.limit || 20
  const sortBy = filters.sort || 'check_time'
  const sortOrder = filters.order || 'desc'
  const from = (page - 1) * limit
  const to = from + limit - 1

  // Build query
  let query = supabase
    .from('attendance_logs')
    .select('*, devices(serial_number, name, location)', { count: 'exact' })

  // Apply filters
  if (filters.search) {
    query = query.or(`device_sn.ilike.%${filters.search}%,user_pin.ilike.%${filters.search}%`)
  }
  if (filters.device_sn) {
    query = query.eq('device_sn', filters.device_sn)
  }
  if (filters.user_pin) {
    query = query.ilike('user_pin', `%${filters.user_pin}%`)
  }
  if (filters.status !== undefined) {
    query = query.eq('status', filters.status)
  }
  if (filters.verify_type !== undefined) {
    query = query.eq('verify_type', filters.verify_type)
  }
  if (filters.dateFrom) {
    query = query.gte('check_time', filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte('check_time', filters.dateTo)
  }

  // Apply sorting and pagination
  query = query
    .order(sortBy, { ascending: sortOrder === 'asc' })
    .range(from, to)

  const { data, error, count } = await query

  if (error) {
    throw new Error(`Failed to fetch attendance logs: ${error.message}`)
  }

  // Fetch users to join with attendance logs
  const pins = [...new Set((data || []).map(log => log.user_pin).filter(Boolean))]
  let usersData: Record<string, { id: string; name: string; frappe_employee_id?: string; pin: string }> = {}
  
  if (pins.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, name, frappe_employee_id, pin')
      .in('pin', pins)
    
    if (users) {
      users.forEach(user => {
        usersData[user.pin] = user
      })
    }
  }

  // Join user data with attendance logs
  const dataWithUsers = (data || []).map(log => ({
    ...log,
    users: usersData[log.user_pin] || null
  }))

  const total = count || 0
  const totalPages = Math.ceil(total / limit)

  return {
    success: true,
    data: dataWithUsers || [],
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

/**
 * Export attendance logs as CSV
 */
export async function exportAttendanceLogs(
  filters: AttendanceLogFilters
): Promise<Blob> {
  // Fetch all matching records (no pagination for export)
  let query = supabase
    .from('attendance_logs')
    .select('*, devices(serial_number, name, location)')

  // Apply same filters
  if (filters.search) {
    query = query.or(`device_sn.ilike.%${filters.search}%,user_pin.ilike.%${filters.search}%`)
  }
  if (filters.device_sn) {
    query = query.eq('device_sn', filters.device_sn)
  }
  if (filters.user_pin) {
    query = query.ilike('user_pin', `%${filters.user_pin}%`)
  }
  if (filters.status !== undefined) {
    query = query.eq('status', filters.status)
  }
  if (filters.verify_type !== undefined) {
    query = query.eq('verify_type', filters.verify_type)
  }
  if (filters.dateFrom) {
    query = query.gte('check_time', filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte('check_time', filters.dateTo)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to export attendance logs: ${error.message}`)
  }

  // Convert to CSV
  const csv = convertToCSV(data || [])
  return new Blob([csv], { type: 'text/csv' })
}

/**
 * Convert attendance logs to CSV format
 */
function convertToCSV(logs: AttendanceLogEntry[]): string {
  const headers = ['ID', 'Device SN', 'Device Name', 'User PIN', 'Check Time', 'Status', 'Verify Type']
  const rows = logs.map(log => [
    log.id,
    log.device_sn,
    log.devices?.name || '',
    log.user_pin,
    log.check_time,
    log.status,
    log.verify_type,
  ])

  return [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n')
}
