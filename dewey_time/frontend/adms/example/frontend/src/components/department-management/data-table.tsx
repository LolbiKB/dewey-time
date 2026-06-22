import type { ColumnDef } from "@tanstack/react-table"
import { Building2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GenericDataTable, type BaseTableMeta } from "@/components/ui/generic-data-table"
import type { DepartmentFilters } from "@/services/department-service"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: BaseTableMeta
  loading?: boolean

  // Server-side operations
  filters: DepartmentFilters
  onFiltersChange: (filters: DepartmentFilters) => void
  onRefresh?: () => void

  onCreateDepartment?: () => void
}

export function DataTable<TData, TValue>({
  columns,
  data,
  meta,
  loading = false,
  filters,
  onFiltersChange,
  onRefresh,
  onCreateDepartment
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
        entityName: "departments",
        entityNameSingular: "department",
        searchPlaceholder: "Search departments...",
      }}
      actions={{
        onRefresh: onRefresh
      }}
      toolbarActions={
        onCreateDepartment && hasPermission(PERMISSIONS.DEPARTMENT_MANAGEMENT.CREATE) && (
          <Button onClick={onCreateDepartment}>
            <Building2 className="mr-2 h-4 w-4" />
            Add
          </Button>
        )
      }
    />
  )
}