import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchStudents,
  fetchStudent,
  fetchStudentPrograms,
  fetchStudentTermTypes,
  fetchAvailableUsers,
  deleteStudent,
  updateStudentPrograms,
  studentQueryKeys,
  type StudentFilters,
  type ProgramUpdateRequest
} from '@/services/student-service'

/**
 * Hook for fetching paginated students with server-side filtering and sorting
 */
export function useStudents(filters: StudentFilters = {}) {
  return useQuery({
    queryKey: studentQueryKeys.list(filters),
    queryFn: () => fetchStudents(filters),
    placeholderData: (previousData) => previousData, // Keep previous data while loading new
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook for fetching a single student by ID
 */
export function useStudent(id: number, enabled = true, options?: { staleTime?: number }) {
  return useQuery({
    queryKey: studentQueryKeys.detail(id),
    queryFn: () => fetchStudent(id),
    enabled: enabled && !!id, // Only fetch if enabled and id exists
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // Individual students stay fresh longer, or override
  })
}

/**
 * Hook to prefetch student details (useful for hover states, etc.)
 */
export function usePrefetchStudent() {
  const queryClient = useQueryClient()

  return (id: number) => {
    queryClient.prefetchQuery({
      queryKey: studentQueryKeys.detail(id),
      queryFn: () => fetchStudent(id),
      staleTime: 5 * 60 * 1000,
    })
  }
}

/**
 * Hook to manually refetch students (useful for refresh buttons)
 */
export function useRefetchStudents() {
  const queryClient = useQueryClient()

  return () => {
    queryClient.invalidateQueries({ queryKey: studentQueryKeys.lists() })
  }
}

/**
 * Hook for deleting a student
 */
export function useDeleteStudent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteStudent,
    onSuccess: (_, deletedId) => {
      // Remove the student from cache
      queryClient.removeQueries({ queryKey: studentQueryKeys.detail(deletedId) })
      
      // Invalidate students list to reflect changes
      queryClient.invalidateQueries({ queryKey: studentQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to delete student:', error)
    }
  })
}

/**
 * Hook for updating student programs
 */
export function useUpdateStudentPrograms() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ studentId, programs }: { studentId: number; programs: ProgramUpdateRequest }) => 
      updateStudentPrograms(studentId, programs),
    onSuccess: (_, { studentId }) => {
      // Invalidate and refetch student details to get updated programs
      queryClient.invalidateQueries({ queryKey: studentQueryKeys.detail(studentId) })
      
      // Also invalidate student list in case program changes affect list view
      queryClient.invalidateQueries({ queryKey: studentQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to update student programs:', error)
    }
  })
}

/**
 * Compound hook that provides all student operations in one place
 */
export function useStudentManagement(filters: StudentFilters = {}) {
  const students = useStudents(filters)
  const prefetchStudent = usePrefetchStudent()

  return {
    // Query states
    students,
    
    // Utilities
    refetchStudents: students.refetch, // Use the actual refetch function that triggers loading state
    prefetchStudent,
    
    // Computed states
    isLoading: students.isLoading || students.isFetching, // Include isFetching for refetch loading state
    isError: students.isError,
    error: students.error,
    data: students.data?.data || [],
    meta: students.data?.meta,
  }
}

/**
 * Hook for fetching programs (for filter options) - includes degree info
 */
export function useStudentPrograms() {
  return useQuery({
    queryKey: studentQueryKeys.programs(),
    queryFn: async () => {
      const response = await fetchStudentPrograms()
      if (!response.success) {
        throw new Error('Failed to fetch student programs')
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - programs don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  })
}

/**
 * Hook for fetching term types (for filter options)
 */
export function useStudentTermTypes() {
  return useQuery({
    queryKey: studentQueryKeys.termTypes(),
    queryFn: async () => {
      const response = await fetchStudentTermTypes()
      if (!response.success) {
        throw new Error('Failed to fetch student term types')
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - term types don't change frequently
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  })
}

// =============================================================================
// MODAL-SPECIFIC HOOKS (Always fetch fresh)
// =============================================================================

/**
 * Hook for fetching student data in modals (always fresh)
 */
export function useStudentForModal(id: number, modalOpen: boolean) {
  return useQuery({
    queryKey: studentQueryKeys.detail(id),
    queryFn: () => fetchStudent(id),
    enabled: modalOpen && !!id,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    // Don't use placeholderData - we want to show loading state for new student
  })
}

/**
 * Hook for fetching programs in modals (always fresh) - includes degree info
 */
export function useStudentProgramsForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: studentQueryKeys.programs(),
    queryFn: async () => {
      const response = await fetchStudentPrograms()
      if (!response.success) {
        throw new Error('Failed to fetch student programs')
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
 * Hook for fetching term types in modals (always fresh)
 */
export function useStudentTermTypesForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: studentQueryKeys.termTypes(),
    queryFn: async () => {
      const response = await fetchStudentTermTypes()
      if (!response.success) {
        throw new Error('Failed to fetch student term types')
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
 * Hook for fetching users available for student enrollment in modals (always fresh)
 */
export function useAvailableUsersForModal(modalOpen: boolean, filters: { search?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: studentQueryKeys.availableUsers(filters),
    queryFn: async () => {
      const response = await fetchAvailableUsers(filters)
      if (!response.success) {
        throw new Error('Failed to fetch available users')
      }
      return response
    },
    enabled: modalOpen,
    staleTime: 30 * 1000, // 30 seconds - user data changes more frequently
    gcTime: 2 * 60 * 1000, // 2 minutes cache
  })
}
