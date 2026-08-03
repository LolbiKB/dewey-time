import type { ColumnDef } from '@tanstack/react-table'
import {
  GenericDataTable,
  type BaseTableMeta,
  type BaseTableActions,
} from '@/components/ui/generic-data-table'
import { RefreshButton } from '@/components/shared/refresh-button'
import type {
  UserEntry,
  UserFilters,
} from '@/services/user-service'

interface UserTableMeta {
  onUserClick?: (user: UserEntry) => void
  onRegister?: (user: UserEntry) => void
}

interface UserDataTableProps {
  columns: ColumnDef<UserEntry, any>[]
  data: UserEntry[]
  meta?: UserTableMeta
  tableMeta?: BaseTableMeta
  loading?: boolean
  filters: UserFilters
  onFiltersChange: (filters: UserFilters) => void
  onRefresh?: () => void
  /** TanStack `isFetching` — drives the refresh spinner. See RefreshButton. */
  refreshing?: boolean
  toolbarActions?: React.ReactNode
}

export function UserDataTable({
  columns,
  data,
  meta,
  tableMeta,
  loading,
  filters,
  onFiltersChange,
  onRefresh,
  refreshing,
  toolbarActions,
}: UserDataTableProps) {
  return (
    <GenericDataTable
      columns={columns}
      data={data}
      meta={tableMeta}
      loading={loading}
      filters={filters}
      onFiltersChange={onFiltersChange}
      toolbarActions={toolbarActions}
      config={{
        entityName: 'users',
        entityNameSingular: 'user',
        searchPlaceholder: 'Search by PIN, name, or employee ID...',
      }}
      // onRefresh is deliberately NOT handed to the primitive: its built-in
      // refresh button keys its spinner off `loading`, which is `isLoading` and
      // therefore never true on a refetch of an already-populated table.
      toolbarLeading={
        onRefresh ? <RefreshButton onRefresh={onRefresh} refreshing={refreshing} /> : undefined
      }
      // The primitive forwards `actions` straight through as react-table's
      // `meta` (dewey-ui data-table.tsx: `meta: actions`), which is how the
      // column cells reach onUserClick/onRegister. Neither is a key of
      // BaseTableActions, so once onRefresh moved out of this object it shared
      // NO keys with that type and tripped TS2559 — the `onRefresh` that used
      // to sit here was the only thing making it type-check.
      actions={meta as BaseTableActions<UserEntry>}
    />
  )
}