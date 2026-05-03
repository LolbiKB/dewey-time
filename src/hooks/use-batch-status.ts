import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/lib/query-keys'

export function useUserBatchStatus(userId: string, deviceSn: string) {
  return useQuery({
    queryKey: queryKeys.devices.syncStatus(deviceSn),
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
      return data
    },
    enabled: !!userId && !!deviceSn,
    staleTime: 5000,
  })
}