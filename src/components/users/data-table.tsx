import type { ColumnDef } from '@tanstack/react-table'
import {
  GenericDataTable,
  type BaseTableMeta,
} from '@/components/ui/generic-data-table'
import type {
  UserEntry,
  UserFilters,
} from '@/services/user-service'

interface UserTableMeta {
  onViewSyncStatus?: (user: UserEntry) => void
  onEnrollBiometric?: (user: UserEntry) => void
  onViewBiometric?: (user: UserEntry) => void
  onRegister?: (user: UserEntry) => void
  onChangeStatus?: (user: UserEntry) => void
  onRefreshPhoto?: (user: UserEntry) => void
}

interface UserDataTableProps {
  columns: ColumnDef<UserEntry, any>[]
  data: UserEntry[]
  meta?: UserTableMeta
  tableMeta?: BaseTableMeta
  loading?: boolean
  isFetching?: boolean
  filters: UserFilters
  onFiltersChange: (filters: UserFilters) => void
  onRefresh?: () => void
  toolbarActions?: React.ReactNode
}

export function UserDataTable({
  columns,
  data,
  meta,
  tableMeta,
  loading,
  isFetching,
  filters,
  onFiltersChange,
  onRefresh,
  toolbarActions,
}: UserDataTableProps) {
  return (
    <GenericDataTable
      columns={columns}
      data={data}
      meta={tableMeta}
      loading={loading || isFetching}
      filters={filters}
      onFiltersChange={onFiltersChange}
      toolbarActions={toolbarActions}
      config={{
        entityName: 'users',
        entityNameSingular: 'user',
        searchPlaceholder: 'Search by PIN, name, or employee ID...',
      }}
      actions={{
        onRefresh,
        ...meta,
      }}
    />
  )
}
