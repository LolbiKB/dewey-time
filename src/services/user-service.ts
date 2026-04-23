import { supabase } from '@/lib/supabase'

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
}

export interface SyncStatusEntry {
  id: string
  device_sn: string
  user_id: string
  has_fingerprint: boolean
  has_face: boolean
  user_synced: boolean
  fingerprint_synced: boolean
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
  partial: number
  not_synced: number
  syncing: number
  failed: number
  drifted: number
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
    const headers = await this.getAuthHeaders()
    const fullUrl = `${API_URL}${path}`
    const response = await fetch(fullUrl, {
      ...options,
      headers: { ...headers, ...options?.headers },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
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
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    if (!user) throw new Error('User not found')

    const parentCommands: Record<string, number> = {}

    for (const deviceSn of deviceSns) {
      const { data: lastCmd } = await supabase
        .from('command_queue').select('id').eq('device_sn', deviceSn).order('id', { ascending: false }).limit(1).single()

      const nextId = (lastCmd?.id || Date.now())
      // Match exact format from Fastify admin-users.ts (tabs)
      const command = `C:${nextId}:DATA UPDATE USERINFO PIN=${user.pin}\tName=${user.name || ''}\tPri=${user.privilege || 0}\tPasswd=\tCard=\tGrp=1\tTZ=0000000000000000\tVerify=-1`

      const { data: cmdData, error } = await supabase
        .from('command_queue')
        .insert({ device_sn: deviceSn, command, command_type: 'sync_user', status: 'pending', related_user_id: userId, initiated_by: 'user' })
        .select('id')
        .single()

      if (error) continue
      if (cmdData) parentCommands[deviceSn] = cmdData.id

      await supabase.from('user_device_sync_status').upsert({
        device_sn: deviceSn,
        user_id: userId,
        expected_state: 'synced',
        actual_state: 'syncing',
        user_command_id: cmdData?.id,
        user_synced: false,
        fingerprint_synced: false,
        face_synced: false,
        photo_synced: false,
      }, { onConflict: 'device_sn,user_id' })
    }

    return { parentCommands }
  }

  static async enrichUserDevices(
    userId: string,
    deviceSns: string[],
    parentCommands: Record<string, number>
  ): Promise<{ commandsQueued: number; biometrics: string[]; photo: boolean }> {
    const { data: biometrics, error: bioError } = await supabase
      .from('user_biometrics')
      .select('*')
      .eq('user_id', userId)

    if (bioError) {
      console.error('[enrichUserDevices] Error fetching biometrics:', bioError)
      throw bioError
    }

    const { data: user } = await supabase
      .from('users')
      .select('pin, photo_storage_path')
      .eq('id', userId)
      .single()

    if (!user) {
      throw new Error('User not found')
    }

    let photoBase64: string | null = null
    let photoSize: number | null = null

    if (user.photo_storage_path) {
      try {
        const { data: photoBlob, error: photoError } = await supabase.storage
          .from('user-photos')
          .download(user.photo_storage_path)

        if (!photoError && photoBlob) {
          const photoBytes = new Uint8Array(await photoBlob.arrayBuffer())
          photoBase64 = btoa(String.fromCharCode(...photoBytes))
          photoSize = photoBytes.byteLength
          console.log('[enrichUserDevices] Loaded photo:', photoSize, 'bytes')
        }
      } catch (err) {
        console.log('[enrichUserDevices] Failed to load cached photo:', err)
      }
    }

    let totalQueued = 0
    const queuedBiometrics: string[] = []

    for (const deviceSn of deviceSns) {
      const parentId = parentCommands[deviceSn]
      if (!parentId) {
        console.warn('[enrichUserDevices] No parent command for device:', deviceSn)
        continue
      }

      let commandIndex = 1
      const commandIdBase = Math.floor(Date.now() / 1000)

      const fingerprint = biometrics?.find((b: any) => b.type === 'fingerprint')
      if (fingerprint) {
        const fpCommandId = commandIdBase + commandIndex++
        const fingerId = fingerprint.finger_id || 0
        const templateSize = fingerprint.template_size || 0
        const fpCommand = `C:${fpCommandId}:DATA UPDATE FINGERTMP PIN=${user.pin}\tFID=${fingerId}\tSize=${templateSize}\tValid=1\tTMP=${fingerprint.template_data || ''}`

        const { error: fpError } = await supabase.from('command_queue').insert({
          device_sn: deviceSn,
          command: fpCommand,
          command_type: 'enroll_fingerprint',
          related_user_id: userId,
          status: 'pending',
          priority: 2,
          depends_on_command_id: parentId,
          initiated_by: 'user',
        })

        if (!fpError) {
          totalQueued++
          queuedBiometrics.push('fingerprint')
        }
      }

      const face = biometrics?.find((b: any) => b.type === 'face')
      if (face) {
        const faceCommandId = commandIdBase + commandIndex++
        const faceCommand = `C:${faceCommandId}:DATA UPDATE FACE PIN=${user.pin}\tFID=0\tSize=${face.template_size || 0}\tValid=1\tTMP=${face.template_data || ''}`

        const { error: faceError } = await supabase.from('command_queue').insert({
          device_sn: deviceSn,
          command: faceCommand,
          command_type: 'enroll_face',
          related_user_id: userId,
          status: 'pending',
          priority: 2,
          depends_on_command_id: parentId,
          initiated_by: 'user',
        })

        if (!faceError) {
          totalQueued++
          queuedBiometrics.push('face')
        }
      }

      if (photoBase64 && photoSize) {
        const photoCommandId = commandIdBase + commandIndex++
        const photoCommand = `C:${photoCommandId}:DATA UPDATE userpic PIN=${user.pin}\tSize=${photoSize}\tContent=${photoBase64}`

        const { error: photoError } = await supabase.from('command_queue').insert({
          device_sn: deviceSn,
          command: photoCommand,
          command_type: 'upload_photo',
          related_user_id: userId,
          status: 'pending',
          priority: 3,
          depends_on_command_id: parentId,
          initiated_by: 'user',
        })

        if (!photoError) {
          totalQueued++
        }
      }
    }

    console.log('[enrichUserDevices] Queued:', totalQueued, 'commands, biometrics:', queuedBiometrics, 'photo:', !!photoBase64)

    return {
      commandsQueued: totalQueued,
      biometrics: queuedBiometrics,
      photo: !!photoBase64,
    }
  }

  static async enrichUserDevicesForDevice(
    userId: string,
    deviceSn: string,
    parentCommandId: number
  ): Promise<void> {
    const { data: biometrics } = await supabase
      .from('user_biometrics')
      .select('*')
      .eq('user_id', userId)

    const { data: user } = await supabase
      .from('users')
      .select('pin, photo_storage_path')
      .eq('id', userId)
      .single()

    if (!user) throw new Error('User not found')

    let photoBase64: string | null = null
    let photoSize: number | null = null

    if (user.photo_storage_path) {
      try {
        const { data: photoBlob } = await supabase.storage
          .from('user-photos')
          .download(user.photo_storage_path)
        if (photoBlob) {
          const photoBytes = new Uint8Array(await photoBlob.arrayBuffer())
          photoBase64 = btoa(String.fromCharCode(...photoBytes))
          photoSize = photoBytes.byteLength
        }
      } catch {}
    }

    let commandIndex = 1
    const commandIdBase = Math.floor(Date.now() / 1000)

    const fingerprint = biometrics?.find((b: any) => b.type === 'fingerprint')
    if (fingerprint) {
      const fpCommand = `C:${commandIdBase + commandIndex++}:DATA UPDATE FINGERTMP PIN=${user.pin}\tFID=${fingerprint.finger_id || 0}\tSize=${fingerprint.template_size || 0}\tValid=1\tTMP=${fingerprint.template_data || ''}`
      await supabase.from('command_queue').insert({
        device_sn: deviceSn,
        command: fpCommand,
        command_type: 'enroll_fingerprint',
        related_user_id: userId,
        status: 'pending',
        priority: 2,
        depends_on_command_id: parentCommandId,
        initiated_by: 'user',
      })
    }

    const face = biometrics?.find((b: any) => b.type === 'face')
    if (face) {
      const faceCommand = `C:${commandIdBase + commandIndex++}:DATA UPDATE FACE PIN=${user.pin}\tFID=0\tSize=${face.template_size || 0}\tValid=1\tTMP=${face.template_data || ''}`
      await supabase.from('command_queue').insert({
        device_sn: deviceSn,
        command: faceCommand,
        command_type: 'enroll_face',
        related_user_id: userId,
        status: 'pending',
        priority: 2,
        depends_on_command_id: parentCommandId,
        initiated_by: 'user',
      })
    }

    if (photoBase64 && photoSize) {
      const photoCommand = `C:${commandIdBase + commandIndex++}:DATA UPDATE userpic PIN=${user.pin}\tSize=${photoSize}\tContent=${photoBase64}`
      await supabase.from('command_queue').insert({
        device_sn: deviceSn,
        command: photoCommand,
        command_type: 'upload_photo',
        related_user_id: userId,
        status: 'pending',
        priority: 3,
        depends_on_command_id: parentCommandId,
        initiated_by: 'user',
      })
    }
  }

  static async getUserBiometrics(userId: string): Promise<BiometricsResponse> {
    const { data, error } = await supabase.from('user_biometrics').select('*').eq('user_id', userId)
    if (error) throw error
    return { success: true, data: (data || []) as BiometricEntry[] }
  }

  static async getCommandStatus(commandId: number): Promise<CommandQueueEntry | null> {
    const { data, error } = await supabase.from('command_queue').select('*').eq('id', commandId).single()
    if (error || !data) return null
    return data as CommandQueueEntry
  }

  static async startEnrollment(userId: string, deviceSn: string, biometricType: 'fingerprint' | 'face', fingerId?: number): Promise<{ commandId: number }> {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()
    if (!user) throw new Error('User not found')

    const { data: lastCmd } = await supabase.from('command_queue').select('id').eq('device_sn', deviceSn).order('id', { ascending: false }).limit(1).single()
    const nextId = (lastCmd?.id || 0) + 1
    const cmdType = biometricType === 'fingerprint' ? 'ENROLL_FP' : 'ENROLL_FACE'
    const cmd = `C:${nextId}:${cmdType},Pin=${user.pin}, Fargo=${fingerId || 0}`

    const { data, error } = await supabase
      .from('command_queue')
      .insert({ device_sn: deviceSn, command: cmd, command_type: biometricType === 'fingerprint' ? 'enroll_fingerprint' : 'enroll_face', status: 'pending', related_user_id: userId, initiated_by: 'user' })
      .select('id')
      .single()

    if (error) throw new Error(error.message)
    return { commandId: data?.id }
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

  static async getUserSyncSummary(userId: string): Promise<SyncStatusSummary> {
    const [devicesRes, syncRes, failedRes, pendingRes] = await Promise.all([
      supabase.from('devices').select('serial_number'),
      supabase.from('user_device_sync_status').select('device_sn, expected_state, actual_state, last_successful_sync').eq('user_id', userId),
      supabase.from('command_queue').select('device_sn, retry_count, max_retries').eq('related_user_id', userId).eq('status', 'failed'),
      supabase.from('command_queue').select('device_sn').eq('related_user_id', userId).in('status', ['pending', 'sent']),
    ])

    if (devicesRes.error) throw devicesRes.error
    if (syncRes.error) throw syncRes.error

    const syncMap = new Map((syncRes.data || []).map(s => [s.device_sn, s]))
    const failedDevices = new Set((failedRes.data || []).filter(cmd => (cmd.retry_count || 0) >= (cmd.max_retries || 3)).map(cmd => cmd.device_sn))
    const syncingDevices = new Set((pendingRes.data || []).map(cmd => cmd.device_sn))

    const driftMap = new Map((syncRes.data || []).filter(d => d.expected_state === 'synced' && d.actual_state === 'not_synced' && failedDevices.has(d.device_sn)).map(d => [d.device_sn, d]))

    const total = devicesRes.data?.length || 0
    let synced = 0, syncing = 0, failed = 0, drifted = 0

    for (const device of devicesRes.data || []) {
      const sn = device.serial_number
      const sync = syncMap.get(sn)
      const hasDrift = driftMap.has(sn) || sync?.actual_state === 'drift_detected'
      const isSynced = sync?.actual_state === 'synced'

      if (hasDrift) drifted++
      else if (failedDevices.has(sn)) failed++
      else if (syncingDevices.has(sn)) syncing++
      else if (isSynced) synced++
    }

    return { total_devices: total, synced, partial: 0, not_synced: total - synced - syncing - failed - drifted, syncing, failed, drifted }
  }

  static async getDriftStatus(userId: string): Promise<{ success: boolean; data: any[] }> {
    const { data, error } = await supabase.from('user_device_sync_status').select('*').eq('user_id', userId).neq('expected_state', 'actual_state')
    if (error) throw error
    return { success: true, data: data || [] }
  }

  static async clearPendingCommands(deviceSn: string, userId?: string): Promise<{ cleared: number }> {
    let lookupQuery = supabase.from('command_queue').select('related_user_id').eq('device_sn', deviceSn).in('status', ['pending', 'sent'])
    if (userId) lookupQuery = lookupQuery.eq('related_user_id', userId)
    const { data: commandsToClear } = await lookupQuery
    const userIds = [...new Set(commandsToClear?.map(c => c.related_user_id).filter(Boolean) || [])]
    const deleted = commandsToClear?.length || 0

    let deleteQuery = supabase.from('command_queue').delete().eq('device_sn', deviceSn).in('status', ['pending', 'sent'])
    if (userId) deleteQuery = deleteQuery.eq('related_user_id', userId)
    await deleteQuery

    for (const uid of userIds) {
      if (!uid) continue
      const { data: remaining } = await supabase.from('command_queue').select('status').eq('device_sn', deviceSn).eq('related_user_id', uid).in('status', ['pending', 'sent', 'dispatched'])
      const { data: completed } = await supabase.from('command_queue').select('status').eq('device_sn', deviceSn).eq('related_user_id', uid).eq('status', 'success')

      if (remaining && remaining.length > 0) {
        await supabase.from('user_device_sync_status').upsert({ device_sn: deviceSn, user_id: uid, expected_state: 'synced', actual_state: 'syncing', retry_count: 0 }, { onConflict: 'device_sn,user_id' })
      } else if (completed && completed.length > 0) {
        await supabase.from('user_device_sync_status').upsert({ device_sn: deviceSn, user_id: uid, expected_state: 'synced', actual_state: 'synced', last_successful_sync: new Date().toISOString(), retry_count: 0 }, { onConflict: 'device_sn,user_id' })
      } else {
        await supabase.from('user_device_sync_status').upsert({ device_sn: deviceSn, user_id: uid, expected_state: 'synced', actual_state: 'not_synced', retry_count: 0 }, { onConflict: 'device_sn,user_id' })
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
  
  static async clearPendingCommandsForDevice(deviceSn: string): Promise<number> {
    const { count } = await supabase
      .from('command_queue')
      .delete()
      .eq('device_sn', deviceSn)
      .in('status', ['pending'])
    
    return count || 0
  }
  
  static async clearPendingCommandsForUser(userId: string): Promise<number> {
    const { count } = await supabase
      .from('command_queue')
      .delete()
      .eq('related_user_id', userId)
      .in('status', ['pending'])
    
    return count || 0
  }

  static async getDeviceState(deviceSn: string): Promise<{ state: 'idle' | 'syncing' | 'unknown'; activeCommand?: CommandQueueEntry }> {
    const { data, error } = await supabase.from('command_queue').select('*').eq('device_sn', deviceSn).in('status', ['pending', 'sent']).order('created_at', { ascending: false }).limit(1).single()
    if (error) {
      if (error.code === 'PGRST116') return { state: 'idle' }
      return { state: 'unknown' }
    }
    return { state: 'syncing', activeCommand: data as CommandQueueEntry }
  }
}