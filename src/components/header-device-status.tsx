import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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

type Status = 'healthy' | 'syncing' | 'warning' | 'critical'

const STATUS_THEME: Record<Status, {
  dot: string
  ring: string
  bg: string
  border: string
  label: string
  icon: typeof CheckCircle2
}> = {
  healthy: {
    dot: 'bg-green-500',
    ring: 'ring-green-500/20',
    bg: 'bg-green-50 dark:bg-green-950/20',
    border: 'border-green-200 dark:border-green-900/50',
    label: 'All operational',
    icon: CheckCircle2,
  },
  syncing: {
    dot: 'bg-blue-500',
    ring: 'ring-blue-500/20',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    border: 'border-blue-200 dark:border-blue-900/50',
    label: 'Sync in progress',
    icon: RefreshCw,
  },
  warning: {
    dot: 'bg-amber-500',
    ring: 'ring-amber-500/20',
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    border: 'border-amber-200 dark:border-amber-900/50',
    label: 'Minor issues',
    icon: Activity,
  },
  critical: {
    dot: 'bg-red-500',
    ring: 'ring-red-500/20',
    bg: 'bg-red-50 dark:bg-red-950/20',
    border: 'border-red-200 dark:border-red-900/50',
    label: 'Issues detected',
    icon: AlertTriangle,
  },
}

export function HeaderDeviceStatus() {
  const navigate = useNavigate()
  const { data: devices, isLoading: devicesLoading } = useDevices()
  const { data: syncData, isLoading: syncLoading } = useSyncStatus()
  const { data: commands, isLoading: commandsLoading } = useCommandQueue()

  const metrics = useMemo(() => {
    const list = devices?.devices ?? []
    const total = list.length
    const online = list.filter((d: any) => d.isOnline).length
    const offline = total - online

    const failedUsers = (syncData ?? []).filter(
      (s: any) => s.actual_state === 'not_synced' && s.error_message !== null
    ).length

    const now = Date.now()

    const pendingCommands = (commands ?? []).filter((c: any) => {
      const age = now - new Date(c.created_at).getTime()
      return age < COMMAND_FRESHNESS_MS && (c.status === 'pending' || c.status === 'sent')
    }).length

    const failedCommands = (commands ?? []).filter((c: any) => {
      if (c.status !== 'failed') return false
      return now - new Date(c.created_at).getTime() < FAILED_COMMAND_WINDOW_MS
    }).length

    const driftCount = list.filter((d: any) => d.stats_drift_detected).length

    const hasIssues = failedCommands > 0 || failedUsers > 0
    const issueCount = failedCommands + failedUsers + offline + driftCount

    let status: Status = 'healthy'
    if (total > 0 && online === 0 && hasIssues) status = 'critical'
    else if (hasIssues) status = 'critical'
    else if (pendingCommands > 0) status = 'syncing'
    else if (offline > 0 || driftCount > 0) status = 'warning'

    return {
      total, online, offline,
      failedUsers, pendingCommands, failedCommands, driftCount,
      hasIssues, issueCount, status,
      isLoading: devicesLoading || syncLoading || commandsLoading,
    }
  }, [devices, syncData, commands, devicesLoading, syncLoading, commandsLoading])

  const theme = STATUS_THEME[metrics.status]
  const StatusIcon = theme.icon

  if (metrics.isLoading) {
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
            className={cn(
              'group flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200',
              'hover:shadow-sm active:scale-[0.97]',
              theme.bg,
              theme.border,
            )}
            aria-label={`System status: ${theme.label}. ${metrics.online}/${metrics.total} devices online`}
          >
            {/* Status dot with ring */}
            <span className="relative flex h-2 w-2">
              <span
                className={cn(
                  'absolute inset-0 rounded-full',
                  theme.dot,
                  metrics.status === 'critical' && 'animate-ping opacity-50',
                  metrics.status === 'syncing' && 'animate-ping opacity-30',
                )}
              />
              <span className={cn('relative inline-block h-2 w-2 rounded-full', theme.dot)} />
            </span>

            {/* Device count */}
            <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-foreground/80">
              <Server className="h-3 w-3 text-muted-foreground" />
              {metrics.online}/{metrics.total}
            </span>

            {/* Issue counter (compact pill) */}
            {metrics.hasIssues && (
              <span className={cn(
                'inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded-full',
                'text-[10px] font-bold leading-none tabular-nums',
                'bg-foreground/10 text-foreground/70',
              )}>
                {metrics.issueCount}
              </span>
            )}

            {/* Status icon */}
            <StatusIcon className={cn(
              'h-3.5 w-3.5 text-muted-foreground/60',
              metrics.status === 'syncing' && 'animate-spin text-blue-500',
              metrics.status === 'critical' && 'text-red-500',
            )} />
          </button>
        </TooltipTrigger>

        <TooltipContent
          side="bottom"
          align="end"
          className="p-0 w-[260px] overflow-hidden rounded-xl border shadow-lg"
        >
          {/* Header */}
          <div className={cn('px-4 py-2.5 border-b', theme.bg, theme.border)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn('flex h-2 w-2 rounded-full', theme.dot)} />
                <span className="text-xs font-semibold">{theme.label}</span>
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {metrics.online}/{metrics.total} online
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="p-3 space-y-3">
            {/* Devices */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                <Server className="h-3 w-3" />
                Devices
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="flex h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-xs tabular-nums">{metrics.online} online</span>
                </div>
                {metrics.offline > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-2 w-2 rounded-full bg-red-400" />
                    <span className="text-xs tabular-nums">{metrics.offline} offline</span>
                  </div>
                )}
              </div>
            </div>

            {/* Separator */}
            {(metrics.pendingCommands > 0 || metrics.failedCommands > 0 || metrics.failedUsers > 0) && (
              <div className="border-t" />
            )}

            {/* Commands */}
            {(metrics.pendingCommands > 0 || metrics.failedCommands > 0) && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                  <RefreshCw className="h-3 w-3" />
                  Commands
                </div>
                <div className="flex gap-2">
                  {metrics.pendingCommands > 0 && (
                    <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                      <span className="text-xs text-blue-700 dark:text-blue-300">Active</span>
                      <span className="text-xs font-semibold text-blue-800 dark:text-blue-200 tabular-nums">{metrics.pendingCommands}</span>
                    </div>
                  )}
                  {metrics.failedCommands > 0 && (
                    <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30">
                      <span className="text-xs text-red-700 dark:text-red-300">Failed</span>
                      <span className="text-xs font-semibold text-red-800 dark:text-red-200 tabular-nums">{metrics.failedCommands}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Users */}
            {(metrics.failedUsers > 0 || metrics.driftCount > 0) && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
                  <AlertTriangle className="h-3 w-3" />
                  Users
                </div>
                <div className="space-y-1">
                  {metrics.failedUsers > 0 && (
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30">
                      <span className="text-xs text-red-700 dark:text-red-300">Failed syncs</span>
                      <span className="text-xs font-semibold text-red-800 dark:text-red-200 tabular-nums">{metrics.failedUsers}</span>
                    </div>
                  )}
                  {metrics.driftCount > 0 && (
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                      <span className="text-xs text-amber-700 dark:text-amber-300">Drift detected</span>
                      <span className="text-xs font-semibold text-amber-800 dark:text-amber-200 tabular-nums">{metrics.driftCount} devices</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={cn(
            'flex items-center justify-between px-4 py-2 border-t text-[11px]',
            theme.bg,
            theme.border,
          )}>
            <span className="text-muted-foreground">Device Management</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
