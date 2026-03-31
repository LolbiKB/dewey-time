import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface DashboardStats {
  totalUsers: number
  registeredUsers: number
  onlineDevices: number
  totalDevices: number
  syncsToday: number
  attendanceToday: number
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
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

      // Get devices count and online status
      const { data: devices } = await supabase
        .from('devices')
        .select('last_seen')

      const totalDevices = devices?.length || 0
      const onlineDevices = devices?.filter((d: { last_seen: string | null }) => {
        if (!d.last_seen) return false
        const lastSeen = new Date(d.last_seen).getTime()
        return (now.getTime() - lastSeen) < 60000 // 1 minute
      }).length || 0

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
        onlineDevices,
        totalDevices,
        syncsToday: syncsToday || 0,
        attendanceToday: attendanceToday || 0,
      }
    },
    staleTime: 30000, // 30 seconds
  })
}
