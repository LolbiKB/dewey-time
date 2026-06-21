import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  fetchDepartments,
  fetchDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  departmentQueryKeys,
  type Department,
  type DepartmentFilters
} from '@/services/department-service'

export function useDepartments(filters: DepartmentFilters = {}) {
  return useQuery({
    queryKey: departmentQueryKeys.list(filters),
    queryFn: async () => {
      const data = await fetchDepartments(filters)
      return data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useDepartment(id: number, enabled = true, options?: { staleTime?: number }) {
  return useQuery({
    queryKey: departmentQueryKeys.detail(id),
    queryFn: async () => {
      const data = await fetchDepartmentById(id)
      return data
    },
    enabled: enabled && !!id,
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5 minutes default
  })
}

export function useCreateDepartment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createDepartment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: departmentQueryKeys.all })
    },
  })
}

export function useUpdateDepartment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, department }: { id: number; department: Partial<Department> }) =>
      updateDepartment(id, department),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: departmentQueryKeys.all })
    },
  })
}

export function useDeleteDepartment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteDepartment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: departmentQueryKeys.all })
    },
  })
}

// =============================================================================
// MODAL-SPECIFIC HOOKS (Always fetch fresh)
// =============================================================================

/**
 * Hook for fetching department data in modals (always fresh)
 */
export function useDepartmentForModal(id: number, modalOpen: boolean) {
  return useQuery({
    queryKey: departmentQueryKeys.detail(id),
    queryFn: async () => {
      const data = await fetchDepartmentById(id)
      return data
    },
    enabled: modalOpen && !!id,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    // Don't use placeholderData - we want to show loading state for new department
  })
}