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
  RotateCcw,
  Zap,
  ArrowRight,
} from 'lucide-react'
import { useSyncStatus, useSyncUser, useCommandQueue, useSyncCancel, useGlobalSyncState, useRetryUserSync, useForceUserSync, useUserBiometrics } from '@/hooks/use-users'
import type { UserEntry } from '@/services/user-service'
import React, { useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  buildComponentSyncOptions,
  getComponentSyncStatus,
  isDeviceAllComponentsSynced,
  type SyncComponent,
} from '@/lib/sync-component-status'
import {
  useDevicePresenceMap,
  enrichSyncStatusWithPresence,
} from '@/hooks/use-device-presence'

interface SyncStatusDialogProps {
  user: UserEntry | null
  userId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DATA_TYPES = [
  { key: 'user', icon: User, label: 'User', commandType: 'sync_user' },
  { key: 'fingerprint', icon: Fingerprint, label: 'FP', commandType: 'enroll_fingerprint' },
  { key: 'face', icon: ScanFace, label: 'Face', commandType: 'enroll_face' },
  { key: 'photo', icon: Image, label: 'Photo', commandType: 'upload_photo' },
] as const

type ItemStatus = 'not_enrolled' | 'pending' | 'syncing' | 'synced' | 'failed'

const statusConfig: Record<ItemStatus, { icon: typeof CheckCircle2; bg: string; text: string; color: string }> = {
  not_enrolled: { icon: Clock, bg: 'bg-muted/50 dark:bg-muted/30', text: 'text-muted-foreground', color: 'text-muted-foreground' },
  synced: { icon: CheckCircle2, bg: 'bg-green-50 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-400', color: 'text-green-600' },
  syncing: { icon: Loader2, bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-400', color: 'text-blue-600' },
  pending: { icon: Clock, bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', color: 'text-amber-600' },
  failed: { icon: AlertCircle, bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', color: 'text-red-600' },
}

function StatusPill({ status, label }: { status: ItemStatus; label: string }) {
  const config = statusConfig[status]
  const Icon = config.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
          config.bg, config.text
        )}>
          <Icon className={cn('h-3 w-3', status === 'syncing' && 'animate-spin')} />
          <span>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}: {status}</TooltipContent>
    </Tooltip>
  )
}

