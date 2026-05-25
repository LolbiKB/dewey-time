import { useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserService, getGlobalCancel, setGlobalCancel, getSyncState, setSyncState, type UserFilters, UserOperationLockedError } from '@/services/user-service'
import { PhotoService } from '@/services/photo-service'
import {
  notifyInfo,
  notifyOperationFailed,
  notifySuccess,
  notifyUserOperationLocked,
} from '@/lib/toast'

export function useSyncCancel() {
  return {
    cancel: () => {
      setGlobalCancel(true)
      notifyInfo('Cancelling sync', 'In-flight device steps will stop after the current command.')
    },
    reset: () => setGlobalCancel(false),
    isCancelling: getGlobalCancel().value,
  }
}

// Hook to get global sync state (persists across modal closes/users)
export function useGlobalSyncState() {
  return getSyncState()
}

// Query key factory
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: UserFilters) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
  syncStatus: (id: string) => [...userKeys.detail(id), 'sync-status'] as const,
  commandQueue: (id: string) => [...userKeys.detail(id), 'command-queue'] as const,
  biometrics: (id: string) => [...userKeys.detail(id), 'biometrics'] as const,
  driftStatus: (id: string) => [...userKeys.detail(id), 'drift-status'] as const,
  enrollmentStatus: (id: string) => [...userKeys.detail(id), 'enrollment-status'] as const,
}

// Hook: Fetch users with filters
export function useUsers(filters: UserFilters = {}) {
  return useQuery({
    queryKey: userKeys.list(filters),
    queryFn: async () => {
      try {
        const result = await UserService.getFrappeEmployees(filters)
        console.log('useUsers result:', result)
        console.log('useUsers result.data:', result.data)
        console.log('useUsers result.meta:', result.meta)
        return result
      } catch (e) {
        console.error('useUsers error:', e)
        throw e
      }
    },
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 5,
    retry: 2,
  })
}

// Hook: Get sync status for a user
export function useSyncStatus(userId: string, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: userKeys.syncStatus(userId),
    queryFn: () => UserService.getSyncStatus(userId),
    enabled: !!userId,
    staleTime: 0,
    refetchInterval: options?.refetchInterval ?? 10000,
  })
}

// Hook: Get command queue for a user
export function useCommandQueue(userId: string, limit: number = 10, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: userKeys.commandQueue(userId),
    queryFn: () => UserService.getCommandQueue(userId, limit),
    enabled: !!userId,
    staleTime: 0,
    refetchInterval: options?.refetchInterval ?? 3000,
  })
}

export { useCreateUser, useDeleteBiometric, useStartEnrollment } from './use-mutations'

