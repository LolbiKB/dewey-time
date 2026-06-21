import type { User } from '../components/user-management/columns'
import type { BaseFilters } from '@/components/ui/generic-data-table'
import { getAuthHeaders, buildQueryString, handleApiResponse } from '@/utils/api-helpers'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

/**
 * User API Response Types
 */
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
  }
}

export interface UserResponse {
  success: boolean
  data: User
}

/**
 * Query Parameters for User API
 */
export interface UserFilters extends BaseFilters {
  // User-specific filters
  search?: string
  email?: string
  firstName?: string
  lastName?: string
  gender?: 'male' | 'female' | 'other'
  
  // Date ranges
  createdAfter?: string
  createdBefore?: string
  dateOfBirthAfter?: string
  dateOfBirthBefore?: string
}

/**
 * User Mutation Types
 */
export interface CreateUserData {
  email: string
  firstName: string
  lastName: string
  khmerFirstName?: string
  khmerLastName?: string
  gender?: 'male' | 'female' | 'other'
  phone?: string
  dateOfBirth?: string
  address?: string
  avatar?: File
}

export interface UpdateUserData extends Partial<CreateUserData> {
  id: string
  clearAvatar?: boolean
  avatarUrl?: string // For displaying existing avatar
}

/**
 * USER SERVICE FUNCTIONS
 */

/**
 * Fetch paginated users with filtering and sorting
 */
export async function fetchUsers(filters: UserFilters = {}): Promise<UsersResponse> {
  const queryString = buildQueryString(filters)
  const url = `${API_BASE_URL}/api/users${queryString ? `?${queryString}` : ''}`

  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<UsersResponse>(response)
}

/**
 * Fetch a single user by ID
 */
export async function fetchUser(id: string): Promise<UserResponse> {
  const response = await fetch(`${API_BASE_URL}/api/users/${id}`, {
    method: 'GET',
    headers: getAuthHeaders()
  })

  return handleApiResponse<UserResponse>(response)
}

/**
 * Create a new user
 */
export async function createUser(userData: CreateUserData): Promise<UserResponse> {
  // Always use FormData to match backend multipart expectation
  const formData = new FormData()
  
  // Add all text fields
  formData.append('email', userData.email)
  formData.append('firstName', userData.firstName)
  formData.append('lastName', userData.lastName)
  
  // Add optional fields only if they have values
  if (userData.khmerFirstName) formData.append('khmerFirstName', userData.khmerFirstName)
  if (userData.khmerLastName) formData.append('khmerLastName', userData.khmerLastName)
  if (userData.gender) formData.append('gender', userData.gender)
  if (userData.phone) formData.append('phone', userData.phone)
  if (userData.dateOfBirth) formData.append('dateOfBirth', userData.dateOfBirth)
  if (userData.address) formData.append('address', userData.address)
  
  // Add avatar file if present
  if (userData.avatar) {
    formData.append('avatar', userData.avatar)
  }
  
  const response = await fetch(`${API_BASE_URL}/api/users`, {
    method: 'POST',
    headers: getAuthHeaders(true), // Exclude Content-Type for FormData
    body: formData
  })
  
  return handleApiResponse<UserResponse>(response)
}

/**
 * Update an existing user
 */
export async function updateUser(userData: UpdateUserData): Promise<UserResponse> {
  const { id, avatarUrl, ...updateData } = userData
  
  // Always use FormData to match backend multipart expectation
  const formData = new FormData()
  
  // Add all text fields only if they are provided (partial update)
  if (updateData.email !== undefined) formData.append('email', updateData.email)
  if (updateData.firstName !== undefined) formData.append('firstName', updateData.firstName)
  if (updateData.lastName !== undefined) formData.append('lastName', updateData.lastName)
  if (updateData.khmerFirstName !== undefined) formData.append('khmerFirstName', updateData.khmerFirstName || '')
  if (updateData.khmerLastName !== undefined) formData.append('khmerLastName', updateData.khmerLastName || '')
  if (updateData.gender !== undefined) formData.append('gender', updateData.gender || '')
  if (updateData.phone !== undefined) formData.append('phone', updateData.phone || '')
  if (updateData.dateOfBirth !== undefined) formData.append('dateOfBirth', updateData.dateOfBirth || '')
  if (updateData.address !== undefined) formData.append('address', updateData.address || '')
  
  // Handle avatar update
  if (updateData.avatar instanceof File) {
    formData.append('avatar', updateData.avatar)
  } else if (updateData.clearAvatar) {
    formData.append('clearAvatar', 'true')
  }

  const response = await fetch(`${API_BASE_URL}/api/users/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(true), // Exclude Content-Type for FormData
    body: formData
  })

  const result = await handleApiResponse<UserResponse>(response)
  
  // 🔥 CRITICAL: Dispatch avatar update event for auth cache invalidation
  if (result.success && (updateData.avatar || updateData.clearAvatar)) {
    window.dispatchEvent(new CustomEvent('userAvatarUpdated', {
      detail: { 
        userId: id, 
        newAvatarUrl: result.data?.avatarUrl || null 
      }
    }))
  }

  return result
}

/**
 * Delete a user
 */
export async function deleteUser(id: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/users/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(true) // Exclude Content-Type for DELETE without body
  })

  return handleApiResponse<{ success: boolean; message: string }>(response)
}

/**
 * Bulk delete users
 */
export async function bulkDeleteUsers(ids: string[]): Promise<{ success: boolean; message: string; deletedCount: number }> {
  const response = await fetch(`${API_BASE_URL}/api/users/bulk-delete`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    body: JSON.stringify({ ids })
  })

  return handleApiResponse<{ success: boolean; message: string; deletedCount: number }>(response)
}

/**
 * QUERY KEYS FOR TANSTACK QUERY
 */
export const userQueryKeys = {
  all: ['users'] as const,
  lists: () => [...userQueryKeys.all, 'list'] as const,
  list: (filters: UserFilters) => [...userQueryKeys.lists(), filters] as const,
  details: () => [...userQueryKeys.all, 'detail'] as const,
  detail: (id: string) => [...userQueryKeys.details(), id] as const,
}