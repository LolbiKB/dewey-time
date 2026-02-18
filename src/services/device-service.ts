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
  last_seen?: string
  registration_data?: string
  created_at: string
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
        status: lastSeenMinutes !== null && lastSeenMinutes < 5 ? 'online' : 'offline',
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
}

