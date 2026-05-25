import { supabase } from '@/lib/supabase'

// Custom error for user operation locks (423 Locked)
export class UserOperationLockedError extends Error {
  existingOperation?: string
  startedAt?: string
  retryAfter: number

  constructor(
    message: string,
    existingOperation?: string,
    startedAt?: string,
    retryAfter: number = 30
  ) {
    super(message)
    this.name = 'UserOperationLockedError'
    this.existingOperation = existingOperation
    this.startedAt = startedAt
    this.retryAfter = retryAfter
  }
}

// Singleton state (shared across the app)
let globalCancelled = { value: false }
let globalSyncState = { active: false, userId: null as string | null, deviceSns: [] as string[], lastSyncTriggered: null as number | null }
let globalSyncListeners = [] as ((state: typeof globalSyncState) => void)[]

export function getGlobalCancel() { return globalCancelled }
export function setGlobalCancel(value: boolean) { globalCancelled.value = value }

export function getSyncState() { return globalSyncState }
export function setSyncState(update: Partial<typeof globalSyncState>) {
  globalSyncState = { ...globalSyncState, ...update }
  globalSyncListeners.forEach(l => l(globalSyncState))
}
export function subscribeSyncState(listener: (state: typeof globalSyncState) => void) {
  globalSyncListeners.push(listener)
  return () => {
    globalSyncListeners = globalSyncListeners.filter(l => l !== listener)
  }
}

export interface UserFilters {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  search?: string
  status?: 'active' | 'inactive' | 'compromised' | 'archived'
  registration_status?: 'registered' | 'unregistered' | 'inactive'
  has_fingerprint?: boolean
  has_face?: boolean
}

export interface UserEntry {
  id: string | null
  pin: string | null
  name: string
  frappe_employee_id?: string
  card_number?: string | null
  photo_url?: string
  photo_storage_path?: string | null
  privilege: number | null
  status?: 'active' | 'inactive' | 'compromised' | 'archived'
  created_at: string | null
  updated_at: string | null
  fingerprint_count?: number
  face_count?: number
  has_fingerprint?: boolean
  has_face?: boolean
  department?: string
  is_registered?: boolean
  attendance_flagged_at?: string | null
  attendance_flag_reason?: string | null
}

export interface SyncStatusEntry {
  id: string
  device_sn: string
  user_id: string
  has_fingerprint: boolean
  has_face: boolean
  has_fingerprint_in_db?: boolean
  has_face_in_db?: boolean
  has_photo_in_db?: boolean
  user_synced: boolean
  fingerprint_synced: boolean
  fingerprint_mask: number  // BULLETPROOF: bitmask of synced FIDs (bit N = FID N synced)
  face_synced: boolean
  photo_synced: boolean
  user_synced_at?: string | null
  fingerprint_synced_at?: string | null
  face_synced_at?: string | null
  photo_synced_at?: string | null
  last_synced_at?: string
  is_online?: boolean
  expected_state?: string
  actual_state?: string
  devices?: {
    serial_number: string
    name?: string
    location?: string
    last_seen?: string
    is_registrar?: boolean
    registrar_capabilities?: string[]
  }
}

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
  initiated_by?: string
  priority?: number
  depends_on_command_id?: number | null
  devices?: {
    serial_number: string
    name?: string
    location?: string
  }
}

export interface SyncStatusSummary {
  total_devices: number
  synced: number
  not_synced: number
  is_fully_synced: boolean
}

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

const API_URL = import.meta.env.VITE_API_URL || '' // Empty string uses Vite proxy in dev

