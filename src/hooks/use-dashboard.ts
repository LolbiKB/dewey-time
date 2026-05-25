import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useDevices } from './use-core-data'
import { useMemo } from 'react'

interface DashboardStats {
  totalUsers: number
  registeredUsers: number
  onlineDevices: number
  totalDevices: number
  syncsToday: number
  attendanceToday: number
}

export function useDashboardStats() {
  const { data: devicesData } = useDevices({ page: 1, limit: 500 })

  const deviceCounts = useMemo(() => {
    const devices = devicesData?.devices ?? []
    const onlineDevices = devices.filter((d) => d.isOnline).length
    return {
      totalDevices: devicesData?.total ?? devices.length,
      onlineDevices,
    }
  }, [devicesData])

  return useQuery({
    queryKey: ['dashboard', 'stats', deviceCounts.totalDevices, deviceCounts.onlineDevices],
    queryFn: async (): Promise<DashboardStats> => {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

      // Get total users from bridge
      const { count: totalUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })

      // Get registered users (is_registered = true from Frappe merge)
      // Since we don't have is_registered in local DB, we'll count all users with pin
      const { count: registeredUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .not('pin', 'is', null)

      // Get syncs today (successful commands)
      const { count: syncsToday } = await supabase
        .from('command_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'success')
        .gte('completed_at', todayStart)

      // Get attendance logs today
      const { count: attendanceToday } = await supabase
        .from('attendance_logs')
        .select('*', { count: 'exact', head: true })
        .gte('check_time', todayStart)

      return {
        totalUsers: totalUsers || 0,
        registeredUsers: registeredUsers || 0,
        onlineDevices: deviceCounts.onlineDevices,
        totalDevices: deviceCounts.totalDevices,
        syncsToday: syncsToday || 0,
        attendanceToday: attendanceToday || 0,
      }
    },
    staleTime: 30000,
    enabled: devicesData !== undefined,
  })
}
