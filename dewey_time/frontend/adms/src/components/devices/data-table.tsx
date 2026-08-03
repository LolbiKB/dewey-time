import type { ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  GenericDataTable,
  type BaseTableMeta,
} from '@/components/ui/generic-data-table'
import { RefreshButton } from '@/components/shared/refresh-button'
import type {
  DeviceEntry,
  DeviceFilters,
} from '@/services/device-service'

interface DeviceDataTableProps {
  columns: ColumnDef<DeviceEntry, any>[]
  data: DeviceEntry[]
  meta?: BaseTableMeta
  loading?: boolean
  filters: DeviceFilters
  onFiltersChange: (filters: DeviceFilters) => void
  onRefresh?: () => void
  /** TanStack `isFetching` — drives the refresh spinner. See RefreshButton. */
  refreshing?: boolean
  toolbarLeading?: ReactNode
}

export function DeviceDataTable({
  columns,
  data,
  meta,
  loading,
  filters,
  onFiltersChange,
  onRefresh,
  refreshing,
  toolbarLeading,
}: DeviceDataTableProps) {
  return (
    <GenericDataTable
      columns={columns}
      data={data}
      meta={meta}
      loading={loading}
      filters={filters}
      onFiltersChange={onFiltersChange}
      config={{
        entityName: 'devices',
        entityNameSingular: 'device',
        searchPlaceholder: 'Search by serial number, name, or location...',
      }}
      // onRefresh is deliberately NOT handed to the primitive: its built-in
      // refresh button keys its spinner off `loading`, which is `isLoading` and
      // therefore never true on a refetch of an already-populated table.
      toolbarLeading={
        <>
          {onRefresh && <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />}
          {toolbarLeading}
        </>
      }
    />
  )
}
