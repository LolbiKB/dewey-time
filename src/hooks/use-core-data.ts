// Core Data Hooks - Single Source of Truth
// All components should consume data from these hooks

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/query-keys'
import { useEffect } from 'react'

// =====================================================
// CORE ENTITY QUERIES (Root Data Sources)
// =====================================================

/**
 * Master device query - single source for all device data
 * Includes online/offline status calculation
 * Refetches every 5 seconds to keep status fresh
 */
export function useDevices(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.devices.status(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .order('name', { ascending: true })
      
      if (error) throw error
      
      const now = Date.now()
      return (data || []).map(device => ({
        ...device,
        isOnline: device.last_seen 
          ? now - new Date(device.last_seen).getTime() < 60000 
          : false,
      }))
    },
    staleTime: 5000, // 5 seconds
    refetchInterval: 5000, // Poll every 5s for online status
    ...options,
  })
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
    staleTime: 10000, // 10 seconds
    refetchInterval: 10000, // Poll every 10s
    ...options,
  })
}

/**
 * Master command queue query - recent commands across all devices
 * Limited to 100 most recent for performance
 */
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
    staleTime: 3000,
    refetchInterval: 3000, // 3s polling for real-time feel
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
  status?: string
}, options?: { enabled?: boolean }) {
  const filterKey = filters || {}
  
  return useQuery({
    queryKey: queryKeys.users.list(filterKey),
    queryFn: async () => {
      const page = filters?.page || 1
      const limit = filters?.limit || 20
      const from = (page - 1) * limit
      const to = from + limit - 1
      
      let query = supabase
        .from('users')
        .select('*, user_biometrics(type, finger_id)', { count: 'exact' })
        .order('created_at', { ascending: false })
      
      if (filters?.search) {
        query = query.or(`pin.ilike.%${filters.search}%,name.ilike.%${filters.search}%`)
      }
      
      if (filters?.status) {
        query = query.eq('status', filters.status)
      }
      
      const { data, error, count } = await query.range(from, to)
      
      if (error) throw error
      
      return {
        users: data || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
      }
    },
    staleTime: 1000 * 60 * 2, // 2 minutes - reasonable for employee directory
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
      
      const now = Date.now()
      return {
        ...data,
        isOnline: data.last_seen 
          ? now - new Date(data.last_seen).getTime() < 60000 
          : false,
      }
    },
    staleTime: 5000,
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
