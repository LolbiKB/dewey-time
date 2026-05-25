import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { getDevicePresence, type DevicePresenceStatus } from '@/lib/device-status'

export interface DeviceStatusEntry {
  serial_number: string
  name: string | null
  location: string | null
  last_seen: string | null
  status: DevicePresenceStatus
  last_seen_minutes: number | null
}

export interface DeviceStatusStats {
  totalDevices: number
  onlineDevices: number
  offlineDevices: number
}

export function useDeviceStatus() {
  return useQuery({
    queryKey: ['device-status'],
    queryFn: async (): Promise<DeviceStatusStats & { devices: DeviceStatusEntry[] }> => {
      const { data: devices, error } = await supabase
        .from('devices')
        .select('serial_number, name, location, last_seen')
        .order('last_seen', { ascending: false })

      if (error) {
        throw new Error(`Failed to fetch device status: ${error.message}`)
      }

      const entries: DeviceStatusEntry[] = (devices || []).map((d) => {
        const presence = getDevicePresence(d.last_seen)
        return {
          serial_number: d.serial_number,
          name: d.name,
          location: d.location,
          last_seen: d.last_seen,
          status: presence.status,
          last_seen_minutes: presence.lastSeenMinutes,
        }
      })

      const onlineDevices = entries.filter((e) => e.status === 'online').length
      const offlineDevices = entries.filter((e) => e.status === 'offline').length

      return {
        totalDevices: entries.length,
        onlineDevices,
        offlineDevices,
        devices: entries,
      }
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    staleTime: 5000,
    retry: 3,
    retryDelay: 1000,
  })
}
