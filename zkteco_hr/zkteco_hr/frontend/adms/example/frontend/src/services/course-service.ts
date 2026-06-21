import { getAuthHeaders, buildQueryString, handleApiResponse } from "@/utils/api-helpers"
import type { Course } from "@/components/course-management/columns"

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

export interface CourseFilters {
  search?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
  department_id?: number
  status?: string
}

export interface PaginatedCourseResponse {
  data: Course[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface CreateCourseInput {
  course_code: string
  course_name: string
  description?: string | null
  credits: number
  department_type_id?: number | null
  status: 'active' | 'inactive' | 'archived'
}

export interface DepartmentType {
  id: number
  name: string
  description: string | null
}

/**
 * Fetch courses with filters and pagination
 */
export async function fetchCourses(
  filters: CourseFilters = {}
): Promise<PaginatedCourseResponse> {
  const queryString = buildQueryString(filters)
  const url = `${API_BASE_URL}/api/courses${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url, {
    headers: getAuthHeaders(),
  })

  return handleApiResponse<PaginatedCourseResponse>(response)
}

/**
 * Fetch a single course by ID
 */
export async function fetchCourseById(id: number): Promise<Course> {
  const response = await fetch(`${API_BASE_URL}/api/courses/${id}`, {
    headers: getAuthHeaders(),
  })

  const result = await handleApiResponse<{ success: boolean; data: Course }>(response)
  return result.data
}

/**
 * Create a new course
 */
export async function createCourse(
  course: CreateCourseInput
): Promise<Course> {
  const response = await fetch(`${API_BASE_URL}/api/courses`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(course),
  })

  const result = await handleApiResponse<{ success: boolean; data: Course }>(response)
  return result.data
}

/**
 * Update an existing course
 */
export async function updateCourse(
  id: number,
  course: Partial<CreateCourseInput>
): Promise<Course> {
  const response = await fetch(`${API_BASE_URL}/api/courses/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(course),
  })

  const result = await handleApiResponse<{ success: boolean; data: Course }>(response)
  return result.data
}

/**
 * Delete a course
 */
export async function deleteCourse(
  id: number
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/courses/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(true), // Exclude Content-Type for DELETE without body
  })

  return handleApiResponse<{ success: boolean; message: string }>(response)
}

/**
 * Fetch all department types for filter dropdown
 */
export async function fetchCourseDepartmentTypes(): Promise<{ success: boolean; data: DepartmentType[] }> {
  const response = await fetch(`${API_BASE_URL}/api/courses/departments`, {
    headers: getAuthHeaders(),
  })

  return handleApiResponse<{ success: boolean; data: DepartmentType[] }>(response)
}

/**
 * QUERY KEYS FOR TANSTACK QUERY
 */
export const courseQueryKeys = {
  all: ['courses'] as const,
  lists: () => [...courseQueryKeys.all, 'list'] as const,
  list: (filters: CourseFilters) => [...courseQueryKeys.lists(), filters] as const,
  details: () => [...courseQueryKeys.all, 'detail'] as const,
  detail: (id: number) => [...courseQueryKeys.details(), id] as const,
  departmentTypes: () => [...courseQueryKeys.all, 'departmentTypes'] as const,
}
