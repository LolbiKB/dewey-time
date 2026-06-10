import { useQuery } from '@tanstack/react-query'
import { getAuthHeaders } from '@/lib/auth-token'

const API_URL = import.meta.env.VITE_API_URL || ''

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
      const response = await fetch(`${API_URL}/admin/frappe-branches`, {
        headers: await getAuthHeaders(),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json()
      if (!result.success) throw new Error(result.error || 'Failed to fetch branches')
      return result.data
    },
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 24,
  })
}