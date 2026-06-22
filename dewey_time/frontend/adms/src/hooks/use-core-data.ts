// Core Data Hooks - Single Source of Truth
// All components should consume data from these hooks

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/query-keys'
import { UserService } from '@/services/user-service'
import { useEffect, useMemo } from 'react'
import { isDeviceOnline } from '@/lib/device-status'

export interface DeviceFilters {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  search?: string
  name?: string
  location?: string
  is_master?: boolean
  status?: 'online' | 'offline'
}

/**
 * Master device query - single source for all device data
 * isOnline calculated fresh from last_seen on every render
 */
export function useDevices(filters?: DeviceFilters, options?: { enabled?: boolean }) {
  const page = filters?.page || 1
  const limit = filters?.limit || 20
  const from = (page - 1) * limit
  const to = from + limit - 1
  const sortBy = filters?.sortBy || 'created_at'
  const sortOrder = filters?.sortOrder || 'desc'
  
  const query = useQuery({
    queryKey: queryKeys.devices.list({
      page: filters?.status ? 1 : page, limit: filters?.status ? 500 : limit, sortBy, sortOrder,
      search: filters?.search, name: filters?.name, location: filters?.location, is_master: filters?.is_master,
      status: filters?.status,
    }),
    queryFn: async () => {
      let dbQuery = supabase
        .from('devices')
        .select('*', { count: 'exact' })

      if (filters?.search) {
        dbQuery = dbQuery.or(`serial_number.ilike.%${filters.search}%,name.ilike.%${filters.search}%,location.ilike.%${filters.search}%`)
      }
      if (filters?.name) {
        dbQuery = dbQuery.ilike('name', `%${filters.name}%`)
      }
      if (filters?.location) {
        dbQuery = dbQuery.ilike('location', `%${filters.location}%`)
      }
      if (filters?.is_master !== undefined) {
        dbQuery = dbQuery.eq('is_master', filters.is_master)
      }

      dbQuery = dbQuery.order(sortBy, { ascending: sortOrder === 'asc' })

      // When status (online/offline) filter is active, fetch all devices so we can
      // filter by derived isOnline field client-side. Device count is always small.
      if (filters?.status) {
        dbQuery = dbQuery.limit(500)
      } else {
        dbQuery = dbQuery.range(from, to)
      }

      const { data, error, count } = await dbQuery

      if (error) throw error

      return {
        devices: data || [],
        rawTotal: count || 0,
        page,
        limit,
      }
    },
    staleTime: 30000,
    refetchInterval: 15000,
    ...options,
  })
  
  // Calculate isOnline fresh from last_seen on every render; apply status filter client-side
  const enrichedData = useMemo(() => {
    if (!query.data) return undefined

    const devicesWithStatus = query.data.devices.map(device => ({
      ...device,
      isOnline: isDeviceOnline(device.last_seen),
    }))

    // status is a derived field (online/offline from last_seen) — filter client-side
    const filtered = filters?.status
      ? devicesWithStatus.filter(d => (d.isOnline ? 'online' : 'offline') === filters.status)
      : devicesWithStatus

    // When status filter is active we fetched all records; paginate in JS
    const paged = filters?.status
      ? filtered.slice(from, to + 1)
      : filtered

    const total = filters?.status ? filtered.length : query.data.rawTotal
    const totalPages = Math.ceil(total / limit)

    return {
      devices: paged,
      total,
      page,
      limit,
      totalPages,
      hasNext: page * limit < total,
      hasPrev: page > 1,
    }
  // from, to, page, limit are all derived from filters — using filters as dep covers them
  }, [query.data, filters])
  
  return {
    ...query,
    data: enrichedData,
  }
}

/**
 * Realtime subscription for device status updates
 * Invalidates the devices query cache so isOnline gets recalculated
 */
