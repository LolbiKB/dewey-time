import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  fetchTerms,
  fetchTermById,
  fetchCurrentTerm,
  createTerm,
  updateTerm,
  deleteTerm,
  setActiveTerm,
  termQueryKeys,
  type TermFilters,
  type CreateTermInput,
} from '@/services/term-service'

export function useTerms(filters: TermFilters = {}) {
  return useQuery({
    queryKey: termQueryKeys.list(filters),
    queryFn: async () => {
      const data = await fetchTerms(filters)
      return data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useTerm(id: number, enabled = true, options?: { staleTime?: number }) {
  return useQuery({
    queryKey: termQueryKeys.detail(id),
    queryFn: async () => {
      const data = await fetchTermById(id)
      return data
    },
    enabled: enabled && !!id,
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5 minutes default
  })
}

export function useCreateTerm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createTerm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: termQueryKeys.all })
    },
  })
}

export function useUpdateTerm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, term }: { id: number; term: Partial<CreateTermInput> }) =>
      updateTerm(id, term),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: termQueryKeys.all })
    },
  })
}

export function useDeleteTerm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteTerm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: termQueryKeys.all })
    },
  })
}

export function useSetActiveTerm() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: setActiveTerm,
    onSuccess: () => {
      // Invalidate all term queries to refresh the is_current status
      queryClient.invalidateQueries({ queryKey: termQueryKeys.all })
    },
  })
}

export function useCurrentTerm() {
  return useQuery({
    queryKey: [...termQueryKeys.all, 'current'],
    queryFn: fetchCurrentTerm,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// =============================================================================
// MODAL-SPECIFIC HOOKS (Always fetch fresh)
// =============================================================================

/**
 * Hook for fetching term data in modals (always fresh)
 */
export function useTermForModal(id: number, modalOpen: boolean) {
  return useQuery({
    queryKey: termQueryKeys.detail(id),
    queryFn: async () => {
      const data = await fetchTermById(id)
      return data
    },
    enabled: modalOpen && !!id,
    staleTime: 0, // Always fetch fresh when modal opens
    gcTime: 60 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  })
}
