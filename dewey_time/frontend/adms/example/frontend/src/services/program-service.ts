import type { Program } from "@/components/program-management/columns"
import { getAuthHeaders, buildQueryString, handleApiResponse } from "@/utils/api-helpers"

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

export interface ProgramFilters {
  search?: string
  page?: number
  limit?: number
  sort?: string
  order?: "asc" | "desc"
  department_id?: number
  degree_id?: number
}

export interface PaginatedProgramResponse {
  data: Program[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface CreateProgramInput {
  major: string
  description?: string | null
  department_type_id?: number | null
  degree_id?: number | null
}

export interface DegreeType {
  id: number
  name: string
  abbreviation: string | null
}

export interface DepartmentType {
  id: number
  name: string
  description?: string | null
}

/**
 * Fetch programs with filters and pagination
 */
export async function fetchPrograms(
  filters: ProgramFilters = {}
): Promise<PaginatedProgramResponse> {
  const queryString = buildQueryString(filters)
  const url = `${API_BASE_URL}/api/programs${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url, {
    headers: getAuthHeaders(),
  })

  return handleApiResponse<PaginatedProgramResponse>(response)
}

/**
 * Fetch a single program by ID
 */
export async function fetchProgramById(id: number): Promise<Program> {
  const response = await fetch(`${API_BASE_URL}/api/programs/${id}`, {
    headers: getAuthHeaders(),
  })

  const result = await handleApiResponse<{ success: boolean; data: Program }>(response)
  return result.data
}

/**
 * Create a new program
 */
export async function createProgram(
  program: CreateProgramInput
): Promise<Program> {
  const response = await fetch(`${API_BASE_URL}/api/programs`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(program),
  })

  const result = await handleApiResponse<{ success: boolean; data: Program }>(response)
  return result.data
}

/**
 * Update an existing program
 */
export async function updateProgram(
  id: number,
  program: Partial<CreateProgramInput>
): Promise<Program> {
  const response = await fetch(`${API_BASE_URL}/api/programs/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(program),
  })

  const result = await handleApiResponse<{ success: boolean; data: Program }>(response)
  return result.data
}

/**
 * Delete a program
 */
export async function deleteProgram(
  id: number
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/programs/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(true), // Exclude Content-Type for DELETE without body
  })

  return handleApiResponse<{ success: boolean; message: string }>(response)
}

/**
 * Fetch all degree types for filter dropdown
 */
export async function fetchProgramDegreeTypes(): Promise<{ success: boolean; data: DegreeType[] }> {
  const response = await fetch(`${API_BASE_URL}/api/programs/degree-types`, {
    headers: getAuthHeaders(),
  })

  return handleApiResponse<{ success: boolean; data: DegreeType[] }>(response)
}

/**
 * Fetch all department types for filter dropdown
 */
export async function fetchProgramDepartmentTypes(): Promise<{ success: boolean; data: DepartmentType[] }> {
  const response = await fetch(`${API_BASE_URL}/api/programs/department-types`, {
    headers: getAuthHeaders(),
  })

  return handleApiResponse<{ success: boolean; data: DepartmentType[] }>(response)
}

/**
 * QUERY KEYS FOR TANSTACK QUERY
 */
export const programQueryKeys = {
  all: ['programs'] as const,
  lists: () => [...programQueryKeys.all, 'list'] as const,
  list: (filters: ProgramFilters) => [...programQueryKeys.lists(), filters] as const,
  details: () => [...programQueryKeys.all, 'detail'] as const,
  detail: (id: number) => [...programQueryKeys.details(), id] as const,
  degreeTypes: () => [...programQueryKeys.all, 'degreeTypes'] as const,
  departmentTypes: () => [...programQueryKeys.all, 'departmentTypes'] as const,
}
