import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { addDays, format, subDays } from 'date-fns'
import { AttlogClosureService } from '@/services/attlog-closure-service'
import { ATTLOG_CATCH_UP_DAYS } from '@/lib/attlog-constants'

export interface DeviceAttlogClosureRow {
  device_sn: string
  local_date: string
  status: string
  device_sum: number | null
  server_sum: number | null
  attempt_count: number
  last_error: string | null
  closed_at: string | null
  backfill_chunks_done?: number | null
  backfill_chunks_total?: number | null
  updated_at?: string | null
}

export interface DeviceAttlogMeta {
  serial_number: string
  name?: string | null
  timezone?: string | null
  attlog_last_closed_date: string | null
  attlog_time_drift_suspected: boolean | null
  attlog_last_device_purge_at: string | null
  attlog_closure_last_tick_at: string | null
  last_seen: string | null
}

/** Map device_sn → yesterday closure status for Devices table badges */
export function useYesterdayAttlogClosure() {
  const yesterday = format(addDays(new Date(), -1), 'yyyy-MM-dd')

  return useQuery({
    queryKey: ['attlog-closure', 'yesterday', yesterday] as const,
    queryFn: async (): Promise<Map<string, DeviceAttlogClosureRow>> => {
      const { data, error } = await supabase
        .from('device_attlog_closure')
        .select(
          'device_sn, local_date, status, device_sum, server_sum, attempt_count, last_error, closed_at'
        )
        .eq('local_date', yesterday)

      if (error) throw new Error(error.message)

      const map = new Map<string, DeviceAttlogClosureRow>()
      for (const row of data || []) {
        map.set(row.device_sn, row as DeviceAttlogClosureRow)
      }
      return map
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

/** Recent closure rows for one device (device detail). */
export function useDeviceAttlogClosureHistory(deviceSn: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['attlog-closure', 'device', deviceSn] as const,
    queryFn: async (): Promise<DeviceAttlogClosureRow[]> => {
      if (!deviceSn) return []
      const { data, error } = await supabase
        .from('device_attlog_closure')
        .select(
          'device_sn, local_date, status, device_sum, server_sum, attempt_count, last_error, closed_at, backfill_chunks_done, backfill_chunks_total, updated_at'
        )
        .eq('device_sn', deviceSn)
        .order('local_date', { ascending: false })
        .limit(ATTLOG_CATCH_UP_DAYS)

      if (error) throw new Error(error.message)
      return (data ?? []) as DeviceAttlogClosureRow[]
    },
    enabled: enabled && !!deviceSn,
    staleTime: 30_000,
  })
}

export function useDeviceAttlogMeta(deviceSn: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['attlog-closure', 'meta', deviceSn] as const,
    queryFn: async (): Promise<DeviceAttlogMeta | null> => {
      if (!deviceSn) return null
      const { data, error } = await supabase
        .from('devices')
        .select(
          'serial_number, name, timezone, attlog_last_closed_date, attlog_time_drift_suspected, attlog_last_device_purge_at, attlog_closure_last_tick_at, last_seen'
        )
        .eq('serial_number', deviceSn)
        .single()

      if (error) throw new Error(error.message)
      return data as DeviceAttlogMeta
    },
    enabled: enabled && !!deviceSn,
    staleTime: 30_000,
  })
}

/** Non-closed days in catch-up window per device (Devices table SLA column). */
export function useAttlogCatchUpDepthMap() {
  const oldest = format(subDays(new Date(), ATTLOG_CATCH_UP_DAYS), 'yyyy-MM-dd')

  return useQuery({
    queryKey: ['attlog-closure', 'catchup-depth', oldest] as const,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from('device_attlog_closure')
        .select('device_sn, status')
        .gte('local_date', oldest)
        .neq('status', 'closed')

      if (error) throw new Error(error.message)

      const map = new Map<string, number>()
      for (const row of data || []) {
        map.set(row.device_sn, (map.get(row.device_sn) || 0) + 1)
      }
      return map
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

const ATTLOG_CMD_TYPES = [
  'attlog_verify_sum',
  'attlog_data_query',
  'attlog_log_push',
  'attlog_clear_log',
]

export function useDeviceAttlogInFlightCommands(deviceSn: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['attlog-closure', 'in-flight', deviceSn] as const,
    queryFn: async () => {
      if (!deviceSn) return []
      const { data, error } = await supabase
        .from('command_queue')
        .select('id, command_type, command, status, created_at, updated_at')
        .eq('device_sn', deviceSn)
        .in('command_type', ATTLOG_CMD_TYPES)
        .in('status', ['pending', 'sent', 'awaiting_verification'])
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw new Error(error.message)
      return data ?? []
    },
    enabled: enabled && !!deviceSn,
    refetchInterval: 10_000,
  })
}

export function useDeviceRecentPunches(deviceSn: string | null, enabled: boolean, limit = 50) {
  return useQuery({
    queryKey: ['attlog-closure', 'recent-punches', deviceSn, limit] as const,
    queryFn: async () => {
      if (!deviceSn) return []
      const { data, error } = await supabase
        .from('attendance_logs')
        .select(
          'id, device_sn, user_pin, check_time, status, verify_type, created_at, sync_status, is_suspicious, suspicious_reason, devices(timezone)'
        )
        .eq('device_sn', deviceSn)
        .order('check_time', { ascending: false })
        .limit(limit)

      if (error) throw new Error(error.message)
      return data ?? []
    },
    enabled: enabled && !!deviceSn,
    staleTime: 15_000,
  })
}

export function useRetryAttlogClosure(deviceSn: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (localDate: string) => {
      if (!deviceSn) throw new Error('No device')
      return AttlogClosureService.retry(deviceSn, localDate)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attlog-closure'] })
    },
  })
}

function useAttlogOpsMutationBase(
  deviceSn: string | null,
  action: 'log' | 'sync' | 'purge'
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => {
      if (!deviceSn) throw new Error('No device')
      if (action === 'log') return AttlogClosureService.forceLog(deviceSn)
      if (action === 'sync') return AttlogClosureService.forceSync(deviceSn)
      return AttlogClosureService.purge(deviceSn)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['attlog-closure'] })
    },
  })
}

export function useAttlogForceLog(deviceSn: string | null) {
  return useAttlogOpsMutationBase(deviceSn, 'log')
}

export function useAttlogForceSync(deviceSn: string | null) {
  return useAttlogOpsMutationBase(deviceSn, 'sync')
}

export function useAttlogPurge(deviceSn: string | null) {
  return useAttlogOpsMutationBase(deviceSn, 'purge')
}
