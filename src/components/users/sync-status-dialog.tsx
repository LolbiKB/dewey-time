import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Loader2, Fingerprint, ScanFace, Wifi, WifiOff, CheckCircle2, AlertCircle, Clock, Circle, Upload, Image } from 'lucide-react'
import { useSyncStatus, useSyncUser, useCommandQueue, useClearPendingCommands, useDriftStatus } from '@/hooks/use-users'
import type { UserEntry } from '@/services/user-service'
import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { ClearCommandsModal } from './clear-commands-modal'
import { DeviceSyncPipeline } from './device-sync-pipeline'
import { isSyncCommand } from '@/lib/command-types'

interface SyncStatusDialogProps {
  user: UserEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SyncStatusDialog({ user, open, onOpenChange }: SyncStatusDialogProps) {
  const { data, isLoading } = useSyncStatus(user?.id || '')
  const { data: commandData } = useCommandQueue(user?.id || '', 50)
  const { data: driftData } = useDriftStatus(user?.id || '')
  const syncUser = useSyncUser()
  const clearCommands = useClearPendingCommands()
  const [clearModalState, setClearModalState] = useState<{ deviceSn: string; deviceName: string; count: number } | null>(null)
  
  // Build drift map for quick lookup
  const driftMap = useMemo(() => {
    const map = new Map()
    driftData?.data?.forEach(drift => {
      map.set(drift.device_sn, drift)
    })
    return map
  }, [driftData])

  const syncStatus = data?.data || []
  // Filter to only show sync commands (not device-level commands like reboot, info, etc.)
  const allCommands = commandData?.data || []
  const commands = useMemo(() => {
    return allCommands.filter(cmd => isSyncCommand(cmd.command_type || ''))
  }, [allCommands])

  // Count active (pending/sent) commands per device
  const activeCommandsByDevice = useMemo(() => {
    const counts: Record<string, number> = {}
    commands.forEach(cmd => {
      if (cmd.status === 'pending' || cmd.status === 'sent') {
        counts[cmd.device_sn] = (counts[cmd.device_sn] || 0) + 1
      }
    })
    return counts
  }, [commands])

  // Check if all devices already have active commands (no point syncing)
  const allDevicesBusy = syncStatus.length > 0 && syncStatus.every(
    (s) => !!activeCommandsByDevice[s.device_sn]
  )

  const handleSyncToDevice = (deviceSn: string) => {
    if (!user?.id) return
    syncUser.mutate({ userId: user.id, deviceSns: [deviceSn] })
  }

  const handleSyncToAll = () => {
    if (!user?.id || syncStatus.length === 0) return

    // Only queue to devices that don't already have active commands
    const deviceSns = syncStatus
      .map(s => s.device_sn)
      .filter(sn => !activeCommandsByDevice[sn])
    if (deviceSns.length === 0) return

    syncUser.mutate({ userId: user.id, deviceSns })
  }

  const handleClearDevice = (deviceSn: string, deviceName: string) => {
    const count = activeCommandsByDevice[deviceSn] || 0
    if (count === 0) return
    setClearModalState({ deviceSn, deviceName, count })
  }

  const handleConfirmClear = () => {
    if (!clearModalState || !user?.id) return
    clearCommands.mutate(
      { deviceSn: clearModalState.deviceSn, userId: user.id },
      {
        onSuccess: () => {
          setClearModalState(null)
        }
      }
    )
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="h-5 px-1.5 text-[10px] bg-gray-100 text-gray-700">Pending</Badge>
      case 'sent':
        return <Badge variant="outline" className="h-5 px-1.5 text-[10px] bg-blue-100 text-blue-700">Sent</Badge>
      case 'success':
        return <Badge variant="outline" className="h-5 px-1.5 text-[10px] bg-green-100 text-green-700">Success</Badge>
      case 'failed':
        return <Badge variant="outline" className="h-5 px-1.5 text-[10px] bg-red-100 text-red-700">Failed</Badge>
      default:
        return null
    }
  }

