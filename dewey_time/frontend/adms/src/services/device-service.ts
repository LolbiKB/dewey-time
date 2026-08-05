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

/**
 * What KIND of thing an option key is — classified by the BRIDGE, the
 * enforcement point for write eligibility. Never re-derived here.
 */
export type KeyKind = 'setting' | 'identity' | 'counter'

/** One option a terminal reported about itself in an INFO reply. */
export interface DeviceOptionEntry {
  device_sn: string
  key: string
  /** Null when withheld — see `redacted`. Never assume null means "unset". */
  value: string | null
  /**
   * The device reported a value that the bridge deliberately did not store,
   * because this key is not on its value allowlist. Anything written to that
   * table also lands in backups, so unclassified values are never persisted.
   */
  redacted: boolean
  reported_at: string
  /** Classified by the BRIDGE — the enforcement point. Never re-derived here. */
  kind: KeyKind
}

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

  /**
   * Queue a command for a device (REBOOT, INFO, CHECK, LOG, SET OPTION, etc.)
   * The device picks it up on its next getrequest poll.
   */
  static async queueDeviceCommand(
    deviceSn: string,
    commandType: string,
    commandBody: string
  ): Promise<{ id: number; command: string }> {
    // Insert first, then stamp the prefix with the REAL row id — the same
    // two-step the bridge's queueCommandWithDbId uses.
    //
    // This used to derive the id as max(id)+1 for the device, which is wrong the
    // moment anything else queues concurrently (another admin, or the bridge's
    // own sync/reconciliation): two rows get the same C:{n}: prefix, the device
    // ACKs one id, and the other command can never be matched to its ACK — it
    // stays undeliverable forever. The prefix must be the row's own primary key.
    const { data: inserted, error: insertError } = await supabase
      .from('command_queue')
      .insert({
        device_sn: deviceSn,
        command: commandBody,
        command_type: commandType,
        status: 'pending',
        // Keep it out of the delivery window until the prefix is stamped; the
        // bridge honours next_retry_at and repairs any missed stamp anyway.
        next_retry_at: new Date(Date.now() + 10_000).toISOString(),
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      throw new Error(`Failed to queue command: ${insertError?.message ?? 'no row returned'}`)
    }

    // Best-effort stamp. `authenticated` no longer holds UPDATE on
    // command_queue — that grant was what let an admin replay a Super Admin's
    // REBOOT at any terminal, so it was revoked outright rather than policed.
    //
    // Failing here is NOT a failure of the operation: the row is already
    // inserted, and the bridge repairs a missing C:{id}: prefix on its next
    // maintenance pass (command-maintenance.ts:114-127). Throwing would tell
    // the user their request failed when the command is queued and will be
    // delivered.
    const command = `C:${inserted.id}:${commandBody}`
    const { data, error } = await supabase
      .from('command_queue')
      .update({ command, next_retry_at: new Date().toISOString() })
      .eq('id', inserted.id)
      .select('id, command')
      .single()

    if (error) {
      console.warn(
        `[device-service] could not stamp command ${inserted.id}; the bridge will repair the prefix`,
        error.message
      )
      return { id: inserted.id, command: commandBody }
    }

    return data!
  }

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

  /**
   * Ask a terminal to report its own configuration (ZKTeco INFO, §12.4.3).
   *
   * Queues a command — the terminal answers on its NEXT POLL, so options appear
   * seconds later, not in this response. Super Admin only, enforced by the bridge.
   */
  static async refreshDeviceOptions(serialNumber: string): Promise<{ commandId: number }> {
    const json = await this.fetchApi<{ success: boolean; commandId: number }>(
      `/admin/devices/${encodeURIComponent(serialNumber)}/options/refresh`,
      { method: 'POST', body: JSON.stringify({}) },
      'Failed to request device configuration'
    )
    return { commandId: json.commandId }
  }

  /**
   * What a terminal last reported about itself.
   *
   * `redacted` means the device DID report a value the bridge deliberately did
   * not store, because the key is not on its value allowlist — NOT that the
   * option is unset. The two must never render the same way.
   */
  /**
   * NOTE: there is deliberately no fleet-wide variant of this.
   *
   * A bare GET returns every device's rows under ONE bound, which truncates
   * silently as the fleet grows — ten terminals at ~78 keys is 780 rows against
   * a 500 cap. A cut key looks absent on every terminal, which renders as drift
   * that is not real. The fleet page fans out per device instead, so each query
   * stays far under the bound however many terminals there are.
   */
  static async getDeviceOptions(serialNumber: string): Promise<DeviceOptionEntry[]> {
    const json = await this.fetchApi<{ success: boolean; data: DeviceOptionEntry[] }>(
      `/admin/device-options?sn=${encodeURIComponent(serialNumber)}`,
      {},
      'Failed to load device configuration'
    )
    return json.data ?? []
  }

}

