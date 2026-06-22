import type { Employee } from '../components/employee-management/columns'
import { getAuthHeaders, buildQueryString, handleApiResponse } from '@/utils/api-helpers'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

/**
 * Employee API Response Types
 */
export interface EmployeesResponse {
  success: boolean
  data: Employee[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface EmployeeResponse {
  success: boolean
  data: Employee
}

/**
 * Query Parameters for Employee API
 */
export interface EmployeeFilters {
  search?: string
  department_id?: number
  position_type_id?: number
  status?: 'active' | 'inactive'
  role?: string
  created_date?: string
  hire_term?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface Role {
  id: number
  name: string
  description?: string
}

export interface TermType {
  id: number
  name: string
  start_date?: string
  end_date?: string
  is_current: boolean
}

export interface PositionType {
  id: number
  name: string
  description?: string
}

export interface DepartmentType {
  id: number
  name: string
  description?: string
}

export interface Position {
  id?: number
  position_type_id: number
  start_date: string
  end_date?: string
  status: 'active' | 'inactive'
  position_types?: {
    id: number
    name: string
    description?: string
  }
}

export interface PositionUpdateRequest {
  positions: Array<{
    id?: number
    position_type_id: number
    start_date: string
    end_date?: string
    status: 'active' | 'inactive'
  }>
}

export interface CreateEmployeeRequest {
  user_id: string
  employee_id: string
  hire_term_id?: number
  positions: Array<{
    position_type_id: number
    department_type_id?: number 
    start_date: string
    status: 'active' | 'inactive'
  }>
  roles: number[]
}

export interface RoleUpdateRequest {
  roleIds: number[]
}

export interface Position {
  id?: number
  position_type_id: number
  start_date: string
  end_date?: string
  status: 'active' | 'inactive'
  position_types?: {
    id: number
    name: string
    description?: string
  }
}

export interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  khmer_first_name?: string
  khmer_last_name?: string
  phone?: string
  avatar_url?: string
  date_of_birth?: string
  gender?: 'male' | 'female' | 'other'
  address?: string
}

export interface UsersResponse {
  success: boolean
  data: User[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
    excludedEmployees?: number
  }
}

/**
 * EMPLOYEE SERVICE FUNCTIONS
 */

/**
 * Fetch paginated employees with filtering and sorting
 */
export async function fetchEmployees(filters: EmployeeFilters = {}): Promise<EmployeesResponse> {
  const queryString = buildQueryString(filters)
  const url = `${API_BASE_URL}/api/employees${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<EmployeesResponse>(response)
}

/**
 * Fetch a single employee by ID
 */
export async function fetchEmployee(id: number): Promise<EmployeeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/employees/${id}`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<EmployeeResponse>(response)
}

/**
 * Delete an employee
 */
export async function deleteEmployee(id: number): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/employees/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(true) // Exclude Content-Type for DELETE without body
  })

  return handleApiResponse<{ success: boolean; message: string }>(response)
}

/**
 * Create a new employee
 */
export async function createEmployee(employeeData: CreateEmployeeRequest): Promise<{ success: boolean; message: string; data: { id: number } }> {
  const response = await fetch(`${API_BASE_URL}/api/employees`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(employeeData)
  })

  return handleApiResponse<{ success: boolean; message: string; data: { id: number } }>(response)
}

/**
 * Update employee roles
 */
export async function updateEmployeeRoles(employeeId: number, roles: RoleUpdateRequest): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/employees/${employeeId}/roles`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(roles)
  })

  return handleApiResponse<{ success: boolean; message: string }>(response)
}

/**
 * Update employee positions
 */
export async function updateEmployeePositions(employeeId: number, positions: PositionUpdateRequest): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/employees/${employeeId}/positions`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(positions)
  })

  return handleApiResponse<{ success: boolean; message: string }>(response)
}

/**
 * Fetch employee positions (if we need them separately)
 */
export async function fetchEmployeePositions(employeeId: number): Promise<{ success: boolean; data: Position[] }> {
  const response = await fetch(`${API_BASE_URL}/api/employees/${employeeId}/positions`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<{ success: boolean; data: Position[] }>(response)
}

/**
 * Fetch all roles for filter dropdown
 */
export async function fetchEmployeeRoles(): Promise<{ success: boolean; data: Role[] }> {
  const response = await fetch(`${API_BASE_URL}/api/employees/roles`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<{ success: boolean; data: Array<{ id: number; name: string; description?: string }> }>(response)
}

/**
 * Fetch assignable roles (respects user permissions for role assignment)
 */
export async function fetchAssignableRoles(): Promise<{ success: boolean; data: Role[] }> {
  const response = await fetch(`${API_BASE_URL}/api/employees/assignable-roles`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<{ success: boolean; data: Array<{ id: number; name: string; description?: string }> }>(response)
}

/**
 * Fetch all term types for filter dropdown
 */
export async function fetchEmployeeTermTypes(): Promise<{ success: boolean; data: TermType[] }> {
  const response = await fetch(`${API_BASE_URL}/api/employees/term-types`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<{ success: boolean; data: Array<{ id: number; name: string; start_date?: string; end_date?: string; is_current: boolean }> }>(response)
}

/**
 * Fetch all position types for filter dropdown
 */
export async function fetchEmployeePositionTypes(): Promise<{ success: boolean; data: PositionType[] }> {
  const response = await fetch(`${API_BASE_URL}/api/employees/position-types`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<{ success: boolean; data: Array<{ id: number; name: string; description?: string }> }>(response)
}

/**
 * Fetch all department types for filter dropdown
 */
export async function fetchEmployeeDepartmentTypes(): Promise<{ success: boolean; data: DepartmentType[] }> {
  const response = await fetch(`${API_BASE_URL}/api/employees/department-types`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<{ success: boolean; data: Array<{ id: number; name: string; description?: string }> }>(response)
}

/**
 * Fetch users available for employee creation (HR context)
 */
export async function fetchAvailableUsers(filters: { search?: string; limit?: number } = {}): Promise<UsersResponse> {
  const queryString = buildQueryString(filters)
  
  const response = await fetch(`${API_BASE_URL}/api/employees/available-users?${queryString}`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<UsersResponse>(response)
}

/**
 * QUERY KEYS FOR TANSTACK QUERY
 */
export const employeeQueryKeys = {
  all: ['employees'] as const,
  lists: () => [...employeeQueryKeys.all, 'list'] as const,
  list: (filters: EmployeeFilters) => [...employeeQueryKeys.lists(), filters] as const,
  details: () => [...employeeQueryKeys.all, 'detail'] as const,
  detail: (id: number) => [...employeeQueryKeys.details(), id] as const,
  positions: (employeeId: number) => [...employeeQueryKeys.all, 'positions', employeeId] as const,
  roles: () => [...employeeQueryKeys.all, 'roles'] as const,
  assignableRoles: () => [...employeeQueryKeys.all, 'assignableRoles'] as const,
  termTypes: () => [...employeeQueryKeys.all, 'termTypes'] as const,
  positionTypes: () => [...employeeQueryKeys.all, 'positionTypes'] as const,
  departmentTypes: () => [...employeeQueryKeys.all, 'departmentTypes'] as const,
  availableUsers: (filters?: { search?: string; limit?: number }) => [...employeeQueryKeys.all, 'availableUsers', filters] as const,
}
