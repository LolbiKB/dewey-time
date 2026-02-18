import { useState, useMemo } from 'react'
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { createDeviceColumns } from '@/components/devices/columns'
import { DeviceDataTable } from '@/components/devices/data-table'
import { useDevices, useSetMasterDevice, useDeviceCommand } from '@/hooks/use-devices'
import type { DeviceFilters } from '@/services/device-service'

const COMMAND_LABELS: Record<string, string> = {
  reboot: 'Reboot',
  info: 'Info request',
  check: 'Force sync',
  log: 'Push new logs',
}

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
        onFilterByMaster: (isMaster) =>
          setFilters((prev) => ({
            ...prev,
            is_master: isMaster === 'true' ? true : isMaster === 'false' ? false : undefined,
            page: 1,
          })),
        currentStatusFilter: filters.status,
        currentMasterFilter: filters.is_master?.toString(),
        onSetMaster: handleSetMaster,
        onDeviceCommand: handleDeviceCommand,
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
    </div>
  )
}
