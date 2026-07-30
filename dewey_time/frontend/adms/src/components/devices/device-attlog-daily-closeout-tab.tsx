import { Link } from 'react-router-dom'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useDeviceAttlogClosureHistory,
  useDeviceAttlogMeta,
  useRetryAttlogClosure,
} from '@/hooks/use-attlog-closure'
import { attlogClosureLabel } from '@/lib/attlog-closure-display'
import { DEFAULT_DEVICE_TZ, deviceDayWindowIso } from '@/lib/attendance-log-display'
import { AttlogClosureBadge } from '@/components/shared/status-badges'
import { AttlogSection } from '@/components/devices/attlog-section'
import { toast } from 'sonner'

interface DeviceAttlogDailyCloseoutTabProps {
  deviceSn: string
  enabled: boolean
}

export function DeviceAttlogDailyCloseoutTab({
  deviceSn,
  enabled,
}: DeviceAttlogDailyCloseoutTabProps) {
  const { data: closureHistory = [], isLoading: closureLoading } = useDeviceAttlogClosureHistory(
    deviceSn,
    enabled
  )
  const { data: meta } = useDeviceAttlogMeta(deviceSn, enabled)
  const retryMutation = useRetryAttlogClosure(deviceSn)

  const handleRetry = async (localDate: string) => {
    try {
      await retryMutation.mutateAsync(localDate)
      toast.success(`Verify queued for ${localDate}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Retry failed')
    }
  }

  // local_date is a device-LOCAL calendar date, so the punch window has to be
  // built in the device's timezone — a UTC window shows a shifted day and the
  // device/bridge counts on this row can never be checked by eye.
  const openAttendanceLogsUrl = (localDate: string) => {
    const { dateFrom, dateTo } = deviceDayWindowIso(localDate, meta?.timezone)
    const params = new URLSearchParams({ device_sn: deviceSn, dateFrom, dateTo })
    return `/attendance-logs?${params.toString()}`
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 pb-4">
      <AttlogSection
        title="Daily closeout"
        description={`Per-day device vs bridge counts, dated in device-local time (${meta?.timezone || DEFAULT_DEVICE_TZ}). View logs on the Attendance Logs page.`}
        contentClassName="min-h-0"
      >
        {closureLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Counts</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closureHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No closeout rows yet
                    </TableCell>
                  </TableRow>
                ) : (
                  closureHistory.map((row) => {
                    const mismatch =
                      row.status === 'closure_failed' &&
                      row.device_sum != null &&
                      row.server_sum != null &&
                      row.device_sum !== row.server_sum
                    return (
                      <TableRow key={row.local_date} className="align-top">
                        <TableCell className="font-mono text-xs py-2.5">{row.local_date}</TableCell>
                        <TableCell className="py-2.5">
                          <AttlogClosureBadge
                            status={row.status}
                            label={
                              row.status === 'backfill_running' &&
                              row.backfill_chunks_total != null
                                ? `${attlogClosureLabel(row.status)} (${row.backfill_chunks_done ?? 0}/${row.backfill_chunks_total})`
                                : undefined
                            }
                          />
                          {row.last_error && (
                            <p
                              className="text-xs text-muted-foreground mt-1.5 line-clamp-2 break-words"
                              title={row.last_error}
                            >
                              {row.last_error}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs py-2.5 space-y-0.5">
                          <div>Device: {row.device_sum ?? '—'}</div>
                          <div>Bridge: {row.server_sum ?? '—'}</div>
                          {mismatch && (
                            <div className="text-destructive font-medium">
                              Δ {Math.abs(row.device_sum! - row.server_sum!)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right py-2.5 space-x-1">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to={openAttendanceLogsUrl(row.local_date)}>
                              <ExternalLink className="h-3.5 w-3.5 mr-1" />
                              View logs
                            </Link>
                          </Button>
                          {(row.status === 'closure_failed' ||
                            row.status === 'deferred_offline' ||
                            row.status === 'pending_verify') && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={retryMutation.isPending}
                              onClick={() => void handleRetry(row.local_date)}
                            >
                              Retry
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </AttlogSection>
    </div>
  )
}