export function useRealtimeDevices() {
  const queryClient = useQueryClient()
  
  useEffect(() => {
    const channel = supabase
      .channel('devices-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'devices',
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.devices.all,
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}

/**
 * Master sync status query - all user-device sync relationships
 * This is the foundation for all sync status displays
 */
export function useSyncStatus(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['sync-status', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_device_sync_status')
    .select(`
          *,
          users!inner(id, name, pin, photo_storage_path, user_biometrics(type, finger_id)),
          devices!inner(serial_number, name, location)
        `)
      
      if (error) throw error
      return data || []
    },
staleTime: 30000, // 30 seconds - rely on realtime
    ...options,
  })
}

export function useCommandQueue(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.commands.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('command_queue')
        .select(`
          *,
          devices!inner(name, location)
        `)
        .order('created_at', { ascending: false })
        .limit(100)
      
      if (error) throw error
      return data || []
    },
    staleTime: 30000, // 30 seconds - rely on realtime
    ...options,
  })
}

/**
 * Master users query - paginated user list
 * 2 minute stale time is reasonable for employee directory
 */
export function useUsersList(filters?: {
  page?: number
  limit?: number
  search?: string
  status?: 'active' | 'inactive' | 'compromised' | 'archived'
  registration_status?: 'registered' | 'unregistered' | 'inactive'
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}, options?: { enabled?: boolean }) {
  const filterKey = filters || {}

  return useQuery({
    queryKey: queryKeys.users.list(filterKey),
    queryFn: async () => {
      // Use getFrappeEmployees (same as legacy useUsers) to maintain compatibility
      const result = await UserService.getFrappeEmployees({
        page: filters?.page,
        limit: filters?.limit,
        search: filters?.search,
        status: filters?.status,
        registration_status: filters?.registration_status,
        sortBy: filters?.sortBy,
        sortOrder: filters?.sortOrder,
      })
      // Return same structure as legacy useUsers for compatibility
      return {
        data: result.data || [],
        meta: result.meta,
      }
    },
    staleTime: 1000 * 60 * 2, // 2 min
    ...options,
  })
}

/**
 * Master attendance logs query
 */
export function useAttendanceLogs(filters?: {
  page?: number
  limit?: number
  startDate?: string
  endDate?: string
  deviceSn?: string
  userPin?: string
}, options?: { enabled?: boolean }) {
  const filterKey = filters || {}
  
  return useQuery({
    queryKey: queryKeys.attendance.list(filterKey),
    queryFn: async () => {
      const page = filters?.page || 1
      const limit = filters?.limit || 50
      const from = (page - 1) * limit
      const to = from + limit - 1
      
      let query = supabase
        .from('attendance_logs')
        .select('*, devices!inner(name, location)', { count: 'exact' })
        .order('check_time', { ascending: false })
      
      if (filters?.startDate) {
        query = query.gte('check_time', filters.startDate)
      }
      if (filters?.endDate) {
        query = query.lte('check_time', filters.endDate)
      }
      if (filters?.deviceSn) {
        query = query.eq('device_sn', filters.deviceSn)
      }
      if (filters?.userPin) {
        query = query.eq('user_pin', filters.userPin)
      }
      
      const { data, error, count } = await query.range(from, to)
      
      if (error) throw error
      
      return {
        logs: data || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
        hasNext: (page * limit) < (count || 0),
        hasPrev: page > 1,
      }
    },
    staleTime: 30000, // 30 seconds
    ...options,
  })
}

// =====================================================
// SINGLE ENTITY QUERIES (by ID)
// =====================================================

export function useUser(userId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.users.detail(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*, user_biometrics(*)')
        .eq('id', userId)
        .single()
      
      if (error) throw error
      return data
    },
    staleTime: 60000, // 1 minute
    ...options,
  })
}

export function useDevice(deviceSn: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.devices.detail(deviceSn),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .eq('serial_number', deviceSn)
        .single()
      
      if (error) throw error
      
      return {
        ...data,
        isOnline: isDeviceOnline(data.last_seen),
      }
    },
    staleTime: 5000,
    refetchInterval: 5000,
    ...options,
  })
}

/**
 * Device-specific command queue
 */
export function useDeviceCommands(deviceSn: string, options?: { enabled?: boolean; limit?: number }) {
  const limit = options?.limit ?? 20
  
  return useQuery({
    queryKey: queryKeys.devices.commands(deviceSn),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('command_queue')
        .select('*')
        .eq('device_sn', deviceSn)
        .order('created_at', { ascending: false })
        .limit(limit)
      
      if (error) throw error
      return data || []
    },
    enabled: !!deviceSn,
    staleTime: 3000,
    refetchInterval: 5000,
    ...options,
  })
}