export class UserService {
  private static async getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session } } = await supabase.auth.getSession()
    return {
      'Content-Type': 'application/json',
      ...(session?.access_token && { 'Authorization': `Bearer ${session.access_token}` }),
    }
  }

  private static async fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
    const authHeaders = await this.getAuthHeaders() as Record<string, string>
    const hasBody = !!options?.body
    const fullUrl = `${API_URL}${path}`
    const response = await fetch(fullUrl, {
      ...options,
      // Fastify rejects DELETE/GET with Content-Type but no body — omit Content-Type for bodiless requests
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeaders.Authorization ? { Authorization: authHeaders.Authorization } : {}),
        ...options?.headers,
      },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      
      // Handle 423 Locked (User Operation Lock)
      if (response.status === 423) {
        const retryAfter = response.headers.get('Retry-After')
        throw new UserOperationLockedError(
          error.error || 'User operation in progress',
          error.existingOperation,
          error.startedAt,
          retryAfter ? parseInt(retryAfter, 10) : 30
        )
      }
      
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    try {
      const result = await response.json()
      console.log('=== API Response ===', JSON.stringify(result).slice(0, 200))
      return result
    } catch (e) {
      console.error('JSON parse error:', e)
      const text = await response.text()
      console.error('Response text:', text.slice(0, 500))
      throw e
    }
  }

  static async getUsers(filters: UserFilters = {}): Promise<UsersResponse> {
    const params = new URLSearchParams()
    if (filters.page) params.append('page', String(filters.page))
    if (filters.limit) params.append('limit', String(filters.limit))
    if (filters.sortBy) params.append('sortBy', filters.sortBy)
    if (filters.sortOrder) params.append('sortOrder', filters.sortOrder)
    if (filters.search) params.append('search', filters.search)
    if (filters.status) params.append('status', filters.status)
    if (filters.has_fingerprint !== undefined) params.append('has_fingerprint', String(filters.has_fingerprint))
    if (filters.has_face !== undefined) params.append('has_face', String(filters.has_face))

    return this.fetchApi<UsersResponse>(`/admin/users?${params}`)
  }

  static async getSyncStatus(userId: string): Promise<SyncStatusResponse> {
    return this.fetchApi<SyncStatusResponse>(`/admin/users/${userId}/sync-status`)
  }

  static async getCommandQueue(userId: string, limit: number = 10): Promise<CommandQueueResponse> {
    return this.fetchApi<CommandQueueResponse>(`/admin/users/${userId}/commands?limit=${limit}`)
  }

  static async createUser(user: Partial<UserEntry>): Promise<UserEntry> {
    const result = await this.fetchApi<{ success: boolean; data: UserEntry }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(user),
    })
    return result.data
  }

  static async updateUser(userId: string, user: Partial<UserEntry>): Promise<UserEntry> {
    const result = await this.fetchApi<{ success: boolean; data: UserEntry }>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(user),
    })
    return result.data
  }

  static async deleteUser(userId: string): Promise<void> {
    await this.fetchApi(`/admin/users/${userId}`, { method: 'DELETE' })
  }

  static async syncUserToDevices(
    userId: string,
    deviceSns: string[],
  ): Promise<{ parentCommands: Record<string, number> }> {
    const result = await this.fetchApi<{ success: boolean; message: string; commandsQueued: number; parentCommands: Record<string, number> }>(
      `/admin/users/${userId}/sync`,
      {
        method: 'POST',
        body: JSON.stringify({ device_sns: deviceSns }),
      }
    )
    return { parentCommands: result.parentCommands || {} }
  }

  static async enrichUserDevices(
    userId: string,
    deviceSns: string[],
    parentCommands: Record<string, number>
  ): Promise<{ commandsQueued: number; biometrics: string[]; photo: boolean }> {
    const result = await this.fetchApi<{ success: boolean; message: string; commandsQueued: number; photoIncluded: boolean }>(
      `/admin/users/${userId}/enrich`,
      {
        method: 'POST',
        body: JSON.stringify({ device_sns: deviceSns, parent_commands: parentCommands }),
      }
    )
    return {
      commandsQueued: result.commandsQueued || 0,
      biometrics: [], // Fastify doesn't return which biometrics were queued
      photo: result.photoIncluded || false,
    }
  }

  static async enrichUserDevicesForDevice(
    userId: string,
    deviceSn: string,
    parentCommandId: number
  ): Promise<void> {
    await this.fetchApi<{ success: boolean; message: string }>(
      `/admin/users/${userId}/enrich`,
      {
        method: 'POST',
        body: JSON.stringify({
          device_sns: [deviceSn],
          parent_commands: { [deviceSn]: parentCommandId }
        }),
      }
    )
  }

  static async getUserBiometrics(userId: string): Promise<BiometricsResponse> {
    const { data, error } = await supabase.from('user_biometrics').select('*').eq('user_id', userId)
    if (error) throw error
    return { success: true, data: (data || []) as BiometricEntry[] }
  }

  static async deleteBiometric(userId: string, type: 'fingerprint' | 'face', fingerId?: number): Promise<{ success: boolean; commandsQueued: number }> {
    const params = new URLSearchParams({ type })
    if (fingerId != null) {
      params.append('finger_id', String(fingerId))
    }

    const result = await this.fetchApi<{ success: boolean; message: string; commandsQueued: number }>(
      `/admin/users/${userId}/biometrics?${params}`,
      { method: 'DELETE' }
    )

    return { success: result.success, commandsQueued: result.commandsQueued }
  }

  static async retryUserSync(userId: string, deviceSns?: string[]): Promise<{ success: boolean; commandsQueued: number }> {
    const result = await this.fetchApi<{ success: boolean; message: string; commandsQueued: number }>(
      `/admin/users/${userId}/sync/retry`,
      { 
        method: 'POST',
        body: JSON.stringify({ device_sns: deviceSns }),
      }
    )

    return { success: result.success, commandsQueued: result.commandsQueued }
  }

  static async forceUserSync(userId: string, deviceSns?: string[]): Promise<{ success: boolean; commandsQueued: number }> {
    console.log('[forceUserSync] Calling API:', `/admin/users/${userId}/sync/force`, 'devices:', deviceSns)
    const result = await this.fetchApi<{ success: boolean; message: string; commandsQueued: number; skippedDevices?: number }>(
      `/admin/users/${userId}/sync/force`,
      { 
        method: 'POST',
        body: JSON.stringify({ device_sns: deviceSns, reset: true }),
      }
    )
    console.log('[forceUserSync] API result:', result)
    return { success: result.success, commandsQueued: result.commandsQueued }
  }

  static async getCommandStatus(commandId: number): Promise<CommandQueueEntry | null> {
    const { data, error } = await supabase.from('command_queue').select('*').eq('id', commandId).single()
    if (error || !data) return null
    return data as CommandQueueEntry
  }

  static async startEnrollment(userId: string, deviceSn: string, biometricType: 'fingerprint' | 'face', fingerId?: number): Promise<{ commandId: number }> {
    const result = await this.fetchApi<{ success: boolean; commandId: number }>(
      `/admin/users/${userId}/enrollment/start`,
      {
        method: 'POST',
        body: JSON.stringify({
          device_sn: deviceSn,
          biometric_type: biometricType,
          finger_id: fingerId,
        }),
      }
    )

    return { commandId: result.commandId }
  }

  static async cancelEnrollment(userId: string): Promise<{ cancelled: number; message: string }> {
    const result = await this.fetchApi<{ success: boolean; cancelled: number; message: string }>(
      `/admin/users/${userId}/enrollment/cancel`,
      { method: 'POST' }
    )
    return { cancelled: result.cancelled, message: result.message }
  }

  static async triggerEnrollmentRecovery(userId: string): Promise<{ success: boolean; message: string }> {
    return this.fetchApi<{ success: boolean; message: string }>(
      `/admin/users/${userId}/enrollment/recovery`,
      { method: 'POST', body: JSON.stringify({}) }
    )
  }

  static async getEnrollmentStatus(userId: string): Promise<{
    success: boolean
    data: {
      session: {
        id: string
        phase: string
        bio_type: string
        finger_id: number
        device_sn: string
        command_id: number | null
        deadline_at: string | null
        error_message: string | null
        recovery_queued_at: string | null
        recovery_command_id: number | null
        recovery_attempts: number
      } | null
      command: CommandQueueEntry | null
      hasTemplateInDb: boolean
    }
  }> {
    return this.fetchApi(`/admin/users/${userId}/enrollment/status`)
  }

  static async reconcileUserSync(userId: string): Promise<{
    success: boolean
    cancelled: number
    devices: Array<{
      device_sn: string
      actual_state: string
      user_synced: boolean
      photo_synced: boolean
      fingerprint_synced: boolean
    }>
  }> {
    return this.fetchApi(`/admin/users/${userId}/reconcile-sync`, {
      method: 'POST',
      body: JSON.stringify({ force: true }),
    })
  }

  static async getFrappeEmployees(filters: UserFilters = {}): Promise<UsersResponse> {
    const params = new URLSearchParams()
    if (filters.page) params.append('page', String(filters.page))
    if (filters.limit) params.append('limit', String(filters.limit))
    if (filters.search) params.append('search', filters.search)
    if (filters.status) params.append('status', filters.status)
    if (filters.registration_status) params.append('registration_status', filters.registration_status)
    
    return this.fetchApi<UsersResponse>(`/admin/frappe-employees?${params}`)
  }

  static async registerEmployee(employeeId: string, pin: string, name: string): Promise<UserEntry> {
    const result = await this.fetchApi<{ success: boolean; data: UserEntry }>('/admin/frappe-employees/register', {
      method: 'POST',
      body: JSON.stringify({ frappe_employee_id: employeeId, pin, name }),
    })
    return result.data
  }

  static async listUsers(): Promise<UserEntry[]> {
    const result = await this.getUsers({ limit: 1000 })
    return result.data
  }

  static async checkPinAvailability(pin: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('pin', pin)
      .maybeSingle()
    
    if (error) {
      console.error('[checkPinAvailability] Error:', error)
      return true // Assume available on error to not block user
    }
    
    return !data // true = available (no user found), false = taken
  }

  static async getNextAvailablePin(): Promise<string> {
    const { data, error } = await supabase
      .from('users')
      .select('pin')
      .not('pin', 'is', null)
      .order('pin', { ascending: true })
    
    if (error || !data || data.length === 0) {
      return '1' // Default to 1 if no users exist
    }
    
    // Find first gap in sequential PINs
    const pins = data.map(u => parseInt(u.pin!, 10)).filter(n => !isNaN(n))
    
    for (let i = 1; i <= pins.length + 1; i++) {
      if (!pins.includes(i)) {
        return i.toString()
      }
    }
    
    return (pins.length + 1).toString()
  }

  static async getUserSyncSummary(userId: string): Promise<SyncStatusSummary> {
    const { data: syncStatuses, error } = await supabase
      .from('user_device_sync_status')
      .select('device_sn, actual_state, fingerprint_synced, face_synced')
      .eq('user_id', userId)

    if (error) throw error

    const { data: activeEnrollment } = await supabase
      .from('enrollment_sessions')
      .select('id')
      .eq('user_id', userId)
      .in('phase', ['queued', 'awaiting_upload'])
      .limit(1)

    const { count: fpInDb } = await supabase
      .from('user_biometrics')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'fingerprint')

    const total = syncStatuses?.length || 0
    const hasFpInDb = (fpInDb ?? 0) > 0
    const hasActiveEnrollment = (activeEnrollment?.length ?? 0) > 0

    const deviceSynced = (s: { actual_state: string; fingerprint_synced: boolean }) => {
      if (s.actual_state !== 'synced') return false
      if (hasFpInDb && !s.fingerprint_synced) return false
      return true
    }

    const synced = syncStatuses?.filter(deviceSynced).length || 0
    let not_synced = syncStatuses?.filter(s => !deviceSynced(s)).length || 0
    if (hasActiveEnrollment && not_synced === 0 && total > 0) {
      not_synced = 1
    }

    return {
      total_devices: total,
      synced,
      not_synced,
      is_fully_synced: synced === total && total > 0 && !hasActiveEnrollment,
    }
  }

  static async getDriftStatus(userId: string): Promise<{ success: boolean; data: any[] }> {
    const { data, error } = await supabase.from('user_device_sync_status').select('*').eq('user_id', userId).neq('expected_state', 'actual_state')
    if (error) throw error
    return { success: true, data: data || [] }
  }

  static async clearPendingCommands(deviceSn: string, userId?: string): Promise<{ cleared: number }> {
    console.log('[clearPendingCommands] deviceSn:', deviceSn, 'userId:', userId)
    
    let lookupQuery = supabase.from('command_queue').select('id, related_user_id, status').eq('device_sn', deviceSn).in('status', ['pending', 'sent', 'success'])
    if (userId) lookupQuery = lookupQuery.eq('related_user_id', userId)
    const { data: commandsToClear, error: lookupError } = await lookupQuery
    
    console.log('[clearPendingCommands] Found:', commandsToClear, 'error:', lookupError)
    
    const deleted = commandsToClear?.length || 0

    let deleteQuery = supabase.from('command_queue').delete().eq('device_sn', deviceSn).in('status', ['pending', 'sent', 'success'])
    if (userId) deleteQuery = deleteQuery.eq('related_user_id', userId)
    const { error: deleteError } = await deleteQuery
    
    console.log('[clearPendingCommands] Delete error:', deleteError)
    
    // Check remaining commands for this user+device and update sync status
    if (userId) {
      const { data: remaining } = await supabase.from('command_queue').select('status', { count: 'exact' }).eq('device_sn', deviceSn).eq('related_user_id', userId)
      const remainingCount = remaining?.length || 0
      
      console.log('[clearPendingCommands] Remaining commands:', remainingCount)

      // Update sync status based on remaining commands
      if (remainingCount === 0) {
        // No more commands - mark as not_synced (need re-sync)
        await supabase.from('user_device_sync_status').upsert({ 
          device_sn: deviceSn, 
          user_id: userId, 
          expected_state: 'synced', 
          actual_state: 'not_synced', 
          retry_count: 0 
        }, { onConflict: 'device_sn,user_id' })
      } else {
        await supabase.from('user_device_sync_status').upsert({ 
          device_sn: deviceSn, 
          user_id: userId, 
          expected_state: 'synced', 
          actual_state: 'syncing', 
          retry_count: 0 
        }, { onConflict: 'device_sn,user_id' })
      }
    }
    return { cleared: deleted }
  }

  static async waitForCommand(commandId: number, timeoutMs: number = 30000): Promise<'success' | 'failed' | 'timeout' | 'cancelled'> {
    const startTime = Date.now()
    const pollInterval = 500
    
    while (Date.now() - startTime < timeoutMs) {
      // Check for cancellation via global flag
      if (getGlobalCancel().value) {
        return 'cancelled'
      }
      
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      
      const { data, error } = await supabase
        .from('command_queue')
        .select('status')
        .eq('id', commandId)
        .single()
      
      if (error || !data) continue
      
      if (data.status === 'success') return 'success'
      if (data.status === 'failed') return 'failed'
    }
    
    return 'timeout'
  }
  
  static async clearPendingCommandsForDevice(deviceSn: string, userId: string): Promise<number> {
    // Clear pending, sent, and success (stuck) commands for this user+device
    const { count } = await supabase
      .from('command_queue')
      .delete()
      .eq('device_sn', deviceSn)
      .eq('related_user_id', userId)
      .in('status', ['pending', 'sent', 'success'])
    
    return count || 0
  }
  
  static async clearPendingCommandsForUser(userId: string): Promise<number> {
    // Clear pending AND sent (stuck) commands - include older than 5 minutes to be safe
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    
    // First get count of what will be deleted for logging
    const { data: existing } = await supabase
      .from('command_queue')
      .select('id')
      .eq('related_user_id', userId)
      .in('status', ['pending', 'sent'])
      .lte('created_at', fiveMinutesAgo)
    
    const count = existing?.length || 0
    
    if (count > 0) {
      const { count: deleted } = await supabase
        .from('command_queue')
        .delete()
        .eq('related_user_id', userId)
        .in('status', ['pending', 'sent'])
        .lte('created_at', fiveMinutesAgo)
      
      return deleted || count
    }
    
    return 0
  }

  static async getSyncHealth(): Promise<{
    success: boolean;
    data: {
      devices: { total: number; online: number; offline: number };
      users: { total: number; synced: number; syncing: number; failed: number };
      commands: { pending: number; failed: number };
      health: { deviceOnlinePercent: number; userSyncPercent: number };
    };
  }> {
    return this.fetchApi<{ success: boolean; data: any }>('/admin/sync/health')
  }

  static async getDeviceState(deviceSn: string): Promise<{ state: 'idle' | 'syncing' | 'unknown'; activeCommand?: CommandQueueEntry }> {
    const { data, error } = await supabase.from('command_queue').select('*').eq('device_sn', deviceSn).in('status', ['pending', 'sent']).order('created_at', { ascending: false }).limit(1).single()
    if (error) {
      if (error.code === 'PGRST116') return { state: 'idle' }
      return { state: 'unknown' }
    }
    return { state: 'syncing', activeCommand: data as CommandQueueEntry }
  }

  static async queryDeviceStats(deviceSn: string): Promise<{ success: boolean; message: string }> {
    return this.fetchApi<{ success: boolean; message: string }>(`/admin/devices/${deviceSn}/query-stats`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
  }
}