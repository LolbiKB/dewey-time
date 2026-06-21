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
    queryKey: ['batches-detailed', deviceSn], 
    queryFn: async () => {
      if (!deviceSn) return []
      
      // Get batches
      const { data: batches, error } = await supabase
        .from('sync_batches')
        .select('*')
        .eq('device_sn', deviceSn)
        .order('created_at', { ascending: false })
        .limit(20)
      
      if (error) throw error
      if (!batches) return []
      
      // Get user IDs and fetch user details
      const userIds = [...new Set(batches.map(b => b.user_id))]
      const { data: users } = await supabase
        .from('users')
        .select('id, name, pin')
        .in('id', userIds)
      
      const userMap = new Map((users || []).map(u => [u.id, u]))
      
// Get command counts and command types for each batch
      const batchIds = batches.map(b => b.id)
      
      // Query batch_commands for these batches
      const { data: batchCommands } = await supabase
        .from('batch_commands')
        .select('*')
        .in('batch_id', batchIds)
      
      // Extract command IDs
      const commandIds = (batchCommands || []).map(bc => bc.command_id).filter(id => id)
      
      if (commandIds.length === 0) {
        return batches.map(batch => ({ ...batch, commands: [] }))
      }
      
      const { data: commands } = await supabase
        .from('command_queue')
        .select('id, command_type, status, error_message, sent_at, completed_at, command')
        .in('id', commandIds)
      
      const commandMap = new Map((commands || []).map(c => [c.id, c]))
      
      // Group commands by batch for detailed view
      const batchCommandsDetail = new Map<string, any[]>()
      for (const bc of (batchCommands || [])) {
        const cmd = commandMap.get(bc.command_id)
        if (!cmd) continue
        // Extract useful part from command (first 50 chars for display)
        const cmdPreview = cmd.command ? cmd.command.substring(0, 50).replace(/[\r\n]/g, ' ') : ''
        const list = batchCommandsDetail.get(bc.batch_id) || []
        list.push({
          id: cmd.id,
          type: cmd.command_type,
          status: bc.completed ? 'completed' : (bc.failed ? 'failed' : 'pending'),
          error: cmd.error_message,
          preview: cmdPreview,
        })
        batchCommandsDetail.set(bc.batch_id, list)
      }
      
      // Calculate actual counts and types per batch
      const batchData = new Map<string, { commands: number; completed: number; failed: number; types: Set<string> }>()
      for (const bc of (batchCommands || [])) {
        const current = batchData.get(bc.batch_id) || { commands: 0, completed: 0, failed: 0, types: new Set<string>() }
        current.commands++
        if (bc.completed === true) current.completed++
        if (bc.failed === true) current.failed++
        const cmd = commandMap.get(bc.command_id)
        if (cmd) current.types.add(cmd.command_type)
        batchData.set(bc.batch_id, current)
      }
      
      // Merge counts into batches
      return batches.map(batch => {
        const data = batchData.get(batch.id) || { commands: 0, completed: 0, failed: 0, types: new Set<string>() }
        const user = userMap.get(batch.user_id)
        return {
          ...batch,
          userName: user?.name || 'Unknown',
          userPin: user?.pin || '',
          commands_count: data.commands,
          completed_count: data.completed,
          failed_count: data.failed,
          commandTypes: Array.from(data.types),
          commands: batchCommandsDetail.get(batch.id) || [],
        }
      }) as BatchStatus[]
    },
    enabled: !!deviceSn,
    staleTime: 5000,
    refetchOnMount: 'always',
  })
}