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
import { useSyncStatus, useSyncUser, useCommandQueue, useClearPendingCommands } from '@/hooks/use-users'
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

// Get status from per-item sync flags (from database)
function getItemStatusFromFlags(status: any, key: string, hasPendingCommands: boolean): ItemStatus {
  const fieldMap: Record<string, string> = {
    user: 'user_synced',
    fingerprint: 'fingerprint_synced',
    face: 'face_synced',
    photo: 'photo_synced',
  }
  
  const field = fieldMap[key]
  if (!field) return 'pending'
  
  const isSynced = status[field]
  
  if (isSynced) return 'synced'
  
  // Check if there are pending commands - shows syncing
  if (hasPendingCommands) return 'syncing'
  
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
  const clearCommands = useClearPendingCommands()
  const [clearModalState, setClearModalState] = useState<{ deviceSn: string; deviceName: string; count: number } | null>(null)

  // Immediate refetch when modal opens
  useEffect(() => {
    if (userId && open) {
      refetchSyncStatus()
    }
  }, [open, userId])
  
  const syncStatus = data?.data || []
  const commands = commandData?.data || []

  const getDeviceState = (status: any, _deviceSn: string) => {
    // Check if there are any pending commands for this device
    const deviceCommands = commands.filter(cmd => cmd.device_sn === status.device_sn)
    const hasPendingCommands = deviceCommands.some(cmd => 
      cmd.status === 'pending' || cmd.status === 'sent'
    )
    
    // Use per-item sync status from database (much more stable)
    const availableItems = ALL_DATA_TYPES.filter(({ key }) => {
      if (key === 'user') return true
      if (key === 'fingerprint') return status.has_fingerprint_in_db
      if (key === 'face') return status.has_face_in_db
      if (key === 'photo') return status.has_photo_in_db
      return true
    })
    
    const items = availableItems.map(({ key, icon, label }) => {
      const itemStatus = getItemStatusFromFlags(status, key, hasPendingCommands)
      
      return {
        key,
        icon,
        label,
        status: itemStatus,
      }
    })

    // Determine overall device state
    const hasFailed = items.some(i => i.status === 'failed')
    const isActive = items.some(i => i.status === 'syncing')
    // Device is synced if ALL items are synced
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
                                    onClick={() => handleClearDevice(deviceSn, device?.name || deviceSn)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Clear</TooltipContent>
                              </Tooltip>
                            )}
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
            {!isLoading && syncStatus.length > 0 && !syncUser.isPending && (
              <div className="flex justify-center pt-2">
                <Button
                  onClick={handleSyncToAll}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Sync All Devices
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