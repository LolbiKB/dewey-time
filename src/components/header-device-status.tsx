import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Wifi, Clock, AlertTriangle, CheckCircle2, RefreshCw, Activity } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useDevices, useSyncStatus, useCommandQueue } from '@/hooks/use-core-data'
import { useMemo } from 'react'

// Command freshness threshold (2 minutes)
const COMMAND_FRESHNESS_MS = 2 * 60 * 1000

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
    
    // User sync stats - only count actual failures, not missing optional components
    // face_sync=false is OK if user simply hasn't enrolled face
    // Only count as failed if actual_state='not_synced' AND there's an error_message
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
    
    return {
      total,
      online,
      allOnline: total > 0 && online === total,
      allOffline: total > 0 && online === 0,
      hasUsers: totalSynced > 0,
      failedUsers,
      pendingCommands,
      failedCommands,
      driftCount,
      isLoading: devicesLoading || syncLoading || commandsLoading,
    }
  }, [devices, syncData, commands, devicesLoading, syncLoading, commandsLoading])

  const handleClick = () => {
    navigate('/devices')
  }

  // Show loading state
  if (metrics.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="h-3 w-3 animate-spin" />
        <span>Loading...</span>
      </div>
    )
  }

  // Determine main status
  const getStatusIcon = () => {
    if (metrics.allOffline) return <Wifi className="h-3.5 w-3.5 text-slate-400" />
    if (metrics.pendingCommands > 0) return <Clock className="h-3.5 w-3.5 text-blue-500 animate-pulse" />
    if (metrics.failedCommands > 0 || metrics.failedUsers > 0) return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
    if (metrics.driftCount > 0) return <Activity className="h-3.5 w-3.5 text-amber-500" />
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button 
            onClick={handleClick} 
            className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent/50 transition-colors"
          >
            {/* Status dot */}
            <span
              className={`h-2 w-2 rounded-full ${
                metrics.allOnline ? 'bg-green-500' : metrics.online > 0 ? 'bg-amber-500' : 'bg-red-500'
              }`}
            />
            
            {/* Device count */}
            <span className="text-sm font-medium">
              {metrics.online}/{metrics.total}
            </span>
            
            {/* Status icon */}
            {getStatusIcon()}
          </button>
        </TooltipTrigger>
        
        <TooltipContent side="bottom" className="text-xs py-2 px-3">
          <div className="space-y-1.5 min-w-[160px]">
            {/* Device Status Line */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Devices</span>
              <span className="font-medium">
                {metrics.online}/{metrics.total} online
                {metrics.allOnline && ' ✓'}
              </span>
            </div>

            {/* Only show issues, not empty stats */}
            {metrics.pendingCommands > 0 && (
              <div className="flex items-center justify-between text-blue-600">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Syncing
                </span>
                <span className="font-medium">{metrics.pendingCommands} cmds</span>
              </div>
            )}

            {metrics.failedCommands > 0 && (
              <div className="flex items-center justify-between text-red-600">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Failed
                </span>
                <span className="font-medium">{metrics.failedCommands} cmds</span>
              </div>
            )}

            {metrics.failedUsers > 0 && (
              <div className="flex items-center justify-between text-red-600">
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Users
                </span>
                <span className="font-medium">{metrics.failedUsers} failed</span>
              </div>
            )}

            {metrics.driftCount > 0 && (
              <div className="flex items-center justify-between text-amber-600">
                <span className="flex items-center gap-1">
                  <Activity className="h-3 w-3" /> Drift
                </span>
                <span className="font-medium">{metrics.driftCount} devices</span>
              </div>
            )}

            {/* Overall Status */}
            <div className="border-t border-dashed pt-1 mt-1">
              {metrics.allOffline ? (
                <span className="flex items-center gap-1 text-slate-500">
                  <Wifi className="h-3 w-3" /> All devices offline
                </span>
              ) : metrics.pendingCommands > 0 ? (
                <span className="flex items-center gap-1 text-blue-600">
                  <Clock className="h-3 w-3" /> Sync in progress...
                </span>
              ) : metrics.failedCommands > 0 || metrics.failedUsers > 0 ? (
                <span className="flex items-center gap-1 text-red-600">
                  <AlertTriangle className="h-3 w-3" /> Issues need attention
                </span>
              ) : metrics.driftCount > 0 ? (
                <span className="flex items-center gap-1 text-amber-600">
                  <Activity className="h-3 w-3" /> Statistics drift detected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-green-600">
                  <CheckCircle2 className="h-3 w-3" /> All systems operational
                </span>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
