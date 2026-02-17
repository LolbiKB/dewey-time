import type { ColumnDef } from '@tanstack/react-table'
import {
  GenericDataTable,
  type BaseTableMeta,
} from '@/components/ui/generic-data-table'
import type {
  AttendanceLogEntry,
  AttendanceLogFilters,
} from '@/services/attendance-log-service'

interface AttendanceLogDataTableProps {
  columns: ColumnDef<AttendanceLogEntry, any>[]
  data: AttendanceLogEntry[]
  meta?: BaseTableMeta
  loading?: boolean
  isFetching?: boolean
  filters: AttendanceLogFilters
  onFiltersChange: (filters: AttendanceLogFilters) => void
  onRefresh?: () => void
  onExportLogs?: () => void
  isExporting?: boolean
}

export function AttendanceLogDataTable({
  columns,
  data,
  meta,
  loading,
  isFetching,
  filters,
  onFiltersChange,
  onRefresh,
  onExportLogs: _onExportLogs,
  isExporting: _isExporting = false,
}: AttendanceLogDataTableProps) {
  return (
    <GenericDataTable
      columns={columns}
      data={data}
      meta={meta}
      loading={loading || isFetching}
      filters={filters}
      onFiltersChange={onFiltersChange}
      config={{
        entityName: 'attendance logs',
        entityNameSingular: 'attendance log',
        searchPlaceholder: 'Search by user PIN or device...',
      }}
      actions={{
        onRefresh,
      }}
    />
  )
}
