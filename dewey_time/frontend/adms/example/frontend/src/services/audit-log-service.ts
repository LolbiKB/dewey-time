const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'
import type { BaseFilters } from '@/components/ui/generic-data-table'
import { getAuthHeaders, buildQueryString, handleApiResponse } from '@/utils/api-helpers'

/**
 * Query Parameters for Audit Logs API
 */
export interface AuditLogFilters extends BaseFilters {
  // Audit-specific filters
  category?: string        // AUDIT_LOGS, USER_ADMINISTRATION, etc.
  action?: string          // CREATED, UPDATED, DELETED, VIEWED
  userId?: string          // Filter by who performed the action
  resourceId?: string      // Filter by resource that was acted upon
  dateFrom?: string        // ISO date string
  dateTo?: string          // ISO date string
  ipAddress?: string       // Filter by IP address
}

/**
 * Audit Log Entry from API (matches backend snake_case format)
 */
export interface AuditLogEntry {
  id: string
  user_id: string
  action: string
  resource_type: string
  resource_id?: string
  old_values?: string  // JSON string from backend
  new_values?: string  // JSON string from backend
  ip_address?: string
  user_agent?: string
  session_id?: string
  timestamp: string
  // Joined user information (from backend join)
  users?: {
    id: string
    email: string
    first_name?: string
    last_name?: string
    khmer_first_name?: string
    khmer_last_name?: string
    avatar_url?: string
  }
}

/**
 * API Response for Audit Logs
 */
export interface AuditLogsResponse {
  success: boolean
  data: AuditLogEntry[]
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
 * Fetch audit logs from API
 */
export async function fetchAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogsResponse> {
  const queryString = buildQueryString(filters)
  const endpoint = `${API_BASE_URL}/api/audit-logs${queryString ? `?${queryString}` : ''}`
  
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  })

  return handleApiResponse<AuditLogsResponse>(response)
}

/**
 * Export audit logs to CSV
 */
export async function exportAuditLogs(filters: AuditLogFilters = {}): Promise<Blob> {
  const queryString = buildQueryString({ ...filters, limit: undefined, page: undefined })
  const endpoint = `${API_BASE_URL}/api/audit-logs/export${queryString ? `?${queryString}` : ''}`
  
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      ...getAuthHeaders(true),
      'Accept': 'text/csv',
    },
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Failed to export audit logs: ${response.statusText}`)
  }
  
  return response.blob()
}

/**
 * Get audit log statistics for dashboard
 */
export async function fetchAuditLogStats(): Promise<{
  totalLogs: number
  todayLogs: number
  topCategories: Array<{ category: string; count: number }>
  topActions: Array<{ action: string; count: number }>
  recentActivity: AuditLogEntry[]
}> {
  const response = await fetch(`${API_BASE_URL}/api/audit-logs/stats`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  })

  return handleApiResponse(response)
}

/**
 * Get unique values for filter dropdowns
 */
export async function fetchAuditLogFilterOptions(): Promise<{
  categories: string[]
  actions: string[]
  users: Array<{ id: string; email: string; name: string }>
}> {
  const response = await fetch(`${API_BASE_URL}/api/audit-logs/filter-options`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  })

  return handleApiResponse(response)
}

/**
 * TanStack Query keys for audit logs
 */
export const auditLogQueryKeys = {
  all: ['auditLogs'] as const,
  lists: () => [...auditLogQueryKeys.all, 'list'] as const,
  list: (filters: AuditLogFilters) => [...auditLogQueryKeys.lists(), filters] as const,
  stats: () => [...auditLogQueryKeys.all, 'stats'] as const,
  filterOptions: () => [...auditLogQueryKeys.all, 'filterOptions'] as const,
}