  const getErrorMessage = (errorCode: string | null | undefined) => {
    if (!errorCode) return null

    // Error codes from ZKTeco PUSH Protocol (Appendix 1)
    const errorMap: Record<string, string> = {
      'Error -1004': 'Data inconsistency - Often duplicate PIN, but may also indicate invalid auth mode or data format mismatch',
      'Error -1002': 'Not supported by equipment - Command or data type not supported',
      'Error -1': 'Invalid parameter',
      'Error 0': 'Success',
    }

    return errorMap[errorCode] || errorCode
  }

  // Calculate device sync state
  const getDeviceSyncState = (deviceSn: string) => {
    const deviceCommands = commands.filter(cmd => cmd.device_sn === deviceSn)
    const pendingCmd = deviceCommands.find(cmd => cmd.status === 'pending')
    const sentCmd = deviceCommands.find(cmd => cmd.status === 'sent')

    // Only consider failed commands that are MORE RECENT than the last success.
    // This prevents old failures (e.g. Error 5) from showing after a later successful sync.
    const sortedDesc = [...deviceCommands].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    const lastSuccessTime = sortedDesc.find(c => c.status === 'success')?.created_at
    const recentFailed = sortedDesc.filter(cmd =>
      cmd.status === 'failed' &&
      (!lastSuccessTime || new Date(cmd.created_at) > new Date(lastSuccessTime))
    )
    const failedCmd = recentFailed.find(cmd =>
      (cmd.retry_count || 0) >= (cmd.max_retries || 3)
    )
    const retryingCmd = recentFailed.find(cmd =>
      (cmd.retry_count || 0) < (cmd.max_retries || 3)
    )
    const status = syncStatus.find(s => s.device_sn === deviceSn)

    if (pendingCmd) {
      return {
        state: 'queued' as const,
        label: 'Queued',
        icon: <Clock className="h-5 w-5 text-blue-600" />,
        command: pendingCmd
      }
    } else if (sentCmd) {
      return {
        state: 'syncing' as const,
        label: 'Syncing',
        icon: <Upload className="h-5 w-5 text-blue-600" />,
        command: sentCmd
      }
    } else if (retryingCmd) {
      return {
        state: 'retrying' as const,
        label: `Retrying (${retryingCmd.retry_count}/${retryingCmd.max_retries})`,
        icon: <Clock className="h-5 w-5 text-yellow-600" />,
        command: retryingCmd
      }
    } else if (failedCmd) {
      return {
        state: 'failed' as const,
        label: 'Needs Manual Fix',
        icon: <AlertCircle className="h-5 w-5 text-red-600" />,
        command: failedCmd
      }
    } else if (status?.has_user) {
      // Check if ALL expected data is synced (not just user)
      const allSynced = status.has_user
        && (!user?.has_fingerprint || status.has_fingerprint)
        && (!user?.has_face || status.has_face)
      if (allSynced) {
        return {
          state: 'synced' as const,
          label: 'Synced',
          icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
          command: null
        }
      } else {
        return {
          state: 'partial' as const,
          label: 'Partially Synced',
          icon: <AlertCircle className="h-5 w-5 text-yellow-600" />,
          command: null
        }
      }
    } else {
      return {
        state: 'not_synced' as const,
        label: 'Not Synced',
        icon: <Circle className="h-5 w-5 text-gray-400" />,
        command: null
      }
    }
  }

  // Early return after all hooks
  if (!user) return null

