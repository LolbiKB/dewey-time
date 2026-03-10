import { useState, useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { createDeviceColumns } from '@/components/devices/columns'
import { DeviceDataTable } from '@/components/devices/data-table'
import { useDevices, useSetMasterDevice, useDeviceCommand, useUpdateDevice } from '@/hooks/use-devices'
import { EditDeviceDialog } from '@/components/devices/edit-device-dialog'
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

  // Fetch devices
  const { data: response, isLoading, isError, error, refetch, isFetching } = useDevices(filters)

  // Set master device mutation
  const setMasterMutation = useSetMasterDevice()

  // Device command mutation
  const deviceCommandMutation = useDeviceCommand()

  // Update device mutation
  const updateDeviceMutation = useUpdateDevice()

  const [historyDevice, setHistoryDevice] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editDevice, setEditDevice] = useState<DeviceEntry | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  // Handle set master
  const handleSetMaster = async (serialNumber: string) => {
    try {
      await setMasterMutation.mutateAsync(serialNumber)
      toast.success('Master device updated', {
        description: `Device ${serialNumber} is now the master device.`,
      })
    } catch (err) {
      toast.error('Error', {
        description: 'Failed to set master device. Please try again.',
      })
    }
  }

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
        onSetMaster: handleSetMaster,
        onDeviceCommand: handleDeviceCommand,
        onShowHistory: (sn: string) => {
          setHistoryDevice(sn)
          setHistoryOpen(true)
        },
        onEdit: handleEditDevice,
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
    <div className="h-full">
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
      <CommandHistoryDialog deviceSn={historyDevice} open={historyOpen} onOpenChange={setHistoryOpen} />
      <EditDeviceDialog
        device={editDevice}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSave={handleUpdateDevice}
        isSaving={updateDeviceMutation.isPending}
      />
    </div>
  )
}
