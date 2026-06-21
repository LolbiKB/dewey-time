import type { ColumnDef } from "@tanstack/react-table"
import { Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GenericDataTable, type BaseTableMeta } from "@/components/ui/generic-data-table"
import type { CourseOfferingFilters } from "@/services/course-offering-service"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: BaseTableMeta
  loading?: boolean

  // Server-side operations
  filters: CourseOfferingFilters
  onFiltersChange: (filters: CourseOfferingFilters) => void
  onRefresh?: () => void

  onCreateOffering?: () => void
}

export function DataTable<TData, TValue>({
  columns,
  data,
  meta,
  loading = false,
  filters,
  onFiltersChange,
  onRefresh,
  onCreateOffering,
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
        entityName: "course offerings",
        entityNameSingular: "course offering",
        searchPlaceholder: "Search course offerings...",
      }}
      actions={{
        onRefresh: onRefresh,
      }}
      toolbarActions={
        onCreateOffering &&
        hasPermission(PERMISSIONS.COURSE_MANAGEMENT.CREATE) && (
          <Button onClick={onCreateOffering}>
            <Calendar className="mr-2 h-4 w-4" />
            Add
          </Button>
        )
      }
    />
  )
}
