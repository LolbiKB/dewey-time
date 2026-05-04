import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useRealtimeBatches(deviceSn?: string) {
  const queryClient = useQueryClient()
  
  useEffect(() => {
    const channel = supabase
      .channel('batches-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_batches',
          filter: deviceSn ? `device_sn=eq.${deviceSn}` : undefined,
        },
        () => {
          // Invalidate sync status queries when batch changes
          queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient, deviceSn])
}