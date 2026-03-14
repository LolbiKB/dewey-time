import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  X
} from 'lucide-react'
import { useSyncStatus, useSyncUser, useCommandQueue, useClearPendingCommands } from '@/hooks/use-users'
import type { UserEntry } from '@/services/user-service'
import { useMemo, useState, useEffect } from 'react'
import { ClearCommandsModal } from './clear-commands-modal'
import { isSyncCommand } from '@/lib/command-types'
import { cn } from '@/lib/utils'

interface SyncStatusDialogProps {
  user: UserEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DATA_TYPES = [
  { key: 'user', icon: User, label: 'User' },
  { key: 'fingerprint', icon: Fingerprint, label: 'FP' },
  { key: 'face', icon: ScanFace, label: 'Face' },
  { key: 'photo', icon: Image, label: 'Photo' },
] as const

export function SyncStatusDialog({ user, open, onOpenChange }: SyncStatusDialogProps) {
  // Use more aggressive polling when modal is open (3s for sync, 1s for commands)
  const { data, isLoading, refetch: refetchSyncStatus } = useSyncStatus(user?.id || '', {
    refetchInterval: open ? 3000 : 10000, // 3s when open, 10s when closed
  })
  const { data: commandData, refetch: refetchCommands } = useCommandQueue(user?.id || '', 50, {
    refetchInterval: open ? 1000 : 3000, // 1s when open, 3s when closed
  })
  const syncUser = useSyncUser()
  const clearCommands = useClearPendingCommands()
  const [clearModalState, setClearModalState] = useState<{ deviceSn: string; deviceName: string; count: number } | null>(null)

  // Immediate refetch when modal opens
  useEffect(() => {
    if (open && user?.id) {
      refetchSyncStatus()
      refetchCommands()
    }
  }, [open, user?.id, refetchSyncStatus, refetchCommands])
  
  const syncStatus = data?.data || []
  const allCommands = commandData?.data || []
  const commands = useMemo(() => {
    return allCommands.filter(cmd => isSyncCommand(cmd.command_type || ''))
  }, [allCommands])

  const getItemStatus = (deviceSn: string, type: string, isSynced: boolean) => {
    // If already synced according to database, return synced
    if (isSynced) return 'synced'
    
    // Check for active commands
    const deviceCommands = commands.filter(cmd => 
      cmd.device_sn === deviceSn && 
      cmd.command_type?.includes(type === 'user' ? 'user' : type)
    )
    
    const latestCmd = deviceCommands.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]

    if (latestCmd?.status === 'sent') return 'syncing'
    if (latestCmd?.status === 'pending') return 'pending'
    if (latestCmd?.status === 'failed') return 'failed'
    
    // Not synced and no active command = needs sync
    return 'pending'
  }

  const getSyncState = (status: any, deviceSn: string) => {
    const items = DATA_TYPES.map(({ key, icon, label }) => {
      const hasData = key === 'user' ? true : 
        key === 'fingerprint' ? user?.has_fingerprint :
        key === 'face' ? user?.has_face :
        !!user?.photo_url
      
      const isSynced = key === 'user' ? status?.has_user :
        key === 'fingerprint' ? status?.has_fingerprint :
        key === 'face' ? status?.has_face :
        status?.has_photo
      
      return {
        key,
        icon,
        label,
        hasData,
        status: !hasData ? 'na' : getItemStatus(deviceSn, key, isSynced)
      }
    })

    const relevant = items.filter(i => i.hasData)
    const synced = relevant.filter(i => i.status === 'synced').length
    const hasErrors = relevant.some(i => i.status === 'failed')
    const isActive = relevant.some(i => i.status === 'syncing' || i.status === 'pending')
    const percent = relevant.length > 0 ? Math.round((synced / relevant.length) * 100) : 0

    return { items, synced, total: relevant.length, percent, hasErrors, isActive }
  }

