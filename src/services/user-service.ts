import { supabase } from '@/lib/supabase'

const API_BASE_URL = 'https://jihzfxcdbdpzrrefecys.supabase.co/functions/v1'

export { API_BASE_URL }

// User Filters
export interface UserFilters {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  search?: string
  frappe_employee_id?: string
  status?: 'active' | 'inactive' | 'compromised' | 'archived'
  has_fingerprint?: boolean
  has_face?: boolean
}

// User Entry
export interface UserEntry {
  id: string | null
  pin: string | null
  name: string
  frappe_employee_id?: string
  card_number?: string | null
  photo_url?: string
  privilege: number | null
  status?: 'active' | 'inactive' | 'compromised' | 'archived'
  notes?: string
  created_at: string | null
  updated_at: string | null
  fingerprint_count?: number
  face_count?: number
  has_fingerprint?: boolean
  has_face?: boolean
  department?: string
  frappe_status?: string
  is_registered?: boolean
}

// Sync Status Entry
export interface SyncStatusEntry {
  id: string
  device_sn: string
  user_id: string
  has_user: boolean
  has_fingerprint: boolean
  has_face: boolean
  has_photo: boolean
  has_card: boolean
  last_synced_at?: string
  is_online?: boolean
  devices?: {
    serial_number: string
    name?: string
    location?: string
    last_seen?: string
  }
}

// Command Queue Entry
export interface CommandQueueEntry {
  id: number
  device_sn: string
  command: string
  status: 'pending' | 'sent' | 'success' | 'failed'
  created_at: string
  sent_at?: string
  completed_at?: string
  updated_at?: string
  command_type?: string
  error_message?: string
  retry_count?: number
  max_retries?: number
  next_retry_at?: string
  last_error?: string
  initiated_by?: 'user' | 'system' | 'webhook' | 'api'
  priority?: number
  depends_on_command_id?: number | null
  devices?: {
    serial_number: string
    name?: string
    location?: string
  }
}

// User Device Sync Status (Desired State Reconciliation)
export interface UserDeviceSyncStatus {
  id: string
  user_id: string
  device_id: string
  expected_state: 'synced' | 'deleted'
  actual_state: 'not_synced' | 'syncing' | 'synced' | 'failed' | 'drift_detected' | 'unknown'
  last_sync_attempt?: string
  last_successful_sync?: string
  retry_count: number
  next_retry_at?: string
  error_message?: string
  drift_detected_at?: string
  drift_details?: any
  created_at: string
  updated_at: string
  devices?: {
    id: string
    name: string
    ip_address: string
    status: string
    is_registrar?: boolean
  }
}

// Sync Status Summary
export interface SyncStatusSummary {
  total_devices: number
  synced: number
  not_synced: number
  syncing: number
  failed: number
  drift_detected: number
  unknown: number
}

// API Responses
export interface UsersResponse {
  success: boolean
  data: UserEntry[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface SyncStatusResponse {
  success: boolean
  data: SyncStatusEntry[]
}

export interface CommandQueueResponse {
  success: boolean
  data: CommandQueueEntry[]
}

// Biometric Entry (from user_biometrics table)
export interface BiometricEntry {
  id: string
  type: 'fingerprint' | 'face'
  finger_id: number | null
  template_size: number | null
  enrolled_at: string
  enrolled_device_sn: string | null
}

export interface BiometricsResponse {
  success: boolean
  data: BiometricEntry[]
}

// Service class
export class UserService {
  /**
   * Get auth headers for API requests
   */
  private static async getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session } } = await supabase.auth.getSession()
    
