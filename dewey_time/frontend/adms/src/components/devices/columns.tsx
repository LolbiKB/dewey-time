import { format, parseISO } from 'date-fns'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import {
  Wifi,
  WifiOff,
} from 'lucide-react'
import {
  SelectFilterHeader,
  DeviceCell,
} from '@/components/ui/table-components'
import type { DeviceEntry } from '@/services/device-service'
import type { DeviceAttlogClosureRow } from '@/hooks/use-attlog-closure'
import { AttlogCatchUpBadge, AttlogClosureBadge } from '@/components/shared/status-badges'
import { DeviceSecuritySerialHint } from '@/components/devices/device-security-banner'
import { DeviceRowActions } from '@/components/devices/device-row-actions'
import type { DeviceDetailTab } from '@/components/devices/device-detail-tabs'
import { signalBadge } from '@/lib/signal'

interface CreateDeviceColumnsProps {
  onFilterByStatus?: (status: string) => void
  currentStatusFilter?: string
  onDeviceCommand?: (
    serialNumber: string,
    commandType: string,
    commandBody: string
  ) => void | Promise<void>
  onEdit?: (device: DeviceEntry) => void
  onShowDetail?: (serialNumber: string, tab?: DeviceDetailTab) => void
  yesterdayClosureBySn?: Map<string, DeviceAttlogClosureRow>
  catchUpDepthBySn?: Map<string, number>
}

// Status options for filter
const STATUS_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
]

export function createDeviceColumns({
  onFilterByStatus,
  currentStatusFilter,
  onDeviceCommand,
  onEdit,
  onShowDetail,
  yesterdayClosureBySn,
  catchUpDepthBySn,
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
          />
        )
      },
    },
    {
      id: 'serial_number',
      accessorKey: 'serial_number',
      header: 'Serial Number',
      cell: ({ row }) => {
        const device = row.original
        const serialNumber = row.getValue('serial_number') as string
        return (
          <div className="flex items-center gap-2 min-w-0">
            <code className="text-sm font-mono truncate">{serialNumber}</code>
            <DeviceSecuritySerialHint device={device} />
          </div>
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
            <Badge variant="secondary" className={isOnline ? signalBadge.success : signalBadge.idle}>
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
      id: 'fp_algorithm_version',
      accessorKey: 'fp_algorithm_version',
      header: 'FP Version',
      cell: ({ row }) => {
        const fpVersion = row.original.fp_algorithm_version
        const faceVersion = row.original.face_algorithm_version
        
        return (
          <div className="flex items-center gap-2">
            {fpVersion ? (
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="font-mono text-xs">
                  FP: {fpVersion}
                </Badge>
                {faceVersion && (
                  <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                    Face: {faceVersion}
                  </Badge>
                )}
              </div>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Unknown
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      id: 'attlog_catchup',
      header: 'Catch-up',
      cell: ({ row }) => {
        const depth = catchUpDepthBySn?.get(row.original.serial_number) ?? 0
        if (depth === 0) {
          return <span className="text-muted-foreground text-sm">—</span>
        }
        return <AttlogCatchUpBadge depth={depth} />
      },
    },
    {
      id: 'attlog_closure',
      header: 'Yesterday ledger',
      cell: ({ row }) => {
        const sn = row.original.serial_number
        const closure = yesterdayClosureBySn?.get(sn)
        const status = closure?.status
        return (
          <AttlogClosureBadge
            status={status}
            title={
              closure?.last_error ||
              (closure?.device_sum != null
                ? `device=${closure.device_sum} bridge=${closure.server_sum ?? '—'}`
                : 'Daily ATTLOG closeout — see runbook')
            }
          />
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
      cell: ({ row }) => (
        <DeviceRowActions
          device={row.original}
          onDeviceCommand={onDeviceCommand}
          onEdit={onEdit}
          onShowDetail={onShowDetail}
        />
      ),
    },
  ]
}
