import type { ColumnDef } from '@tanstack/react-table'
import {
  GenericDataTable,
  type BaseTableMeta,
} from '@/components/ui/generic-data-table'
import { AttendanceLogStatFilters } from '@/components/attendance-logs/attendance-log-stat-filters'
import type {
  AttendanceLogEntry,
  AttendanceLogFilters,
  AttendanceLogStatFilter,
  AttendanceLogSummary,
} from '@/services/attendance-log-service'

interface AttendanceLogDataTableProps {
  columns: ColumnDef<AttendanceLogEntry, unknown>[]
  data: AttendanceLogEntry[]
  meta?: BaseTableMeta
  loading?: boolean
  filters: AttendanceLogFilters
  summary?: AttendanceLogSummary
  onFiltersChange: (filters: AttendanceLogFilters) => void
  onStatToggle: (stat: AttendanceLogStatFilter) => void
  onRefresh?: () => void
}

export function AttendanceLogDataTable({
  columns,
  data,
  meta,
  loading,
  filters,
  summary,
  onFiltersChange,
  onStatToggle,
  onRefresh,
}: AttendanceLogDataTableProps) {
  return (
    <GenericDataTable
      columns={columns}
      data={data}
      meta={meta}
      loading={loading}
      filters={filters}
      onFiltersChange={onFiltersChange}
      config={{
        entityName: 'punches',
        entityNameSingular: 'punch',
        searchPlaceholder: 'Search by PIN or device SN...',
      }}
      actions={{
        onRefresh,
      }}
      toolbarActions={
        <AttendanceLogStatFilters
          filters={filters}
          summary={summary}
          onToggle={onStatToggle}
        />
      }
    />
  )
}
