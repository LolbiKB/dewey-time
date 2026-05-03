// Optimistic Mutation Hooks
// All data modifications go through these hooks
// They handle optimistic updates and cache invalidation

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { queryKeys } from '@/lib/query-keys'
import { UserService } from '@/services/user-service'
import { DeviceService } from '@/services/device-service'
import { supabase } from '@/lib/supabase'

// =====================================================
// USER SYNC MUTATIONS
// =====================================================

export function useForceSync() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({ 
      userId, 
      deviceSns 
    }: { 
      userId: string
      deviceSns: string[] 
    }) => {
      return UserService.forceUserSync(userId, deviceSns)
    },
    
    onMutate: async ({ userId, deviceSns }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.users.syncStatus(userId) })
      await queryClient.cancelQueries({ queryKey: ['sync-status', 'all'] })
      
      // Snapshot previous values
      const previousUserStatus = queryClient.getQueryData(queryKeys.users.syncStatus(userId))
      const previousAllStatus = queryClient.getQueryData(['sync-status', 'all'])
      
      // Optimistically update to "syncing"
      const optimisticSync = {
        actual_state: 'syncing',
        user_synced: false,
        fingerprint_synced: false,
        face_synced: false,
        photo_synced: false,
      }
      
      // Update user-specific sync status
      queryClient.setQueryData(
        queryKeys.users.syncStatus(userId),
        (old: any) => {
          if (!old || !Array.isArray(old)) return old
          return old.map((status: any) =>
            deviceSns.includes(status.device_sn)
              ? { ...status, ...optimisticSync }
              : status
          )
        }
      )
      
      // Update global sync status
      queryClient.setQueryData(
        ['sync-status', 'all'],
        (old: any) => {
          if (!old || !Array.isArray(old)) return old
          return old.map((status: any) =>
            status.user_id === userId && deviceSns.includes(status.device_sn)
              ? { ...status, ...optimisticSync }
              : status
          )
        }
      )
      
      return { previousUserStatus, previousAllStatus, deviceSns }
    },
    
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousUserStatus) {
        queryClient.setQueryData(
          queryKeys.users.syncStatus(variables.userId),
          context.previousUserStatus
        )
      }
      if (context?.previousAllStatus) {
        queryClient.setQueryData(['sync-status', 'all'], context.previousAllStatus)
      }
      
      toast.error(`Force sync failed: ${error.message}`)
    },
    
    onSuccess: (data, _variables) => {
      toast.success(`Force sync started for ${data.commandsQueued} command(s)`)
    },
    
    onSettled: (_data, _error, variables) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.users.syncStatus(variables.userId) })
      queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.commands.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.system.syncHealth })
      
      // Invalidate device-specific queries
      variables.deviceSns.forEach(sn => {
        queryClient.invalidateQueries({ queryKey: queryKeys.devices.syncStatus(sn) })
        queryClient.invalidateQueries({ queryKey: queryKeys.devices.commands(sn) })
      })
    },
  })
}

export function useRetrySync() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      userId,
      deviceSns,
    }: {
      userId: string
      deviceSns: string[]
    }) => {
      return UserService.retryUserSync(userId, deviceSns)
    },
    
    onMutate: async ({ userId, deviceSns }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.users.syncStatus(userId) })
      
      const previousStatus = queryClient.getQueryData(queryKeys.users.syncStatus(userId))
      
      // Optimistically set to syncing
      queryClient.setQueryData(
        queryKeys.users.syncStatus(userId),
        (old: any) => {
          if (!old || !Array.isArray(old)) return old
          return old.map((status: any) =>
            deviceSns.includes(status.device_sn) && status.actual_state === 'failed'
              ? { ...status, actual_state: 'syncing' }
              : status
          )
        }
      )
      
      return { previousStatus }
    },
    
    onError: (error, variables, context) => {
      if (context?.previousStatus) {
        queryClient.setQueryData(queryKeys.users.syncStatus(variables.userId), context.previousStatus)
      }
      toast.error(`Retry failed: ${error.message}`)
    },
    
    onSuccess: () => {
      toast.success('Retry initiated')
    },
    
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.syncStatus(variables.userId) })
      queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.commands.all })
    },
  })
}

// =====================================================
// BIOMETRIC MUTATIONS
// =====================================================

export function useDeleteBiometric() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      userId,
      type,
      fingerId,
    }: {
      userId: string
      type: 'fingerprint' | 'face'
      fingerId?: number
    }) => {
      return UserService.deleteBiometric(userId, type, fingerId)
    },
    
    onMutate: async ({ userId, type, fingerId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.users.biometrics(userId) })
      
      const previousBiometrics = queryClient.getQueryData(queryKeys.users.biometrics(userId))
      
      // Optimistically remove the biometric
      queryClient.setQueryData(
        queryKeys.users.biometrics(userId),
        (old: any) => {
          if (!old) return old
          return old.filter((bio: any) => 
            !(bio.type === type && (fingerId === undefined || bio.finger_id === fingerId))
          )
        }
      )
      
      return { previousBiometrics }
    },
    
    onError: (error, variables, context) => {
      if (context?.previousBiometrics) {
        queryClient.setQueryData(
          queryKeys.users.biometrics(variables.userId),
          context.previousBiometrics
        )
      }
      toast.error(`Failed to delete biometric: ${error.message}`)
    },
    
    onSuccess: () => {
      toast.success('Biometric deleted')
    },
    
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.biometrics(variables.userId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.users.syncStatus(variables.userId) })
      queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
    },
  })
}

