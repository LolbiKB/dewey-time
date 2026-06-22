import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  fetchPrograms,
  fetchProgramById,
  createProgram,
  updateProgram,
  deleteProgram,
  fetchProgramDegreeTypes,
  fetchProgramDepartmentTypes,
  type ProgramFilters,
  type CreateProgramInput,
} from "@/services/program-service"

// Query keys
export const PROGRAM_KEYS = {
  all: ["programs"] as const,
  lists: () => [...PROGRAM_KEYS.all, "list"] as const,
  list: (filters: ProgramFilters) =>
    [...PROGRAM_KEYS.lists(), filters] as const,
  details: () => [...PROGRAM_KEYS.all, "detail"] as const,
  detail: (id: number) => [...PROGRAM_KEYS.details(), id] as const,
}

// Fetch programs with filters
export function usePrograms(filters: ProgramFilters = {}) {
  return useQuery({
    queryKey: PROGRAM_KEYS.list(filters),
    queryFn: () => fetchPrograms(filters),
  })
}

// Fetch single program by ID
export function useProgram(id: number | undefined) {
  return useQuery({
    queryKey: PROGRAM_KEYS.detail(id!),
    queryFn: () => fetchProgramById(id!),
    enabled: !!id,
  })
}

// Create program mutation
export function useCreateProgram() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (program: CreateProgramInput) => createProgram(program),
    onSuccess: () => {
      // Invalidate and refetch programs list
      queryClient.invalidateQueries({ queryKey: PROGRAM_KEYS.lists() })
    },
  })
}

// Update program mutation
export function useUpdateProgram() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateProgramInput> }) =>
      updateProgram(id, data),
    onSuccess: (_, variables) => {
      // Invalidate specific program and lists
      queryClient.invalidateQueries({ queryKey: PROGRAM_KEYS.detail(variables.id) })
      queryClient.invalidateQueries({ queryKey: PROGRAM_KEYS.lists() })
    },
  })
}

// Delete program mutation
export function useDeleteProgram() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => deleteProgram(id),
    onSuccess: () => {
      // Invalidate programs list
      queryClient.invalidateQueries({ queryKey: PROGRAM_KEYS.lists() })
    },
  })
}

/**
 * Hook for fetching degree types (for filter options)
 */
export function useProgramDegreeTypes() {
  return useQuery({
    queryKey: ["programDegreeTypes"],
    queryFn: async () => {
      const response = await fetchProgramDegreeTypes()
      if (!response.success) {
        throw new Error("Failed to fetch degree types")
      }
      return response.data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}

/**
 * Hook for fetching department types (for filter options)
 */
export function useProgramDepartmentTypes() {
  return useQuery({
    queryKey: ["programDepartmentTypes"],
    queryFn: async () => {
      const response = await fetchProgramDepartmentTypes()
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
 * Hook for fetching program data in modals (always fresh)
 */
export function useProgramForModal(id: number | undefined, modalOpen: boolean) {
  return useQuery({
    queryKey: PROGRAM_KEYS.detail(id!),
    queryFn: () => fetchProgramById(id!),
    enabled: modalOpen && !!id,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    // Don't use placeholderData - we want to show loading state for new program
  })
}

/**
 * Hook for fetching degree types in modals (always fresh)
 */
export function useProgramDegreeTypesForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: ["programDegreeTypes"],
    queryFn: async () => {
      const response = await fetchProgramDegreeTypes()
      if (!response.success) {
        throw new Error("Failed to fetch degree types")
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
export function useProgramDepartmentTypesForModal(modalOpen: boolean) {
  return useQuery({
    queryKey: ["programDepartmentTypes"],
    queryFn: async () => {
      const response = await fetchProgramDepartmentTypes()
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
