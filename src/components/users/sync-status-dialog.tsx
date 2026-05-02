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
  ArrowRight,
  RotateCcw,
  Zap,
} from 'lucide-react'
import { useSyncStatus, useSyncUser, useCommandQueue, useSyncCancel, useGlobalSyncState, useRetryUserSync, useForceUserSync } from '@/hooks/use-users'
import type { UserEntry } from '@/services/user-service'
import { useEffect } from 'react'
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

function getItemStatus(status: any, key: string, hasActiveCommands: boolean): ItemStatus {
  const fieldMap: Record<string, string> = {
    user: 'user_synced',
    fingerprint: 'fingerprint_synced',
    face: 'face_synced',
    photo: 'photo_synced',
  }
  
  const field = fieldMap[key]
  if (!field) return 'pending'
  
  const isSynced = status[field]
  
  // PRIMARY: Use DB sync flag as single source of truth
  if (isSynced) return 'synced'
  
  // Override: If actively syncing (pending commands), show syncing
  if (hasActiveCommands) return 'syncing'
  
  return 'pending'
}

export function SyncStatusDialog({ user, userId, open, onOpenChange }: SyncStatusDialogProps) {
  // Use more aggressive polling when modal is open (3s for sync)
  const refetchInterval = open ? 3000 : undefined
  const { data, isLoading, refetch: refetchSyncStatus } = useSyncStatus(userId, {
    refetchInterval,
  })
  const { data: commandData } = useCommandQueue(userId, 50, {
    refetchInterval,
  })
  const syncUser = useSyncUser()
  const { cancel: doCancel } = useSyncCancel()
  const globalSyncState = useGlobalSyncState()
  
  // Immediate refetch when modal opens
  useEffect(() => {
    if (userId && open) {
      refetchSyncStatus()
    }
  }, [open, userId])
  
  const syncStatus = data?.data || []
  const commands = commandData?.data || []

  const getDeviceState = (status: any) => {
    const deviceCommands = commands.filter(cmd => cmd.device_sn === status.device_sn)
    const isOnline = status.is_online
    
    // Check if there are active (pending/sent) commands - for transient "syncing" indicator
    const hasActiveCommands = deviceCommands.some(cmd => 
      cmd.status === 'pending' || cmd.status === 'sent'
    )
    
    const availableItems = ALL_DATA_TYPES.filter(({ key }) => {
      // Show item if: has local data OR has been synced (any status exists)
      if (key === 'user') return true
      if (key === 'fingerprint') return status.has_fingerprint_in_db || status.fingerprint_synced === true
      if (key === 'face') return status.has_face_in_db || status.face_synced === true
      if (key === 'photo') return status.has_photo_in_db || status.photo_synced === true
      return true
    })
    
    const items = availableItems.map(({ key, icon, label }) => {
      let itemStatus = getItemStatus(status, key, hasActiveCommands)
      
      // For offline devices with pending commands, show as "pending" instead of actual status
      // because we don't know what the device actually has until it connects
      if (!isOnline && hasActiveCommands) {
        itemStatus = 'pending'
      }
      
      // For offline devices with no pending commands, show current state but note it's offline
      // (the visual indicator handles the offline state)
      
      return {
        key,
        icon,
        label,
        status: itemStatus,
      }
    })

    // Only show "failed" for online devices or if there are no active pending commands
    // For offline devices with pending commands, don't show as failed since it'll retry
    const hasFailed = items.some(i => i.status === 'failed' && isOnline)
    // Check local items for syncing, OR check if global sync is active for this user
    const localActive = items.some(i => i.status === 'syncing')
    const isActive = localActive || globalSyncState.active
    const allSynced = items.length > 0 && items.every(i => i.status === 'synced')

    return { 
      items, 
      hasFailed,
      isActive,
      allSynced,
      isOffline: !isOnline,
      lastSyncedAt: status?.last_synced_at
    }
  }

  const handleSyncToDevice = (deviceSn: string) => {
    console.log('[handleSyncToDevice] user:', user, 'deviceSn:', deviceSn)
    if (!user?.id) {
      console.log('[handleSyncToDevice] No user.id, returning')
      return
    }
    syncUser.mutate({ userId: user.id, deviceSns: [deviceSn] })
  }

  const handleSyncToAll = () => {
    console.log('[handleSyncToAll] user:', user, 'syncStatus:', syncStatus)
    if (!user?.id || syncStatus.length === 0) return
    const deviceSns = syncStatus.map(s => s.device_sn)
    syncUser.mutate({ userId: user.id, deviceSns })
  }

  const handleCancelSync = () => {
    doCancel()
    toast.info('Cancelling sync...')
  }

  const retryUserSync = useRetryUserSync()
  const forceUserSync = useForceUserSync()

  const handleRetryToDevice = (deviceSn: string) => {
    if (!user?.id) return
    retryUserSync.mutate({ userId: user.id, deviceSns: [deviceSn] })
  }

  const handleForceSyncToDevice = (deviceSn: string) => {
    if (!user?.id) return
    forceUserSync.mutate({ userId: user.id, deviceSns: [deviceSn] })
  }

  const handleRetryToAll = () => {
    if (!user?.id || syncStatus.length === 0) return
    const deviceSns = syncStatus.map(s => s.device_sn)
    retryUserSync.mutate({ userId: user.id, deviceSns })
  }

  const handleForceSyncToAll = () => {
    if (!user?.id || syncStatus.length === 0) return
    const deviceSns = syncStatus.map(s => s.device_sn)
    forceUserSync.mutate({ userId: user.id, deviceSns })
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
                    const state = getDeviceState(status)
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
                                <>
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
                                  {state.hasFailed && (
                                    <>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => handleRetryToDevice(deviceSn)}
                                            disabled={retryUserSync.isPending}
                                          >
                                            <RotateCcw className="h-3 w-3" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Retry failed sync</TooltipContent>
                                      </Tooltip>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-orange-600 hover:text-orange-700"
                                            onClick={() => handleForceSyncToDevice(deviceSn)}
                                            disabled={forceUserSync.isPending}
                                          >
                                            <Zap className="h-3 w-3" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Force full re-sync</TooltipContent>
                                      </Tooltip>
                                    </>
                                  )}
                                </>
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
              <div className="flex justify-center pt-2 gap-2">
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
                  {globalSyncState.active && globalSyncState.userId !== userId ? 'Sync in progress...' : 'Sync All'}
                </Button>
                <Button
                  onClick={handleRetryToAll}
                  size="sm"
                  variant="outline"
                  disabled={retryUserSync.isPending}
                  className="h-7 text-xs"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Retry Failed
                </Button>
                <Button
                  onClick={handleForceSyncToAll}
                  size="sm"
                  variant="outline"
                  disabled={forceUserSync.isPending}
                  className="h-7 text-xs text-orange-600 border-orange-200 hover:bg-orange-50"
                >
                  <Zap className="h-3 w-3 mr-1" />
                  Force Sync
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}