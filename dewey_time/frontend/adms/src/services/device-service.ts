// ============================================================
// Device Service - Direct database queries with RLS
// ============================================================

import { supabase } from '@/lib/supabase'
import { getAuthHeaders } from '@/lib/auth-token'
import { getDevicePresence } from '@/lib/device-status'
import { DEVICE_PUBLIC_COLUMNS } from '@/lib/column-allowlists'

const API_URL = import.meta.env.VITE_API_URL || ''

// Base pagination filters
export interface BaseFilters {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

// Device Filters
export interface DeviceFilters extends BaseFilters {
  name?: string
  location?: string
  is_master?: boolean
  status?: 'online' | 'offline'
  search?: string
}

// Device Entry (matches database schema)
export interface DeviceEntry {
  serial_number: string
  name?: string
  location?: string
  is_master: boolean
  is_registrar?: boolean
  registrar_capabilities?: string[]
  last_seen?: string
  registration_data?: string
  created_at: string
  fp_algorithm_version?: string
  face_algorithm_version?: string
  status?: 'online' | 'offline' // derived field
  last_seen_minutes?: number | null // derived field
  comm_key?: string | null
  connection_status?: 'pending' | 'approved' | 'rejected'
}

// API Response
export interface DevicesResponse {
  success: boolean
  data: DeviceEntry[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

// Service class
export class DeviceService {
  /**
   * Fetch devices with filters and pagination
   */
  static async getDevices(filters: DeviceFilters = {}): Promise<DevicesResponse> {
    const page = filters.page || 1
    const limit = filters.limit || 20
    const sortBy = filters.sortBy || 'created_at'
    const sortOrder = filters.sortOrder || 'desc'
    const from = (page - 1) * limit
    const to = from + limit - 1

    // Build query
    let query = supabase
      .from('devices')
      .select('*', { count: 'exact' })

    // Apply filters
    if (filters.search) {
      query = query.or(`serial_number.ilike.%${filters.search}%,name.ilike.%${filters.search}%,location.ilike.%${filters.search}%`)
    }
    if (filters.name) {
      query = query.ilike('name', `%${filters.name}%`)
    }
    if (filters.location) {
      query = query.ilike('location', `%${filters.location}%`)
    }
    if (filters.is_master !== undefined) {
      query = query.eq('is_master', filters.is_master)
    }

    // Apply sorting and pagination
    query = query
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range(from, to)

    const { data, error, count } = await query

    if (error) {
      throw new Error(`Failed to fetch devices: ${error.message}`)
    }

    const devicesWithStatus = (data || []).map((device) => {
      const presence = getDevicePresence(device.last_seen)
      return {
        ...device,
        status: presence.status,
        last_seen_minutes: presence.lastSeenMinutes,
      } as DeviceEntry
    })

    // Filter by status if specified
    const filteredDevices = filters.status
      ? devicesWithStatus.filter(d => d.status === filters.status)
      : devicesWithStatus

    const total = count || 0
    const totalPages = Math.ceil(total / limit)

    return {
      success: true,
      data: filteredDevices,
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

  // queueDeviceCommand was removed here. It INSERTed into command_queue under
  // the user's JWT and then UPDATEd the row to stamp the C:{id}: prefix. Its
  // last caller was the "Request Info" button, now served by
  // refreshDeviceOptions() against the Super-Admin-gated bridge endpoint.
  //
  // With it gone the dashboard makes NO writes to command_queue except
  // clearCommand's DELETE — so `authenticated` needs neither INSERT nor UPDATE
  // on that table. getrequest ships command text to terminals verbatim, so the
  // less that table can be written from a browser, the better.

  // Command filters interface
  static async getDeviceCommands(
    deviceSn: string,
    options: {
      page?: number
      limit?: number
      status?: 'pending' | 'sent' | 'success' | 'failed' | 'all'
      commandType?: 'sync' | 'device' | 'all'
    } = {}
  ) {
    const page = options.page || 1
    const limit = options.limit || 20
    const from = (page - 1) * limit
    const to = from + limit - 1

    let query = supabase
      .from('command_queue')
      .select('*', { count: 'exact' })
      .eq('device_sn', deviceSn)

    // Apply status filter
    if (options.status && options.status !== 'all') {
      query = query.eq('status', options.status)
    }

    // Apply command type filter
    if (options.commandType && options.commandType !== 'all') {
      if (options.commandType === 'sync') {
        query = query.in('command_type', ['sync_user', 'enroll_fingerprint', 'enroll_fingerprint_confirm', 'enroll_face', 'upload_photo', 'delete_user'])
      } else if (options.commandType === 'device') {
        query = query.in('command_type', ['reboot', 'info', 'check', 'log', 'clear_data'])
      }
    }

    // Apply pagination
    query = query.order('created_at', { ascending: false }).range(from, to)

    const { data, error, count } = await query

    if (error) {
      throw new Error(`Failed to fetch device commands: ${error.message}`)
    }

    const total = count || 0
    const totalPages = Math.ceil(total / limit)

    return {
      success: true,
      data: data || [],
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
   * Set a device as master
   */
  static async setMasterDevice(serialNumber: string): Promise<void> {
    // First, set all devices to non-master
    const { error: updateAllError } = await supabase
      .from('devices')
      .update({ is_master: false })
      .neq('serial_number', '')

    if (updateAllError) {
      throw new Error(`Failed to update devices: ${updateAllError.message}`)
    }

    // Then set the specified device as master
    const { error: updateError } = await supabase
      .from('devices')
      .update({ is_master: true })
      .eq('serial_number', serialNumber)

    if (updateError) {
      throw new Error(`Failed to set master device: ${updateError.message}`)
    }
  }

  /**
   * Get a single device by serial number
   */
  static async getDevice(serialNumber: string): Promise<DeviceEntry | null> {
    // Explicit columns: select('*') shipped devices.comm_key — the device
    // authentication secret — to the browser. Nothing renders it; the Super
    // Admin flow that SETS it goes through the bridge API, not this read.
    const { data, error } = await supabase
      .from('devices')
      .select(DEVICE_PUBLIC_COLUMNS)
      .eq('serial_number', serialNumber)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null // No rows returned
      throw new Error(`Failed to fetch device: ${error.message}`)
    }

    if (!data) return null

    const presence = getDevicePresence(data.last_seen)
    return {
      ...data,
      status: presence.status,
      last_seen_minutes: presence.lastSeenMinutes,
    } as DeviceEntry
  }

  /**
   * Clear a specific command from the queue
   */
  static async clearCommand(deviceSn: string, commandId: number): Promise<void> {
    const { error } = await supabase
      .from('command_queue')
      .delete()
      .eq('id', commandId)
      .eq('device_sn', deviceSn)

    if (error) {
      throw new Error(`Failed to clear command: ${error.message}`)
    }
  }

  /**
   * Update device configuration fields
   */
  static async updateDevice(
    serialNumber: string,
    updates: {
      name?: string
      location?: string
      is_registrar?: boolean
      registrar_capabilities?: string[]
    }
  ): Promise<DeviceEntry> {
    const { data, error } = await supabase
      .from('devices')
      .update(updates)
      .eq('serial_number', serialNumber)
      .select('*')
      .single()

    if (error) {
      throw new Error(`Failed to update device: ${error.message}`)
    }

    const presence = getDevicePresence(data.last_seen)
    return {
      ...data,
      status: presence.status,
      last_seen_minutes: presence.lastSeenMinutes,
    } as DeviceEntry
  }

  /** What a terminal last reported about its own configuration. */
  static async getDeviceOptions(
    serialNumber: string
  ): Promise<Array<{ key: string; value: string | null; reported_at: string }>> {
    const json = await this.fetchApi<{
      success: boolean
      data: Array<{ key: string; value: string | null; reported_at: string }>
    }>(
      `/admin/device-options?sn=${encodeURIComponent(serialNumber)}`,
      {},
      'Failed to load device options'
    )
    return json.data ?? []
  }

  /**
   * Super Admin: ask a terminal what configuration it exposes (INFO, §12.4.3).
   *
   * The reply is persisted into device_option_observed by the bridge. This is
   * the bootstrap channel — §5's PushOptions= needs an explicit key list, which
   * cannot exist until INFO has reported one.
   */
  static async refreshDeviceOptions(
    serialNumber: string
  ): Promise<{ success: boolean; commandId: number }> {
    return this.fetchApi<{ success: boolean; commandId: number }>(
      `/admin/devices/${encodeURIComponent(serialNumber)}/options/refresh`,
      // A bodiless POST leaves Fastify's JSON parser with nothing to read.
      { method: 'POST', body: JSON.stringify({}) },
      'Failed to request device options'
    )
  }

  /**
   * Super Admin: queue a REBOOT via the bridge.
   *
   * Never writes command_queue directly. getrequest ships command text to the
   * terminal verbatim and command_admin_full authorises on role-blind
   * is_admin(), so the old direct write let any admin reboot a device — and
   * the allowlist trigger rejects that path.
   */
  static async rebootDevice(
    serialNumber: string
  ): Promise<{ success: boolean; commandId: number }> {
    return this.fetchApi<{ success: boolean; commandId: number }>(
      `/admin/devices/${encodeURIComponent(serialNumber)}/reboot`,
      // A bodiless POST leaves Fastify's JSON parser with nothing to read.
      { method: 'POST', body: JSON.stringify({}) },
      'Failed to reboot device'
    )
  }

  /**
   * Get paginated users for a specific device via API
   */
  static async getDeviceUsers(
    deviceSn: string,
    options: { page?: number; limit?: number; search?: string } = {}
  ): Promise<{ data: any[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
    const params = new URLSearchParams()
    if (options.page) params.append('page', String(options.page))
    if (options.limit) params.append('limit', String(options.limit))
    if (options.search) params.append('search', options.search)

    return this.fetchApi(
      `/admin/devices/${encodeURIComponent(deviceSn)}/users?${params}`,
      {},
      'Failed to fetch device users'
    )
  }

  /**
   * Get sync summary for a device
   */
  static async getDeviceSyncSummary(deviceSn: string): Promise<{ total: number; synced: number; syncing: number; failed: number }> {
    return this.fetchApi(
      `/admin/devices/${encodeURIComponent(deviceSn)}/sync-summary`,
      {},
      'Failed to fetch sync summary'
    )
  }

  /**
   * Single entry point for bridge `/admin/*` calls.
   *
   * Fastify rejects a request carrying `Content-Type: application/json` with an
   * empty body as 400 FST_ERR_CTP_EMPTY_JSON_BODY *before* the route handler
   * runs, so the header must be attached only when there is actually a body.
   * getAuthHeaders() always sets it, hence the split here — keep this rule in
   * one place rather than per call site.
   */
  private static async fetchApi<T>(
    path: string,
    options: RequestInit = {},
    failureMessage = 'Request failed'
  ): Promise<T> {
    const authHeaders = (await getAuthHeaders()) as Record<string, string>
    const hasBody = options.body != null
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeaders.Authorization ? { Authorization: authHeaders.Authorization } : {}),
        ...options.headers,
      },
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: failureMessage }))
      throw new Error(err.error || failureMessage)
    }
    return response.json()
  }