export function useStartEnrollment() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      userId,
      deviceSn,
      biometricType,
      fingerId,
    }: {
      userId: string
      deviceSn: string
      biometricType: 'fingerprint' | 'face'
      fingerId?: number
    }) => {
      return UserService.startEnrollment(userId, deviceSn, biometricType, fingerId)
    },
    
    onSuccess: () => {
      toast.success(`Enrollment started on device. Please follow instructions on the device.`)
    },
    
    onError: (error) => {
      toast.error(`Failed to start enrollment: ${error.message}`)
    },
    
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commands.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.commands.byDevice(variables.deviceSn) })
    },
  })
}

// =====================================================
// USER CRUD MUTATIONS
// =====================================================

export function useCreateUser() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (userData: {
      pin: string
      name: string
      frappe_employee_id: string
      card_number?: string
      privilege?: number
    }) => {
      return UserService.createUser(userData)
    },
    
    onSuccess: () => {
      toast.success('User created successfully')
    },
    
    onError: (error) => {
      toast.error(`Failed to create user: ${error.message}`)
    },
    
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
    },
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      userId,
      userData,
    }: {
      userId: string
      userData: Record<string, unknown>
    }) => {
      return UserService.updateUser(userId, userData)
    },
    
    onSuccess: () => {
      toast.success('User updated successfully')
    },
    
    onError: (error) => {
      toast.error(`Failed to update user: ${error.message}`)
    },
    
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(variables.userId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() })
    },
  })
}

export function useDeleteUser() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (userId: string) => {
      return UserService.deleteUser(userId)
    },
    
    onSuccess: () => {
      toast.success('User deleted successfully')
    },
    
    onError: (error) => {
      toast.error(`Failed to delete user: ${error.message}`)
    },
    
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
    },
  })
}

// =====================================================
// DEVICE MUTATIONS
// =====================================================

export function useSendDeviceCommand() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      deviceSn,
      command,
      commandType,
    }: {
      deviceSn: string
      command: string
      commandType: string
    }) => {
      return DeviceService.queueDeviceCommand(deviceSn, commandType, command)
    },
    
    onSuccess: (_, variables) => {
      toast.success(`Command sent to ${variables.deviceSn}`)
    },
    
    onError: (error) => {
      toast.error(`Failed to send command: ${error.message}`)
    },
    
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commands.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.commands.byDevice(variables.deviceSn) })
    },
  })
}

export function useUpdateDevice() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      deviceSn,
      updates,
    }: {
      deviceSn: string
      updates: Record<string, unknown>
    }) => {
      const { data, error } = await supabase
        .from('devices')
        .update(updates)
        .eq('serial_number', deviceSn)
        .select()
        .single()
      
      if (error) throw error
      return data
    },
    
    onSuccess: () => {
      toast.success('Device updated successfully')
    },
    
    onError: (error) => {
      toast.error(`Failed to update device: ${error.message}`)
    },
    
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices.detail(variables.deviceSn) })
      queryClient.invalidateQueries({ queryKey: queryKeys.devices.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.devices.status() })
    },
  })
}

// =====================================================
// PHOTO MUTATIONS
// =====================================================

export function useProcessPhoto() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      userId,
      photoUrl,
    }: {
      userId: string
      photoUrl: string
    }) => {
      // Call photo service to process and store
      const response = await fetch(`/admin/photo/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, photoUrl }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to process photo')
      }
      
      return response.json()
    },
    
    onMutate: async ({ userId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.photos.status(userId) })
      
      const previousStatus = queryClient.getQueryData(queryKeys.photos.status(userId))
      
      // Optimistically set to processing
      queryClient.setQueryData(
        queryKeys.photos.status(userId),
        { status: 'processing', progress: 0 }
      )
      
      return { previousStatus }
    },
    
    onSuccess: () => {
      toast.success('Photo processed successfully')
    },
    
    onError: (error, variables, context) => {
      if (context?.previousStatus) {
        queryClient.setQueryData(
          queryKeys.photos.status(variables.userId),
          context.previousStatus
        )
      }
      toast.error(`Failed to process photo: ${error.message}`)
    },
    
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.photos.status(variables.userId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.photos.detail(variables.userId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.users.detail(variables.userId) })
    },
  })
}

// TODO: fix or remove unused
// export function useRefreshPhoto() { }

// =====================================================
// CANCELLATION
// =====================================================

let globalCancelFlag = { value: false }

export function useSyncCancel() {
  return {
    cancel: () => {
      globalCancelFlag.value = true
      toast.info('Cancelling sync operations...')
    },
    reset: () => {
      globalCancelFlag.value = false
    },
    isCancelling: () => globalCancelFlag.value,
  }
}

export function getGlobalCancel() {
  return globalCancelFlag
}
