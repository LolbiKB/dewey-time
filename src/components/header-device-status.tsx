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

type Status = 'healthy' | 'syncing' | 'warning' | 'critical'

const STATUS_COLORS: Record<Status, {
  dot: string
  icon: typeof CheckCircle2
  label: string
}> = {
  healthy:   { dot: 'bg-green-500', icon: CheckCircle2, label: 'All operational' },
  syncing:   { dot: 'bg-blue-500',  icon: RefreshCw,    label: 'Sync in progress' },
  warning:   { dot: 'bg-amber-500', icon: Activity,      label: 'Minor issues' },
  critical:  { dot: 'bg-red-500',   icon: AlertTriangle, label: 'Issues detected' },
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
    if (hasIssues) status = 'critical'
    else if (pendingCommands > 0) status = 'syncing'
    else if (offline > 0 || driftCount > 0) status = 'warning'

    return {
      total, online, offline,
      failedUsers, pendingCommands, failedCommands, driftCount,
      hasIssues, issueCount, status,
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
            {/* Animated status dot */}
            <span className="relative flex h-2 w-2">
              <span className={cn(
                'absolute inset-0 rounded-full',
                color.dot,
                m.status === 'critical' && 'animate-ping opacity-50',
                m.status === 'syncing' && 'animate-ping opacity-30',
              )} />
              <span className={cn('relative inline-block h-2 w-2 rounded-full', color.dot)} />
            </span>

            {/* Device count */}
            <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-muted-foreground">
              <Server className="h-3 w-3" />
              {m.online}/{m.total}
            </span>

            {/* Issue counter badge */}
            {m.hasIssues && (
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[10px] font-bold leading-none tabular-nums"
              >
                {m.issueCount}
              </Badge>
            )}

            {/* Status icon */}
            <StatusIcon className={cn(
              'h-3.5 w-3.5 text-muted-foreground/60',
              m.status === 'syncing' && 'animate-spin text-blue-500',
              m.status === 'critical' && 'text-red-500',
              m.status === 'warning' && 'text-amber-500',
              m.status === 'healthy' && 'text-green-500',
            )} />
          </button>
        </TooltipTrigger>

        <TooltipContent
          side="bottom"
          align="end"
          className="p-0 w-[260px] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
        >
          {/* Header */}
          <div className={cn(
            'px-4 py-2.5 border-b flex items-center justify-between',
            m.status === 'critical' && 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800',
            m.status === 'syncing' && 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800',
            m.status === 'warning' && 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800',
            m.status === 'healthy' && 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800',
          )}>
            <div className="flex items-center gap-2">
              <span className={cn('flex h-2 w-2 rounded-full', color.dot)} />
              <span className="text-xs font-semibold">{color.label}</span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {m.online}/{m.total} online
            </span>
          </div>

          {/* Body */}
          <div className="p-3 space-y-3">
            {/* Devices */}
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                <Server className="h-3.5 w-3.5" />
                <span className="font-medium">Devices</span>
              </div>
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

            {/* Commands */}
            {(m.pendingCommands > 0 || m.failedCommands > 0) && (
              <>
                <div className="border-t" />
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span className="font-medium">Commands</span>
                  </div>
                  <div className="flex gap-2">
                    {m.pendingCommands > 0 && (
                      <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-950/20 dark:border-blue-800">
                        <span className="text-xs text-blue-700 dark:text-blue-400">Active</span>
                        <span className="text-xs font-semibold text-blue-800 dark:text-blue-400 tabular-nums">{m.pendingCommands}</span>
                      </div>
                    )}
                    {m.failedCommands > 0 && (
                      <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-800">
                        <span className="text-xs text-red-700 dark:text-red-400">Failed</span>
                        <span className="text-xs font-semibold text-red-800 dark:text-red-400 tabular-nums">{m.failedCommands}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Users */}
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
                      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-800">
                        <span className="text-xs text-red-700 dark:text-red-400">Failed syncs</span>
                        <span className="text-xs font-semibold text-red-800 dark:text-red-400 tabular-nums">{m.failedUsers}</span>
                      </div>
                    )}
                    {m.driftCount > 0 && (
                      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
                        <span className="text-xs text-amber-700 dark:text-amber-400">Drift detected</span>
                        <span className="text-xs font-semibold text-amber-800 dark:text-amber-400 tabular-nums">{m.driftCount} devices</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground hover:bg-accent transition-colors cursor-default rounded-b-xl">
            <span>Device Management</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
