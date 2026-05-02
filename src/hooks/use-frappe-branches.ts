import { useQuery } from '@tanstack/react-query'

interface BranchOption {
  value: string
  label: string
}

export const frappeBranchKeys = {
  all: ['frappe-branches'] as const,
}

export function useFrappeBranches() {
  return useQuery({
    queryKey: frappeBranchKeys.all,
    queryFn: async (): Promise<BranchOption[]> => {
      // Branches come from Frappe HR - not stored locally
      // Returns empty for now - can be extended with Fastify route to fetch from Frappe
      return []
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 24, // 24 hours
  })
}