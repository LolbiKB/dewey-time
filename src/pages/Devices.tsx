// Improved Devices Page using Centralized Data Pipeline
import { useState, useMemo } from 'react'
import { 
  AlertCircle, 
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { createDeviceColumns } from '@/components/devices/columns'
import { DeviceDataTable } from '@/components/devices/data-table'
import { 
  useDevices, 
  useSendDeviceCommand, 
  useUpdateDevice 
} from '@/hooks'
import { EditDeviceDialog } from '@/components/devices/edit-device-dialog'
import { DeviceDetailDialog } from '@/components/devices/device-detail-dialog'
import type { DeviceFilters, DeviceEntry } from '@/services/device-service'

export function Devices() {
  const [filters, setFilters] = useState<DeviceFilters>({
    page: 1,
    limit: 20,
    sortBy: 'created_at',
    sortOrder: 'desc',
  })

  // Fetch devices for table
  const { data, isLoading, isError, error, refetch, isFetching } = useDevices(filters)

  // Device command mutation
  const deviceCommandMutation = useSendDeviceCommand()

  // Update device mutation
  const updateDeviceMutation = useUpdateDevice()

  const [editDevice, setEditDevice] = useState<DeviceEntry | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [detailDevice, setDetailDevice] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // Handle device command
  const handleDeviceCommand = async (
    serialNumber: string,
    commandType: string,
    commandBody: string
  ) => {
    await deviceCommandMutation.mutateAsync({
      deviceSn: serialNumber,
      commandType,
      command: commandBody,
    })
  }

  // Handle edit device
  const handleEditDevice = (device: DeviceEntry) => {
    setEditDevice(device)
    setEditOpen(true)
  }

  // Handle update device
  const handleUpdateDevice = async (
    serialNumber: string,
    updates: {
      name?: string
      location?: string
      is_registrar?: boolean
      registrar_capabilities?: string[]
    }
  ) => {
    await updateDeviceMutation.mutateAsync({ deviceSn: serialNumber, updates })
  }

  // Handle show device detail
  const handleShowDetail = (serialNumber: string) => {
    setDetailDevice(serialNumber)
    setDetailOpen(true)
  }

  // Column definitions with filter callbacks
  const columns = useMemo(
    () =>
      createDeviceColumns({
        onFilterByStatus: (status) =>
          setFilters((prev) => ({
            ...prev,
            status: (status as 'online' | 'offline') || undefined,
            page: 1,
          })),
        currentStatusFilter: filters.status,
        onDeviceCommand: handleDeviceCommand,
        onEdit: handleEditDevice,
        onShowDetail: handleShowDetail,
      }),
    [filters]
  )

  // Error state
  if (isError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-6">
        <Card className="border-destructive max-w-2xl w-full">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="font-semibold">Error loading devices</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Data Table */}
      <div className="flex-1 min-h-0">
        <DeviceDataTable
          columns={columns}
          data={(data?.devices || []).map(d => ({ ...d, status: d.isOnline ? 'online' : 'offline' }))}
          meta={data ? { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages, hasNext: data.hasNext, hasPrev: data.hasPrev } : undefined}
          loading={isLoading}
          isFetching={isFetching}
          filters={filters}
          onFiltersChange={setFilters}
          onRefresh={refetch}
        />
      </div>

      {/* Dialogs */}
      <EditDeviceDialog
        device={editDevice}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={handleUpdateDevice}
        isSaving={updateDeviceMutation.isPending}
      />
      <DeviceDetailDialog
        deviceSn={detailDevice}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}
