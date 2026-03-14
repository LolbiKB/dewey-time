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
  Circle,
  ChevronDown,
  ChevronUp,
  X
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

// Data types that can be synced
const DATA_TYPES = [
  { key: 'user', label: 'User Info', icon: User },
  { key: 'fingerprint', label: 'Fingerprint', icon: Fingerprint },
  { key: 'face', label: 'Face', icon: ScanFace },
] as const

type DataTypeStatus = {
  type: typeof DATA_TYPES[number]['key']
  status: 'synced' | 'pending' | 'syncing' | 'failed' | 'missing'
  command?: any
}

export function SyncStatusDialog({ user, open, onOpenChange }: SyncStatusDialogProps) {
  const { data, isLoading } = useSyncStatus(user?.id || '')
  const { data: commandData } = useCommandQueue(user?.id || '', 50)
  const syncUser = useSyncUser()
  const clearCommands = useClearPendingCommands()
  const [clearModalState, setClearModalState] = useState<{ deviceSn: string; deviceName: string; count: number } | null>(null)
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set())
  
  const syncStatus = data?.data || []
  const allCommands = commandData?.data || []
  const commands = useMemo(() => {
    return allCommands.filter(cmd => isSyncCommand(cmd.command_type || ''))
  }, [allCommands])

  const toggleExpanded = (deviceSn: string) => {
    setExpandedDevices(prev => {
      const next = new Set(prev)
      if (next.has(deviceSn)) {
        next.delete(deviceSn)
      } else {
        next.add(deviceSn)
      }
      return next
    })
  }

  const getDataTypeStatus = (deviceSn: string, type: string, status: any): DataTypeStatus['status'] => {
    const deviceCommands = commands.filter(cmd => 
      cmd.device_sn === deviceSn && 
      cmd.command_type?.includes(type === 'user' ? 'user' : type)
    )
    
    const latestCmd = deviceCommands.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]

    if (latestCmd?.status === 'pending') return 'pending'
    if (latestCmd?.status === 'sent') return 'syncing'
    if (latestCmd?.status === 'failed') return 'failed'
    
    // Check if data exists on device
    if (type === 'user' && status?.has_user) return 'synced'
    if (type === 'fingerprint' && status?.has_fingerprint) return 'synced'
    if (type === 'face' && status?.has_face) return 'synced'
    
    // Check if user has this data type
    if (type === 'fingerprint' && !user?.has_fingerprint) return 'missing'
    if (type === 'face' && !user?.has_face) return 'missing'
    
    return 'pending'
  }

  const getStatusIcon = (status: DataTypeStatus['status']) => {
    switch (status) {
      case 'synced':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'syncing':
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
      case 'pending':
        return <Clock className="h-4 w-4 text-gray-400" />
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-600" />
      case 'missing':
        return <Circle className="h-4 w-4 text-gray-300" />
    }
  }

  const getStatusColor = (status: DataTypeStatus['status']) => {
    switch (status) {
      case 'synced':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'syncing':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'pending':
        return 'text-gray-600 bg-gray-50 border-gray-200'
      case 'failed':
        return 'text-red-600 bg-red-50 border-red-200'
      case 'missing':
        return 'text-gray-400 bg-gray-50/50 border-gray-200'
    }
  }

  const calculateProgress = (status: any) => {
    let total = 1 // User info always required
    let synced = status?.has_user ? 1 : 0
    
    if (user?.has_fingerprint) {
      total++
      if (status?.has_fingerprint) synced++
    }
    
    if (user?.has_face) {
      total++
      if (status?.has_face) synced++
    }
    
    return { synced, total, percent: Math.round((synced / total) * 100) }
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
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sync Status</DialogTitle>
            <DialogDescription>
              {user.name} (PIN: {user.pin})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Global Actions */}
            {!isLoading && syncStatus.length > 0 && (
              <div className="flex justify-end">
                <Button
                  onClick={handleSyncToAll}
                  size="sm"
                  disabled={syncUser.isPending}
                >
                  {syncUser.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                  )}
                  Sync All Devices
                </Button>
              </div>
            )}

            {/* Device Cards */}
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : syncStatus.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No devices found. User may not be registered on any devices yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {syncStatus.map((status) => {
                  const device = status.devices
                  const deviceSn = status.device_sn
                  const isExpanded = expandedDevices.has(deviceSn)
                  const progress = calculateProgress(status)
                  const isOnline = status.is_online
                  
                  // Count active commands for this device
                  const deviceActiveCount = commands.filter(cmd => 
                    cmd.device_sn === deviceSn && 
                    (cmd.status === 'pending' || cmd.status === 'sent')
                  ).length

                  return (
                    <div
                      key={status.id}
                      className="border rounded-lg overflow-hidden"
                    >
                      {/* Device Header */}
                      <div className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            {isOnline ? (
                              <Wifi className="h-5 w-5 text-green-600" />
                            ) : (
                              <WifiOff className="h-5 w-5 text-gray-400" />
                            )}
                            <div>
                              <div className="font-medium">
                                {device?.name || deviceSn}
                              </div>
                              {device?.name && (
                                <div className="text-xs text-muted-foreground font-mono">
                                  {deviceSn}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {deviceActiveCount > 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleClearDevice(deviceSn, device?.name || deviceSn)}
                              >
                                <X className="h-3 w-3 mr-1" />
                                Clear
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleSyncToDevice(deviceSn)}
                              disabled={syncUser.isPending || deviceActiveCount > 0}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Sync
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => toggleExpanded(deviceSn)}
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              {progress.synced} of {progress.total} items synced
                            </span>
                            <span className={cn(
                              "font-medium",
                              progress.percent === 100 ? "text-green-600" : "text-blue-600"
                            )}>
                              {progress.percent}%
                            </span>
                          </div>
                          <Progress 
                            value={progress.percent} 
                            className="h-2"
                          />
                        </div>
                      </div>

                      {/* Expandable Details */}
                      {isExpanded && (
                        <div className="border-t bg-muted/30 px-4 py-3 space-y-2">
                          {DATA_TYPES.map(({ key, label, icon: Icon }) => {
                            const itemStatus = getDataTypeStatus(deviceSn, key, status)
                            
                            // Skip if user doesn't have this data type
                            if (key === 'fingerprint' && !user.has_fingerprint) return null
                            if (key === 'face' && !user.has_face) return null
                            
                            return (
                              <div
                                key={key}
                                className={cn(
                                  "flex items-center justify-between p-2 rounded-md border",
                                  getStatusColor(itemStatus)
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  {getStatusIcon(itemStatus)}
                                  <Icon className="h-4 w-4" />
                                  <span className="text-sm font-medium">{label}</span>
                                </div>
                                <Badge variant="outline" className="text-[10px] h-5">
                                  {itemStatus === 'synced' && 'Synced'}
                                  {itemStatus === 'syncing' && 'Syncing...'}
                                  {itemStatus === 'pending' && 'Pending'}
                                  {itemStatus === 'failed' && 'Failed'}
                                  {itemStatus === 'missing' && 'N/A'}
                                </Badge>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
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