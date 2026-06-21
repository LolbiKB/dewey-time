import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchEmployees,
  fetchEmployee,
  createEmployee,
  deleteEmployee,
  fetchEmployeeRoles,
  fetchAssignableRoles,
  fetchEmployeeTermTypes,
  fetchEmployeePositionTypes,
  fetchEmployeeDepartmentTypes,
  fetchAvailableUsers,
  updateEmployeePositions,
  updateEmployeeRoles,
  employeeQueryKeys,
  type EmployeeFilters,
  type PositionUpdateRequest,
  type RoleUpdateRequest
} from '../services/employee-service'

/**
 * Hook for fetching paginated employees with server-side filtering and sorting
 */
export function useEmployees(filters: EmployeeFilters = {}) {
  return useQuery({
    queryKey: employeeQueryKeys.list(filters),
    queryFn: () => fetchEmployees(filters),
    placeholderData: (previousData) => previousData, // Keep previous data while loading new
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook for fetching a single employee by ID
 */
export function useEmployee(id: number, enabled = true, options?: { staleTime?: number }) {
  return useQuery({
    queryKey: employeeQueryKeys.detail(id),
    queryFn: () => fetchEmployee(id),
    enabled: enabled && !!id, // Only fetch if enabled and id exists
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // Individual employees stay fresh longer, or override
  })
}

/**
 * Hook for creating a new employee
 */
export function useCreateEmployee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createEmployee,
    onSuccess: () => {
      // Invalidate and refetch employees list
      queryClient.invalidateQueries({ queryKey: employeeQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to create employee:', error)
    }
  })
}

/**
 * Hook for updating employee roles
 */
export function useUpdateEmployeeRoles() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ employeeId, roles }: { employeeId: number; roles: RoleUpdateRequest }) => 
      updateEmployeeRoles(employeeId, roles),
    onSuccess: (_, { employeeId }) => {
      // Invalidate and refetch employee details to get updated roles
      queryClient.invalidateQueries({ queryKey: employeeQueryKeys.detail(employeeId) })
      
      // Also invalidate employee list in case role changes affect list view
      queryClient.invalidateQueries({ queryKey: employeeQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to update employee roles:', error)
    }
  })
}

/**
 * Hook for deleting a single employee
 */
export function useDeleteEmployee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteEmployee,
    onSuccess: (_, deletedId) => {
      // Remove the employee from cache
      queryClient.removeQueries({ queryKey: employeeQueryKeys.detail(deletedId) })
      
      // Invalidate employees list to reflect changes
      queryClient.invalidateQueries({ queryKey: employeeQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to delete employee:', error)
    }
  })
}

/**
 * Hook to prefetch employee details (useful for hover states, etc.)
 */
export function usePrefetchEmployee() {
  const queryClient = useQueryClient()

  return (id: number) => {
    queryClient.prefetchQuery({
      queryKey: employeeQueryKeys.detail(id),
      queryFn: () => fetchEmployee(id),
      staleTime: 5 * 60 * 1000,
    })
  }
}

/**
 * Hook to manually refetch employees (useful for refresh buttons)
 */
export function useRefetchEmployees() {
  const queryClient = useQueryClient()

  return () => {
    queryClient.invalidateQueries({ queryKey: employeeQueryKeys.lists() })
  }
}

/**
 * Compound hook that provides all employee operations in one place
 */
export function useEmployeeManagement(filters: EmployeeFilters = {}) {
  const employees = useEmployees(filters)
  const createEmployee = useCreateEmployee()
  const updateEmployeeRoles = useUpdateEmployeeRoles()
  const updateEmployeePositions = useUpdateEmployeePositions()
  const deleteEmployee = useDeleteEmployee()
  const prefetchEmployee = usePrefetchEmployee()

  return {
    // Query states
    employees,
    
    // Mutations
    createEmployee,
    updateEmployeeRoles,
    updateEmployeePositions,
    deleteEmployee,
    
    // Utilities
    refetchEmployees: employees.refetch, // Use the actual refetch function that triggers loading state
    prefetchEmployee,
    
    // Computed states
    isLoading: employees.isLoading || employees.isFetching, // Include isFetching for refetch loading state
    isError: employees.isError,
    error: employees.error,
    data: employees.data?.data || [],
    meta: employees.data?.meta,
    
    // Mutation states
    isCreating: createEmployee.isPending,
    isUpdatingRoles: updateEmployeeRoles.isPending,
    isUpdatingPositions: updateEmployeePositions.isPending,
    isDeleting: deleteEmployee.isPending,
  }
}

/**
 * Hook for fetching employee roles (for filter options)
 */
