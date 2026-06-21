import type { Student } from '../components/student-management/columns'
import { getAuthHeaders, buildQueryString, handleApiResponse } from '@/utils/api-helpers'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

/**
 * Student API Response Types
 */
export interface StudentsResponse {
  success: boolean
  data: Student[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface StudentResponse {
  success: boolean
  data: Student
}

/**
 * Query Parameters for Student API
 */
export interface StudentFilters {
  search?: string
  program_id?: number
  status?: 'active' | 'inactive' | 'completed'
  admission_term?: string
  created_date?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface Program {
  id: number
  major: string
  description?: string
  degree: {
    id: number
    name: string
    abbreviation?: string
  }
  department_type_id?: number
}

export interface TermType {
  id: number
  name: string
  start_date?: string
  end_date?: string
  is_current: boolean
}

/**
 * STUDENT SERVICE FUNCTIONS
 */

/**
 * Fetch paginated students with filtering and sorting
 */
export async function fetchStudents(filters: StudentFilters = {}): Promise<StudentsResponse> {
  const queryString = buildQueryString(filters)
  const url = `${API_BASE_URL}/api/students${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<StudentsResponse>(response)
}

/**
 * Fetch a single student by ID
 */
export async function fetchStudent(id: number): Promise<StudentResponse> {
  const response = await fetch(`${API_BASE_URL}/api/students/${id}`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<StudentResponse>(response)
}

/**
 * Fetch all programs for filter dropdown (with degree info)
 */
export async function fetchStudentPrograms(): Promise<{ success: boolean; data: Program[] }> {
  const response = await fetch(`${API_BASE_URL}/api/students/programs`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<{ success: boolean; data: Program[] }>(response)
}

/**
 * Fetch all term types for filter dropdown (admission terms)
 */
export async function fetchStudentTermTypes(): Promise<{ success: boolean; data: TermType[] }> {
  const response = await fetch(`${API_BASE_URL}/api/students/term-types`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<{ success: boolean; data: Array<{ id: number; name: string; start_date?: string; end_date?: string; is_current: boolean }> }>(response)
}

/**
 * Fetch users available for student enrollment
 */
export async function fetchAvailableUsers(filters: { search?: string; limit?: number } = {}): Promise<any> {
  const queryString = buildQueryString(filters)
  
  const response = await fetch(`${API_BASE_URL}/api/students/available-users?${queryString}`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<any>(response)
}

/**
 * Create a new student
 */
export async function createStudent(studentData: {
  user_id: string
  student_id: string
  admission_term_id?: number
  initial_program?: {
    program_id: number
    start_date: string
  }
}): Promise<{ success: boolean; message: string; data: { id: number; student: Student } }> {
  const response = await fetch(`${API_BASE_URL}/api/students`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(studentData)
  })

  return handleApiResponse<{ success: boolean; message: string; data: { id: number; student: Student } }>(response)
}

/**
 * Delete a student
 */
export async function deleteStudent(id: number): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/students/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(true) // Exclude Content-Type for DELETE without body
  })

  return handleApiResponse<{ success: boolean; message: string }>(response)
}

/**
 * Update student programs
 */
export interface ProgramUpdateRequest {
  programs: Array<{
    id?: number
    program_id: number
    start_date: string
    end_date?: string
    status: 'active' | 'inactive' | 'completed'
  }>
}

export async function updateStudentPrograms(studentId: number, programs: ProgramUpdateRequest): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/programs`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(programs)
  })

  return handleApiResponse<{ success: boolean; message: string }>(response)
}

/**
 * QUERY KEYS FOR TANSTACK QUERY
 */
export const studentQueryKeys = {
  all: ['students'] as const,
  lists: () => [...studentQueryKeys.all, 'list'] as const,
  list: (filters: StudentFilters) => [...studentQueryKeys.lists(), filters] as const,
  details: () => [...studentQueryKeys.all, 'detail'] as const,
  detail: (id: number) => [...studentQueryKeys.details(), id] as const,
  programs: () => [...studentQueryKeys.all, 'programs'] as const,
  termTypes: () => [...studentQueryKeys.all, 'termTypes'] as const,
  availableUsers: (filters?: { search?: string; limit?: number }) => [...studentQueryKeys.all, 'availableUsers', filters] as const,
}
