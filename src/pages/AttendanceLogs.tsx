import { useState, useMemo } from 'react'
import { startOfDay, endOfDay, formatISO } from 'date-fns'
import { AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { createAttendanceLogColumns } from '@/components/attendance-logs/columns'
import { AttendanceLogDataTable } from '@/components/attendance-logs/data-table'
import {
  useAttendanceLogs,
} from '@/hooks'
import { useExportAttendanceLogs } from '@/hooks/use-attendance-logs'
import type { AttendanceLogFilters } from '@/services/attendance-log-service'

export function AttendanceLogs() {
  const [filters, setFilters] = useState<AttendanceLogFilters>({
    page: 1,
    limit: 20,
    sort: 'check_time',
    order: 'desc',
  })

  // Fetch attendance logs
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useAttendanceLogs({
    page: filters.page,
    limit: filters.limit,
    startDate: filters.dateFrom,
    endDate: filters.dateTo,
    deviceSn: filters.device_sn,
    userPin: filters.user_pin,
  })

  // Export mutation
  const { mutate: exportLogs, isPending: isExporting } = useExportAttendanceLogs()

  // Extract unique devices for filter
  const availableDevices = useMemo(() => {
    const uniqueDevices = new Set((data?.logs || []).map((log) => log.device_sn))
    return Array.from(uniqueDevices).map((sn) => ({
      value: sn,
      label: sn,
    }))
  }, [data])

  // Column definitions with filter callbacks
  const columns = useMemo(
    () =>
      createAttendanceLogColumns({
        onFilterByDevice: (device) =>
          setFilters((prev) => ({
            ...prev,
            device_sn: device || undefined,
            page: 1,
          })),
        onFilterByStatus: (status) =>
          setFilters((prev) => ({
            ...prev,
            status: status ? parseInt(status) : undefined,
            page: 1,
          })),
        onFilterByVerifyType: (type) =>
          setFilters((prev) => ({
            ...prev,
            verify_type: type ? parseInt(type) : undefined,
            page: 1,
          })),
        onFilterByDate: (date) => {
          if (date) {
            setFilters((prev) => ({
              ...prev,
              dateFrom: formatISO(startOfDay(date)),
              dateTo: formatISO(endOfDay(date)),
              page: 1,
            }))
          } else {
            setFilters((prev) => {
              const { dateFrom, dateTo, ...rest } = prev
              return { ...rest, page: 1 }
            })
          }
        },
        currentDeviceFilter: filters.device_sn,
        currentStatusFilter: filters.status?.toString(),
        currentVerifyTypeFilter: filters.verify_type?.toString(),
        currentDateFilter: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        availableDevices,
      }),
    [filters, availableDevices]
  )

  // Handle export
  const handleExport = () => {
    exportLogs(filters)
  }

  // Error state
  if (isError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-6">
        <Card className="border-destructive max-w-2xl w-full">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="font-semibold">Error loading attendance logs</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-full">
      <AttendanceLogDataTable
        columns={columns}
        data={data?.logs || []}
        meta={data ? { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages, hasNext: data.hasNext, hasPrev: data.hasPrev } : undefined}
        loading={isLoading}
        isFetching={isFetching}
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={refetch}
        onExportLogs={handleExport}
        isExporting={isExporting}
      />
    </div>
  )
}
