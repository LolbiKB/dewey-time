import { format, parseISO } from 'date-fns'
import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { 
  Fingerprint, 
  ScanFace, 
  KeyRound,
  Monitor,
  MapPin,
} from 'lucide-react'
import {
  SelectFilterHeader,
  DateFilterHeader,
} from '@/components/ui/table-components'
import type { AttendanceLogEntry } from '@/services/attendance-log-service'

interface CreateAttendanceLogColumnsProps {
  onFilterByDevice?: (device: string) => void
  onFilterByStatus?: (status: string) => void
  onFilterByVerifyType?: (type: string) => void
  onFilterByDate?: (date: Date | undefined) => void
  currentDeviceFilter?: string
  currentStatusFilter?: string
  currentVerifyTypeFilter?: string
  currentDateFilter?: Date
  availableDevices?: Array<{ value: string; label: string }>
}

export function createAttendanceLogColumns({
  onFilterByDevice,
  onFilterByStatus,
  onFilterByVerifyType,
  onFilterByDate,
  currentDeviceFilter,
  currentStatusFilter,
  currentVerifyTypeFilter,
  currentDateFilter,
  availableDevices = [],
}: CreateAttendanceLogColumnsProps): ColumnDef<AttendanceLogEntry>[] {
  return [
    {
      id: 'check_time',
      accessorKey: 'check_time',
      header: onFilterByDate
        ? () => (
          <DateFilterHeader
            title="Check Time"
            currentFilter={currentDateFilter}
            onFilterChange={onFilterByDate}
          />
        )
        : 'Check Time',
      cell: ({ row }) => {
        const timestamp = parseISO(row.getValue('check_time'))
        return (
          <div className="flex flex-col">
            <span className="font-medium">{format(timestamp, 'MMM d, yyyy')}</span>
            <span className="text-sm text-muted-foreground">{format(timestamp, 'h:mm a')}</span>
          </div>
        )
      },
    },
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => {
        const pin = row.original.user_pin
        const user = row.original.users
        return (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <KeyRound className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col">
              {user?.name ? (
                <>
                  <span className="font-medium">{user.name}</span>
                  <span className="text-sm text-muted-foreground">{user.frappe_employee_id || `PIN: ${pin}`}</span>
                </>
              ) : (
                <code className="font-mono font-medium">{pin}</code>
              )}
            </div>
          </div>
        )
      },
    },
    {
      id: 'device_sn',
      accessorKey: 'device_sn',
      header: onFilterByDevice && availableDevices.length > 0
        ? () => (
          <SelectFilterHeader
            title="Device"
            options={availableDevices}
            currentFilter={currentDeviceFilter}
            onFilterChange={onFilterByDevice}
          />
        )
        : 'Device',
      cell: ({ row }) => {
        const device = row.original.devices
        const sn = row.getValue('device_sn') as string
        const deviceName = device?.name || sn
        const deviceDisplay = device?.location && device?.location !== device?.name 
          ? `${deviceName} (${device.location})`
          : deviceName
        return (
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Monitor className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="font-medium flex items-center gap-1">
                {deviceDisplay}
                {device?.location && device?.location !== device?.name && (
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                )}
              </span>
              <span className="text-sm text-muted-foreground">{sn}</span>
            </div>
          </div>
        )
      },
    },
    {
      id: 'verify_type',
      accessorKey: 'verify_type',
      header: onFilterByVerifyType
        ? () => (
          <SelectFilterHeader
            title="Verify Type"
            options={[
              { value: '1', label: 'Fingerprint' },
              { value: '15', label: 'Face' },
              { value: '0', label: 'Password' },
            ]}
            currentFilter={currentVerifyTypeFilter}
            onFilterChange={onFilterByVerifyType}
          />
        )
        : 'Verify Type',
      cell: ({ row }) => {
        const type = row.getValue('verify_type') as number
        const config: Record<number, { label: string; className: string; icon: typeof KeyRound }> = {
          0: { label: 'Password', className: 'text-gray-600', icon: KeyRound },
          1: { label: 'Fingerprint', className: 'text-blue-700', icon: Fingerprint },
          15: { label: 'Face', className: 'text-purple-700', icon: ScanFace },
          255: { label: 'Other', className: 'text-slate-600', icon: KeyRound },
        }
        const { label, className, icon: Icon } = config[type] || config[255]
        return (
          <Badge variant="secondary" className={`${className} pointer-events-none`}>
            <Icon className="h-3 w-3 mr-1" />
            {label}
          </Badge>
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
            options={[
              { value: '0', label: 'Check-In' },
              { value: '1', label: 'Check-Out' },
              { value: '255', label: 'Unknown' },
            ]}
            currentFilter={currentStatusFilter}
            onFilterChange={onFilterByStatus}
          />
        )
        : 'Status',
      cell: ({ row }) => {
        const status = row.getValue('status') as number
        const config: Record<number, { label: string; className: string }> = {
          0: { label: 'Check-In', className: 'text-green-700' },
          1: { label: 'Check-Out', className: 'text-amber-700' },
          255: { label: 'Unknown', className: 'text-gray-500' },
        }
        const { label, className } = config[status] || config[255]
        return (
          <Badge variant="secondary" className={`${className} pointer-events-none`}>
            {label}
          </Badge>
        )
      },
    },
  ]
}