  const handleSyncToDevice = (deviceSn: string) => {
    if (!user?.id) return
    syncUser.mutate({ userId: user.id, deviceSns: [deviceSn] })
  }

  const handleSyncToAll = () => {
    if (!user?.id || syncStatus.length === 0) return
    const deviceSns = syncStatus.map(s => s.device_sn)
    syncUser.mutate({ userId: user.id, deviceSns })
  }

  const handleClearDevice = (deviceSn: string, deviceName: string) => {
    const deviceCommands = commands.filter(cmd => cmd.device_sn === deviceSn)
    const count = deviceCommands.length
    if (count === 0) return
    setClearModalState({ deviceSn, deviceName, count })
  }

  const handleConfirmClear = () => {
    if (!clearModalState || !user?.id) return
    clearCommands.mutate(
      { deviceSn: clearModalState.deviceSn, userId: user.id },
      { onSuccess: () => setClearModalState(null) }
    )
  }

  if (!user) return null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0">
          <DialogHeader className="px-4 py-3 border-b">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base">Device Sync</DialogTitle>
                <DialogDescription className="text-xs">
                  {user.name} · {user.pin}
                </DialogDescription>
              </div>
              {!isLoading && syncStatus.length > 0 && (
                <Button
                  onClick={handleSyncToAll}
                  disabled={syncUser.isPending}
                  size="sm"
                  className="h-7 text-xs"
                >
                  {syncUser.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  Sync All
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="p-3">
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
                    const state = getSyncState(status, deviceSn)
                    const isOnline = status.is_online
                    
                    return (
                      <div 
                        key={status.id} 
                        className={cn(
                          "rounded-lg border p-2.5",
                          state.hasErrors && "border-red-200 bg-red-50/30",
                          state.percent === 100 && !state.hasErrors && "border-green-200 bg-green-50/30"
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
                              ) : state.percent === 100 ? (
                                <RefreshCw className="h-3 w-3" />
                              ) : (
                                'Sync'
                              )}
                            </Button>
                          </div>
                        </div>

                        {/* Progress */}
                        <div className="flex items-center gap-2 mb-2">
                          <Progress 
                            value={state.percent} 
                            className={cn(
                              "h-1.5 flex-1",
                              state.percent === 100 && !state.hasErrors && "bg-green-100 [&>div]:bg-green-500",
                              state.hasErrors && "bg-red-100 [&>div]:bg-red-500"
                            )}
                          />
                          <span className={cn(
                            "text-xs font-medium w-8 text-right shrink-0",
                            state.percent === 100 ? "text-green-600" : "text-muted-foreground"
                          )}>
                            {state.percent}%
                          </span>
                        </div>

                        {/* Items Grid */}
                        <div className="grid grid-cols-4 gap-1">
                          {state.items.map(({ key, icon: Icon, label, status }) => {
                            if (status === 'na') return (
                              <div key={key} className="flex flex-col items-center gap-0.5 p-1 rounded opacity-40">
                                <Icon className="h-3.5 w-3.5 text-gray-400" />
                                <span className="text-[9px] text-gray-400">{label}</span>
                              </div>
                            )
                            
                            return (
                              <Tooltip key={key}>
                                <TooltipTrigger asChild>
                                  <div className={cn(
                                    "flex flex-col items-center gap-0.5 p-1 rounded cursor-default",
                                    status === 'synced' && "bg-green-100/50",
                                    status === 'syncing' && "bg-blue-100/50",
                                    status === 'pending' && "bg-amber-100/50",
                                    status === 'failed' && "bg-red-100/50"
                                  )}>
                                    {status === 'synced' && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                                    {status === 'syncing' && <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />}
                                    {status === 'pending' && <Clock className="h-3.5 w-3.5 text-amber-600" />}
                                    {status === 'failed' && <AlertCircle className="h-3.5 w-3.5 text-red-600" />}
                                    <span className={cn(
                                      "text-[9px] font-medium",
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
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </TooltipProvider>
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