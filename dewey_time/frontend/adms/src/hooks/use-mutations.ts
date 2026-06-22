// Optimistic Mutation Hooks
// All data modifications go through these hooks
// They handle optimistic updates and cache invalidation

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  notifyInfo,
  notifyOperationFailed,
  notifySuccess,
  notifyUserOperationLocked,
} from '@/lib/toast'
import { queryKeys } from '@/lib/query-keys'
import { UserService, UserOperationLockedError } from '@/services/user-service'
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
      // Cancel batch queries to prevent stale data
      await queryClient.cancelQueries({ queryKey: ['batches'] })
      deviceSns.forEach(sn => {
        queryClient.cancelQueries({ queryKey: ['batches', sn] })
        queryClient.cancelQueries({ queryKey: queryKeys.devices.users(sn, '') })
      })

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

      // Optimistically update batches to show syncing immediately
      deviceSns.forEach(sn => {
        queryClient.setQueryData(['batches', sn], (old: any) => {
          if (!old || !Array.isArray(old)) return old
          // Add pending batch entry for this user
          const existingIndex = old.findIndex((b: any) => b.user_id === userId && b.device_sn === sn)
          if (existingIndex >= 0) {
            // Update existing batch to processing
            const newOld = [...old]
            newOld[existingIndex] = { ...newOld[existingIndex], status: 'processing', created_at: new Date().toISOString() }
            return newOld
          }
          // Add new pending batch at the top
          return [
            {
              id: `temp-${Date.now()}`,
              user_id: userId,
              device_sn: sn,
              status: 'pending',
              batch_type: 'full',
              success_mode: 'AND',
              commands_count: 0,
              completed_count: 0,
              failed_count: 0,
              created_at: new Date().toISOString(),
            },
            ...old
          ]
        })
      })

      // Optimistically reset component sync status to false
      const componentReset = {
        user_synced: false,
        fingerprint_synced: false,
        face_synced: false,
        photo_synced: false,
      }

      // Update user-specific sync status with component reset
      queryClient.setQueryData(
        queryKeys.users.syncStatus(userId),
        (old: any) => {
          if (!old || !Array.isArray(old)) return old
          return old.map((status: any) =>
            deviceSns.includes(status.device_sn)
              ? { ...status, ...componentReset, actual_state: 'syncing' }
              : status
          )
        }
      )

      // Update global sync status with component reset
      queryClient.setQueryData(
        ['sync-status', 'all'],
        (old: any) => {
          if (!old || !Array.isArray(old)) return old
          return old.map((status: any) =>
            status.user_id === userId && deviceSns.includes(status.device_sn)
              ? { ...status, ...componentReset, actual_state: 'syncing' }
              : status
          )
        }
      )

      // Optimistically update device users paginated data
      deviceSns.forEach(sn => {
        queryClient.setQueryData(queryKeys.devices.users(sn, ''), (old: any) => {
          if (!old || !old.pages) return old
          // Update all pages - reset sync flags for the synced user
          const newPages = old.pages.map((page: any) => ({
            ...page,
            data: page.data?.map((user: any) =>
              user.userId === userId
                ? {
                    ...user,
                    userSynced: false,
                    fingerprintSynced: false,
                    faceSynced: false,
                    photoSynced: false,
                  }
                : user
            ),
          }))
          return { ...old, pages: newPages }
        })
      })

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
      // Rollback batches and device users
      variables.deviceSns.forEach((sn: string) => {
        queryClient.invalidateQueries({ queryKey: ['batches', sn] })
        queryClient.invalidateQueries({ queryKey: queryKeys.devices.users(sn, '') })
      })

      if (error instanceof UserOperationLockedError) {
        notifyUserOperationLocked(error, 'sync')
      } else {
        notifyOperationFailed('force sync', error)
      }
    },

    onSuccess: (data) => {
      const skipped = data.skippedDevices ?? 0
      const description =
        skipped > 0 ? `${skipped} device(s) skipped — batch already running` : undefined
      const title =
        data.message ?? `Force sync queued on ${data.commandsQueued} device(s)`
      notifySuccess(title, description)
    },

    onSettled: (_data, _error, variables) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.users.syncStatus(variables.userId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.users.commands(variables.userId) })
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.users.detail(variables.userId), 'command-queue'],
      })
      queryClient.invalidateQueries({ queryKey: ['user-sync-aggregate', variables.userId] })
      queryClient.invalidateQueries({ queryKey: ['sync-status', 'all'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.commands.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.system.syncHealth })

      // Invalidate device-specific queries and trigger immediate refetch
      variables.deviceSns.forEach((sn: string) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.devices.syncStatus(sn) })
        queryClient.invalidateQueries({ queryKey: queryKeys.devices.commands(sn) })
        queryClient.invalidateQueries({ queryKey: queryKeys.devices.users(sn, '') })
        queryClient.invalidateQueries({ queryKey: ['batches', sn] })
        // Force immediate refetch
        queryClient.refetchQueries({ queryKey: queryKeys.devices.users(sn, '') })
        queryClient.refetchQueries({ queryKey: ['batches', sn] })
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
      if (error instanceof UserOperationLockedError) {
        notifyUserOperationLocked(error, 'sync')
      } else {
        notifyOperationFailed('retry sync', error)
      }
    },

    onSuccess: (result) => {
      if (result.message) {
        notifySuccess(result.message)
      } else if ((result.resetCount ?? 0) > 0) {
        notifySuccess(
          `Reset ${result.resetCount} failed command(s)`,
          'Devices will pick them up on the next poll.'
        )
      } else if (result.commandsQueued > 0) {
        notifySuccess(`Queued fresh sync on ${result.commandsQueued} device(s)`)
      } else {
        notifyInfo('Sync retry requested', 'Watch device status for progress.')
      }
    },
    
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.syncStatus(variables.userId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.users.commands(variables.userId) })
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.users.detail(variables.userId), 'command-queue'],
      })
      queryClient.invalidateQueries({ queryKey: ['user-sync-aggregate', variables.userId] })
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
      notifyOperationFailed('delete biometric', error)
    },

    onSuccess: (result, variables) => {
      const detail =
        result.commandsQueued > 0
          ? `${result.commandsQueued} device delete command(s) queued`
          : undefined
      notifySuccess(`Deleted ${variables.type} template`, detail)
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
    
    onSuccess: (_data, variables) => {
      notifySuccess(
        'Enrollment started',
        'Follow the prompts on the registrar device.'
      )
      queryClient.invalidateQueries({ queryKey: queryKeys.users.syncStatus(variables.userId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.users.commands(variables.userId) })
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.users.detail(variables.userId), 'enrollment-status'],
      })
    },

    onError: (error) => {
      if (error instanceof UserOperationLockedError) {
        notifyUserOperationLocked(error, 'enroll')
      } else {
        notifyOperationFailed('start enrollment', error)
      }
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
      notifySuccess('User created successfully')
    },

    onError: (error) => {
      notifyOperationFailed('create user', error)
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
      notifySuccess('User updated successfully')
    },

    onError: (error) => {
      notifyOperationFailed('update user', error)
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
      notifySuccess('User deleted successfully')
    },

    onError: (error) => {
      notifyOperationFailed('delete user', error)
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
      notifySuccess('Command queued', `Sent to ${variables.deviceSn}. Executes on next device poll.`)
    },

    onError: (error) => {
      notifyOperationFailed('send command', error)
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
    
    onSuccess: (_data, variables) => {
      notifySuccess('Device updated', `Configuration saved for ${variables.deviceSn}.`)
    },

    onError: (error) => {
      notifyOperationFailed('update device', error)
    },
    
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices.detail(variables.deviceSn) })
      queryClient.invalidateQueries({ queryKey: queryKeys.devices.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.devices.status() })
    },
  })
}

// Photo processing: see use-photo.ts (canonical implementation)

// =====================================================
// DEVICE COMMAND MUTATIONS
// =====================================================

/**
 * Retry a failed command
 */
export function useRetryCommand() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (commandId: number) => DeviceService.retryCommand(commandId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commands.all })
      notifySuccess('Command retry queued')
    },
    onError: (error) => {
      notifyOperationFailed('retry command', error)
    },
  })
}

/**
 * Clear a single command from a device queue
 */
export function useClearDeviceCommands() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ deviceSn, commandId }: { deviceSn: string; commandId: number }) =>
      DeviceService.clearCommand(deviceSn, commandId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.commands.all })
      notifySuccess('Command cleared')
    },
    onError: (error) => {
      notifyOperationFailed('clear command', error)
    },
  })
}

/** @deprecated Prefer useForceSync */
export { useForceSync as useForceUserSync, useRetrySync as useRetryUserSync }
