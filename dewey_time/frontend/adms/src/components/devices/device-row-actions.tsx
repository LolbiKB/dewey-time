import { useState } from 'react'
import {
  Activity,
  CalendarCheck,
  Edit,
  Eye,
  MoreHorizontal,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmationDialog } from '@/components/ui/base-modal'
import { signalText } from '@/lib/signal'
import type { DeviceEntry } from '@/services/device-service'
import type { DeviceDetailTab } from '@/components/devices/device-detail-tabs'

interface DeviceRowActionsProps {
  device: DeviceEntry
  onDeviceCommand?: (
    serialNumber: string,
    commandType: string,
    commandBody: string
  ) => void | Promise<void>
  onEdit?: (device: DeviceEntry) => void
  onShowDetail?: (serialNumber: string, tab?: DeviceDetailTab) => void
}

/**
 * Row menu for the Devices table. Reboot is destructive and cannot be
 * un-queued once the device picks the command up, so it goes through a
 * confirmation step like the other destructive device actions.
 */
export function DeviceRowActions({
  device,
  onDeviceCommand,
  onEdit,
  onShowDetail,
}: DeviceRowActionsProps) {
  const [confirmRebootOpen, setConfirmRebootOpen] = useState(false)
  const [isRebooting, setIsRebooting] = useState(false)

  const serialNumber = device.serial_number
  const name = device.name

  const handleConfirmReboot = async () => {
    setIsRebooting(true)
    try {
      // Failures are surfaced by the command mutation's own error toast.
      await onDeviceCommand?.(serialNumber, 'reboot', 'REBOOT')
    } catch {
      /* already reported */
    } finally {
      setIsRebooting(false)
      setConfirmRebootOpen(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-muted">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{name || 'Unnamed Device'}</p>
              <p className="text-xs text-muted-foreground">{serialNumber}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onShowDetail?.(serialNumber, 'users')}>
            <Eye className="mr-2 h-4 w-4" />
            View Sync Details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onShowDetail?.(serialNumber, 'overview')}>
            <Activity className="mr-2 h-4 w-4" />
            View ATT overview
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onShowDetail?.(serialNumber, 'closeout')}>
            <CalendarCheck className="mr-2 h-4 w-4" />
            View daily closeout
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEdit?.(device)}>
            <Edit className="mr-2 h-4 w-4" />
            Edit Device
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setConfirmRebootOpen(true)}
            className={`${signalText.danger} focus:text-destructive`}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reboot Device
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmationDialog
        isOpen={confirmRebootOpen}
        title="Reboot device?"
        message={`This queues REBOOT for ${name || 'this device'} (${serialNumber}). The device restarts on its next poll, drops any punch upload in flight, and the queued command cannot be cancelled.`}
        confirmLabel="Reboot device"
        cancelLabel="Cancel"
        variant="destructive"
        isProcessing={isRebooting}
        onConfirm={handleConfirmReboot}
        onCancel={() => setConfirmRebootOpen(false)}
      />
    </>
  )
}
