import { format, parseISO } from 'date-fns'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, MoreHorizontal, RotateCcw, Info, RefreshCw, Send } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SelectFilterHeader,
  TwoLineTextCell,
} from '@/components/ui/table-components'
import type { DeviceEntry } from '@/services/device-service'

interface CreateDeviceColumnsProps {
  onFilterByStatus?: (status: string) => void
  onFilterByMaster?: (isMaster: string) => void
  currentStatusFilter?: string
  currentMasterFilter?: string
  onSetMaster?: (serialNumber: string) => void
  onDeviceCommand?: (serialNumber: string, commandType: string, commandBody: string) => void
}

// Status options for filter
const STATUS_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
]

// Master filter options
const MASTER_OPTIONS = [
  { value: 'true', label: 'Master' },
  { value: 'false', label: 'Not Master' },
]

export function createDeviceColumns({
  onFilterByStatus,
  onFilterByMaster,
  currentStatusFilter,
  currentMasterFilter,
  onSetMaster,
  onDeviceCommand,
}: CreateDeviceColumnsProps): ColumnDef<DeviceEntry>[] {
  return [
    {
      id: 'serial_number',
      accessorKey: 'serial_number',
      header: 'Serial Number',
      cell: ({ row }) => (
        <div className="font-mono font-medium">{row.getValue('serial_number')}</div>
      ),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Device Name',
      cell: ({ row }) => {
        const name = row.getValue('name') as string | undefined
        return (
          <div className="font-medium">{name || <span className="text-xs italic text-muted-foreground">Unnamed</span>}</div>
        )
      },
    },
    {
      id: 'location',
      accessorKey: 'location',
      header: 'Location',
      cell: ({ row }) => {
        const location = row.getValue('location') as string | undefined
        return (
          <div className="text-muted-foreground text-sm">{location || <span className="text-xs italic">-</span>}</div>
        )
      },
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: onFilterByStatus
        ? () => (
          <SelectFilterHeader
            title="Status"
            options={STATUS_OPTIONS}
            currentFilter={currentStatusFilter}
            onFilterChange={onFilterByStatus}
          />
        )
        : 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        return (
          <Badge variant={status === 'online' ? 'default' : 'secondary'}>
            {status === 'online' ? 'Online' : 'Offline'}
          </Badge>
        )
      },
    },
    {
      id: 'last_seen',
      accessorKey: 'last_seen',
      header: 'Last Seen',
      cell: ({ row }) => {
        const lastSeen = row.getValue('last_seen') as string | undefined
        const lastSeenMinutes = row.original.last_seen_minutes

        if (!lastSeen) {
          return <span className="text-sm text-muted-foreground">Never</span>
        }

        const timestamp = parseISO(lastSeen)
        let timeAgo = ''

        if (lastSeenMinutes !== null && lastSeenMinutes !== undefined) {
          if (lastSeenMinutes < 1) {
            timeAgo = 'Just now'
          } else if (lastSeenMinutes < 60) {
            timeAgo = `${lastSeenMinutes}m ago`
          } else {
            const hours = Math.floor(lastSeenMinutes / 60)
            timeAgo = `${hours}h ago`
          }
        }

        return (
          <TwoLineTextCell
            mainText={format(timestamp, 'MMM d, h:mm a')}
            secondaryText={timeAgo}
            mainClassName="text-sm"
            secondaryClassName="text-xs"
          />
        )
      },
    },
    {
      id: 'is_master',
      accessorKey: 'is_master',
      header: onFilterByMaster
        ? () => (
          <SelectFilterHeader
            title="Master"
            options={MASTER_OPTIONS}
            currentFilter={currentMasterFilter}
            onFilterChange={onFilterByMaster}
          />
        )
        : 'Master',
      cell: ({ row }) => {
        const isMaster = row.getValue('is_master') as boolean
        return (
          <div className="flex items-center gap-2">
            {isMaster ? (
              <Badge variant="default">Master</Badge>
            ) : (
              <span className="text-sm text-muted-foreground">-</span>
            )}
          </div>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const isMaster = row.getValue('is_master') as boolean
        const serialNumber = row.getValue('serial_number') as string

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isMaster && (
                <DropdownMenuItem onClick={() => onSetMaster?.(serialNumber)}>
                  <Check className="mr-2 h-4 w-4" />
                  Set as Master
                </DropdownMenuItem>
              )}
              {isMaster && (
                <DropdownMenuItem disabled>
                  <Check className="mr-2 h-4 w-4" />
                  Current Master
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDeviceCommand?.(serialNumber, 'info', 'INFO')}
              >
                <Info className="mr-2 h-4 w-4" />
                Request Info
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDeviceCommand?.(serialNumber, 'check', 'CHECK')}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Force Sync
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDeviceCommand?.(serialNumber, 'log', 'LOG')}
              >
                <Send className="mr-2 h-4 w-4" />
                Push New Logs
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDeviceCommand?.(serialNumber, 'reboot', 'REBOOT')}
                className="text-destructive focus:text-destructive"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reboot Device
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
}
