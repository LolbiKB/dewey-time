// Sync Status Summary Component
// Shows overall sync status for a user across all devices
// Logic: actual_state === 'synced' means synced, everything else means unsynced
// actual_state is maintained by triggers (user changes → not_synced) and sync flow (success → synced)

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Check, X, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { UserService, getSyncState } from '@/services/user-service'
import { useEffect, useState } from 'react'

interface SyncStatusSummaryProps {
  userId: string
  variant?: 'badge' | 'detailed'
}

export function SyncStatusSummary({ userId, variant = 'badge' }: SyncStatusSummaryProps) {
  const [globalActive, setGlobalActive] = useState(false)
  
  // Listen to global sync state changes
  useEffect(() => {
    const checkGlobalState = () => {
      const state = getSyncState()
      setGlobalActive(state.active && state.userId === userId)
    }
    
    checkGlobalState()
    const interval = setInterval(checkGlobalState, 500)
    return () => clearInterval(interval)
  }, [userId])

  const { data: summary, isLoading } = useQuery({
    queryKey: ['user-sync-summary', userId],
    queryFn: () => UserService.getUserSyncSummary(userId),
    enabled: !!userId,
    refetchInterval: 10000,
  })

  if (isLoading || !summary) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Loading...</span>
      </Badge>
    )
  }

  const { total_devices, synced, not_synced, is_fully_synced } = summary
  const isSyncing = globalActive

  // Badge variant - simple synced/unsynced
  if (variant === 'badge') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="secondary"
              className={`gap-1.5 cursor-help ${
                is_fully_synced
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {is_fully_synced && <Check className="h-3 w-3" />}
              {!is_fully_synced && !isSyncing && <X className="h-3 w-3" />}
              {isSyncing && <Loader2 className="h-3 w-3 animate-spin" />}
              <span className="text-xs">
                {isSyncing ? 'Syncing...' : `${synced}/${total_devices}`}
              </span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="bg-popover text-popover-foreground border shadow-md">
            <div className="space-y-1 text-xs">
              <div className="font-semibold">Sync Status</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-muted-foreground">Synced:</span>
                <span className="text-green-600 font-medium">{synced}</span>
                <span className="text-muted-foreground">Not synced:</span>
                <span className={not_synced > 0 ? 'text-gray-600 font-medium' : ''}>{not_synced}</span>
                <span className="text-muted-foreground">Total devices:</span>
                <span>{total_devices}</span>
              </div>
              {isSyncing && (
                <div className="text-blue-600 pt-0.5 border-t">
                  Sync in progress...
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Detailed variant
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Sync Status:</span>
        {is_fully_synced ? (
          <Badge variant="secondary" className="gap-1.5 text-green-700 dark:text-green-400">
            <Check className="h-3 w-3" />
            All devices synced
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1.5 text-gray-500 dark:text-gray-400">
            {synced}/{total_devices} devices
          </Badge>
        )}
        {isSyncing && (
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        )}
      </div>

      {!is_fully_synced && (
        <div className="flex items-center gap-1.5 text-xs">
          <X className="h-3 w-3 text-muted-foreground" />
          <span>{not_synced} device{not_synced !== 1 ? 's' : ''} not synced</span>
        </div>
      )}
    </div>
  )
}
