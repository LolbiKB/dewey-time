import type { ReactNode } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  GenericDataTable,
  type BaseTableMeta,
} from '@/components/ui/generic-data-table'
import type {
  DeviceEntry,
  DeviceFilters,
} from '@/services/device-service'

interface DeviceDataTableProps {
  columns: ColumnDef<DeviceEntry, any>[]
  data: DeviceEntry[]
  meta?: BaseTableMeta
  loading?: boolean
  isFetching?: boolean
  filters: DeviceFilters
  onFiltersChange: (filters: DeviceFilters) => void
  onRefresh?: () => void
  toolbarLeading?: ReactNode
}

export function DeviceDataTable({
  columns,
  data,
  meta,
  loading,
  isFetching,
  filters,
  onFiltersChange,
  onRefresh,
  toolbarLeading,
}: DeviceDataTableProps) {
  return (
    <GenericDataTable
      columns={columns}
      data={data}
      meta={meta}
      loading={loading || isFetching}
      filters={filters}
      onFiltersChange={onFiltersChange}
      config={{
        entityName: 'devices',
        entityNameSingular: 'device',
        searchPlaceholder: 'Search by serial number, name, or location...',
      }}
      toolbarLeading={toolbarLeading}
      actions={{
        onRefresh,
      }}
    />
  )
}
