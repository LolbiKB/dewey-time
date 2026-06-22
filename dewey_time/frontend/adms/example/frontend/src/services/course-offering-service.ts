import { getAuthHeaders, buildQueryString, handleApiResponse } from "@/utils/api-helpers"
import type { CourseOffering } from "@/components/course-offering-management/columns"

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

export interface CourseOfferingFilters {
  search?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
  term_id?: number
  instructor_id?: number
  course_id?: number
  status?: string
}

export interface PaginatedCourseOfferingResponse {
  data: CourseOffering[]
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
 * Fetch course offerings with filters and pagination
 */
export async function fetchCourseOfferings(
  filters: CourseOfferingFilters = {}
): Promise<PaginatedCourseOfferingResponse> {
  const queryString = buildQueryString(filters)
  const url = `${API_BASE_URL}/api/course-offerings${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
  })

  return handleApiResponse(response)
}

/**
 * Fetch a single course offering by ID
 */
export async function fetchCourseOfferingById(id: number): Promise<{ success: boolean; data: CourseOffering }> {
  const url = `${API_BASE_URL}/api/course-offerings/${id}`

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
  })

  return handleApiResponse(response)
}

/**
 * Fetch all courses for filter dropdown
 */
export async function fetchCourseOfferingCourses(): Promise<{ success: boolean; data: Array<{ id: number; course_code: string; course_name: string }> }> {
  const url = `${API_BASE_URL}/api/course-offerings/courses`

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
  })

  return handleApiResponse(response)
}

/**
 * Fetch all terms for filter dropdown
 */
export async function fetchCourseOfferingTerms(): Promise<{ success: boolean; data: Array<{ id: number; name: string; start_date: string; end_date: string; is_active: boolean }> }> {
  const url = `${API_BASE_URL}/api/course-offerings/terms`

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
  })

  return handleApiResponse(response)
}

/**
 * Fetch all instructors for filter dropdown
 */
export async function fetchCourseOfferingInstructors(): Promise<{ success: boolean; data: Array<{ id: number; employee_id: string; first_name: string; last_name: string }> }> {
  const url = `${API_BASE_URL}/api/course-offerings/instructors`

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
  })

  return handleApiResponse(response)
}

/**
 * Create a new course offering
 */
export async function createCourseOffering(data: {
  course_id: number
  term_id: number
  section: string
  instructor_id?: number | null
  location?: string | null
  min_enrollment?: number | null
  max_enrollment?: number | null
  status: 'active' | 'completed' | 'cancelled'
  schedules: Array<{
    day_of_week: number
    start_time: string
    end_time: string
  }>
  google_classroom_id?: string | null
}): Promise<{ success: boolean; message: string; data: { id: number; courseOffering: CourseOffering } }> {
  const url = `${API_BASE_URL}/api/course-offerings`

  const response = await fetch(url, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data)
  })

  return handleApiResponse(response)
}

/**
 * Update an existing course offering
 */
export async function updateCourseOffering(id: number, data: {
  course_id?: number
  term_id?: number
  section?: string
  instructor_id?: number | null
  location?: string | null
  min_enrollment?: number | null
  max_enrollment?: number | null
  status?: 'active' | 'completed' | 'cancelled'
  schedules?: Array<{
    day_of_week: number
    start_time: string
    end_time: string
  }>
  google_classroom_id?: string | null
}): Promise<{ success: boolean; message: string; data: CourseOffering }> {
  const url = `${API_BASE_URL}/api/course-offerings/${id}`

  const response = await fetch(url, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(data)
  })

  return handleApiResponse(response)
}

/**
 * Delete a course offering
 */
export async function deleteCourseOffering(id: number): Promise<{ success: boolean; message: string }> {
  const url = `${API_BASE_URL}/api/course-offerings/${id}`

  const response = await fetch(url, {
    method: 'DELETE',
    headers: getAuthHeaders(true) // Exclude Content-Type for DELETE without body
  })

  return handleApiResponse(response)
}

// Query keys for React Query
export const courseOfferingQueryKeys = {
  all: ['courseOfferings'] as const,
  lists: () => [...courseOfferingQueryKeys.all, 'list'] as const,
  list: (filters: CourseOfferingFilters) => [...courseOfferingQueryKeys.lists(), filters] as const,
  details: () => [...courseOfferingQueryKeys.all, 'detail'] as const,
  detail: (id: number) => [...courseOfferingQueryKeys.details(), id] as const,
  courses: () => ['courseOfferingCourses'] as const,
  terms: () => ['courseOfferingTerms'] as const,
  instructors: () => ['courseOfferingInstructors'] as const,
}