export function useUserBiometrics(userId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.users.biometrics(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_biometrics')
        .select('*')
        .eq('user_id', userId)
      
      if (error) throw error
      return data || []
    },
    staleTime: 30000,
    ...options,
  })
}

// =====================================================
// SUPABASE REALTIME SUBSCRIPTIONS
// =====================================================

/**
 * Realtime subscription for command updates
 * Replaces polling with instant updates when possible
 */
export function useRealtimeCommands(deviceSn?: string) {
  const queryClient = useQueryClient()
  
  useEffect(() => {
    const channel = supabase
      .channel(`commands-realtime:${deviceSn || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'command_queue',
          filter: deviceSn ? `device_sn=eq.${deviceSn}` : undefined,
        },
        (payload) => {
          // Update the cache immediately
          queryClient.setQueryData(queryKeys.commands.all, (old: any) => {
            if (!old) return old
            
            if (payload.eventType === 'UPDATE') {
              return old.map((cmd: any) =>
                cmd.id === payload.new.id ? { ...cmd, ...payload.new } : cmd
              )
            }
            
            if (payload.eventType === 'INSERT') {
              return [payload.new, ...old].slice(0, 100)
            }
            
            if (payload.eventType === 'DELETE') {
              return old.filter((cmd: any) => cmd.id !== payload.old.id)
            }
            
            return old
          })
          
          const terminalStatuses = ['success', 'failed', 'cancelled']
          if (deviceSn) {
            if (
              payload.eventType === 'UPDATE' &&
              terminalStatuses.includes((payload.new as { status?: string }).status ?? '')
            ) {
              queryClient.invalidateQueries({ queryKey: queryKeys.devices.users(deviceSn, '') })
              queryClient.invalidateQueries({ queryKey: ['device-sync-summary', deviceSn] })
              queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
            }
          }

          // Also update by-device cache if exists
          if (deviceSn) {
            queryClient.setQueryData(
              queryKeys.commands.byDevice(deviceSn),
              (old: any) => {
                if (!old) return old
                
                if (payload.eventType === 'UPDATE') {
                  return old.map((cmd: any) =>
                    cmd.id === payload.new.id ? { ...cmd, ...payload.new } : cmd
                  )
                }
                if (payload.eventType === 'INSERT') {
                  return [payload.new, ...old]
                }
                return old
              }
            )
          }
        }
      )
      .subscribe()
    
    return () => {
      supabase.removeChannel(channel)
    }
  }, [deviceSn, queryClient])
}

/**
 * Realtime subscription for sync status updates
 */
export function useRealtimeSyncStatus(userId?: string) {
  const queryClient = useQueryClient()
  
  useEffect(() => {
    const channel = supabase
      .channel(`sync-status-realtime:${userId || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_device_sync_status',
          filter: userId ? `user_id=eq.${userId}` : undefined,
        },
        () => {
          // Invalidate and refetch to get fresh data with joins
          queryClient.invalidateQueries({
            queryKey: ['sync-status', 'all'],
          })
          
          if (userId) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.users.syncStatus(userId),
            })
          }
        }
      )
      .subscribe()
    
    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, queryClient])
}

// =====================================================
// SYSTEM STATUS QUERIES
// =====================================================

export function useSystemConnection() {
  return useQuery({
    queryKey: queryKeys.system.connection,
    queryFn: async () => {
      try {
        const response = await fetch('/health')
        return response.ok
      } catch {
        return false
      }
    },
    refetchInterval: 15000,
    staleTime: 15000,
  })
}

export function useSyncHealth() {
  return useQuery({
    queryKey: queryKeys.system.syncHealth,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_device_sync_status')
        .select('actual_state, expected_state')
      
      if (error) throw error
      
      const total = data?.length || 0
      const synced = data?.filter(s => s.actual_state === 'synced').length || 0
      const syncing = data?.filter(s => s.actual_state === 'syncing').length || 0
      const failed = data?.filter(s => s.actual_state === 'not_synced').length || 0
      
      return {
        total,
        synced,
        syncing,
        failed,
        healthPercentage: total > 0 ? Math.round((synced / total) * 100) : 100,
      }
    },
    staleTime: 30000,
    refetchInterval: 30000,
  })
}
