import { useMemo, useState } from 'react'
import { format, parseISO, subDays, differenceInMinutes, isToday } from 'date-fns'
import {
  Activity,
  AlertTriangle,
  Calendar,
  Download,
  Loader2,
  RefreshCw,
  Upload,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  useDeviceAttlogClosureHistory,
  useDeviceAttlogMeta,
  useDeviceAttlogInFlightCommands,
  useDeviceRecentPunches,
  useAttlogForceLog,
  useAttlogForceSync,
  useAttlogPurge,
} from '@/hooks/use-attlog-closure'
import { useExportAttendanceLogs } from '@/hooks/use-attendance-logs'
import {
  attlogClosureLabel,
  attlogClosureCellRingClass,
} from '@/lib/attlog-closure-display'
import { useAuth } from '@/contexts/auth-context'
import { formatCheckTimeForLog } from '@/lib/attendance-log-display'
import {
  AttlogCommandTypeBadge,
  CommandQueueStatusBadge,
} from '@/components/shared/status-badges'
import { ATTLOG_CATCH_UP_DAYS } from '@/lib/attlog-constants'
import { AttlogSection } from '@/components/devices/attlog-section'
import { AttlogClosureLegend } from '@/components/devices/attlog-closure-legend'
import { AttlogHealthMetric } from '@/components/devices/attlog-health-metric'
import { toast } from 'sonner'

interface DeviceAttlogOverviewTabProps {
  deviceSn: string
  isOnline: boolean
  enabled: boolean
}

