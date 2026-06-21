import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  fetchCourses,
  fetchCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  fetchCourseDepartmentTypes,
  type CourseFilters,
} from "@/services/course-service"
import type { CourseFormData } from "@/schemas/course-validation"

// Query keys
export const COURSE_KEYS = {
  all: ["courses"] as const,
  lists: () => [...COURSE_KEYS.all, "list"] as const,
  list: (filters: CourseFilters) => [...COURSE_KEYS.lists(), filters] as const,
  details: () => [...COURSE_KEYS.all, "detail"] as const,
  detail: (id: number) => [...COURSE_KEYS.details(), id] as const,
}

/**
 * Hook to fetch paginated courses with filters
 */
export function useCourses(filters: CourseFilters = {}) {
  return useQuery({
    queryKey: COURSE_KEYS.list(filters),
    queryFn: () => fetchCourses(filters),
  })
}

/**
 * Hook to fetch a single course by ID
 */
export function useCourse(id: number | undefined) {
  return useQuery({
    queryKey: COURSE_KEYS.detail(id!),
    queryFn: () => fetchCourseById(id!),
    enabled: !!id,
  })
}

/**
 * Hook to create a new course
 */
export function useCreateCourse() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (course: CourseFormData) => createCourse(course),
    onSuccess: () => {
      // Invalidate and refetch courses list
      queryClient.invalidateQueries({ queryKey: COURSE_KEYS.lists() })
    },
  })
}

/**
 * Hook to update an existing course
 */
export function useUpdateCourse() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, course }: { id: number; course: Partial<CourseFormData> }) =>
      updateCourse(id, course),
    onSuccess: (_, variables) => {
      // Invalidate specific course and lists
      queryClient.invalidateQueries({ queryKey: COURSE_KEYS.detail(variables.id) })
      queryClient.invalidateQueries({ queryKey: COURSE_KEYS.lists() })
    },
  })
}

/**
 * Hook to delete a course
 */
export function useDeleteCourse() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteCourse(id),
    onSuccess: () => {
      // Invalidate courses list after deletion
      queryClient.invalidateQueries({ queryKey: COURSE_KEYS.lists() })
    },
  })
}

/**
 * Hook for fetching department types (for filter options)
 */
export function useCourseDepartmentTypes() {
  return useQuery({
    queryKey: ["courseDepartmentTypes"],
    queryFn: async () => {
      const response = await fetchCourseDepartmentTypes()
      if (!response.success) {
        throw new Error("Failed to fetch department types")
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
 * Hook for fetching course data in modals (always fresh)
 */
export function useCourseForModal(id: number | undefined, modalOpen: boolean) {
  return useQuery({
    queryKey: COURSE_KEYS.detail(id!),
    queryFn: () => fetchCourseById(id!),
    enabled: modalOpen && !!id,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    // Don't use placeholderData - we want to show loading state for new course
  })
}

/**
 * Hook for fetching department types in modals (always fresh)
 */
export function useCourseDepartmentTypesForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: ["courseDepartmentTypes"],
    queryFn: async () => {
      const response = await fetchCourseDepartmentTypes()
      if (!response.success) {
        throw new Error("Failed to fetch department types")
      }
      return response.data
    },
    enabled: modalOpen,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  })
}
