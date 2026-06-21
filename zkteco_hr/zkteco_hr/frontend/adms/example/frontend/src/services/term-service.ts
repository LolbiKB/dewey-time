// API configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

// Import types from validation schema
import type { CreateTermInput } from '@/schemas/term-validation'
import { getAuthHeaders, buildQueryString, handleApiResponse } from '@/utils/api-helpers'

// Re-export for convenience
export type { CreateTermInput }

export interface Term {
  id: number
  name: string
  start_date: string | null
  end_date: string | null
  description: string | null
  is_current: boolean
}

export interface TermFilters {
  search?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface PaginatedTermResponse {
  data: Term[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

/**
 * Fetch all terms with filtering, pagination, and sorting
 */
export async function fetchTerms(filters: TermFilters = {}): Promise<PaginatedTermResponse> {
  const queryString = buildQueryString(filters)
  const url = `${API_BASE_URL}/api/terms${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(true), // Exclude Content-Type for GET request
  })
  
  return handleApiResponse<PaginatedTermResponse>(response)
}

/**
 * Create a new term
 */
export async function createTerm(term: CreateTermInput): Promise<Term> {
  const response = await fetch(`${API_BASE_URL}/api/terms`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(term),
  })
  
  const result = await handleApiResponse<{ success: boolean; data: Term }>(response)
  return result.data
}

/**
 * Update an existing term
 */
export async function updateTerm(id: number, term: Partial<CreateTermInput>): Promise<Term> {
  const response = await fetch(`${API_BASE_URL}/api/terms/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(term),
  })
  
  const result = await handleApiResponse<{ success: boolean; data: Term }>(response)
  return result.data
}

/**
 * Delete a term
 */
export async function deleteTerm(id: number): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/terms/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(true), // Exclude Content-Type for DELETE request
  })
  
  return handleApiResponse<{ success: boolean; message: string }>(response)
}

/**
 * Fetch a single term by ID
 */
export async function fetchTermById(id: number): Promise<Term> {
  const response = await fetch(`${API_BASE_URL}/api/terms/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(true), // Exclude Content-Type for GET request
  })
  
  const result = await handleApiResponse<{ success: boolean; data: Term }>(response)
  return result.data
}

/**
 * Set a term as the active/current term
 */
export async function setActiveTerm(id: number): Promise<Term> {
  const response = await fetch(`${API_BASE_URL}/api/terms/${id}/set-active`, {
    method: 'PUT',
    headers: getAuthHeaders(true), // No body needed for this endpoint
  })
  
  const result = await handleApiResponse<{ success: boolean; data: Term; message?: string }>(response)
  return result.data
}

/**
 * Get the currently active term
 */
export async function fetchCurrentTerm(): Promise<Term | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/terms/current`, {
      method: 'GET',
      headers: getAuthHeaders(true), // Exclude Content-Type for GET request
    })
    
    if (response.status === 404) {
      return null // No active term found
    }
    
    const result = await handleApiResponse<{ success: boolean; data: Term }>(response)
    return result.data
  } catch (error) {
    // If no active term exists, return null instead of throwing
    if (error instanceof Error && error.message.includes('404')) {
      return null
    }
    throw error
  }
}

/**
 * Query keys for React Query cache management
 */
export const termQueryKeys = {
  all: ['terms'] as const,
  lists: () => [...termQueryKeys.all, 'list'] as const,
  list: (filters: TermFilters) => [...termQueryKeys.lists(), filters] as const,
  details: () => [...termQueryKeys.all, 'detail'] as const,
  detail: (id: number) => [...termQueryKeys.details(), id] as const,
}
