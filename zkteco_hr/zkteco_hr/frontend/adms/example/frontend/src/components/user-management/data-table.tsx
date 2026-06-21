import type { ColumnDef } from "@tanstack/react-table"
import { UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GenericDataTable, type BaseTableMeta } from "@/components/ui/generic-data-table"
import type { UserFilters } from "@/services/user-service"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: BaseTableMeta
  loading?: boolean

  // Server-side operations
  filters: UserFilters
  onFiltersChange: (filters: UserFilters) => void
  onRefresh?: () => void

  onCreateUser?: () => void
}

export function DataTable<TData, TValue>({
  columns,
  data,
  meta,
  loading = false,
  filters,
  onFiltersChange,
  onRefresh,
  onCreateUser
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
        entityName: "users",
        entityNameSingular: "user",
        searchPlaceholder: "Search users...",
      }}
      actions={{
        onRefresh: onRefresh
      }}
      toolbarActions={
        onCreateUser && hasPermission(PERMISSIONS.USER_ADMINISTRATION.CREATE) && (
          <Button onClick={onCreateUser}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add
          </Button>
        )
      }
    />
  )
}