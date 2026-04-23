import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { 
  RefreshCw, 
  Loader2, 
  Fingerprint, 
  ScanFace, 
  User, 
  Wifi, 
  WifiOff,
  CheckCircle2, 
  AlertCircle, 
  Clock,
  Image,
  X,
  ArrowRight
} from 'lucide-react'
import { useSyncStatus, useSyncUser, useCommandQueue, useClearPendingCommands, useSyncCancel, useGlobalSyncState } from '@/hooks/use-users'
import type { UserEntry } from '@/services/user-service'
import { useState, useEffect } from 'react'
import { ClearCommandsModal } from './clear-commands-modal'
import { cn } from '@/lib/utils'

interface SyncStatusDialogProps {
  user: UserEntry | null
  userId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

// All possible sync items in order (first to last in sync sequence)
const ALL_DATA_TYPES = [
  { key: 'user', icon: User, label: 'User', commandType: 'sync_user' },
  { key: 'fingerprint', icon: Fingerprint, label: 'FP', commandType: 'enroll_fingerprint' },
  { key: 'face', icon: ScanFace, label: 'Face', commandType: 'enroll_face' },
  { key: 'photo', icon: Image, label: 'Photo', commandType: 'upload_photo' },
] as const

type ItemStatus = 'pending' | 'syncing' | 'synced' | 'failed'

function getCommandTypeForItem(key: string): string {
  const map: Record<string, string> = {
    user: 'sync_user',
    fingerprint: 'enroll_fingerprint',
    face: 'enroll_face',
    photo: 'upload_photo',
  }
  return map[key] || key
}

function getItemStatus(status: any, key: string, commands: any[], lastSyncTriggered: number | null): ItemStatus {
  const fieldMap: Record<string, string> = {
    user: 'user_synced',
    fingerprint: 'fingerprint_synced',
    face: 'face_synced',
    photo: 'photo_synced',
  }
  
  const commandType = getCommandTypeForItem(key)
  
  // Get commands for this specific type
  const typeCommands = commands.filter(c => c.command_type === commandType)
  
  // Check for pending/sent commands
  const pendingCmd = typeCommands.find(c => 
    c.status === 'pending' || c.status === 'sent'
  )
  if (pendingCmd) return 'syncing'
  
  // Failed command?
  const failedCmd = typeCommands.find(c => c.status === 'failed')
  if (failedCmd) return 'failed'
  
  // During active sync - only trust commands created in this sync session
  if (lastSyncTriggered) {
    const recentCmd = typeCommands.find(c => 
      new Date(c.created_at).getTime() >= lastSyncTriggered
    )
    
    if (recentCmd) {
      // This item has a command created during this sync
      if (recentCmd.status === 'success') {
        return 'synced'
      }
      // Command exists but not yet success
      return 'syncing'
    }
    
    // No command found for this item type in this sync session
    // This item hasn't been processed yet
    return 'syncing'
  }
  
  // Sync not active - use DB flags normally
  const field = fieldMap[key]
  const isSynced = field ? status[field] : false
  if (isSynced) return 'synced'
  
  return 'pending'
}

export function SyncStatusDialog({ user, userId, open, onOpenChange }: SyncStatusDialogProps) {
  // Use aggressive polling when modal is open (500ms for sync)
  const refetchInterval = open ? 500 : undefined
  const { data, isLoading, refetch: refetchSyncStatus } = useSyncStatus(userId, {
    refetchInterval,
  })
  const { data: commandData } = useCommandQueue(userId, 50, {
    refetchInterval,
  })
  const syncUser = useSyncUser()
  const clearCommands = useClearPendingCommands()
  const { cancel: doCancel } = useSyncCancel()
  const globalSyncState = useGlobalSyncState()
  const [clearModalState, setClearModalState] = useState<{ deviceSn: string; deviceName: string; count: number } | null>(null)
  
  // Use global lastSyncTriggered if it matches current user
  const lastSyncTriggered = globalSyncState.userId === userId ? globalSyncState.lastSyncTriggered : null

  // Immediate refetch when modal opens
  useEffect(() => {
    if (userId && open) {
      refetchSyncStatus()
    }
  }, [open, userId])
  
  const syncStatus = data?.data || []
  const commands = commandData?.data || []

  const getDeviceState = (status: any, deviceSn: string) => {
    const deviceCommands = commands.filter(cmd => cmd.device_sn === status.device_sn)
    
    const availableItems = ALL_DATA_TYPES.filter(({ key }) => {
      if (key === 'user') return true
      if (key === 'fingerprint') return status.has_fingerprint_in_db
      if (key === 'face') return status.has_face_in_db
      if (key === 'photo') return status.has_photo_in_db
      return true
    })
    
    const items = availableItems.map(({ key, icon, label }) => {
      const itemStatus = getItemStatus(status, key, deviceCommands, lastSyncTriggered)
      
      return {
        key,
        icon,
        label,
        status: itemStatus,
      }
    })

    const hasFailed = items.some(i => i.status === 'failed')
    // Check local items for syncing, OR check if global sync is active for this user
    const localActive = items.some(i => i.status === 'syncing')
    const globalActive = globalSyncState.active && globalSyncState.userId === userId
    const isActive = localActive || globalActive
    const allSynced = items.length > 0 && items.every(i => i.status === 'synced')

    return { 
      items, 
      hasFailed,
      isActive,
      allSynced,
      lastSyncedAt: status?.last_synced_at
    }
  }

  const handleSyncToDevice = (deviceSn: string) => {
    console.log('[handleSyncToDevice] user:', user, 'deviceSn:', deviceSn)
    if (!user?.id) {
      console.log('[handleSyncToDevice] No user.id, returning')
      return
    }
    syncUser.mutate({ userId: user.id, deviceSns: [deviceSn], photoUrl: user.photo_url || undefined })
  }

  const handleSyncToAll = () => {
    console.log('[handleSyncToAll] user:', user, 'syncStatus:', syncStatus)
    if (!user?.id || syncStatus.length === 0) return
    const deviceSns = syncStatus.map(s => s.device_sn)
    syncUser.mutate({ userId: user.id, deviceSns, photoUrl: user.photo_url || undefined })
  }

  const handleClearDevice = (deviceSn: string, deviceName: string) => {
    // Show clear modal - for now use a placeholder count
    // Could be enhanced to show actual pending command count
    setClearModalState({ deviceSn, deviceName, count: 1 })
  }

  const handleConfirmClear = () => {
    if (!clearModalState || !user?.id) return
    clearCommands.mutate(
      { deviceSn: clearModalState.deviceSn, userId: user.id },
      { 
        onSuccess: (data) => {
          setClearModalState(null)
          toast.success(`${data.cleared} commands cleared`)
        },
        onError: (error) => {
          toast.error(`Failed to clear: ${error.message}`)
        }
      }
    )
  }

  const handleCancelSync = () => {
    doCancel()
    toast.info('Cancelling sync...')
  }

  if (!user) return null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0">
          <DialogHeader className="px-4 py-3 border-b">
            <DialogTitle className="text-base">Device Sync</DialogTitle>
            <DialogDescription className="text-xs">
              {user.name} · {user.pin}
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : syncStatus.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No devices found
              </div>
            ) : (
              <TooltipProvider>
                <div className="space-y-2">
                  {syncStatus.map((status) => {
                    const device = status.devices
                    const deviceSn = status.device_sn
                    const state = getDeviceState(status, deviceSn)
                    const isOnline = status.is_online
                    
                    return (
                      <div 
                        key={status.id} 
                        className={cn(
                          "rounded-lg border p-2.5",
                          state.hasFailed && "border-red-200 bg-red-50/30",
                          state.allSynced && !state.hasFailed && "border-green-200 bg-green-50/30"
                        )}
                      >
                        {/* Header Row */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Tooltip>
                              <TooltipTrigger>
                                {isOnline ? (
                                  <Wifi className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                ) : (
                                  <WifiOff className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                )}
                              </TooltipTrigger>
                              <TooltipContent side="top">{isOnline ? 'Online' : 'Offline'}</TooltipContent>
                            </Tooltip>
                            <span className="text-sm font-medium truncate">
                              {device?.name || deviceSn}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-1 shrink-0">
                            {state.isActive && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={handleCancelSync}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Cancel</TooltipContent>
                              </Tooltip>
                            )}
                            {/* Any sync in progress (for any user)? */}
                            {globalSyncState.active && globalSyncState.userId !== userId && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" disabled className="h-6 text-xs px-2">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Sync in progress for another user</TooltipContent>
                              </Tooltip>
                            )}
                            {(!globalSyncState.active || globalSyncState.userId === userId) && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSyncToDevice(deviceSn)}
                                disabled={syncUser.isPending || state.isActive}
                                className="h-6 text-xs px-2"
                              >
                                {state.isActive ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : state.allSynced ? (
                                  <RefreshCw className="h-3 w-3" />
                                ) : (
                                  'Sync'
                                )}
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Last synced timestamp */}
                        {state.lastSyncedAt && (
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
                            <Clock className="h-2.5 w-2.5" />
                            <span>Last sync: {new Date(state.lastSyncedAt).toLocaleString()}</span>
                          </div>
                        )}

                        {/* Items Horizontal with Arrows */}
                        <div className="flex items-center gap-1 overflow-x-auto pb-1">
                          {state.items.map(({ key, label, status }) => {
                            return (
                              <Tooltip key={key}>
                                <TooltipTrigger asChild>
                                  <div className={cn(
                                    "flex flex-col items-center gap-0.5 p-1.5 rounded cursor-default min-w-[48px]",
                                    status === 'synced' && "bg-green-100/50",
                                    status === 'syncing' && "bg-blue-100/50",
                                    status === 'pending' && "bg-amber-100/50",
                                    status === 'failed' && "bg-red-100/50"
                                  )}>
                                    {status === 'synced' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                                    {status === 'syncing' && <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />}
                                    {status === 'pending' && <Clock className="h-4 w-4 text-amber-600" />}
                                    {status === 'failed' && <AlertCircle className="h-4 w-4 text-red-600" />}
                                    <span className={cn(
                                      "text-[10px] font-medium",
                                      status === 'synced' && "text-green-700",
                                      status === 'syncing' && "text-blue-700",
                                      status === 'pending' && "text-amber-700",
                                      status === 'failed' && "text-red-700"
                                    )}>
                                      {label}
                                    </span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                  {label}: {status}
                                </TooltipContent>
                              </Tooltip>
                            )
                          }).flatMap((el, idx, arr) => 
                            idx < arr.length - 1 
                              ? [el, <ArrowRight key={`arrow-${idx}`} className="h-3 w-3 text-muted-foreground shrink-0" />]
                              : [el]
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </TooltipProvider>
            )}
            
            {/* Sync All button at bottom */}
            {!isLoading && syncStatus.length > 0 && (
              <div className="flex justify-center pt-2">
                <Button
                  onClick={handleSyncToAll}
                  size="sm"
                  variant="outline"
                  disabled={syncUser.isPending || globalSyncState.active}
                  className="h-7 text-xs"
                >
                  {globalSyncState.active && globalSyncState.userId === userId ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  {globalSyncState.active && globalSyncState.userId !== userId ? 'Sync in progress...' : 'Sync All Devices'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {clearModalState && (
        <ClearCommandsModal
          commandCount={clearModalState.count}
          deviceName={clearModalState.deviceName}
          isOpen={!!clearModalState}
          onOpenChange={(open) => !open && setClearModalState(null)}
          onConfirm={handleConfirmClear}
          isClearing={clearCommands.isPending}
        />
      )}
    </>
  )
}