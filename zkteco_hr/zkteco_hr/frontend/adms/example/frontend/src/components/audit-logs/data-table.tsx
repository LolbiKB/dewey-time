import type { ColumnDef } from "@tanstack/react-table"
import { Download, FileBarChart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GenericDataTable, type BaseTableMeta } from "@/components/ui/generic-data-table"
import type { AuditLogFilters } from "@/services/audit-log-service"

interface AuditLogDataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: BaseTableMeta
  loading?: boolean
  isFetching?: boolean

  // Server-side operations
  filters: AuditLogFilters
  onFiltersChange: (filters: AuditLogFilters) => void
  onRefresh?: () => void

  // Audit log specific actions
  onExportLogs?: () => void
  onViewStats?: () => void
  isExporting?: boolean
}

export function AuditLogDataTable<TData, TValue>({
  columns,
  data,
  meta,
  loading = false,
  isFetching = false,
  filters,
  onFiltersChange,
  onRefresh,
  onExportLogs,
  onViewStats,
  isExporting = false
}: AuditLogDataTableProps<TData, TValue>) {
  return (
    <GenericDataTable
      columns={columns}
      data={data}
      meta={meta}
      loading={loading || isFetching}
      filters={filters}
      onFiltersChange={onFiltersChange}
      config={{
        entityName: "audit logs",
        entityNameSingular: "audit log",
        searchPlaceholder: "Search audit logs...",
      }}
      actions={{
        onRefresh: onRefresh
      }}
      toolbarActions={
        <div className="flex items-center space-x-2">
          {onViewStats && (
            <Button
              variant="outline"
              onClick={onViewStats}
            >
              <FileBarChart className="mr-2 h-4 w-4" />
              Statistics
            </Button>
          )}
          {onExportLogs && (
            <Button
              variant="outline"
              onClick={onExportLogs}
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </Button>
          )}
        </div>
      }
    />
  )
}