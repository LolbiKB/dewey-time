import type { ColumnDef } from "@tanstack/react-table"
import { BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GenericDataTable, type BaseTableMeta } from "@/components/ui/generic-data-table"
import type { CourseFilters } from "@/services/course-service"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: BaseTableMeta
  loading?: boolean

  // Server-side operations
  filters: CourseFilters
  onFiltersChange: (filters: CourseFilters) => void
  onRefresh?: () => void

  onCreateCourse?: () => void
}

export function DataTable<TData, TValue>({
  columns,
  data,
  meta,
  loading = false,
  filters,
  onFiltersChange,
  onRefresh,
  onCreateCourse,
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
        entityName: "courses",
        entityNameSingular: "course",
        searchPlaceholder: "Search courses...",
      }}
      actions={{
        onRefresh: onRefresh,
      }}
      toolbarActions={
        onCreateCourse &&
        hasPermission(PERMISSIONS.COURSE_MANAGEMENT.CREATE) && (
          <Button onClick={onCreateCourse}>
            <BookOpen className="mr-2 h-4 w-4" />
            Add
          </Button>
        )
      }
    />
  )
}
