import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ConfirmationDialog } from '@/components/ui/base-modal'
import { RefreshCw, Loader2, RotateCcw, Zap, AlertCircle, ChevronDown, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SyncToolbarActionsProps {
  deviceSns: string[]
  onlineDeviceSns: string[]
  isSyncing: boolean
  showResetFailed: boolean
  showClearStuck: boolean
  onSyncAll: () => void
  onResetFailed: () => void
  onForceSync: () => void
  onClearStuck: () => void
  resetPending?: boolean
  forcePending?: boolean
  clearPending?: boolean
}

export function SyncToolbarActions({
  deviceSns,
  onlineDeviceSns,
  isSyncing,
  showResetFailed,
  showClearStuck,
  onSyncAll,
  onResetFailed,
  onForceSync,
  onClearStuck,
  resetPending = false,
  forcePending = false,
  clearPending = false,
}: SyncToolbarActionsProps) {
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false)

  const syncTargetCount = onlineDeviceSns.length > 0 ? onlineDeviceSns.length : deviceSns.length
  const allOffline = deviceSns.length > 0 && onlineDeviceSns.length === 0

  const handleConfirmForce = () => {
    setForceConfirmOpen(false)
    onForceSync()
  }

  return (
    <>
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  size="sm"
                  variant="default"
                  onClick={onSyncAll}
                  disabled={isSyncing || deviceSns.length === 0 || allOffline}
                  className="h-8 gap-1.5 text-xs"
                >
                  {isSyncing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Sync all devices
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs">
              Push user profile, fingerprints, face, and photo from cloud to{' '}
              {onlineDeviceSns.length > 0 ? 'online' : 'configured'} devices (
              {syncTargetCount}).
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={deviceSns.length === 0}
                className="h-8 gap-1 text-xs"
              >
                <Wrench className="h-3 w-3" />
                Troubleshoot
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={onResetFailed}
                disabled={!showResetFailed || resetPending}
                className="gap-2"
              >
                {resetPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Reset failed commands
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setForceConfirmOpen(true)}
                disabled={forcePending}
                className={cn('gap-2 text-orange-700 focus:text-orange-700')}
              >
                {forcePending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                Force full resync…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onClearStuck}
                disabled={!showClearStuck || clearPending}
                className="gap-2"
              >
                {clearPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                Clear stuck sync state
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TooltipProvider>

      <ConfirmationDialog
        isOpen={forceConfirmOpen}
        title="Force full resync?"
        message={`This clears pending and in-flight commands for this user on the selected devices, resets sync batches, and queues a fresh push from cloud. Use when sync is stuck or the command queue looks wrong. Devices: ${deviceSns.length}.`}
        confirmLabel="Force resync"
        variant="destructive"
        isProcessing={forcePending}
        onConfirm={handleConfirmForce}
        onCancel={() => setForceConfirmOpen(false)}
      />
    </>
  )
}
