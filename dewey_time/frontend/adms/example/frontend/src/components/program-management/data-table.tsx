import type { ColumnDef } from "@tanstack/react-table"
import { GraduationCap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GenericDataTable, type BaseTableMeta } from "@/components/ui/generic-data-table"
import type { ProgramFilters } from "@/services/program-service"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  meta?: BaseTableMeta
  loading?: boolean

  // Server-side operations
  filters: ProgramFilters
  onFiltersChange: (filters: ProgramFilters) => void
  onRefresh?: () => void

  onCreateProgram?: () => void
}

export function DataTable<TData, TValue>({
  columns,
  data,
  meta,
  loading = false,
  filters,
  onFiltersChange,
  onRefresh,
  onCreateProgram,
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
        entityName: "programs",
        entityNameSingular: "program",
        searchPlaceholder: "Search programs...",
      }}
      actions={{
        onRefresh: onRefresh,
      }}
      toolbarActions={
        onCreateProgram &&
        hasPermission(PERMISSIONS.PROGRAM_MANAGEMENT.CREATE) && (
          <Button onClick={onCreateProgram}>
            <GraduationCap className="mr-2 h-4 w-4" />
            Add
          </Button>
        )
      }
    />
  )
}
