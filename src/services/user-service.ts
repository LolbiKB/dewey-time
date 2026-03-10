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
    is_registrar?: boolean
    registrar_capabilities?: string[]
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

// Sync Status Summary
export interface SyncStatusSummary {
  total_devices: number
  synced: number
  partial: number
  not_synced: number
  syncing: number
  failed: number
  drifted: number
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

// Drift Status Entry (from user_device_sync_status table)
export interface DriftStatusEntry {
  device_sn: string
  expected_state: 'synced' | 'deleted'
  actual_state: 'not_synced' | 'syncing' | 'synced' | 'failed' | 'drift_detected' | 'unknown'
  drift_detected_at?: string
  last_sync_attempt?: string
  last_successful_sync?: string
  error_message?: string
}

export interface DriftStatusResponse {
  success: boolean
  data: DriftStatusEntry[]
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
   * Get sync status summary for a user.
   * A device is "synced" when it has the user data AND all the biometrics
   * (fingerprints/face) that are enrolled in the bridge database.
   * "partial" means the user data is on the device but biometrics are missing.
   * "drifted" means expected_state !== actual_state in user_device_sync_status.
   */
  static async getUserSyncSummary(userId: string): Promise<SyncStatusSummary> {
    // Parallel queries: devices, sync flags, biometric counts, commands, drift status
    const [devicesRes, syncRes, biometricsRes, failedRes, pendingRes, driftRes] = await Promise.all([
      supabase.from('devices').select('serial_number'),
      supabase.from('device_sync_status')
        .select('device_sn, has_user, has_fingerprint, has_face')
        .eq('user_id', userId),
      supabase.from('user_biometrics')
        .select('type')
        .eq('user_id', userId),
      supabase.from('command_queue')
        .select('device_sn, retry_count, max_retries')
        .eq('related_user_id', userId)
        .eq('status', 'failed'),
      supabase.from('command_queue')
        .select('device_sn')
        .eq('related_user_id', userId)
        .in('status', ['pending', 'sent']),
      supabase.from('user_device_sync_status')
        .select('device_sn, expected_state, actual_state, drift_detected_at')
        .eq('user_id', userId),
    ])

    if (devicesRes.error) throw devicesRes.error
    if (syncRes.error) throw syncRes.error

    // Determine what biometrics the user has enrolled in the bridge
    const biometrics = biometricsRes.data || []
    const userHasFingerprints = biometrics.some(b => b.type === 'fingerprint')
    const userHasFace = biometrics.some(b => b.type === 'face')

    // Build lookup maps
    const syncMap = new Map(
      (syncRes.data || []).map(s => [s.device_sn, s])
    )
    const failedDevices = new Set(
      (failedRes.data || [])
        .filter(cmd => (cmd.retry_count || 0) >= (cmd.max_retries || 3))
        .map(cmd => cmd.device_sn)
    )
    const syncingDevices = new Set(
      (pendingRes.data || []).map(cmd => cmd.device_sn)
    )
    
    // Build drift map from user_device_sync_status
    const driftMap = new Map(
      (driftRes.data || [])
        .filter(d => d.expected_state !== d.actual_state)
        .map(d => [d.device_sn, d])
    )

    const total = devicesRes.data?.length || 0
    let synced = 0
    let partial = 0
    let failed = 0
    let syncing = 0
    let drifted = 0

    for (const device of devicesRes.data || []) {
      const sn = device.serial_number
      const sync = syncMap.get(sn)
      const hasDrift = driftMap.has(sn)

      if (hasDrift) {
        drifted++
      } else if (failedDevices.has(sn)) {
        failed++
      } else if (syncingDevices.has(sn)) {
        syncing++
      } else if (sync?.has_user) {
        // Check if biometrics are also on the device
        const fpOk = !userHasFingerprints || sync.has_fingerprint
        const faceOk = !userHasFace || sync.has_face
        if (fpOk && faceOk) {
          synced++
        } else {
          partial++ // user data present but biometrics missing
        }
      }
    }

    return {
      total_devices: total,
      synced,
      partial,
      not_synced: total - synced - partial - syncing - failed - drifted,
      syncing,
      failed,
      drifted,
    }
  }

  /**
   * Get drift status for a user across all devices
   * Returns devices where expected_state !== actual_state
   */
  static async getDriftStatus(userId: string): Promise<DriftStatusResponse> {
    const { data, error } = await supabase
      .from('user_device_sync_status')
      .select('device_sn, expected_state, actual_state, drift_detected_at, last_sync_attempt, last_successful_sync, error_message')
      .eq('user_id', userId)
      .neq('expected_state', 'actual_state')

    if (error) throw error

    return {
      success: true,
      data: data || [],
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

}
