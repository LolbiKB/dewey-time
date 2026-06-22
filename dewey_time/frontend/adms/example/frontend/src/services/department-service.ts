const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

import { getAuthHeaders, buildQueryString, handleApiResponse } from '@/utils/api-helpers'

export interface Department {
  id: number
  name: string
  description?: string
}

export interface DepartmentFilters {
  search?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface PaginatedDepartmentResponse {
  data: Department[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export async function fetchDepartments(filters: DepartmentFilters = {}): Promise<PaginatedDepartmentResponse> {
  const queryString = buildQueryString(filters)

  const response = await fetch(`${API_BASE_URL}/api/departments${queryString ? `?${queryString}` : ''}`, {
    method: 'GET',
    headers: getAuthHeaders(true), // Exclude Content-Type for GET request
  })
  
  return handleApiResponse<PaginatedDepartmentResponse>(response)
}

export async function createDepartment(department: Omit<Department, 'id'>): Promise<Department> {
  const response = await fetch(`${API_BASE_URL}/api/departments`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(department),
  })
  
  const result = await handleApiResponse<{ success: boolean; data: Department }>(response)
  return result.data
}

export async function updateDepartment(id: number, department: Partial<Department>): Promise<Department> {
  const response = await fetch(`${API_BASE_URL}/api/departments/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(department),
  })
  
  const result = await handleApiResponse<{ success: boolean; data: Department }>(response)
  return result.data
}

export async function deleteDepartment(id: number): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/departments/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(true), // Exclude Content-Type for DELETE request
  })
  
  return handleApiResponse<{ success: boolean; message: string }>(response)
}

export async function fetchDepartmentById(id: number): Promise<Department> {
  const response = await fetch(`${API_BASE_URL}/api/departments/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(true), // Exclude Content-Type for GET request
  })
  
  const result = await handleApiResponse<{ success: boolean; data: Department }>(response)
  return result.data
}

export const departmentQueryKeys = {
  all: ['departments'] as const,
  lists: () => [...departmentQueryKeys.all, 'list'] as const,
  list: (filters: DepartmentFilters) => [...departmentQueryKeys.lists(), filters] as const,
  details: () => [...departmentQueryKeys.all, 'detail'] as const,
  detail: (id: number) => [...departmentQueryKeys.details(), id] as const,
}