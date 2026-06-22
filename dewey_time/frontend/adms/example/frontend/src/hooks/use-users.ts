import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchUsers,
  fetchUser,
  createUser,
  updateUser,
  deleteUser,
  bulkDeleteUsers,
  userQueryKeys,
  type UserFilters
} from '../services/user-service'

/**
 * Hook for fetching paginated users with server-side filtering and sorting
 */
export function useUsers(filters: UserFilters = {}) {
  return useQuery({
    queryKey: userQueryKeys.list(filters),
    queryFn: () => fetchUsers(filters),
    placeholderData: (previousData) => previousData, // Keep previous data while loading new
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook for fetching a single user by ID
 */
export function useUser(id: string, enabled = true, options?: { staleTime?: number }) {
  return useQuery({
    queryKey: userQueryKeys.detail(id),
    queryFn: () => fetchUser(id),
    enabled: enabled && !!id, // Only fetch if enabled and id exists
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // Individual users stay fresh longer, or override
  })
}

/**
 * Hook for creating a new user
 */
export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      // Invalidate and refetch users list
      queryClient.invalidateQueries({ queryKey: userQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to add user:', error)
    }
  })
}

/**
 * Hook for updating an existing user
 */
export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateUser,
    onSuccess: (data) => {
      // Update the specific user in cache
      queryClient.setQueryData(userQueryKeys.detail(data.data.id), data)
      
      // Invalidate users list to reflect changes
      queryClient.invalidateQueries({ queryKey: userQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to update user:', error)
    }
  })
}

/**
 * Hook for deleting a single user
 */
export function useDeleteUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteUser,
    onSuccess: (_, deletedId) => {
      // Remove the user from cache
      queryClient.removeQueries({ queryKey: userQueryKeys.detail(deletedId) })
      
      // Invalidate users list to reflect changes
      queryClient.invalidateQueries({ queryKey: userQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to delete user:', error)
    }
  })
}

/**
 * Hook for bulk deleting multiple users
 */
export function useBulkDeleteUsers() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: bulkDeleteUsers,
    onSuccess: (_, variables) => {
      // Remove deleted users from cache
      variables.forEach(id => {
        queryClient.removeQueries({ queryKey: userQueryKeys.detail(id) })
      })
      
      // Invalidate users list to reflect changes
      queryClient.invalidateQueries({ queryKey: userQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to bulk delete users:', error)
    }
  })
}

/**
 * Hook to prefetch user details (useful for hover states, etc.)
 */
export function usePrefetchUser() {
  const queryClient = useQueryClient()

  return (id: string) => {
    queryClient.prefetchQuery({
      queryKey: userQueryKeys.detail(id),
      queryFn: () => fetchUser(id),
      staleTime: 5 * 60 * 1000,
    })
  }
}

/**
 * Hook to manually refetch users (useful for refresh buttons)
 */
export function useRefetchUsers() {
  const queryClient = useQueryClient()

  return () => {
    queryClient.invalidateQueries({ queryKey: userQueryKeys.lists() })
  }
}

/**
 * Compound hook that provides all user operations in one place
 */
export function useUserManagement(filters: UserFilters = {}) {
  const users = useUsers(filters)
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const deleteUser = useDeleteUser()
  const bulkDeleteUsers = useBulkDeleteUsers()
  const prefetchUser = usePrefetchUser()

  return {
    // Query states
    users,
    
    // Mutations
    createUser,
    updateUser,
    deleteUser,
    bulkDeleteUsers,
    
    // Utilities
    refetchUsers: users.refetch, // Use the actual refetch function that triggers loading state
    prefetchUser,
    
    // Computed states
    isLoading: users.isLoading || users.isFetching, // Include isFetching for refetch loading state
    isError: users.isError,
    error: users.error,
    data: users.data?.data || [],
    meta: users.data?.meta,
    
    // Mutation states
    isCreating: createUser.isPending,
    isUpdating: updateUser.isPending,
    isDeleting: deleteUser.isPending || bulkDeleteUsers.isPending,
  }
}

// =============================================================================
// MODAL-SPECIFIC HOOKS (Always fetch fresh)
// =============================================================================

/**
 * Hook for fetching user data in modals (always fresh)
 */
export function useUserForModal(id: string, modalOpen: boolean) {
  return useQuery({
    queryKey: userQueryKeys.detail(id),
    queryFn: () => fetchUser(id),
    enabled: modalOpen && !!id,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    // Don't use placeholderData - we want to show loading state for new user
  })
}