    return {
      'Content-Type': 'application/json',
      ...(session?.access_token && { 'Authorization': `Bearer ${session.access_token}` }),
    }
  }

  /**
   * Fetch users with filters and pagination
   */
  static async getUsers(filters: UserFilters = {}): Promise<UsersResponse> {
    const params = new URLSearchParams()
    
    if (filters.page) params.append('page', filters.page.toString())
    if (filters.limit) params.append('limit', filters.limit.toString())
    if (filters.sortBy) params.append('sortBy', filters.sortBy)
    if (filters.sortOrder) params.append('sortOrder', filters.sortOrder)
    if (filters.search) params.append('search', filters.search)
    if (filters.frappe_employee_id) params.append('frappe_employee_id', filters.frappe_employee_id)
    if (filters.status) params.append('status', filters.status)
    if (filters.has_fingerprint !== undefined) params.append('has_fingerprint', filters.has_fingerprint.toString())
    if (filters.has_face !== undefined) params.append('has_face', filters.has_face.toString())

    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users?${params}`, {
      headers,
    })
    
    if (!response.ok) {
      throw new Error('Failed to fetch users')
    }

    return response.json()
  }

  /**
   * Get sync status for a user across all devices
   */
  static async getSyncStatus(userId: string): Promise<SyncStatusResponse> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users/${userId}/sync-status`, {
      headers,
    })
    
    if (!response.ok) {
      throw new Error('Failed to fetch sync status')
    }

    return response.json()
  }

  /**
   * Get recent command queue entries for a user
   */
  static async getCommandQueue(userId: string, limit: number = 10): Promise<CommandQueueResponse> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users/${userId}/commands?limit=${limit}`, {
      headers,
    })
    
    if (!response.ok) {
      throw new Error('Failed to fetch command queue')
    }

    return response.json()
  }

  /**
   * Create a new user
   */
  static async createUser(user: Partial<UserEntry>): Promise<UserEntry> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users`, {
      method: 'POST',
      headers,
      body: JSON.stringify(user),
    })
    
    if (!response.ok) {
      throw new Error('Failed to create user')
    }

    const result = await response.json()
    return result.data
  }

  /**
   * Update a user
   */
  static async updateUser(userId: string, user: Partial<UserEntry>): Promise<UserEntry> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users/${userId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(user),
    })
    
    if (!response.ok) {
      throw new Error('Failed to update user')
    }

    const result = await response.json()
    return result.data
  }

  /**
   * Delete a user
   */
  static async deleteUser(userId: string): Promise<void> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users/${userId}`, {
      method: 'DELETE',
      headers,
    })
    
    if (!response.ok) {
      throw new Error('Failed to delete user')
    }
  }

  /**
   * Sync user to specific devices (fast — queues sync_user commands only)
   * Returns parent command IDs needed for enrich step.
   */
  static async syncUserToDevices(
    userId: string,
    deviceSns: string[],
  ): Promise<{ parentCommands: Record<string, number> }> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users/${userId}/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ device_sns: deviceSns }),
    })

    if (!response.ok) {
      throw new Error('Failed to sync user')
    }

    const result = await response.json()
    return { parentCommands: result.parentCommands ?? {} }
  }

  /**
   * Enrich sync with biometrics & photo (slow — fetches from Frappe)
   */
  static async enrichUserDevices(
    userId: string,
    deviceSns: string[],
    parentCommands: Record<string, number>,
  ): Promise<void> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users/${userId}/enrich`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ device_sns: deviceSns, parent_commands: parentCommands }),
    })

    if (!response.ok) {
      throw new Error('Failed to enrich sync')
    }
  }

  /**
   * Get biometric inventory for a user (fingerprints + face templates)
   */
  static async getUserBiometrics(userId: string): Promise<BiometricsResponse> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users/${userId}/biometrics`, {
      headers,
    })

    if (!response.ok) {
      throw new Error('Failed to fetch biometrics')
    }

    return response.json()
  }

  /**
   * Get a single command's status by ID (for enrollment polling)
   */
  static async getCommandStatus(commandId: number): Promise<CommandQueueEntry | null> {
    const { data, error } = await supabase
      .from('command_queue')
      .select('*')
      .eq('id', commandId)
      .single()

    if (error || !data) return null
    return data as CommandQueueEntry
  }

  /**
   * Start biometric enrollment on a device (queues ENROLL_FP / ENROLL_FACE command)
   */
  static async startEnrollment(
    userId: string,
    deviceSn: string,
    biometricType: 'fingerprint' | 'face',
    fingerId?: number,
  ): Promise<{ commandId: number }> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users/${userId}/enroll-biometric`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        device_sn: deviceSn,
        biometric_type: biometricType,
        finger_id: fingerId,
      }),
    })

    if (!response.ok) {
      const err = await response.json()
      throw new Error(err.error || 'Failed to start enrollment')
    }

    const result = await response.json()
    return { commandId: result.commandId }
  }

  /**
   * Fetch employees from Frappe HR merged with bridge users
   */
  static async getFrappeEmployees(filters: UserFilters = {}): Promise<UsersResponse> {
    const params = new URLSearchParams()
    
    if (filters.page) params.append('page', filters.page.toString())
    if (filters.limit) params.append('limit', filters.limit.toString())
    if (filters.search) params.append('search', filters.search)
    
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-frappe-employees?${params}`, {
      headers,
    })
    
    if (!response.ok) {
      throw new Error('Failed to fetch Frappe employees')
    }

    return response.json()
  }

  /**
   * Register an employee from Frappe in the bridge
   */
  static async registerEmployee(employeeId: string, pin: string, name: string): Promise<UserEntry> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-frappe-employees/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ frappe_employee_id: employeeId, pin, name }),
    })
    
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to register employee')
    }

    const result = await response.json()
    return result.data
  }

  /**
   * List all users (for PIN validation, etc.)
   */
  static async listUsers(): Promise<UserEntry[]> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/api-users?limit=1000`, {
      headers,
    })
    
    if (!response.ok) {
      throw new Error('Failed to list users')
    }

    const result = await response.json()
    return result.data || []
  }

  /**
   * Get detailed sync status for a user across all devices
   */
  static async getUserDeviceSyncStatus(userId: string): Promise<UserDeviceSyncStatus[]> {
    const { data, error } = await supabase
      .from('user_device_sync_status')
      .select(`
        *,
        devices (
          id,
          name,
          ip_address,
          status,
          is_registrar
        )
      `)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    if (error) throw error
    return data || []
  }

  /**
   * Get sync status summary for a user
   */
  static async getUserSyncSummary(userId: string): Promise<SyncStatusSummary> {
    // Get all devices
    const { data: devices, error: devicesError } = await supabase
      .from('devices')
      .select('serial_number')
    
    if (devicesError) throw devicesError

    // Get sync status for this user
    const { data: syncData, error: syncError } = await supabase
      .from('device_sync_status')
      .select('device_sn, has_user, has_fingerprint, has_face')
      .eq('user_id', userId)

    if (syncError) throw syncError

    // Get failed commands that maxed out retries (NEEDS FIX)
    const { data: failedCommands, error: failedError } = await supabase
      .from('command_queue')
      .select('device_sn, status, retry_count, max_retries')
      .eq('related_user_id', userId)
      .eq('status', 'failed')

    if (failedError) throw failedError

    // Get pending/sent commands (currently syncing)
    const { data: pendingCommands, error: pendingError } = await supabase
      .from('command_queue')
      .select('device_sn')
      .eq('related_user_id', userId)
      .in('status', ['pending', 'sent'])

    if (pendingError) throw pendingError

    // Create maps/sets for quick lookup
    const syncMap = new Map(
      (syncData || []).map(s => [s.device_sn, s])
    )

    // Devices with maxed-out failed commands (drift/error state)
    const failedDevices = new Set(
      (failedCommands || [])
        .filter(cmd => (cmd.retry_count || 0) >= (cmd.max_retries || 3))
        .map(cmd => cmd.device_sn)
    )

    const syncingDevices = new Set(
      (pendingCommands || []).map(cmd => cmd.device_sn)
    )

    // Count statuses
    const total = devices?.length || 0
    let synced = 0
    let failed = 0
    let syncing = 0

    for (const device of devices || []) {
      const sync = syncMap.get(device.serial_number)
      
      if (failedDevices.has(device.serial_number)) {
        // Device has failed commands that maxed out retries - treat as failed/drift
        failed++
      } else if (syncingDevices.has(device.serial_number)) {
        // Device has pending/sent commands - currently syncing
        syncing++
      } else if (sync?.has_user === true) {
        // Device has user and no active/failed commands - truly synced
        synced++
      }
    }

    return {
      total_devices: total,
      synced: synced,
      not_synced: total - synced - syncing - failed,
      syncing: syncing,
      failed: failed,
      drift_detected: failedDevices.size,
      unknown: 0,
    }
  }

  /**
   * Manually trigger reconciliation for a specific user
   */
  static async triggerUserReconciliation(userId: string): Promise<void> {
    const headers = await this.getAuthHeaders()
    const response = await fetch(`${API_BASE_URL}/sync-reconciliation`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ user_id: userId }),
    })
    
    if (!response.ok) {
      throw new Error('Failed to trigger reconciliation')
    }
  }

  /**
   * Clear pending/sent commands for a specific device
   * Removes commands that haven't completed yet to reset the queue
   */
  static async clearPendingCommands(deviceSn: string, userId?: string): Promise<{ cleared: number }> {
    let query = supabase
      .from('command_queue')
      .delete()
      .eq('device_sn', deviceSn)
      .in('status', ['pending', 'sent'])

    if (userId) {
      query = query.eq('related_user_id', userId)
    }

    const { data, error } = await query.select()

    if (error) throw error
    
    return { cleared: data?.length || 0 }
  }

  /**
   * Check if a device is currently busy (has active commands)
   * Returns device state: idle, syncing, or unknown
   */
  static async getDeviceState(deviceSn: string): Promise<{
    state: 'idle' | 'syncing' | 'unknown'
    activeCommand?: CommandQueueEntry
  }> {
    const { data, error } = await supabase
      .from('command_queue')
      .select('*')
      .eq('device_sn', deviceSn)
      .in('status', ['pending', 'sent'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error) {
      // PGRST116 means no rows returned (device is idle)
      if (error.code === 'PGRST116') {
        return { state: 'idle' }
      }
      return { state: 'unknown' }
    }

    return {
      state: 'syncing',
      activeCommand: data
    }
  }

  /**
   * Check if a user can be deleted from cloud
   * Returns whether deletion is allowed and which devices still have the user
   */
  static async canDeleteUser(userId: string): Promise<{
    allowed: boolean
    deviceCount: number
    devices: Array<{ sn: string; name: string }>
  }> {
    const { data, error } = await supabase
      .from('user_device_sync_status')
      .select(`
        device_id,
        devices!inner (
          serial_number,
          name
        )
      `)
      .eq('user_id', userId)
      .eq('expected_state', 'synced')
      .eq('actual_state', 'synced')

    if (error) {
      console.error('Error checking user device status:', error)
      return { allowed: false, deviceCount: 0, devices: [] }
    }

    const devices = (data || []).map(item => ({
      sn: (item.devices as any).serial_number,
      name: (item.devices as any).name || (item.devices as any).serial_number
    }))

    return {
      allowed: devices.length === 0,
      deviceCount: devices.length,
      devices
    }
  }
}
