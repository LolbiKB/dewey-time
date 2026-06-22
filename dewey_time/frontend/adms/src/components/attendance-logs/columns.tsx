import type { ColumnDef } from '@tanstack/react-table'
import {
  SelectFilterHeader,
  DateFilterHeader,
} from '@/components/ui/table-components'
import type { AttendanceLogEntry } from '@/services/attendance-log-service'
import {
  formatCheckTimeForLog,
  formatIngestedTime,
  erpPairingPreviewLabel,
} from '@/lib/attendance-log-display'
import { HrSyncBadge } from '@/components/shared/status-badges'
import { signalText } from '@/lib/signal'

interface CreateAttendanceLogColumnsProps {
  onFilterByVerifyType?: (type: string) => void
  onFilterByDate?: (date: Date | undefined) => void
  currentVerifyTypeFilter?: string
  currentDateFilter?: Date
  showSequence?: boolean
  sequenceMap?: Map<number, number>
}

export function createAttendanceLogColumns({
  onFilterByVerifyType,
  onFilterByDate,
  currentVerifyTypeFilter,
  currentDateFilter,
  showSequence = false,
  sequenceMap = new Map(),
}: CreateAttendanceLogColumnsProps): ColumnDef<AttendanceLogEntry>[] {
  const cols: ColumnDef<AttendanceLogEntry>[] = []

  if (showSequence) {
    cols.push({
      id: 'seq',
      header: 'Seq #',
      cell: ({ row }) => {
        const seq = sequenceMap.get(row.original.id)
        if (!seq) return <span className="text-muted-foreground">—</span>
        const preview = erpPairingPreviewLabel(seq)
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono font-medium">{seq}</span>
            <span className="text-[10px] text-muted-foreground" title="ERP pairing preview">
              ERP {preview}
            </span>
          </div>
        )
      },
    })
  }

  cols.push(
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
        const { date, time, timeZoneLabel } = formatCheckTimeForLog(
          row.getValue('check_time') as string,
          row.original.devices?.timezone
        )
        return (
          <div className="flex flex-col" title={`Device clock (${timeZoneLabel})`}>
            <span className="font-medium">{date}</span>
            <span className="text-sm text-muted-foreground">{time}</span>
          </div>
        )
      },
    },
    {
      id: 'location',
      accessorKey: 'device_sn',
      header: 'Location',
      cell: ({ row }) => {
        const device = row.original.devices
        const sn = row.original.device_sn
        const deviceName = device?.name || sn
        const deviceDisplay =
          device?.location && device?.location !== device?.name
            ? `${deviceName} (${device.location})`
            : deviceName
        return (
          <div className="flex flex-col">
            <span className="font-medium">{deviceDisplay}</span>
            <span className="font-mono text-xs text-muted-foreground">{sn}</span>
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
          <div className="flex flex-col">
            {user?.name ? (
              <>
                <span className="font-medium">{user.name}</span>
                <span className="text-xs text-muted-foreground">
                  {user.frappe_employee_id || `PIN: ${pin}`}
                </span>
              </>
            ) : (
              <>
                <code className="font-mono font-medium">{pin}</code>
                <span className={`text-xs ${signalText.attention}`}>Unknown PIN</span>
              </>
            )}
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
              title="Verify"
              options={[
                { value: '1', label: 'Fingerprint' },
                { value: '15', label: 'Face' },
                { value: '0', label: 'Password' },
              ]}
              currentFilter={currentVerifyTypeFilter}
              onFilterChange={onFilterByVerifyType}
            />
          )
        : 'Verify',
      cell: ({ row }) => {
        const type = row.getValue('verify_type') as number
        const labels: Record<number, string> = {
          0: 'Password',
          1: 'Fingerprint',
          15: 'Face',
          255: 'Other',
        }
        return (
          <span className="text-sm text-muted-foreground">{labels[type] ?? labels[255]}</span>
        )
      },
    },
    {
      id: 'hr_sync',
      header: 'HR sync',
      cell: ({ row }) => {
        const log = row.original
        const status = (log.sync_status || 'PENDING').toUpperCase()
        return (
          <div className="flex flex-col gap-0.5 max-w-[200px]">
            <HrSyncBadge syncStatus={log.sync_status} />
            {log.frappe_checkin_id && (
              <span className="text-[10px] text-muted-foreground font-mono truncate">
                {log.frappe_checkin_id}
              </span>
            )}
            {log.last_error_message && status === 'FAILED' && (
              <span className={`text-[10px] line-clamp-2 ${signalText.danger}`}>
                {log.last_error_message}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'suspicious',
      header: 'Suspicious',
      cell: ({ row }) => {
        const log = row.original
        if (!log.is_suspicious) {
          return <span className="text-muted-foreground text-sm">—</span>
        }
        const reason =
          log.suspicious_reason === 'multi_device_same_time'
            ? 'Same time, different device'
            : log.suspicious_reason === 'duplicate_punch_window'
              ? 'Duplicate within 10 min'
              : log.suspicious_reason || 'Flagged'
        return (
          <span className={`inline-flex items-center gap-1.5 text-xs ${signalText.attention}`}>
            <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" />
            {reason}
          </span>
        )
      },
    },
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: 'Ingested',
      cell: ({ row }) => {
        const { date, time } = formatIngestedTime(row.getValue('created_at') as string)
        return (
          <div
            className="flex flex-col text-sm text-muted-foreground"
            title="When the bridge stored this punch (your browser timezone — may differ from device check time if upload was delayed)"
          >
            <span>{date}</span>
            <span>{time}</span>
          </div>
        )
      },
    }
  )

  return cols
}
