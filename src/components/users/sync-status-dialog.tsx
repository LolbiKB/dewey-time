import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
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
  ChevronDown,
  X,
  RotateCcw,
  Server
} from 'lucide-react'
import { useSyncStatus, useSyncUser, useCommandQueue, useClearPendingCommands } from '@/hooks/use-users'
import type { UserEntry } from '@/services/user-service'
import { useMemo, useState } from 'react'
import { ClearCommandsModal } from './clear-commands-modal'
import { isSyncCommand } from '@/lib/command-types'
import { cn } from '@/lib/utils'

interface SyncStatusDialogProps {
  user: UserEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SyncItem = {
  type: 'user' | 'fingerprint' | 'face'
  label: string
  icon: React.ElementType
  hasData: boolean
  isSynced: boolean
  status: 'synced' | 'syncing' | 'pending' | 'failed' | 'na'
}

export function SyncStatusDialog({ user, open, onOpenChange }: SyncStatusDialogProps) {
  const { data, isLoading } = useSyncStatus(user?.id || '')
  const { data: commandData } = useCommandQueue(user?.id || '', 50)
  const syncUser = useSyncUser()
  const clearCommands = useClearPendingCommands()
  const [clearModalState, setClearModalState] = useState<{ deviceSn: string; deviceName: string; count: number } | null>(null)
  
  const syncStatus = data?.data || []
  const allCommands = commandData?.data || []
  const commands = useMemo(() => {
    return allCommands.filter(cmd => isSyncCommand(cmd.command_type || ''))
  }, [allCommands])

  const getItemStatus = (deviceSn: string, type: string): SyncItem['status'] => {
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
    return 'synced'
  }

  const getSyncItems = (status: any, deviceSn: string): SyncItem[] => {
    return [
      {
        type: 'user',
        label: 'User Info',
        icon: User,
        hasData: true,
        isSynced: status?.has_user || false,
        status: status?.has_user ? 'synced' : getItemStatus(deviceSn, 'user')
      },
      {
        type: 'fingerprint',
        label: 'Fingerprint',
        icon: Fingerprint,
        hasData: user?.has_fingerprint || false,
        isSynced: status?.has_fingerprint || false,
        status: !user?.has_fingerprint ? 'na' : (status?.has_fingerprint ? 'synced' : getItemStatus(deviceSn, 'fingerprint'))
      },
      {
        type: 'face',
        label: 'Face',
        icon: ScanFace,
        hasData: user?.has_face || false,
        isSynced: status?.has_face || false,
        status: !user?.has_face ? 'na' : (status?.has_face ? 'synced' : getItemStatus(deviceSn, 'face'))
      }
    ]
  }

  const calculateProgress = (items: SyncItem[]) => {
    const relevant = items.filter(i => i.hasData)
    const synced = relevant.filter(i => i.isSynced).length
    const total = relevant.length
    return {
      synced,
      total,
      percent: total > 0 ? Math.round((synced / total) * 100) : 0,
      isComplete: synced === total
    }
  }

  const getStatusIcon = (status: SyncItem['status']) => {
    switch (status) {
      case 'synced':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'syncing':
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
      case 'pending':
        return <Clock className="h-4 w-4 text-amber-600" />
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-600" />
      case 'na':
        return <span className="h-4 w-4 text-gray-300">—</span>
    }
  }

  const getStatusBadge = (status: SyncItem['status']) => {
    const variants: Record<typeof status, { label: string; className: string }> = {
      synced: { label: 'Synced', className: 'bg-green-100 text-green-800 border-green-200' },
      syncing: { label: 'Syncing', className: 'bg-blue-100 text-blue-800 border-blue-200' },
      pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 border-amber-200' },
      failed: { label: 'Failed', className: 'bg-red-100 text-red-800 border-red-200' },
      na: { label: 'N/A', className: 'bg-gray-100 text-gray-500 border-gray-200' }
    }
    const { label, className } = variants[status]
    return <Badge variant="outline" className={cn("text-[10px] h-5 font-normal", className)}>{label}</Badge>
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
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Device Sync
            </DialogTitle>
            <DialogDescription>
              {user.name} · PIN: {user.pin}
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 space-y-6">
            {/* Global Actions */}
            {!isLoading && syncStatus.length > 0 && (
              <div className="flex justify-end">
                <Button
                  onClick={handleSyncToAll}
                  disabled={syncUser.isPending}
                  className="gap-2"
                >
                  {syncUser.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Sync All Devices
                </Button>
              </div>
            )}

            {/* Device Cards */}
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : syncStatus.length === 0 ? (
              <Alert>
                <AlertDescription>
                  No devices found. User has not been registered on any devices yet.
                </AlertDescription>
              </Alert>
            ) : (
              <TooltipProvider>
                <div className="space-y-4">
                  {syncStatus.map((status) => {
                    const device = status.devices
                    const deviceSn = status.device_sn
                    const items = getSyncItems(status, deviceSn)
                    const progress = calculateProgress(items)
                    const isOnline = status.is_online
                    const hasErrors = items.some(i => i.status === 'failed')
                    const isActive = items.some(i => i.status === 'syncing' || i.status === 'pending')
                    
                    return (
                      <Card key={status.id} className={cn(
                        "overflow-hidden transition-colors",
                        hasErrors && "border-red-200",
                        progress.isComplete && !hasErrors && "border-green-200"
                      )}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className={cn(
                                    "p-2 rounded-full",
                                    isOnline ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
                                  )}>
                                    {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isOnline ? 'Device online' : 'Device offline'}
                                </TooltipContent>
                              </Tooltip>
                              <div>
                                <CardTitle className="text-base font-medium">
                                  {device?.name || deviceSn}
                                </CardTitle>
                                {device?.name && (
                                  <p className="text-xs text-muted-foreground font-mono">
                                    {deviceSn}
                                  </p>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-1">
                              {isActive && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground"
                                      onClick={() => handleClearDevice(deviceSn, device?.name || deviceSn)}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Clear pending commands</TooltipContent>
                                </Tooltip>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSyncToDevice(deviceSn)}
                                disabled={syncUser.isPending || isActive}
                                className="gap-1"
                              >
                                {isActive ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : progress.isComplete ? (
                                  <RotateCcw className="h-3 w-3" />
                                ) : (
                                  <RefreshCw className="h-3 w-3" />
                                )}
                                {isActive ? 'Syncing' : progress.isComplete ? 'Re-sync' : 'Sync'}
                              </Button>
                            </div>
                          </div>

                          {/* Progress */}
                          <div className="pt-2 space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                {progress.synced} of {progress.total} synced
                              </span>
                              <span className={cn(
                                "font-medium",
                                progress.isComplete ? "text-green-600" : "text-blue-600"
                              )}>
                                {progress.percent}%
                              </span>
                            </div>
                            <Progress 
                              value={progress.percent} 
                              className={cn(
                                "h-2",
                                progress.isComplete && "bg-green-100 [&>div]:bg-green-600",
                                hasErrors && "bg-red-100 [&>div]:bg-red-600"
                              )}
                            />
                          </div>
                        </CardHeader>

                        <Separator />

                        <CardContent className="pt-4 pb-4">
                          <Collapsible>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" className="w-full justify-between p-0 h-auto font-normal hover:bg-transparent">
                                <span className="text-sm text-muted-foreground">View details</span>
                                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-4 space-y-2">
                              {items.map((item) => {
                                const Icon = item.icon
                                return (
                                  <div
                                    key={item.type}
                                    className={cn(
                                      "flex items-center justify-between p-3 rounded-lg border",
                                      item.status === 'synced' && "bg-green-50/50 border-green-100",
                                      item.status === 'syncing' && "bg-blue-50/50 border-blue-100",
                                      item.status === 'pending' && "bg-amber-50/50 border-amber-100",
                                      item.status === 'failed' && "bg-red-50/50 border-red-100",
                                      item.status === 'na' && "bg-gray-50 border-gray-100"
                                    )}
                                  >
                                    <div className="flex items-center gap-3">
                                      {getStatusIcon(item.status)}
                                      <div className="flex items-center gap-2">
                                        <Icon className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-sm font-medium">{item.label}</span>
                                      </div>
                                    </div>
                                    {getStatusBadge(item.status)}
                                  </div>
                                )
                              })}
                            </CollapsibleContent>
                          </Collapsible>
                        </CardContent>
                      </Card>
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