export function DeviceAttlogOverviewTab({
  deviceSn,
  isOnline,
  enabled,
}: DeviceAttlogOverviewTabProps) {
  const [purgeOpen, setPurgeOpen] = useState(false)
  const { isSuperAdmin } = useAuth()
  const { data: meta } = useDeviceAttlogMeta(deviceSn, enabled)
  const { data: closureHistory = [] } = useDeviceAttlogClosureHistory(deviceSn, enabled)
  const { data: inFlight = [] } = useDeviceAttlogInFlightCommands(deviceSn, enabled)
  const { data: recentPunches = [] } = useDeviceRecentPunches(deviceSn, enabled, 20)

  const forceLog = useAttlogForceLog(deviceSn)
  const forceSync = useAttlogForceSync(deviceSn)
  const purgeMutation = useAttlogPurge(deviceSn)
  const exportLogs = useExportAttendanceLogs()

  const timezone = meta?.timezone || 'Asia/Phnom_Penh'

  const closureByDate = useMemo(() => {
    const m = new Map<string, (typeof closureHistory)[0]>()
    for (const row of closureHistory) {
      m.set(row.local_date, row)
    }
    return m
  }, [closureHistory])

  const calendarDays = useMemo(() => {
    const days: {
      localDate: string
      status?: string
      label: string
      weekday: string
      date: Date
    }[] = []
    for (let i = ATTLOG_CATCH_UP_DAYS - 1; i >= 0; i--) {
      const d = subDays(new Date(), i)
      const localDate = format(d, 'yyyy-MM-dd')
      days.push({
        localDate,
        status: closureByDate.get(localDate)?.status,
        label: format(d, 'd'),
        weekday: format(d, 'EEEEE'),
        date: d,
      })
    }
    return days
  }, [closureByDate])

  const catchUpDepth = useMemo(
    () => closureHistory.filter((r) => r.status !== 'closed').length,
    [closureHistory]
  )

  const lastPunch = recentPunches[0]?.check_time

  const avgIngestLagMin = useMemo(() => {
    if (recentPunches.length === 0) return null
    let total = 0
    let n = 0
    for (const p of recentPunches.slice(0, 20)) {
      const lag = differenceInMinutes(parseISO(p.created_at), parseISO(p.check_time))
      if (lag >= 0) {
        total += lag
        n++
      }
    }
    return n > 0 ? Math.round(total / n) : null
  }, [recentPunches])

  const postPurgeRecent = useMemo(() => {
    if (!meta?.attlog_last_device_purge_at) return false
    const days = (Date.now() - new Date(meta.attlog_last_device_purge_at).getTime()) / 86400000
    return days <= 7
  }, [meta?.attlog_last_device_purge_at])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Scrollable content; whole-view actions live in the pinned bar below. */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 pb-4">
      {postPurgeRecent && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
          Device log buffer was cleared recently — bridge is the source of truth for archived days.
        </div>
      )}

      <AttlogSection
        title="Device health"
        icon={<Activity className="h-4 w-4 text-muted-foreground" />}
        contentClassName="grid grid-cols-2 sm:grid-cols-3 gap-2.5"
      >
        <AttlogHealthMetric label="Last closed day" value={meta?.attlog_last_closed_date || '—'} />
        <AttlogHealthMetric
          label="Catch-up backlog"
          value={catchUpDepth > 0 ? `${catchUpDepth} day(s) open` : 'None'}
          highlight={catchUpDepth > 0}
        />
        <AttlogHealthMetric
          label="Last punch (device)"
          value={
            lastPunch
              ? `${formatCheckTimeForLog(lastPunch, timezone).date} ${formatCheckTimeForLog(lastPunch, timezone).time}`
              : '—'
          }
          mono
        />
        <AttlogHealthMetric
          label="Avg ingest lag"
          value={avgIngestLagMin != null ? `${avgIngestLagMin} min` : '—'}
        />
        <AttlogHealthMetric
          label="Time drift"
          value={meta?.attlog_time_drift_suspected ? 'Suspected' : 'OK'}
          hint="Checked after each LOG upload: flags only when the newest punch is ahead of server time by >10 min (device clock running fast — impossible with a correct clock). Recent days are then automatically re-verified. Idle devices are never flagged; clocks re-sync to server GMT on each reconnect."
          highlight={!!meta?.attlog_time_drift_suspected}
          icon={
            meta?.attlog_time_drift_suspected ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            ) : undefined
          }
        />
        <AttlogHealthMetric
          label="Last device purge"
          value={
            meta?.attlog_last_device_purge_at
              ? format(parseISO(meta.attlog_last_device_purge_at), 'MMM d, yyyy')
              : 'Never'
          }
        />
      </AttlogSection>

      <AttlogSection
        title="14-day closeout"
        description={`Device local dates · ${timezone}`}
        icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
        contentClassName="space-y-4"
      >
        <div className="overflow-x-auto -mx-1 px-1 pb-0.5">
          <div className="grid grid-flow-col auto-cols-[minmax(2.75rem,1fr)] gap-1.5 min-w-max sm:min-w-0 sm:grid-flow-row sm:grid-cols-[repeat(14,minmax(0,1fr))] sm:gap-2">
            {calendarDays.map(({ localDate, status, label, weekday, date }) => {
              const today = isToday(date)
              return (
                <div
                  key={localDate}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-colors',
                    today
                      ? 'border-blue-200 bg-blue-50/60 ring-1 ring-blue-200/80'
                      : 'border-border/60 bg-muted/40 hover:bg-muted/60'
                  )}
                  title={`${localDate}: ${attlogClosureLabel(status)}`}
                >
                  <div
                    className={cn(
                      'h-1.5 w-[85%] rounded-full',
                      attlogClosureCellRingClass(status)
                    )}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
                    {weekday}
                  </span>
                  <span className="text-xs font-mono tabular-nums font-medium leading-none">
                    {label}
                  </span>
                  <span className="text-[9px] text-muted-foreground leading-none hidden sm:block">
                    {format(date, 'MMM')}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <AttlogClosureLegend compact />
      </AttlogSection>

      {inFlight.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 space-y-2">
          <div className="text-sm font-medium text-amber-900 dark:text-amber-100">
            In-flight ATTLOG commands
          </div>
          {inFlight.map((cmd) => (
            <div key={cmd.id} className="flex flex-wrap gap-2 items-center text-xs">
              <AttlogCommandTypeBadge commandType={cmd.command_type} />
              <span className="text-muted-foreground truncate max-w-md">{cmd.command}</span>
              <CommandQueueStatusBadge status={cmd.status} />
            </div>
          ))}
        </div>
      )}
      </div>

      {/* Pinned whole-view actions (info top, commands bottom — app-wide rule). */}
      <DialogFooter variant="bar" className="flex-wrap">
        {!isOnline && (
          <p className="mr-auto self-center text-xs text-muted-foreground">
            Device offline — LOG and sync actions resume when it reconnects.
          </p>
        )}
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!isOnline || forceLog.isPending}
              title="Queue LOG — device uploads pending ATTLOG to bridge"
              onClick={() => {
                forceLog.mutate(undefined, {
                  onSuccess: () => toast.success('LOG command queued'),
                  onError: (e) => toast.error(e.message),
                })
              }}
            >
              {forceLog.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1.5" />
              )}
              Force LOG
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!isOnline || forceSync.isPending}
              title="Reconnect sync — refresh device stamps after reconnect"
              onClick={() => {
                forceSync.mutate(undefined, {
                  onSuccess: () => toast.success('Reconnect sync queued'),
                  onError: (e) => toast.error(e.message),
                })
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Force sync
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={exportLogs.isPending}
              title="Export attendance logs for this device (CSV)"
              onClick={() => {
                exportLogs.mutate(
                  { device_sn: deviceSn, limit: 5000 },
                  {
                    onSuccess: () => toast.success('Export started'),
                    onError: (e) => toast.error(e.message),
                  }
                )
              }}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export CSV
            </Button>
            {isSuperAdmin && (
              <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8"
                    disabled={!isOnline || purgeMutation.isPending}
                    title="CLEAR LOG — wipes on-device ATTLOG buffer (Super Admin)"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    CLEAR LOG
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear device ATTLOG buffer?</DialogTitle>
                    <DialogDescription>
                      This queues CLEAR LOG on the device and wipes all on-terminal attendance
                      records. Bridge closed days remain the archive. Purge gate must pass.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPurgeOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        purgeMutation.mutate(undefined, {
                          onSuccess: () => {
                            setPurgeOpen(false)
                            toast.success('CLEAR LOG queued')
                          },
                          onError: (e) => toast.error(e.message),
                        })
                      }}
                    >
                      Confirm
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
      </DialogFooter>
    </div>
  )
}
