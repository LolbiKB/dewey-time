import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserService, type UserFilters, type UserEntry } from '@/services/user-service'
import { toast } from 'sonner'

// Query key factory
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (filters: UserFilters) => [...userKeys.lists(), filters] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
  syncStatus: (id: string) => [...userKeys.detail(id), 'sync-status'] as const,
  commandQueue: (id: string) => [...userKeys.detail(id), 'command-queue'] as const,
}

// Hook: Fetch users with filters
export function useUsers(filters: UserFilters = {}) {
  return useQuery({
    queryKey: userKeys.list(filters),
    queryFn: () => UserService.getFrappeEmployees(filters),
    staleTime: 30000, // 30 seconds
  })
}

// Hook: Get sync status for a user
export function useSyncStatus(userId: string) {
  return useQuery({
    queryKey: userKeys.syncStatus(userId),
    queryFn: () => UserService.getSyncStatus(userId),
    enabled: !!userId,
  })
}

// Hook: Get command queue for a user
export function useCommandQueue(userId: string, limit: number = 10) {
  return useQuery({
    queryKey: userKeys.commandQueue(userId),
    queryFn: () => UserService.getCommandQueue(userId, limit),
    enabled: !!userId,
    refetchInterval: 3000, // Auto-refresh every 3 seconds
  })
}

// Hook: Create user
export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (user: Partial<UserEntry>) => UserService.createUser(user),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() })
      toast.success('User created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create user: ${error.message}`)
    },
  })
}

// Hook: Update user
export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, user }: { userId: string; user: Partial<UserEntry> }) =>
      UserService.updateUser(userId, user),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() })
      toast.success('User updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update user: ${error.message}`)
    },
  })
}

// Hook: Delete user
export function useDeleteUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) => UserService.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() })
      toast.success('User deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete user: ${error.message}`)
    },
  })
}

// Hook: Sync user to devices
export function useSyncUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, deviceSns }: { userId: string; deviceSns: string[] }) => {
      // Queue sync_user commands (fast, local DB)
      const { parentCommands } = await UserService.syncUserToDevices(userId, deviceSns)
      // Fetch bio+photo from Frappe & queue remaining commands (slow)
      await UserService.enrichUserDevices(userId, deviceSns, parentCommands)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: userKeys.syncStatus(variables.userId) })
      queryClient.invalidateQueries({ queryKey: userKeys.commandQueue(variables.userId) })
      toast.success('Sync commands queued')
    },
    onError: (error: Error) => {
      toast.error(`Failed to sync user: ${error.message}`)
    },
  })
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
      toast.success(`Cleared ${result.cleared} pending command${result.cleared !== 1 ? 's' : ''}`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to clear commands: ${error.message}`)
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

// Hook: Check if user can be deleted
export function useCanDeleteUser(userId: string) {
  return useQuery({
    queryKey: ['users', userId, 'can-delete'] as const,
    queryFn: () => UserService.canDeleteUser(userId),
    enabled: !!userId,
  })
}

