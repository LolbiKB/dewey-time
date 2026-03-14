import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, RefreshCw, Fingerprint, Wifi, WifiOff, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { DeviceService } from '@/services/device-service'
import { supabase } from '@/lib/supabase'
import type { DeviceEntry } from '@/services/device-service'

interface DeviceInfoDialogProps {
  deviceSn: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface InfoCommandResult {
  id: number
  status: string
  created_at: string
  completed_at?: string
  error_message?: string
}

export function DeviceInfoDialog({ deviceSn, open, onOpenChange }: DeviceInfoDialogProps) {
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [deviceInfo, setDeviceInfo] = useState<DeviceEntry | null>(null)
  const [commandResult, setCommandResult] = useState<InfoCommandResult | null>(null)

  const fetchDeviceInfo = useCallback(async () => {
    if (!deviceSn) return
    
    setLoading(true)
    
    try {
      const device = await DeviceService.getDevice(deviceSn)
      if (device) {
        setDeviceInfo(device)
      }
    } catch (err) {
      console.error('Error fetching device info:', err)
    } finally {
      setLoading(false)
    }
  }, [deviceSn])

  const requestInfo = async () => {
    if (!deviceSn) return
    
    setRefreshing(true)
    setCommandResult(null)
    
    try {
      const result = await DeviceService.queueDeviceCommand(deviceSn, 'info', 'INFO')
      
      setCommandResult({
        id: result.id,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      
      await fetchDeviceInfo()
    } catch (err) {
      console.error('Error requesting info:', err)
    } finally {
      setRefreshing(false)
    }
  }

  const pollCommandStatus = useCallback(async () => {
    if (!commandResult || commandResult.status === 'success' || commandResult.status === 'failed') {
      return
    }

    const { data } = await supabase
      .from('command_queue')
      .select('id, status, completed_at, error_message')
      .eq('id', commandResult.id)
      .single()

    if (data) {
      setCommandResult(prev => prev ? { ...prev, status: data.status, completed_at: data.completed_at, error_message: data.error_message } : null)
      
      if (data.status === 'success') {
        await fetchDeviceInfo()
      }
    }
  }, [commandResult, fetchDeviceInfo])

  useEffect(() => {
    if (open && deviceSn) {
      fetchDeviceInfo()
    }
  }, [open, deviceSn, fetchDeviceInfo])

  useEffect(() => {
    if (!open || !commandResult || commandResult.status === 'success' || commandResult.status === 'failed') {
      return
    }

    const interval = setInterval(pollCommandStatus, 2000)
    return () => clearInterval(interval)
  }, [open, commandResult, pollCommandStatus])

  useEffect(() => {
    if (!open) {
      setCommandResult(null)
    }
  }, [open])

  const formatLastSeen = (lastSeen?: string) => {
    if (!lastSeen) return 'Never'
    const date = new Date(lastSeen)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 5) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return date.toLocaleDateString()
  }

  const getStatusBadge = (status?: string) => {
    if (status === 'online') {
      return (
        <Badge className="bg-green-100 text-green-800">
          <Wifi className="h-3 w-3 mr-1" /> Online
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="text-gray-600">
        <WifiOff className="h-3 w-3 mr-1" /> Offline
      </Badge>
    )
  }

  const getCommandStatusBadge = () => {
    if (!commandResult) return null
    
    switch (commandResult.status) {
      case 'pending':
      case 'sent':
        return (
          <Badge variant="outline" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {commandResult.status === 'sent' ? 'Sent to device...' : 'Queued...'}
          </Badge>
        )
      case 'success':
        return (
          <Badge className="bg-green-100 text-green-800 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Received
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Failed
          </Badge>
        )
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Device Info
          </DialogTitle>
          <DialogDescription>
            Device details and algorithm versions for {deviceSn}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : deviceInfo ? (
          <div className="grid gap-6 py-4">
            {/* Basic Info */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <div className="flex items-center gap-2">
                  {getStatusBadge(deviceInfo.status)}
                  {getCommandStatusBadge()}
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last Seen</span>
                <span className="text-sm">{formatLastSeen(deviceInfo.last_seen)}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm">{deviceInfo.name || 'Unnamed'}</span>
              </div>
            </div>

            {/* Algorithm Versions */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Fingerprint className="h-4 w-4" />
                Algorithm Versions
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Fingerprint</p>
                  {deviceInfo.fp_algorithm_version ? (
                    <Badge variant="outline" className="font-mono">
                      v{deviceInfo.fp_algorithm_version}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">Unknown</span>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Face</p>
                  {deviceInfo.face_algorithm_version ? (
                    <Badge variant="outline" className="font-mono">
                      v{deviceInfo.face_algorithm_version}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">Unknown</span>
                  )}
                </div>
              </div>
            </div>

          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            Device not found
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={requestInfo} disabled={refreshing || commandResult?.status === 'pending' || commandResult?.status === 'sent'}>
            {refreshing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Requesting...</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Request Info</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}