  // Render device status cards
  const renderDeviceCards = () => {
    return (
      <div className="space-y-3">
        {syncStatus.map((status) => {
          const device = status.devices
          const syncState = getDeviceSyncState(status.device_sn)
          const deviceCommands = commands.filter(cmd => cmd.device_sn === status.device_sn)
          const deviceActiveCount = activeCommandsByDevice[status.device_sn] || 0
          const isDeviceSyncing = syncUser.isPending && (
            syncUser.variables?.deviceSns?.includes(status.device_sn) ?? false
          )

          return (
            <div
              key={status.id}
              className="border rounded-lg p-4 space-y-3"
            >
              {/* Device Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  {syncState.icon}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">
                        {device?.name || status.device_sn}
                      </div>
                      {status.is_online ? (
                        <Wifi className="h-4 w-4 text-green-600" />
                      ) : (
                        <WifiOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    {device?.name && (
                      <div className="font-mono text-xs text-muted-foreground mt-0.5">
                        {status.device_sn}
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
                      onClick={() => handleClearDevice(status.device_sn, device?.name || status.device_sn)}
                      disabled={clearCommands.isPending}
                    >
                      Clear ({deviceActiveCount})
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleSyncToDevice(status.device_sn)}
                    disabled={syncUser.isPending || deviceActiveCount > 0}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Sync
                  </Button>
                </div>
              </div>

              {/* Drift Alert */}
              {(() => {
                const drift = driftMap.get(status.device_sn)
                if (!drift) return null
                
                const isDeviceOnline = status.is_online
                
                return (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-orange-600" />
                      <span className="text-sm font-medium text-orange-800">
                        Sync Drift Detected
                      </span>
                      {!isDeviceOnline && (
                        <span className="text-xs text-orange-600 italic">
                          (device offline - data may be stale)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-orange-700 space-y-1">
                      <div>
                        Expected: {drift.expected_state} | Actual: {drift.actual_state}
                      </div>
                      {drift.drift_detected_at && (
                        <div>
                          Detected: {format(new Date(drift.drift_detected_at), 'MMM d, h:mm a')}
                          {!isDeviceOnline && (
                            <span className="text-orange-600 ml-1">
                              • device offline
                            </span>
                          )}
                        </div>
                      )}
                      {drift.error_message && (
                        <div className="text-orange-800">
                          {drift.error_message}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-100"
                        onClick={() => handleSyncToDevice(status.device_sn)}
                        disabled={syncUser.isPending || deviceActiveCount > 0 || !isDeviceOnline}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Fix: Resync
                        {!isDeviceOnline && ' (when online)'}
                      </Button>
                    </div>
                  </div>
                )
              })()}

              {/* Sync Pipeline Progress */}
              <DeviceSyncPipeline
                deviceSn={status.device_sn}
                commands={commands}
                isSyncing={isDeviceSyncing}
              />

              {/* Per-type sync indicators */}
              {status.has_user && (user?.has_fingerprint || user?.has_face || status.has_photo) && (
                <div className="flex gap-2 flex-wrap">
                  {user?.has_fingerprint && (
                    <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-1 ${status.has_fingerprint ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                      <Fingerprint className="h-3 w-3" />
                      FP {status.has_fingerprint ? '✓' : '✗'}
                    </Badge>
                  )}
                  {user?.has_face && (
                    <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-1 ${status.has_face ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                      <ScanFace className="h-3 w-3" />
                      Face {status.has_face ? '✓' : '✗'}
                    </Badge>
                  )}
                  {status.has_photo && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 bg-green-50 text-green-700 border-green-200">
                      <Image className="h-3 w-3" />
                      Photo ✓
                    </Badge>
                  )}
                </div>
              )}

              {/* Error/Retry Details - Only shown when there's an issue */}
              {syncState.command && (syncState.state === 'failed' || syncState.state === 'retrying') && (
                <div className="bg-muted/30 rounded p-3 space-y-2">
                  {syncState.command.status === 'failed' && syncState.command.error_message && (
                    <div className="text-xs text-destructive">
                      {getErrorMessage(syncState.command.error_message)}
                    </div>
                  )}

                  {syncState.state === 'retrying' && syncState.command.next_retry_at && (
                    <div className="text-xs text-yellow-700">
                      Next retry: {format(new Date(syncState.command.next_retry_at), 'h:mm a')}
                    </div>
                  )}

                  {syncState.state === 'failed' && syncState.command.error_message?.includes('-1004') && (
                    <details className="text-xs cursor-pointer group mt-1">
                      <summary className="list-none flex items-center gap-1 hover:underline text-muted-foreground">
                        <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
                        How to fix this
                      </summary>
                      <div className="mt-2 pl-4 space-y-1 text-muted-foreground">
                        <p>PIN {user.pin} exists on device with different data</p>
                        <p>• Delete user from physical device, then sync</p>
                        <p>• Change PIN in system to avoid conflict</p>
                      </div>
                    </details>
                  )}
                </div>
              )}

              {/* Command History - Grouped by batch */}
              {deviceCommands.length > 0 && (() => {
                // Group commands into batches (commands created within 10s of each other)
                const sorted = [...deviceCommands].sort(
                  (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                )
                const batches: typeof deviceCommands[] = []
                let currentBatch: typeof deviceCommands = []

                for (const cmd of sorted) {
                  if (currentBatch.length === 0) {
                    currentBatch.push(cmd)
                  } else {
                    const batchStart = new Date(currentBatch[0].created_at).getTime()
                    const cmdTime = new Date(cmd.created_at).getTime()
                    if (batchStart - cmdTime < 30_000) {
                      currentBatch.push(cmd)
                    } else {
                      batches.push(currentBatch)
                      currentBatch = [cmd]
                    }
                  }
                }
                if (currentBatch.length > 0) batches.push(currentBatch)

                return (
                  <details className="text-xs cursor-pointer group">
                    <summary className="list-none flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <span className="group-open:rotate-90 transition-transform inline-block">▸</span>
                      Show command history ({deviceCommands.length})
                    </summary>
                    <div className="mt-2 space-y-3">
                      {batches.slice(0, 5).map((batch, batchIdx) => {
                        const batchTime = new Date(batch[0].created_at)
                        const allSuccess = batch.every((c) => c.status === 'success')
                        const hasFailed = batch.some((c) => c.status === 'failed')
                        const isAuto = batch.some((c) => c.initiated_by === 'system')

                        return (
                          <div key={batchIdx} className="rounded-md border border-border overflow-hidden">
                            {/* Batch header */}
                            <div className="flex items-center justify-between px-2.5 py-1.5 bg-muted/30">
                              <div className="flex items-center gap-1.5">
                                {allSuccess ? (
                                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                                ) : hasFailed ? (
                                  <AlertCircle className="h-3 w-3 text-red-500" />
                                ) : (
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                )}
                                <span className="font-medium">
                                  Sync ({batch.length} {batch.length === 1 ? 'cmd' : 'cmds'})
                                </span>
                                {isAuto && (
                                  <Badge variant="outline" className="h-4 px-1 text-[10px] text-muted-foreground">
                                    Auto
                                  </Badge>
                                )}
                              </div>
                              <span className="text-muted-foreground">
                                {format(batchTime, 'MMM d, h:mm a')}
                              </span>
                            </div>

                            {/* Batch commands */}
                            <div className="divide-y divide-border">
                              {batch.map((cmd) => (
                                <div key={cmd.id} className="px-2.5 py-1.5 space-y-1">
                                  <div className="flex items-center gap-2">
                                    {getStatusBadge(cmd.status)}
                                    <span className="text-muted-foreground">
                                      {cmd.command_type?.replace(/_/g, ' ') || 'Command'}
                                    </span>
                                  </div>

                                  {cmd.status === 'failed' && cmd.error_message && (
                                    <div className="text-destructive pl-6">
                                      {getErrorMessage(cmd.error_message)}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </details>
                )
              })()}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Device Sync Status</DialogTitle>
            <DialogDescription>
              {user.name} (PIN: {user.pin})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Device Sync Status Cards */}
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : syncStatus.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No devices found. User may not be registered on any devices yet.</p>
              </div>
            ) : (
              <>
                {!syncUser.isPending && syncStatus.length > 0 && !allDevicesBusy && (
                  <div className="flex justify-end">
                    <Button
                      onClick={handleSyncToAll}
                      size="sm"
                    >
                      <RefreshCw className="h-4 w-4 mr-1.5" />
                      Sync to All Devices
                    </Button>
                  </div>
                )}
                {renderDeviceCards()}
              </>
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
