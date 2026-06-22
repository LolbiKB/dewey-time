import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  fetchCourseOfferings,
  fetchCourseOfferingById,
  fetchCourseOfferingCourses,
  fetchCourseOfferingTerms,
  fetchCourseOfferingInstructors,
  createCourseOffering,
  updateCourseOffering,
  deleteCourseOffering,
  type CourseOfferingFilters,
  courseOfferingQueryKeys,
} from "@/services/course-offering-service"

/**
 * Hook to fetch paginated course offerings with filters
 */
export function useCourseOfferings(filters: CourseOfferingFilters = {}) {
  return useQuery({
    queryKey: courseOfferingQueryKeys.list(filters),
    queryFn: () => fetchCourseOfferings(filters),
  })
}

/**
 * Hook to fetch a single course offering by ID
 */
export function useCourseOffering(id: number | undefined) {
  return useQuery({
    queryKey: id ? courseOfferingQueryKeys.detail(id) : ["courseOfferings", "detail", "undefined"],
    queryFn: () => fetchCourseOfferingById(id!),
    enabled: !!id,
  })
}

/**
 * Hook for fetching courses (for filter options)
 */
export function useCourseOfferingCourses() {
  return useQuery({
    queryKey: courseOfferingQueryKeys.courses(),
    queryFn: async () => {
      const response = await fetchCourseOfferingCourses()
      if (!response.success) {
        throw new Error("Failed to fetch courses")
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Hook for fetching terms (for filter options)
 */
export function useCourseOfferingTerms() {
  return useQuery({
    queryKey: courseOfferingQueryKeys.terms(),
    queryFn: async () => {
      const response = await fetchCourseOfferingTerms()
      if (!response.success) {
        throw new Error("Failed to fetch terms")
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Hook for fetching instructors (for filter options)
 */
export function useCourseOfferingInstructors() {
  return useQuery({
    queryKey: courseOfferingQueryKeys.instructors(),
    queryFn: async () => {
      const response = await fetchCourseOfferingInstructors()
      if (!response.success) {
        throw new Error("Failed to fetch instructors")
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

// =============================================================================
// MODAL-SPECIFIC HOOKS (Always fetch fresh)
// =============================================================================

/**
 * Hook for fetching course offering data in modals (always fresh)
 */
export function useCourseOfferingForModal(id: number | undefined, modalOpen: boolean) {
  return useQuery({
    queryKey: id ? courseOfferingQueryKeys.detail(id) : ["courseOfferings", "detail", "undefined"],
    queryFn: () => fetchCourseOfferingById(id!),
    enabled: modalOpen && !!id,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000, // 1 hour
    // Don't use placeholderData - we want to show loading state for new offering
  })
}

/**
 * Hook for fetching courses in modals (always fresh)
 */
export function useCourseOfferingCoursesForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: courseOfferingQueryKeys.courses(),
    queryFn: async () => {
      const response = await fetchCourseOfferingCourses()
      if (!response.success) {
        throw new Error("Failed to fetch courses")
      }
      return response.data
    },
    enabled: modalOpen,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000, // 1 hour
    placeholderData: (previousData) => previousData, // Show cached data while fetching
  })
}

/**
 * Hook for fetching terms in modals (always fresh)
 */
export function useCourseOfferingTermsForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: courseOfferingQueryKeys.terms(),
    queryFn: async () => {
      const response = await fetchCourseOfferingTerms()
      if (!response.success) {
        throw new Error("Failed to fetch terms")
      }
      return response.data
    },
    enabled: modalOpen,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000, // 1 hour
    placeholderData: (previousData) => previousData, // Show cached data while fetching
  })
}

/**
 * Hook for fetching instructors in modals (always fresh)
 */
export function useCourseOfferingInstructorsForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: courseOfferingQueryKeys.instructors(),
    queryFn: async () => {
      const response = await fetchCourseOfferingInstructors()
      if (!response.success) {
        throw new Error("Failed to fetch instructors")
      }
      return response.data
    },
    enabled: modalOpen,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000, // 1 hour
    placeholderData: (previousData) => previousData, // Show cached data while fetching
  })
}

// =============================================================================
// MUTATION HOOKS
// =============================================================================

/**
 * Hook for creating a new course offering
 */
export function useCreateCourseOffering() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createCourseOffering,
    onSuccess: () => {
      // Invalidate course offerings list to reflect new offering
      queryClient.invalidateQueries({ queryKey: courseOfferingQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to create course offering:', error)
    }
  })
}

/**
 * Hook for updating a course offering
 */
export function useUpdateCourseOffering() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateCourseOffering>[1] }) =>
      updateCourseOffering(id, data),
    onSuccess: (_, { id }) => {
      // Invalidate the specific course offering detail
      queryClient.invalidateQueries({ queryKey: courseOfferingQueryKeys.detail(id) })
      
      // Also invalidate list to reflect changes
      queryClient.invalidateQueries({ queryKey: courseOfferingQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to update course offering:', error)
    }
  })
}

/**
 * Hook for deleting a course offering
 */
export function useDeleteCourseOffering() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteCourseOffering,
    onSuccess: (_, deletedId) => {
      // Remove the course offering from cache
      queryClient.removeQueries({ queryKey: courseOfferingQueryKeys.detail(deletedId) })
      
      // Invalidate course offerings list to reflect deletion
      queryClient.invalidateQueries({ queryKey: courseOfferingQueryKeys.lists() })
    },
    onError: (error) => {
      console.error('Failed to delete course offering:', error)
    }
  })
}
