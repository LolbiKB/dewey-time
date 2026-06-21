import type { ColumnDef } from "@tanstack/react-table"
import { CalendarRange } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GenericDataTable, type BaseTableMeta } from "@/components/ui/generic-data-table"
import type { TermFilters } from "@/services/term-service"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: BaseTableMeta
  loading?: boolean

  // Server-side operations
  filters: TermFilters
  onFiltersChange: (filters: TermFilters) => void
  onRefresh?: () => void

  onCreateTerm?: () => void
}

export function DataTable<TData, TValue>({
  columns,
  data,
  meta,
  loading = false,
  filters,
  onFiltersChange,
  onRefresh,
  onCreateTerm
}: DataTableProps<TData, TValue>) {
  const { hasPermission } = useAuth()

  return (
    <GenericDataTable
      columns={columns}
      data={data}
      meta={meta}
      loading={loading}
      filters={filters}
      onFiltersChange={onFiltersChange}
      config={{
        entityName: "terms",
        entityNameSingular: "term",
        searchPlaceholder: "Search terms...",
      }}
      actions={{
        onRefresh: onRefresh
      }}
      toolbarActions={
        onCreateTerm && hasPermission(PERMISSIONS.TERM_MANAGEMENT.CREATE) && (
          <Button onClick={onCreateTerm}>
            <CalendarRange className="mr-2 h-4 w-4" />
            Add
          </Button>
        )
      }
    />
  )
}
