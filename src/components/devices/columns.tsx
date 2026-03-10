import { format, parseISO } from 'date-fns'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  Check, 
  MoreHorizontal, 
  RotateCcw, 
  Info, 
  RefreshCw, 
  Send, 
  History,
  Wifi,
  WifiOff,
  Crown,
  Edit
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SelectFilterHeader,
  DeviceCell,
} from '@/components/ui/table-components'
import type { DeviceEntry } from '@/services/device-service'

interface CreateDeviceColumnsProps {
  onFilterByStatus?: (status: string) => void
  currentStatusFilter?: string
  onSetMaster?: (serialNumber: string) => void
  onDeviceCommand?: (serialNumber: string, commandType: string, commandBody: string) => void
  onShowHistory?: (serialNumber: string) => void
  onEdit?: (device: DeviceEntry) => void
}

// Status options for filter
const STATUS_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
]

export function createDeviceColumns({
  onFilterByStatus,
  currentStatusFilter,
  onSetMaster,
  onDeviceCommand,
  onShowHistory,
  onEdit,
}: CreateDeviceColumnsProps): ColumnDef<DeviceEntry>[] {
  return [
    {
      id: 'device',
      header: 'Device',
      cell: ({ row }) => {
        const device = row.original
        return (
          <DeviceCell
            name={device.name}
            location={device.location}
            isMaster={device.is_master}
          />
        )
      },
    },
    {
      id: 'serial_number',
      accessorKey: 'serial_number',
      header: 'Serial Number',
      cell: ({ row }) => {
        const serialNumber = row.getValue('serial_number') as string
        return (
          <code className="text-sm font-mono">
            {serialNumber}
          </code>
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
        const isOnline = status === 'online'
        
        return (
          <div className="flex justify-center">
            <Badge className={isOnline ? 'bg-green-100 text-green-800 hover:bg-green-100 border-transparent' : 'bg-gray-100 text-gray-800 hover:bg-gray-100 border-transparent'}>
              {isOnline ? (
                <Wifi className="h-3 w-3 mr-1" />
              ) : (
                <WifiOff className="h-3 w-3 mr-1" />
              )}
              {isOnline ? 'Online' : 'Offline'}
            </Badge>
          </div>
        )
      },
    },
    {
      id: 'last_seen',
      accessorKey: 'last_seen',
      header: 'Last Seen',
      cell: ({ row }) => {
        const lastSeen = row.getValue('last_seen') as string | undefined

        if (!lastSeen) {
          return <span className="text-muted-foreground text-sm">-</span>
        }

        const timestamp = parseISO(lastSeen)
        const timeStr = format(timestamp, 'MMM d, h:mm a')

        return (
          <span className="text-sm text-muted-foreground">{timeStr}</span>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const isMaster = row.original.is_master
        const serialNumber = row.original.serial_number
        const name = row.original.name

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-gray-100">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* Device Info Header */}
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{name || 'Unnamed Device'}</p>
                  <p className="text-xs text-muted-foreground">{serialNumber}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              
              {/* Master Device Section */}
              <DropdownMenuLabel className="text-xs">Master Device</DropdownMenuLabel>
              {!isMaster ? (
                <DropdownMenuItem onClick={() => onSetMaster?.(serialNumber)}>
                  <Crown className="mr-2 h-4 w-4" />
                  Set as Master
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled>
                  <Check className="mr-2 h-4 w-4" />
                  Current Master
                </DropdownMenuItem>
              )}
              
              <DropdownMenuSeparator />
              
              {/* Quick Commands Section */}
              <DropdownMenuLabel className="text-xs">Quick Commands</DropdownMenuLabel>
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
              
              {/* Device Management Section */}
              <DropdownMenuLabel className="text-xs">Management</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onEdit?.(row.original)}>
                <Edit className="mr-2 h-4 w-4" />
                Edit Device
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onShowHistory?.(serialNumber)}>
                <History className="mr-2 h-4 w-4" />
                Command History
              </DropdownMenuItem>
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