export function SyncStatusDialog({ user, userId, open, onOpenChange }: SyncStatusDialogProps) {
  const refetchInterval = open ? 3000 : undefined
  const { data, isLoading, refetch: refetchSyncStatus } = useSyncStatus(userId, { refetchInterval })
  const { data: commandData } = useCommandQueue(userId, 50, { refetchInterval })
  const { data: biometricsData } = useUserBiometrics(user?.id || '')
  const syncUser = useSyncUser()
  const { cancel: doCancel } = useSyncCancel()
  const globalSyncState = useGlobalSyncState()
  const retryUserSync = useRetryUserSync()
  const forceUserSync = useForceUserSync()
  
  const fingerprints = (biometricsData?.data || []).filter((b: any) => b.type === 'fingerprint')

  useEffect(() => {
    if (userId && open) refetchSyncStatus()
  }, [open, userId])

  const { map: presenceMap } = useDevicePresenceMap({ enabled: open && !!userId })
  const syncStatus = useMemo(
    () => enrichSyncStatusWithPresence(data?.data || [], presenceMap),
    [data, presenceMap]
  )
  const commands = commandData?.data || []

  const getDeviceState = (status: any) => {
    const deviceCommands = commands.filter(cmd => cmd.device_sn === status.device_sn)
    const isOnline = status.is_online
    const syncOptions = buildComponentSyncOptions(deviceCommands, {
      fingerprints,
      hasFaceInDb: !!(status.has_face_in_db ?? status.has_face),
      hasPhotoInDb: !!status.has_photo_in_db,
    })
    const hasActiveCommands = syncOptions.hasActiveCommands ?? false

    const availableItems = DATA_TYPES.filter(({ key }) => {
      if (key === 'user') return true
      if (key === 'fingerprint') return status.has_fingerprint || status.fingerprint_synced
      if (key === 'face') return status.has_face || status.face_synced
      if (key === 'photo') return status.has_photo_in_db || status.photo_synced
      return true
    })

    const items = availableItems.map(({ key, label }) => {
      let itemStatus = getComponentSyncStatus(key as SyncComponent, status, syncOptions).state
      if (!isOnline && hasActiveCommands && itemStatus === 'syncing') itemStatus = 'pending'
      return { key, label, status: itemStatus as ItemStatus }
    })

    const syncedCount = items.filter(i => i.status === 'synced').length
    const hasFailed = items.some(i => i.status === 'failed' && isOnline)
    const isActive = items.some(i => i.status === 'syncing') || globalSyncState.active
    const allSynced = isDeviceAllComponentsSynced(status, syncOptions)

    return { items, syncedCount, total: items.length, hasFailed, isActive, allSynced, isOffline: !isOnline, lastSyncedAt: status?.last_synced_at }
  }

  const handleSyncToDevice = (deviceSn: string) => {
    if (!user?.id) return
    syncUser.mutate({ userId: user.id, deviceSns: [deviceSn] })
  }

  const handleSyncToAll = () => {
    if (!user?.id || syncStatus.length === 0) return
    syncUser.mutate({ userId: user.id, deviceSns: syncStatus.map(s => s.device_sn) })
  }

  const handleCancelSync = () => {
    doCancel()
    toast.info('Cancelling sync...')
  }

  const handleRetry = (deviceSn?: string) => {
    if (!user?.id) return
    retryUserSync.mutate({ userId: user.id, deviceSns: deviceSn ? [deviceSn] : syncStatus.map(s => s.device_sn) })
  }

  const handleForceSync = (deviceSn?: string) => {
    if (!user?.id) return
    forceUserSync.mutate({ userId: user.id, deviceSns: deviceSn ? [deviceSn] : syncStatus.map(s => s.device_sn) })
  }

  if (!user) return null

  // BULLETPROOF: Calculate isSyncing based on ACTUAL command status, not global state
  const hasActiveCommandsForUser = commands.some((c: any) => c.status === 'pending' || c.status === 'sent')
  const isSyncingAny = hasActiveCommandsForUser || syncUser.isPending || retryUserSync.isPending || forceUserSync.isPending
  const isSyncingThis = isSyncingAny

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b shrink-0">
          <DialogTitle className="text-base">Sync Status</DialogTitle>
          <DialogDescription className="text-xs mt-0.5">
            {user.name} <span className="text-muted-foreground font-mono">PIN {user.pin}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : syncStatus.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No devices found for this user
            </div>
          ) : (
            <TooltipProvider delayDuration={200}>
              <div className="space-y-2.5">
                {syncStatus.map((status) => {
                  const device = status.devices
                  const deviceSn = status.device_sn
                  const state = getDeviceState(status)
                  const isOnline = status.is_online

                  return (
                    <div
                      key={status.id}
                      className={cn(
                        "rounded-xl border p-3.5 transition-colors",
                        state.hasFailed && "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20",
                        state.allSynced && !state.hasFailed && "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20",
                        !state.hasFailed && !state.allSynced && "border-border"
                      )}
                    >
                      {/* Device header */}
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {isOnline ? (
                            <Wifi className="h-3.5 w-3.5 text-green-600 shrink-0" />
                          ) : (
                            <WifiOff className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          )}
                          <span className="text-sm font-medium truncate">
                            {device?.name || deviceSn}
                          </span>
                          {!isOnline && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              Offline
                            </span>
                          )}
                          {state.allSynced && (
                            <span className="text-[10px] text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded">
                              Synced
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {state.isActive && isSyncingThis && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelSync}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!isSyncingAny || isSyncingThis ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSyncToDevice(deviceSn)}
                              disabled={syncUser.isPending || state.isActive}
                              className="h-7 text-xs gap-1"
                            >
                              {state.isActive ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                              {state.isActive ? 'Syncing' : 'Sync'}
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" disabled className="h-7 text-xs gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Busy
                            </Button>
                          )}
                          {state.hasFailed && (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRetry(deviceSn)} disabled={retryUserSync.isPending}>
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-600 hover:text-orange-700" onClick={() => handleForceSync(deviceSn)} disabled={forceUserSync.isPending}>
                                <Zap className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Status pills */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {state.items.map((item, idx) => (
                          <React.Fragment key={item.key}>
                            {idx > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground/50" />}
                            <StatusPill status={item.status} label={item.label} />
                          </React.Fragment>
                        ))}
                      </div>

                      {/* Last synced */}
                      {state.lastSyncedAt && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-2">
                          <Clock className="h-2.5 w-2.5" />
                          Last sync: {new Date(state.lastSyncedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </TooltipProvider>
          )}
        </div>

        {/* Footer actions */}
        {!isLoading && syncStatus.length > 0 && (
          <div className="border-t px-5 py-3 flex items-center justify-end gap-2 shrink-0">
            <Button
              onClick={handleSyncToAll}
              size="sm"
              variant="outline"
              disabled={syncUser.isPending || isSyncingAny}
              className="gap-1.5"
            >
              {isSyncingThis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sync All
            </Button>
            <Button
              onClick={() => handleRetry()}
              size="sm"
              variant="outline"
              disabled={retryUserSync.isPending}
              className="gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry Failed
            </Button>
            <Button
              onClick={() => handleForceSync()}
              size="sm"
              variant="outline"
              disabled={forceUserSync.isPending}
              className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950/30"
            >
              <Zap className="h-3.5 w-3.5" />
              Force Sync
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}