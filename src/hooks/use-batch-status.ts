import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface BatchStatus {
  id: string
  user_id: string
  device_sn: string
  batch_type: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  success_mode: string
  commands_count: number
  completed_count: number
  failed_count: number
  created_at: string
  completed_at: string | null
  error_message: string | null
}

export function useLatestBatch(userId: string, deviceSn: string) {
  return useQuery({
    queryKey: ['batch', userId, deviceSn],
    queryFn: async () => {
      if (!userId || !deviceSn) return null
      
      const { data, error } = await supabase
        .from('sync_batches')
        .select('*')
        .eq('user_id', userId)
        .eq('device_sn', deviceSn)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      if (error && error.code !== 'PGRST116') throw error
      return data as BatchStatus | null
    },
    enabled: !!userId && !!deviceSn,
    staleTime: 5000,
  })
}

export function useDeviceBatches(deviceSn: string) {
  return useQuery({
    queryKey: ['batches', deviceSn],
    queryFn: async () => {
      if (!deviceSn) return []
      
      const { data, error } = await supabase
        .from('sync_batches')
        .select('*')
        .eq('device_sn', deviceSn)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      return data as BatchStatus[]
    },
    enabled: !!deviceSn,
    staleTime: 5000,
  })
}