import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useNavigate } from 'react-router'
import { useDevices, useSyncStatus, useCommandQueue } from '@/hooks/use-core-data'
import { useMemo } from 'react'
import {
  Server,
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
  healthy: { dot: 'bg-green-500', icon: CheckCircle2, label: 'All operational' },
  syncing: { dot: 'bg-blue-500', icon: RefreshCw, label: 'Sync in progress' },
  warning: { dot: 'bg-amber-500', icon: Activity, label: 'Minor issues' },
  critical: { dot: 'bg-red-500', icon: AlertTriangle, label: 'Issues detected' },
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
    const cancelledCommands =
      cancelledAll.length > 0 && cancelledSuperseded === cancelledAll.length
        ? 0
        : cancelledAll.length - cancelledSuperseded

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
  const StatusIcon = color.icon

  if (m.loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border bg-muted/50 animate-pulse">
        <div className="h-2 w-2 rounded-full bg-muted-foreground/20" />
        <div className="h-3 w-12 rounded bg-muted-foreground/20" />
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => navigate('/devices')}
            className="group flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background hover:bg-accent transition-colors active:scale-[0.97]"
            aria-label={`System status: ${color.label}. ${m.online}/${m.total} devices online`}
          >
            <span className="relative flex h-2 w-2">
              <span
                className={cn(
                  'absolute inset-0 rounded-full',
                  color.dot,
                  m.status === 'critical' && 'animate-ping opacity-50',
                  m.status === 'syncing' && 'animate-ping opacity-30'
                )}
              />
              <span className={cn('relative inline-block h-2 w-2 rounded-full', color.dot)} />
            </span>

            <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-muted-foreground">
              <Server className="h-3 w-3" />
              {m.online}/{m.total}
            </span>

            {m.hasCriticalIssues && (
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[10px] font-bold leading-none tabular-nums"
                title={`${m.issueCount} issue(s) need attention`}
              >
                {m.issueCount}
              </Badge>
            )}

            <StatusIcon
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground/60',
                m.status === 'syncing' && 'animate-spin text-blue-500',
                m.status === 'critical' && 'text-red-500',
                m.status === 'warning' && 'text-amber-500',
                m.status === 'healthy' && 'text-green-500'
              )}
            />
          </button>
        </TooltipTrigger>

        <TooltipContent
          side="bottom"
          align="end"
          className="p-0 w-[280px] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
        >
          <div
            className={cn(
              'px-4 py-2.5 border-b flex items-center justify-between',
              m.status === 'critical' &&
                'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800',
              m.status === 'syncing' &&
                'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800',
              m.status === 'warning' &&
                'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800',
              m.status === 'healthy' &&
                'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
            )}
          >
            <div className="flex items-center gap-2">
              <span className={cn('flex h-2 w-2 rounded-full', color.dot)} />
              <span className="text-xs font-semibold">{color.label}</span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {m.online}/{m.total} online
            </span>
          </div>

          {m.status === 'healthy' &&
            (m.cancelledCommands > 0 ||
              m.pendingCommands > 0 ||
              m.failedCommands > 0 ||
              m.enrollmentIncomplete > 0) && (
              <p className="px-4 py-2 text-[10px] text-muted-foreground border-b bg-muted/30">
                System healthy — details below are informational.
              </p>
            )}

          <div className="p-3 space-y-3">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                <Server className="h-3.5 w-3.5" />
                <span className="font-medium">Devices</span>
              </div>
              <p className="text-[10px] text-muted-foreground mb-1">
                Online = device polled the bridge within 65 seconds.
              </p>
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="tabular-nums">{m.online} online</span>
                </div>
                {m.offline > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-red-400" />
                    <span className="tabular-nums">{m.offline} offline</span>
                  </div>
                )}
              </div>
            </div>

            {(m.pendingCommands > 0 ||
              m.failedCommands > 0 ||
              m.enrollmentIncomplete > 0 ||
              m.enrollmentCleanupPending > 0 ||
              m.cancelledCommands > 0) && (
              <>
                <div className="border-t" />
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span className="font-medium">Commands</span>
                  </div>
                  <div className="space-y-2">
                    {m.pendingCommands > 0 && (
                      <div>
                        <Badge
                          variant="secondary"
                          className="flex w-full items-center justify-between px-2.5 py-1.5 text-blue-700 dark:text-blue-400"
                        >
                          <span>Active</span>
                          <span className="font-semibold tabular-nums">{m.pendingCommands}</span>
                        </Badge>
                        <p className="text-[10px] text-muted-foreground mt-0.5 pl-0.5">
                          Pending or sent in the last 2 minutes.
                        </p>
                      </div>
                    )}
                    {m.failedCommands > 0 && (
                      <div>
                        <Badge
                          variant="secondary"
                          className="flex w-full items-center justify-between px-2.5 py-1.5 text-red-700 dark:text-red-400"
                        >
                          <span>Failed</span>
                          <span className="font-semibold tabular-nums">{m.failedCommands}</span>
                        </Badge>
                        <p className="text-[10px] text-muted-foreground mt-0.5 pl-0.5">
                          Failed in the last hour — may need retry.
                        </p>
                      </div>
                    )}
                    {m.enrollmentIncomplete > 0 && (
                      <div>
                        <Badge
                          variant="secondary"
                          className="flex w-full items-center justify-between px-2.5 py-1.5 text-amber-700 dark:text-amber-400"
                        >
                          <span>Enrollment incomplete</span>
                          <span className="font-semibold tabular-nums">
                            {m.enrollmentIncomplete}
                          </span>
                        </Badge>
                        <p className="text-[10px] text-muted-foreground mt-0.5 pl-0.5">
                          Device captured FP but cloud never received the template.
                        </p>
                      </div>
                    )}
                    {m.enrollmentCleanupPending > 0 && (
                      <div>
                        <Badge
                          variant="secondary"
                          className="flex w-full items-center justify-between px-2.5 py-1.5 text-blue-700 dark:text-blue-400"
                        >
                          <span>Enrollment cleanup</span>
                          <span className="font-semibold tabular-nums">
                            {m.enrollmentCleanupPending}
                          </span>
                        </Badge>
                        <p className="text-[10px] text-muted-foreground mt-0.5 pl-0.5">
                          Removing aborted fingerprint from registrar device(s).
                        </p>
                      </div>
                    )}
                    {m.cancelledCommands > 0 && (
                      <div>
                        <Badge
                          variant="secondary"
                          className="flex w-full items-center justify-between px-2.5 py-1.5 text-muted-foreground"
                        >
                          <span>Auto-resolved</span>
                          <span className="font-semibold tabular-nums">{m.cancelledCommands}</span>
                        </Badge>
                        <p className="text-[10px] text-muted-foreground mt-0.5 pl-0.5">
                          Duplicates or stale commands removed in the last 30 minutes — no action
                          needed.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {(m.failedUsers > 0 || m.driftCount > 0) && (
              <>
                <div className="border-t" />
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="font-medium">Users</span>
                  </div>
                  <div className="space-y-1">
                    {m.failedUsers > 0 && (
                      <Badge
                        variant="secondary"
                        className="flex items-center justify-between px-2.5 py-1.5 w-full text-red-700 dark:text-red-400"
                      >
                        <span>Failed syncs</span>
                        <span className="font-semibold tabular-nums">{m.failedUsers}</span>
                      </Badge>
                    )}
                    {m.driftCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="flex items-center justify-between px-2.5 py-1.5 w-full text-amber-700 dark:text-amber-400"
                      >
                        <span>Drift detected</span>
                        <span className="font-semibold tabular-nums">{m.driftCount} devices</span>
                      </Badge>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground hover:bg-accent transition-colors cursor-default rounded-b-xl">
            <span>Device Management</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
