import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { signalText, signalDot } from '@/lib/signal'
import { useNavigate } from 'react-router'
import { useDevices, useSyncStatus, useCommandQueue } from '@/hooks/use-core-data'
import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ChevronRight,
} from 'lucide-react'

const COMMAND_FRESHNESS_MS = 2 * 60 * 1000
const FAILED_COMMAND_WINDOW_MS = 60 * 60 * 1000
/** Tooltip-only: recent auto-cancelled housekeeping (does not affect chip color). */
const CANCELLED_COMMAND_WINDOW_MS = 30 * 60 * 1000

const ENROLLMENT_INCOMPLETE_MSG = 'Template upload not received from device'

function isReconcileLegacyFailed(c: { status: string; error_message?: string | null }) {
  return (
    c.status === 'failed' &&
    typeof c.error_message === 'string' &&
    c.error_message.includes('Cancelled by reconcile')
  )
}

function isEnrollmentIncompleteFailed(c: {
  status: string
  error_message?: string | null
  command_type?: string
}) {
  if (c.status !== 'failed') return false
  if (
    c.command_type === 'enroll_fingerprint' ||
    c.command_type === 'enroll_face'
  ) {
    return true
  }
  return (
    typeof c.error_message === 'string' &&
    c.error_message.includes(ENROLLMENT_INCOMPLETE_MSG)
  )
}

/** Auto-healed cancels — must not count as issues or "needs cleanup" rows. */
function isSupersededCancelled(c: { status: string; error_message?: string | null }) {
  if (c.status !== 'cancelled') return false
  const msg = (c.error_message ?? '').toLowerCase()
  const patterns = [
    'superseded',
    'duplicate',
    'cancelled by reconcile',
    'verification loop',
    'stale',
    'superseded by newer',
  ]
  return patterns.some((p) => msg.includes(p))
}

/** Failures that should turn the header red (retry-worthy system failures). */
function isActionableFailed(
  c: {
    status: string
    error_message?: string | null
    created_at: string
    command_type?: string
  },
  now: number
) {
  if (c.status !== 'failed' || isReconcileLegacyFailed(c)) return false
  if (isEnrollmentIncompleteFailed(c)) return false
  return now - new Date(c.created_at).getTime() < FAILED_COMMAND_WINDOW_MS
}

function isEnrollmentIncompleteInWindow(
  c: { status: string; error_message?: string | null; created_at: string; command_type?: string },
  now: number
) {
  if (!isEnrollmentIncompleteFailed(c)) return false
  return now - new Date(c.created_at).getTime() < FAILED_COMMAND_WINDOW_MS
}

type Status = 'healthy' | 'syncing' | 'warning' | 'critical'

const STATUS_COLORS: Record<
  Status,
  { dot: string; icon: typeof CheckCircle2; label: string }
> = {
  healthy: { dot: signalDot.success, icon: CheckCircle2, label: 'All operational' },
  syncing: { dot: signalDot.progress, icon: RefreshCw, label: 'Sync in progress' },
  warning: { dot: signalDot.attention, icon: Activity, label: 'Minor issues' },
  critical: { dot: signalDot.danger, icon: AlertTriangle, label: 'Issues detected' },
}