  /** Super Admin: set comm_key or connection_status via bridge API */
  static async updateDeviceSecurity(
    serialNumber: string,
    updates: {
      comm_key?: string | null
      connection_status?: 'pending' | 'approved' | 'rejected'
    }
  ): Promise<DeviceEntry> {
    const json = await this.fetchApi<{ success: boolean; data: DeviceEntry }>(
      `/admin/devices/${encodeURIComponent(serialNumber)}/security`,
      { method: 'PATCH', body: JSON.stringify(updates) },
      'Failed to update device security'
    )
    const d = json.data
    const presence = getDevicePresence(d.last_seen)
    return { ...d, status: presence.status, last_seen_minutes: presence.lastSeenMinutes }
  }

  static async approveDevice(serialNumber: string): Promise<DeviceEntry> {
    const json = await this.fetchApi<{ success: boolean; data: DeviceEntry }>(
      `/admin/devices/${encodeURIComponent(serialNumber)}/approve`,
      // The route takes no fields, but an empty JSON object is still required:
      // a bodiless POST would leave Fastify's JSON parser with nothing to read.
      { method: 'POST', body: JSON.stringify({}) },
      'Failed to approve device'
    )
    const d = json.data
    const presence = getDevicePresence(d.last_seen)
    return { ...d, status: presence.status, last_seen_minutes: presence.lastSeenMinutes }
  }
}

