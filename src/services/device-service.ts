// ============================================================
// Device Service - Direct database queries with RLS
// ============================================================

import { supabase } from '@/lib/supabase'

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

    // Calculate derived fields (online/offline status)
    const devicesWithStatus = (data || []).map(device => {
      const lastSeenMinutes = device.last_seen 
        ? Math.floor((Date.now() - new Date(device.last_seen).getTime()) / 60000)
        : null
      
      return {
        ...device,
status: lastSeenMinutes !== null && lastSeenMinutes < 1 ? 'online' : 'offline',
        last_seen_minutes: lastSeenMinutes,
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
    // Get next command ID (use max existing ID + 1 for this device)
    const { data: lastCmd } = await supabase
      .from('command_queue')
      .select('id')
      .eq('device_sn', deviceSn)
      .order('id', { ascending: false })
      .limit(1)
      .single()

    const nextId = (lastCmd?.id || 0) + 1
    const command = `C:${nextId}:${commandBody}`

    const { data, error } = await supabase
      .from('command_queue')
      .insert({
        device_sn: deviceSn,
        command,
        command_type: commandType,
        status: 'pending',
      })
      .select('id, command')
      .single()

    if (error) {
      throw new Error(`Failed to queue command: ${error.message}`)
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
        query = query.in('command_type', ['sync_user', 'enroll_fingerprint', 'enroll_face', 'upload_photo', 'delete_user'])
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
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('serial_number', serialNumber)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null // No rows returned
      throw new Error(`Failed to fetch device: ${error.message}`)
    }

    if (!data) return null

    const lastSeenMinutes = data.last_seen
      ? Math.floor((Date.now() - new Date(data.last_seen).getTime()) / 60000)
      : null

    return {
      ...data,
      status: lastSeenMinutes !== null && lastSeenMinutes < 1 ? 'online' : 'offline',
      last_seen_minutes: lastSeenMinutes,
    } as DeviceEntry
  }

  /**
   * Retry a failed command by resetting it to pending
   */
  static async retryCommand(commandId: number): Promise<void> {
    const { error } = await supabase
      .from('command_queue')
      .update({
        status: 'pending',
        retry_count: 0,
        next_retry_at: null,
      })
      .eq('id', commandId)
      .eq('status', 'failed')

    if (error) {
      throw new Error(`Failed to retry command: ${error.message}`)
    }
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

    // Calculate derived fields
    const lastSeenMinutes = data.last_seen
      ? Math.floor((Date.now() - new Date(data.last_seen).getTime()) / 60000)
      : null

    return {
      ...data,
      status: lastSeenMinutes !== null && lastSeenMinutes < 1 ? 'online' : 'offline',
      last_seen_minutes: lastSeenMinutes,
    } as DeviceEntry
  }

  /**
   * Query device fingerprint algorithm version
   * Queues a GET OPTION ~ZKFPVersion command to the device
   */
  static async queryFingerprintVersion(serialNumber: string): Promise<{ 
    success: boolean
    message: string
    command_id: number
  }> {
    // Query FP version via command queue (device will respond in getrequest)
    const { data: lastCmd } = await supabase
      .from('command_queue')
      .select('id')
      .eq('device_sn', serialNumber)
      .order('id', { ascending: false })
      .limit(1)
      .single()

    const nextId = (lastCmd?.id || 0) + 1
    const command = `C:${nextId}:GETOption,ZKFPVersion`

    const { data, error } = await supabase
      .from('command_queue')
      .insert({
        device_sn: serialNumber,
        command,
        command_type: 'info',
        status: 'pending',
        initiated_by: 'api',
      })
      .select('id')
      .single()

    if (error) throw new Error(error.message)

    return {
      success: true,
      message: 'Query command queued',
      command_id: data?.id,
    }
  }
}