export function useEmployeeRoles() {
  return useQuery({
    queryKey: employeeQueryKeys.roles(),
    queryFn: async () => {
      const response = await fetchEmployeeRoles()
      if (!response.success) {
        throw new Error('Failed to fetch employee roles')
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - roles don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  })
}

/**
 * Hook for fetching assignable roles (for role assignment, respects user permissions)
 */
export function useAssignableRoles() {
  return useQuery({
    queryKey: employeeQueryKeys.assignableRoles(),
    queryFn: async () => {
      const response = await fetchAssignableRoles()
      if (!response.success) {
        throw new Error('Failed to fetch assignable roles')
      }
      return response.data
    },
    staleTime: 2 * 60 * 1000, // 2 minutes - shorter than filter roles since it depends on user permissions
    gcTime: 5 * 60 * 1000, // 5 minutes cache
  })
}

/**
 * Hook for fetching employee term types (for filter options)  
 */
export function useEmployeeTermTypes() {
  return useQuery({
    queryKey: employeeQueryKeys.termTypes(),
    queryFn: async () => {
      const response = await fetchEmployeeTermTypes()
      if (!response.success) {
        throw new Error('Failed to fetch employee term types')
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - term types don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  })
}

/**
 * Hook for fetching employee position types (for filter options)  
 */
export function useEmployeePositionTypes() {
  return useQuery({
    queryKey: employeeQueryKeys.positionTypes(),
    queryFn: async () => {
      const response = await fetchEmployeePositionTypes()
      if (!response.success) {
        throw new Error('Failed to fetch employee position types')
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - position types don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  })
}

/**
 * Hook for fetching employee department types (for filter options)  
 */
export function useEmployeeDepartmentTypes() {
  return useQuery({
    queryKey: employeeQueryKeys.departmentTypes(),
    queryFn: async () => {
      const response = await fetchEmployeeDepartmentTypes()
      if (!response.success) {
        throw new Error('Failed to fetch employee department types')
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - department types don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  })
}

/**
 * Hook for updating employee positions
 */
export function useUpdateEmployeePositions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ employeeId, positions }: { employeeId: number; positions: PositionUpdateRequest }) => 
      updateEmployeePositions(employeeId, positions),
    onSuccess: (_, { employeeId }) => {
      // Invalidate and refetch employee details to get updated positions
      queryClient.invalidateQueries({ queryKey: employeeQueryKeys.detail(employeeId) })
      
      // Also invalidate employee list in case position changes affect list view
      queryClient.invalidateQueries({ queryKey: employeeQueryKeys.lists() })
      
      // Invalidate positions cache if it exists
      queryClient.invalidateQueries({ queryKey: employeeQueryKeys.positions(employeeId) })
    },
    onError: (error) => {
      console.error('Failed to update employee positions:', error)
    }
  })
}

/**
 * Hook for fetching users available for employee creation (HR context)
 */
export function useAvailableUsers(filters: { search?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: employeeQueryKeys.availableUsers(filters),
    queryFn: async () => {
      const response = await fetchAvailableUsers(filters)
      if (!response.success) {
        throw new Error('Failed to fetch available users')
      }
      return response
    },
    enabled: true, // Always enabled, but can be controlled by component
    staleTime: 30 * 1000, // 30 seconds - user data changes more frequently
    gcTime: 2 * 60 * 1000, // 2 minutes cache
  })
}

// =============================================================================
// MODAL-SPECIFIC HOOKS (Always fetch fresh)
// =============================================================================

/**
 * Hook for fetching employee data in modals (always fresh)
 */
export function useEmployeeForModal(id: number, modalOpen: boolean) {
  return useQuery({
    queryKey: employeeQueryKeys.detail(id),
    queryFn: () => fetchEmployee(id),
    enabled: modalOpen && !!id,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    // Don't use placeholderData - we want to show loading state for new employee
  })
}

/**
 * Hook for fetching assignable roles in modals (always fresh)
 */
export function useAssignableRolesForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: employeeQueryKeys.assignableRoles(),
    queryFn: async () => {
      const response = await fetchAssignableRoles()
      if (!response.success) {
        throw new Error('Failed to fetch assignable roles')
      }
      return response.data
    },
    enabled: modalOpen,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  })
}

/**
 * Hook for fetching position types in modals (always fresh)
 */
export function useEmployeePositionTypesForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: employeeQueryKeys.positionTypes(),
    queryFn: async () => {
      const response = await fetchEmployeePositionTypes()
      if (!response.success) {
        throw new Error('Failed to fetch employee position types')
      }
      return response.data
    },
    enabled: modalOpen,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  })
}

/**
 * Hook for fetching department types in modals (always fresh)
 */
export function useEmployeeDepartmentTypesForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: employeeQueryKeys.departmentTypes(),
    queryFn: async () => {
      const response = await fetchEmployeeDepartmentTypes()
      if (!response.success) {
        throw new Error('Failed to fetch employee department types')
      }
      return response.data
    },
    enabled: modalOpen,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  })
}