import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Activity,
  Server,
  Terminal,
  Users,
  ArrowRight
} from 'lucide-react'
import { useNavigate } from 'react-router'
import { useDevices, useSyncStatus, useCommandQueue } from '@/hooks/use-core-data'
import { useMemo } from 'react'
import { cn } from '@/lib/utils'

// Command freshness threshold (2 minutes)
const COMMAND_FRESHNESS_MS = 2 * 60 * 1000

// Status severity levels
const STATUS = {
  CRITICAL: 'critical', // All offline or major failures
  WARNING: 'warning',   // Some issues but functioning
  SYNCING: 'syncing',   // Active operations
  HEALTHY: 'healthy',   // Everything good
} as const

type StatusType = typeof STATUS[keyof typeof STATUS]

export function HeaderDeviceStatus() {
  const navigate = useNavigate()
  
  // Use centralized data hooks
  const { data: devicesResponse, isLoading: devicesLoading } = useDevices()
  const { data: syncData, isLoading: syncLoading } = useSyncStatus()
  const { data: commands, isLoading: commandsLoading } = useCommandQueue()
  
  const devices = devicesResponse?.devices || []

  // Calculate derived metrics using centralized data
  const metrics = useMemo(() => {
    const total = devices?.length ?? 0
    const online = devices?.filter((d: any) => d.isOnline).length ?? 0
    const offline = total - online
    
    // User sync stats
    const totalSynced = syncData?.length ?? 0
    const failedUsers = syncData?.filter(s => 
      s.actual_state === 'not_synced' && s.error_message !== null
    ).length ?? 0
    
    // Command stats - only count fresh commands (< 2 minutes old)
    const now = Date.now()
    const freshCommands = (commands || []).filter(c => {
      const age = now - new Date(c.created_at).getTime()
      return age < COMMAND_FRESHNESS_MS
    })
    
    const pendingCommands = freshCommands.filter(c => c.status === 'pending' || c.status === 'sent').length
    const failedCommands = (commands || []).filter(c => c.status === 'failed').length
    
    // Devices with drift
    const driftCount = devices?.filter(d => d.stats_drift_detected).length ?? 0
    
    // Determine overall status
    let status: StatusType = STATUS.HEALTHY
    if (total > 0 && online === 0) {
      status = STATUS.CRITICAL
    } else if (failedCommands > 0 || failedUsers > 0) {
      status = STATUS.CRITICAL
    } else if (pendingCommands > 0) {
      status = STATUS.SYNCING
    } else if (offline > 0 || driftCount > 0) {
      status = STATUS.WARNING
    }
    
    return {
      total,
      online,
      offline,
      allOnline: total > 0 && online === total,
      allOffline: total > 0 && online === 0,
      hasUsers: totalSynced > 0,
      failedUsers,
      pendingCommands,
      failedCommands,
      driftCount,
      status,
      isLoading: devicesLoading || syncLoading || commandsLoading,
    }
  }, [devices, syncData, commands, devicesLoading, syncLoading, commandsLoading])

  const handleClick = () => {
    navigate('/devices')
  }

  // Status configuration
  const statusConfig = {
    [STATUS.CRITICAL]: {
      dotColor: 'bg-red-500',
      pulseColor: 'bg-red-500',
      badgeVariant: 'destructive' as const,
      icon: AlertTriangle,
      label: 'Issues',
    },
    [STATUS.WARNING]: {
      dotColor: 'bg-amber-500',
      pulseColor: 'bg-amber-500',
      badgeVariant: 'secondary' as const,
      icon: Activity,
      label: 'Warning',
    },
    [STATUS.SYNCING]: {
      dotColor: 'bg-blue-500',
      pulseColor: 'bg-blue-500',
      badgeVariant: 'default' as const,
      icon: Clock,
      label: 'Syncing',
    },
    [STATUS.HEALTHY]: {
      dotColor: 'bg-green-500',
      pulseColor: 'bg-green-500',
      badgeVariant: 'outline' as const,
      icon: CheckCircle2,
      label: 'Healthy',
    },
  }

  const config = statusConfig[metrics.status]
  const StatusIcon = config.icon

  // Show loading state
  if (metrics.isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground font-medium">Loading...</span>
      </div>
    )
  }

  const hasIssues = metrics.failedCommands > 0 || metrics.failedUsers > 0 || metrics.offline > 0

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button 
            onClick={handleClick}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-200",
              "hover:scale-105 active:scale-95",
              "border shadow-sm",
              metrics.status === STATUS.HEALTHY && "bg-green-50/80 border-green-200 hover:bg-green-50",
              metrics.status === STATUS.SYNCING && "bg-blue-50/80 border-blue-200 hover:bg-blue-50",
              metrics.status === STATUS.WARNING && "bg-amber-50/80 border-amber-200 hover:bg-amber-50",
              metrics.status === STATUS.CRITICAL && "bg-red-50/80 border-red-200 hover:bg-red-50",
              metrics.allOffline && "bg-slate-100 border-slate-200"
            )}
          >
            {/* Animated status dot */}
            <span className="relative flex h-2.5 w-2.5">
              <span className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                config.pulseColor,
                metrics.status === STATUS.HEALTHY && "opacity-0"
              )} />
              <span className={cn(
                "relative inline-flex rounded-full h-2.5 w-2.5",
                config.dotColor
              )} />
            </span>

            {/* Device count - compact */}
            <div className="flex items-center gap-1">
              <Server className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-semibold tabular-nums">
                {metrics.online}/{metrics.total}
              </span>
            </div>

            {/* Issues badge - only show if there are issues */}
            {hasIssues && (
              <Badge 
                variant={config.badgeVariant} 
                className="h-4 px-1.5 text-[10px] font-bold tabular-nums"
              >
                {metrics.failedCommands + metrics.failedUsers + metrics.offline}
              </Badge>
            )}

            {/* Status icon */}
            <StatusIcon className={cn(
              "h-3.5 w-3.5",
              metrics.status === STATUS.SYNCING && "animate-spin"
            )} />
          </button>
        </TooltipTrigger>
        
        <TooltipContent side="bottom" align="end" className="p-0 overflow-hidden">
          <div className="min-w-[240px]">
            {/* Header */}
            <div className={cn(
              "px-3 py-2 flex items-center justify-between",
              metrics.status === STATUS.HEALTHY && "bg-green-50",
              metrics.status === STATUS.SYNCING && "bg-blue-50",
              metrics.status === STATUS.WARNING && "bg-amber-50",
              metrics.status === STATUS.CRITICAL && "bg-red-50",
              metrics.allOffline && "bg-slate-50"
            )}>
              <div className="flex items-center gap-2">
                <StatusIcon className={cn(
                  "h-4 w-4",
                  metrics.status === STATUS.CRITICAL && "text-red-600",
                  metrics.status === STATUS.WARNING && "text-amber-600",
                  metrics.status === STATUS.SYNCING && "text-blue-600 animate-spin",
                  metrics.status === STATUS.HEALTHY && "text-green-600"
                )} />
                <span className="font-semibold text-sm">
                  {config.label}
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>

            <div className="p-3 space-y-3">
              {/* Devices Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Server className="h-3.5 w-3.5" />
                    <span>Devices</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {metrics.online > 0 && (
                      <Badge variant="outline" className="h-5 px-1.5 text-xs bg-green-50 text-green-700 border-green-200">
                        {metrics.online} online
                      </Badge>
                    )}
                    {metrics.offline > 0 && (
                      <Badge variant="outline" className="h-5 px-1.5 text-xs bg-red-50 text-red-700 border-red-200">
                        {metrics.offline} offline
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Progress bar for devices */}
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      metrics.allOnline ? "bg-green-500 w-full" : 
                      metrics.online === 0 ? "bg-red-500 w-0" :
                      "bg-amber-500"
                    )}
                    style={{ width: `${metrics.total > 0 ? (metrics.online / metrics.total) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <Separator />

              {/* Active Operations */}
              {(metrics.pendingCommands > 0 || metrics.failedCommands > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Terminal className="h-3.5 w-3.5" />
                    <span>Commands</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    {metrics.pendingCommands > 0 && (
                      <div className="flex items-center justify-between p-2 rounded-md bg-blue-50 border border-blue-100">
                        <span className="text-xs text-blue-700 flex items-center gap-1">
                          <Clock className="h-3 w-3 animate-spin" />
                          Active
                        </span>
                        <span className="text-sm font-semibold text-blue-800 tabular-nums">
                          {metrics.pendingCommands}
                        </span>
                      </div>
                    )}
                    
                    {metrics.failedCommands > 0 && (
                      <div className="flex items-center justify-between p-2 rounded-md bg-red-50 border border-red-100">
                        <span className="text-xs text-red-700 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Failed
                        </span>
                        <span className="text-sm font-semibold text-red-800 tabular-nums">
                          {metrics.failedCommands}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* User Sync Status */}
              {(metrics.failedUsers > 0 || metrics.driftCount > 0) && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span>Users</span>
                    </div>
                    
                    <div className="space-y-1.5">
                      {metrics.failedUsers > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-red-600 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Failed syncs
                          </span>
                          <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                            {metrics.failedUsers}
                          </Badge>
                        </div>
                      )}
                      
                      {metrics.driftCount > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-amber-600 flex items-center gap-1">
                            <Activity className="h-3 w-3" />
                            Drift detected
                          </span>
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            {metrics.driftCount} devices
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Footer Status */}
              <div className={cn(
                "pt-2 border-t text-xs text-center py-1.5 rounded-md font-medium",
                metrics.status === STATUS.HEALTHY && "bg-green-50 text-green-700 border-green-100",
                metrics.status === STATUS.SYNCING && "bg-blue-50 text-blue-700 border-blue-100",
                metrics.status === STATUS.WARNING && "bg-amber-50 text-amber-700 border-amber-100",
                metrics.status === STATUS.CRITICAL && "bg-red-50 text-red-700 border-red-100"
              )}>
                {metrics.allOffline ? 'All devices offline - check connections' :
                 metrics.status === STATUS.SYNCING ? 'Sync in progress...' :
                 metrics.status === STATUS.CRITICAL ? 'Issues need attention' :
                 metrics.status === STATUS.WARNING ? 'Minor issues detected' :
                 'All systems operational'}
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
