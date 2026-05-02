// Improved Devices Page using Centralized Data Pipeline
import { useState, useMemo } from 'react'
import { 
  AlertCircle, 
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { createDeviceColumns } from '@/components/devices/columns'
import { DeviceDataTable } from '@/components/devices/data-table'
import { 
  useDevices as useLegacyDevices, 
  useDeviceCommand, 
  useUpdateDevice 
} from '@/hooks/use-devices'
import { EditDeviceDialog } from '@/components/devices/edit-device-dialog'
import { DeviceInfoDialog } from '@/components/devices/device-info-dialog'
import { DeviceDetailDialog } from '@/components/devices/device-detail-dialog'
import type { DeviceFilters, DeviceEntry } from '@/services/device-service'

const COMMAND_LABELS: Record<string, string> = {
  reboot: 'Reboot',
  info: 'Info request',
  check: 'Force sync',
  log: 'Push new logs',
}

import { CommandHistoryDialog } from '@/components/devices/command-history-dialog'

export function Devices() {
  const [filters, setFilters] = useState<DeviceFilters>({
    page: 1,
    limit: 20,
    sortBy: 'created_at',
    sortOrder: 'desc',
  })

  // Fetch devices for table
  const { data: response, isLoading, isError, error, refetch, isFetching } = useLegacyDevices(filters)

  // Device command mutation
  const deviceCommandMutation = useDeviceCommand()

  // Update device mutation
  const updateDeviceMutation = useUpdateDevice()

  const [historyDevice, setHistoryDevice] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editDevice, setEditDevice] = useState<DeviceEntry | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [infoDevice, setInfoDevice] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [detailDevice, setDetailDevice] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // Handle device command
  const handleDeviceCommand = async (
    serialNumber: string,
    commandType: string,
    commandBody: string
  ) => {
    const label = COMMAND_LABELS[commandType] || commandType
    try {
      await deviceCommandMutation.mutateAsync({
        deviceSn: serialNumber,
        commandType,
        commandBody,
      })
      toast.success(`${label} queued`, {
        description: `Command sent to ${serialNumber}. Will execute on next poll.`,
      })
    } catch (err) {
      toast.error('Error', {
        description: `Failed to queue ${label} for ${serialNumber}.`,
      })
    }
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
    try {
      await updateDeviceMutation.mutateAsync({ serialNumber, updates })
      toast.success('Device updated', {
        description: `Device ${serialNumber} configuration updated successfully.`,
      })
    } catch (err) {
      toast.error('Error', {
        description: 'Failed to update device. Please try again.',
      })
      throw err
    }
  }

  // Handle show device info
  const handleShowInfo = (serialNumber: string) => {
    setInfoDevice(serialNumber)
    setInfoOpen(true)
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
        onShowHistory: (sn: string) => {
          setHistoryDevice(sn)
          setHistoryOpen(true)
        },
        onEdit: handleEditDevice,
        onShowInfo: handleShowInfo,
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
          data={response?.data || []}
          meta={response?.meta}
          loading={isLoading}
          isFetching={isFetching}
          filters={filters}
          onFiltersChange={setFilters}
          onRefresh={refetch}
        />
      </div>

      {/* Dialogs */}
      <CommandHistoryDialog deviceSn={historyDevice} open={historyOpen} onOpenChange={setHistoryOpen} />
      <EditDeviceDialog
        device={editDevice}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={handleUpdateDevice}
        isSaving={updateDeviceMutation.isPending}
      />
      <DeviceInfoDialog
        deviceSn={infoDevice}
        open={infoOpen}
        onOpenChange={setInfoOpen}
      />
      <DeviceDetailDialog
        deviceSn={detailDevice}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}
