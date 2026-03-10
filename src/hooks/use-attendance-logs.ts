import { useQuery, useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  fetchAttendanceLogs,
  exportAttendanceLogs,
  type AttendanceLogFilters,
} from '@/services/attendance-log-service'

/**
 * Query keys for attendance logs
 */
export const attendanceLogQueryKeys = {
  all: ['attendance-logs'] as const,
  lists: () => [...attendanceLogQueryKeys.all, 'list'] as const,
  list: (filters: AttendanceLogFilters) => [...attendanceLogQueryKeys.lists(), filters] as const,
}

/**
 * Hook for managing attendance logs with TanStack Query
 */
export function useAttendanceLogManagement(filters: AttendanceLogFilters) {
  const {
    data: response,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: attendanceLogQueryKeys.list(filters),
    queryFn: () => fetchAttendanceLogs(filters),
    staleTime: 30000, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  })

  return {
    data: response?.data || [],
    meta: response?.meta || {
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    },
    isLoading,
    isError,
    error,
    refetchAttendanceLogs: refetch,
    isFetching,
  }
}

/**
 * Hook for exporting attendance logs
 */
export function useExportAttendanceLogs() {
  return useMutation({
    mutationFn: async (filters: AttendanceLogFilters) => {
      const blob = await exportAttendanceLogs(filters)
      
      // Create download link
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `attendance-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`
      document.body.appendChild(link)
      link.click()
      
      // Cleanup
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    },
  })
}
