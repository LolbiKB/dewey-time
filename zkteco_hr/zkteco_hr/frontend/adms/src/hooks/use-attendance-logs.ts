import { useQuery, useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  fetchAttendanceLogs,
  fetchAttendanceLogSummary,
  exportAttendanceLogs,
  type AttendanceLogFilters,
} from '@/services/attendance-log-service'

export const attendanceLogQueryKeys = {
  all: ['attendance-logs'] as const,
  lists: () => [...attendanceLogQueryKeys.all, 'list'] as const,
  list: (filters: AttendanceLogFilters) => [...attendanceLogQueryKeys.lists(), filters] as const,
  summary: () => [...attendanceLogQueryKeys.all, 'summary'] as const,
}

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
    staleTime: 30000,
    gcTime: 1000 * 60 * 5,
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

/** Primary hook for Attendance Logs page (replaces use-core-data thin wrapper). */
export function useAttendanceLogs(filters: AttendanceLogFilters) {
  return useAttendanceLogManagement(filters)
}

export function useAttendanceLogSummary() {
  return useQuery({
    queryKey: attendanceLogQueryKeys.summary(),
    queryFn: fetchAttendanceLogSummary,
    staleTime: 60000,
  })
}

export function useExportAttendanceLogs() {
  return useMutation({
    mutationFn: async (filters: AttendanceLogFilters) => {
      const blob = await exportAttendanceLogs(filters)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `attendance-punches-${format(new Date(), 'yyyy-MM-dd')}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    },
  })
}