// Hook: Sync user to devices
export function useSyncUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, deviceSns, photoUrl }: { userId: string; deviceSns: string[]; photoUrl?: string }) => {
      setGlobalCancel(false) // Reset cancel flag
      setSyncState({ active: true, userId, deviceSns, lastSyncTriggered: Date.now() })
      
      // Step 1: Queue sync_user commands for ALL devices
      const { parentCommands } = await UserService.syncUserToDevices(userId, deviceSns)
      console.log('[useSyncUser] sync_user queued, parentCommands:', parentCommands)
      
      // Invalidate immediately so UI shows pending state
      queryClient.invalidateQueries({ queryKey: userKeys.syncStatus(userId) })
      queryClient.invalidateQueries({ queryKey: userKeys.commandQueue(userId) })
      
      // Check for cancellation before photo processing
      if (getGlobalCancel().value) {
        await UserService.clearPendingCommandsForUser(userId)
        throw new Error('Sync cancelled')
      }
      
      // Process photo BEFORE biometrics (if needed)
      if (photoUrl) {
        try {
          const result = await PhotoService.processAndStorePhoto(userId, photoUrl)
          if (!result.success) {
            console.warn('[useSyncUser] Photo processing failed:', result.message)
            notifyInfo(
              'Photo skipped',
              result.message || 'Photo processing failed; continuing sync without photo.'
            )
          }
        } catch (error) {
          console.error('[useSyncUser] Photo processing error:', error)
        }
      }
      
      // Step 2: Run sync for each device in PARALLEL
      const syncPromises = deviceSns.map(async (deviceSn) => {
        const parentId = parentCommands[deviceSn]
        if (!parentId) return
        
        // Wait for sync_user to complete
        const result = await UserService.waitForCommand(parentId, 30000)
        console.log('[useSyncUser] sync_user completed:', result, 'for device:', deviceSn)
        
        if (result === 'cancelled' || getGlobalCancel().value) {
          await UserService.clearPendingCommandsForDevice(deviceSn, userId)
          return 'cancelled'
        }
        
        // Invalidate after sync_user completes
        queryClient.invalidateQueries({ queryKey: userKeys.syncStatus(userId) })
        queryClient.invalidateQueries({ queryKey: userKeys.commandQueue(userId) })
        
        // Queue biometrics for this device
        await UserService.enrichUserDevicesForDevice(userId, deviceSn, parentId)
        
        if (getGlobalCancel().value) {
          await UserService.clearPendingCommandsForDevice(deviceSn, userId)
          return 'cancelled'
        }
        
        // Invalidate after biometrics queued
        queryClient.invalidateQueries({ queryKey: userKeys.syncStatus(userId) })
        queryClient.invalidateQueries({ queryKey: userKeys.commandQueue(userId) })
        
        // Wait for biometric commands to complete
        const deviceCommands = await UserService.getCommandQueue(userId, 50)
        const cmds = deviceCommands.data?.filter(c => c.device_sn === deviceSn) || []
        const lastCmd = cmds.sort((a, b) => b.id - a.id)[0]
        if (lastCmd && lastCmd.status !== 'success') {
          const bioResult = await UserService.waitForCommand(lastCmd.id, 30000)
          if (bioResult === 'cancelled' || getGlobalCancel().value) {
            await UserService.clearPendingCommandsForDevice(deviceSn, userId)
            return 'cancelled'
          }
        }
        
        // Final invalidate
        queryClient.invalidateQueries({ queryKey: userKeys.syncStatus(userId) })
        queryClient.invalidateQueries({ queryKey: userKeys.commandQueue(userId) })
        
        return 'success'
      })
      
      const results = await Promise.all(syncPromises)
      
      if (results.some(r => r === 'cancelled')) {
        throw new Error('Sync cancelled')
      }
      
      return { success: true }
    },
    onSuccess: (_, variables) => {
      console.log('[useSyncUser] onSuccess triggered')
      setSyncState({ active: false, lastSyncTriggered: null })
      queryClient.invalidateQueries({ queryKey: userKeys.syncStatus(variables.userId) })
      queryClient.invalidateQueries({ queryKey: userKeys.commandQueue(variables.userId) })
      notifySuccess('Sync completed')
    },
    onError: (error: Error) => {
      console.error('[useSyncUser] onError triggered:', error.message)
      setSyncState({ active: false, lastSyncTriggered: null })
      if (error.message === 'Sync cancelled') {
        notifyInfo('Sync cancelled')
      } else if (error instanceof UserOperationLockedError) {
        notifyUserOperationLocked(error, 'sync')
      } else {
        notifyOperationFailed('sync user', error)
      }
      setGlobalCancel(false)
      queryClient.invalidateQueries({ queryKey: userKeys.details() })
      queryClient.invalidateQueries({ queryKey: userKeys.lists() })
    },
    onSettled: () => {
      setGlobalCancel(false)
      setSyncState({ active: false, lastSyncTriggered: null })
    },
  })
}

// Export cancel function helper
export function cancelSyncUser(_queryClient: ReturnType<typeof useQueryClient>, cancelledRef: { current: boolean }) {
  cancelledRef.current = true
}

// Hook: Get biometric inventory for a user
export function useUserBiometrics(userId: string) {
  return useQuery({
    queryKey: userKeys.biometrics(userId),
    queryFn: () => UserService.getUserBiometrics(userId),
    enabled: !!userId,
  })
}

// Hook: Poll active enrollment session (continues after modal close)
export function useEnrollmentStatus(userId: string, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: userKeys.enrollmentStatus(userId),
    queryFn: () => UserService.getEnrollmentStatus(userId),
    enabled: !!userId && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? 3000,
  })
}

// Hook: Get drift status for a user
export function useDriftStatus(userId: string) {
  return useQuery({
    queryKey: userKeys.driftStatus(userId),
    queryFn: () => UserService.getDriftStatus(userId),
    enabled: !!userId,
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  })
}

