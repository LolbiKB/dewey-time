// Sync Status Summary — uses shared aggregate (command queue + component rules)

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Check, X, Loader2 } from 'lucide-react'
import { useUserSyncAggregate } from '@/hooks/use-user-sync-aggregate'
import { signalText } from '@/lib/signal'

interface SyncStatusSummaryProps {
  userId: string
  variant?: 'badge' | 'detailed'
}

export function SyncStatusSummary({ userId, variant = 'badge' }: SyncStatusSummaryProps) {
  const { aggregate, isLoading, isSyncing } = useUserSyncAggregate(userId, {
    refetchInterval: 10000,
  })

  if (isLoading || !aggregate) {
    return (
      <Badge variant="outline" className="gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Loading...</span>
      </Badge>
    )
  }

  const { total: total_devices, synced, not_synced: notSynced, is_fully_synced } = aggregate

  if (variant === 'badge') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="secondary"
              className={`gap-1.5 cursor-help ${
                is_fully_synced && !isSyncing
                  ? signalText.success
                  : signalText.idle
              }`}
            >
              {is_fully_synced && !isSyncing && <Check className="h-3 w-3" />}
              {!is_fully_synced && !isSyncing && <X className="h-3 w-3" />}
              {isSyncing && <Loader2 className="h-3 w-3 animate-spin" />}
              <span className="text-xs">
                {isSyncing
                  ? aggregate.syncing > 0
                    ? `Syncing ${aggregate.syncing}/${total_devices}…`
                    : 'Syncing…'
                  : `${synced}/${total_devices}`}
              </span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="bg-popover text-popover-foreground border shadow-md">
            <div className="space-y-1 text-xs">
              <div className="font-semibold">Sync Status</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-muted-foreground">Synced:</span>
                <span className={`${signalText.success} font-medium`}>{synced}</span>
                <span className="text-muted-foreground">Not synced:</span>
                <span className={notSynced > 0 ? 'text-foreground font-medium' : ''}>{notSynced}</span>
                {aggregate.syncing > 0 && (
                  <>
                    <span className="text-muted-foreground">In progress:</span>
                    <span className={`${signalText.progress} font-medium`}>{aggregate.syncing}</span>
                  </>
                )}
                <span className="text-muted-foreground">Total devices:</span>
                <span>{total_devices}</span>
              </div>
              {isSyncing && (
                <div className={`${signalText.progress} pt-0.5 border-t`}>
                  Commands still pending on the device — same rules as the Sync tab.
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Sync Status:</span>
        {is_fully_synced && !isSyncing ? (
          <Badge variant="secondary" className={`gap-1.5 ${signalText.success}`}>
            <Check className="h-3 w-3" />
            All devices synced
          </Badge>
        ) : (
          <Badge variant="secondary" className={`gap-1.5 ${signalText.idle}`}>
            {synced}/{total_devices} devices
          </Badge>
        )}
        {isSyncing && <Loader2 className={`h-4 w-4 animate-spin ${signalText.progress}`} />}
      </div>

      {!is_fully_synced && (
        <div className="flex items-center gap-1.5 text-xs">
          <X className="h-3 w-3 text-muted-foreground" />
          <span>
            {notSynced} not synced
            {aggregate.syncing > 0 ? `, ${aggregate.syncing} in progress` : ''}
          </span>
        </div>
      )}
    </div>
  )
}