export function HeaderDeviceStatus() {
  const navigate = useNavigate()
  const { data: devices, isLoading: devicesLoading } = useDevices()
  const { data: syncData, isLoading: syncLoading } = useSyncStatus()
  const { data: commands, isLoading: commandsLoading } = useCommandQueue()

  const m = useMemo(() => {
    const list = devices?.devices ?? []
    const total = list.length
    const online = list.filter((d: any) => d.isOnline).length
    const offline = total - online

    const failedUsers = (syncData ?? []).filter(
      (s: any) => s.actual_state === 'not_synced' && s.error_message !== null
    ).length

    const now = Date.now()
    const cmdList = commands ?? []

    const pendingCommands = cmdList.filter((c: any) => {
      const age = now - new Date(c.created_at).getTime()
      return age < COMMAND_FRESHNESS_MS && (c.status === 'pending' || c.status === 'sent')
    }).length

    const failedCommands = cmdList.filter((c: any) => isActionableFailed(c, now)).length

    const enrollmentIncomplete = cmdList.filter((c: any) =>
      isEnrollmentIncompleteInWindow(c, now)
    ).length

    const enrollmentCleanupPending = cmdList.filter((c: any) => {
      const age = now - new Date(c.created_at).getTime()
      return (
        age < COMMAND_FRESHNESS_MS &&
        c.command_type === 'delete_fingerprint' &&
        c.initiated_by === 'enrollment_abort' &&
        (c.status === 'pending' || c.status === 'sent')
      )
    }).length

    const cancelledAll = cmdList.filter((c: any) => {
      if (c.status !== 'cancelled') return false
      return now - new Date(c.created_at).getTime() < CANCELLED_COMMAND_WINDOW_MS
    })
    const cancelledSuperseded = cancelledAll.filter((c: any) => isSupersededCancelled(c)).length
    const autoResolvedCancelled = cancelledSuperseded
    const cancelledCommands = cancelledAll.length - cancelledSuperseded

    const driftCount = list.filter((d: any) => d.stats_drift_detected).length

    const hasCriticalIssues = failedCommands > 0 || failedUsers > 0
    // Cancelled housekeeping is informational only — never amber chip
    const hasMinorIssues =
      enrollmentIncomplete > 0 || offline > 0 || driftCount > 0

    const issueCount =
      failedCommands +
      failedUsers +
      offline +
      driftCount +
      enrollmentIncomplete

    let status: Status = 'healthy'
    if (hasCriticalIssues) status = 'critical'
    else if (pendingCommands > 0) status = 'syncing'
    else if (hasMinorIssues) status = 'warning'

    return {
      total,
      online,
      offline,
      failedUsers,
      pendingCommands,
      failedCommands,
      enrollmentIncomplete,
      enrollmentCleanupPending,
      autoResolvedCancelled,
      cancelledCommands,
      driftCount,
      hasCriticalIssues,
      hasMinorIssues,
      issueCount,
      status,
      loading: devicesLoading || syncLoading || commandsLoading,
    }
  }, [devices, syncData, commands, devicesLoading, syncLoading, commandsLoading])

  const color = STATUS_COLORS[m.status]
  const [open, setOpen] = useState(false)

  if (m.loading) {
    return (
      <div className="flex items-center gap-2 rounded-full border bg-muted/50 px-2.5 py-1 animate-pulse">
        <div className="h-2 w-2 rounded-full bg-muted-foreground/20" />
        <div className="h-3 w-10 rounded bg-muted-foreground/20" />
      </div>
    )
  }

  // Flat issue/activity rows — only non-zero entries render, so the healthy
  // dialog stays a calm two-liner instead of boxes full of zeros.
  const detailRows = [
    { key: 'offline', label: 'Devices offline', value: m.offline, tone: signalText.danger },
    { key: 'active', label: 'Commands in flight', value: m.pendingCommands, tone: signalText.progress },
    { key: 'failedCmd', label: 'Failed commands (last hour)', value: m.failedCommands, tone: signalText.danger },
    { key: 'failedUsers', label: 'Failed user syncs', value: m.failedUsers, tone: signalText.danger },
    { key: 'enroll', label: 'Enrollment incomplete', value: m.enrollmentIncomplete, tone: signalText.attention },
    { key: 'cleanup', label: 'Enrollment cleanup running', value: m.enrollmentCleanupPending, tone: signalText.progress },
    { key: 'cancelled', label: 'Cancelled commands (30 min)', value: m.cancelledCommands, tone: signalText.attention },
    { key: 'drift', label: 'Devices with stats drift', value: m.driftCount, tone: signalText.attention },
    { key: 'resolved', label: 'Auto-resolved housekeeping', value: m.autoResolvedCancelled, tone: signalText.idle },
  ].filter((s) => s.value > 0)

  return (
    <>
      {/* Simplified indicator: status dot + online count (+ issue count). */}
      <button
        onClick={() => setOpen(true)}
        className="group flex items-center gap-2 rounded-full border bg-background px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent active:scale-[0.97]"
        aria-label={`System status: ${color.label}. ${m.online} of ${m.total} devices online. Open status detail.`}
      >
        <span className="relative flex h-2 w-2">
          <span
            className={cn(
              'absolute inset-0 rounded-full',
              color.dot,
              (m.status === 'critical' || m.status === 'syncing') && 'animate-ping opacity-40'
            )}
          />
          <span className={cn('relative inline-block h-2 w-2 rounded-full', color.dot)} />
        </span>
        <span>
          {m.online}/{m.total}
        </span>
        {m.issueCount > 0 && (
          <span className="text-foreground/70">
            · {m.issueCount} {m.issueCount === 1 ? 'issue' : 'issues'}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Content-adaptive: compact when healthy, grows with issues up to 85vh. */}
        <DialogContent size="md" className="flex max-h-[85vh] flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', color.dot)} />
              {color.label}
            </DialogTitle>
            <DialogDescription>
              {m.online} of {m.total} devices online · refreshed live
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="divide-y divide-border/60">
              <StatusRow
                tone={signalText.success}
                label="Devices online"
                value={`${m.online}/${m.total}`}
                hint="Online = device polled the bridge within the last 65 seconds."
              />
              {detailRows.map((s) => (
                <StatusRow key={s.key} tone={s.tone} label={s.label} value={s.value} />
              ))}
              {detailRows.length === 0 && (
                <p className="py-3 text-sm text-muted-foreground">
                  No issues — commands idle and all users in sync.
                </p>
              )}
            </div>
          </div>

          <DialogFooter variant="bar" className="sm:justify-between">
            <span className="hidden self-center text-xs text-muted-foreground sm:inline">
              Live from the bridge — updates automatically.
            </span>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false)
                navigate('/devices')
              }}
            >
              Open Device Management
              <ChevronRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StatusRow({
  tone,
  label,
  value,
  hint,
}: {
  tone: string
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <div
      className={cn('flex items-center justify-between py-2.5 text-sm', hint && 'cursor-help')}
      title={hint}
    >
      <span className={cn('inline-flex items-center gap-2', tone)}>
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
        <span className="text-foreground/80">{label}</span>
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}