// Hook: Poll a single command's status (for enrollment progress)
export function useEnrollmentCommandStatus(
  commandId: number | null,
  userId: string,
) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['command', commandId] as const,
    queryFn: () => UserService.getCommandStatus(commandId!),
    enabled: !!commandId,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      // Stop polling once terminal
      if (status === 'success' || status === 'failed') return false
      return 2000 // Poll every 2 seconds while in-flight
    },
  })

  // Invalidate related queries once when enrollment reaches a terminal success state
  const didInvalidate = useRef(false)
  useEffect(() => {
    if (query.data?.status === 'success' && !didInvalidate.current) {
      didInvalidate.current = true
      queryClient.invalidateQueries({ queryKey: userKeys.biometrics(userId) })
      queryClient.invalidateQueries({ queryKey: userKeys.lists() })
    }
    // Reset when commandId changes (new enrollment)
    if (!commandId) {
      didInvalidate.current = false
    }
  }, [query.data?.status, commandId, userId, queryClient])

  return query
}

// Hook: Clear pending commands for a device
export function useClearPendingCommands() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ deviceSn, userId }: { deviceSn: string; userId?: string }) => 
      UserService.clearPendingCommands(deviceSn, userId),
    onSuccess: (result, variables) => {
      if (variables.userId) {
        queryClient.invalidateQueries({ queryKey: userKeys.commandQueue(variables.userId) })
        queryClient.invalidateQueries({ queryKey: userKeys.syncStatus(variables.userId) })
      }
      notifySuccess(
        `Cleared ${result.cleared} pending command${result.cleared !== 1 ? 's' : ''}`
      )
    },
    onError: (error: Error) => {
      notifyOperationFailed('clear commands', error)
    },
  })
}

// Hook: Check device state (busy or idle)
export function useDeviceState(deviceSn: string) {
  return useQuery({
    queryKey: ['devices', deviceSn, 'state'] as const,
    queryFn: () => UserService.getDeviceState(deviceSn),
    enabled: !!deviceSn,
    refetchInterval: 3000, // Check every 3 seconds
  })
}

// Hook: Cancel pending enrollment
export function useCancelEnrollment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) => UserService.cancelEnrollment(userId),
    onSuccess: (result, userId) => {
      queryClient.invalidateQueries({ queryKey: userKeys.syncStatus(userId) })
      queryClient.invalidateQueries({ queryKey: userKeys.commandQueue(userId) })
      queryClient.invalidateQueries({ queryKey: userKeys.enrollmentStatus(userId) })
      queryClient.invalidateQueries({ queryKey: ['user-sync-summary', userId] })
      if (result.detail) {
        notifySuccess(result.message, result.detail)
      } else {
        notifySuccess(result.message)
      }
    },
    onError: (error: Error) => {
      notifyOperationFailed('cancel enrollment', error)
    },
  })
}

export { useRetryUserSync, useForceUserSync } from './use-mutations'

// Hook: Check if user has active operation lock
export function useUserLockStatus(userId: string) {
  return useQuery({
    queryKey: [...userKeys.detail(userId), 'lock-status'],
    queryFn: async () => {
      if (!userId) return null
      try {
        const result = await UserService.getSyncStatus(userId)
        // Check if any device shows 'syncing' or 'cleaning' state which indicates lock
        const hasActiveOperation = result.data?.some(
          (status: any) => status.actual_state === 'syncing' || status.actual_state === 'cleaning'
        )
        return {
          isLocked: hasActiveOperation,
          states: result.data?.map((s: any) => ({
            deviceSn: s.device_sn,
            state: s.actual_state,
          })),
        }
      } catch {
        return null
      }
    },
    enabled: !!userId,
    refetchInterval: 5000, // Refetch every 5 seconds
  })
}
export function useReconcileUserSync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) => UserService.reconcileUserSync(userId),
    onSuccess: (result, userId) => {
      queryClient.invalidateQueries({ queryKey: userKeys.syncStatus(userId) })
      queryClient.invalidateQueries({ queryKey: userKeys.commandQueue(userId) })
      notifySuccess(
        result.cancelled > 0
          ? `Cleared ${result.cancelled} stale command(s)`
          : 'Sync state reconciled',
        result.cancelled > 0 ? 'Admin cleanup of orphan queue entries' : undefined
      )
    },
    onError: (error: Error) => {
      notifyOperationFailed('reconcile sync', error)
    },
  })
}
