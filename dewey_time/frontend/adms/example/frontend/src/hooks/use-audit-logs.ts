import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { 
  fetchAuditLogs,
  exportAuditLogs,
  fetchAuditLogStats,
  fetchAuditLogFilterOptions,
  auditLogQueryKeys,
  type AuditLogFilters
} from '../services/audit-log-service'

/**
 * Hook for fetching paginated audit logs with filters
 */
export function useAuditLogs(filters: AuditLogFilters) {
  return useQuery({
    queryKey: auditLogQueryKeys.list(filters),
    queryFn: () => fetchAuditLogs(filters),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 2,
  })
}

/**
 * Hook for audit log management with data and error handling
 */
export function useAuditLogManagement(filters: AuditLogFilters) {
  const {
    data: response,
    isLoading,
    isError,
    error,
    refetch: refetchAuditLogs,
    isFetching,
  } = useAuditLogs(filters)

  return {
    data: response?.data || [],
    meta: response?.meta || {
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    },
    isLoading,
    isError,
    error,
    refetchAuditLogs,
    isFetching,
  }
}

/**
 * Hook for audit log statistics
 */
export function useAuditLogStats() {
  return useQuery({
    queryKey: auditLogQueryKeys.stats(),
    queryFn: fetchAuditLogStats,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
    retry: 2,
  })
}

/**
 * Hook for filter options (categories, actions, users)
 */
export function useAuditLogFilterOptions() {
  return useQuery({
    queryKey: auditLogQueryKeys.filterOptions(),
    queryFn: fetchAuditLogFilterOptions,
    staleTime: 1000 * 60 * 15, // 15 minutes (these don't change often)
    gcTime: 1000 * 60 * 30, // 30 minutes
    retry: 2,
  })
}

/**
 * Hook for exporting audit logs
 */
export function useExportAuditLogs() {
  return useMutation({
    mutationFn: async (filters: AuditLogFilters) => {
      const blob = await exportAuditLogs(filters)
      
      // Create download link
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      // Generate filename with current date using date-fns
      const dateStr = format(new Date(), 'yyyy-MM-dd')
      link.download = `audit-logs-${dateStr}.csv`
      
      // Trigger download
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      // Clean up
      window.URL.revokeObjectURL(url)
    },
    onError: (error) => {
      console.error('Failed to export audit logs:', error)
    },
  })
}

/**
 * Hook to invalidate audit log queries (useful after data changes)
 */
export function useInvalidateAuditLogs() {
  const queryClient = useQueryClient()
  
  return {
    invalidateAll: () => queryClient.invalidateQueries({ 
      queryKey: auditLogQueryKeys.all 
    }),
    invalidateLists: () => queryClient.invalidateQueries({ 
      queryKey: auditLogQueryKeys.lists() 
    }),
    invalidateStats: () => queryClient.invalidateQueries({ 
      queryKey: auditLogQueryKeys.stats() 
    }),
  }
}

/**
 * Helper hook for real-time audit log updates (WebSocket or polling)
 */
export function useAuditLogRealtime(enabled = false) {
  const { invalidateAll } = useInvalidateAuditLogs()
  
  // Poll for new logs every 30 seconds when enabled
  const { data } = useQuery({
    queryKey: ['auditLogs', 'realtime'],
    queryFn: async () => {
      // Could fetch just the count or latest timestamp
      const stats = await fetchAuditLogStats()
      return stats.todayLogs
    },
    enabled,
    refetchInterval: 30000, // 30 seconds
    refetchIntervalInBackground: false,
  })

  // Use useEffect to handle the side effect of invalidating queries
  React.useEffect(() => {
    if (data !== undefined) {
      invalidateAll()
    }
  }, [data, invalidateAll])
  
  return { todayLogsCount: data }
}