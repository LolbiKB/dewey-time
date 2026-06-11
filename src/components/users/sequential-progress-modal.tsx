import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface DeviceProgress {
  deviceSn: string
  deviceName: string
  status: 'pending' | 'processing' | 'success' | 'failed'
  error?: string
}

interface SequentialProgressModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  devices: DeviceProgress[]
  currentIndex: number
  isProcessing: boolean
  onCancel?: () => void
  canCancel?: boolean
}

export function SequentialProgressModal({
  isOpen,
  onOpenChange,
  title,
  description,
  devices,
  currentIndex,
  isProcessing,
  onCancel,
  canCancel = false
}: SequentialProgressModalProps) {
  const totalDevices = devices.length
  const completedCount = devices.filter(d => d.status === 'success' || d.status === 'failed').length
  const successCount = devices.filter(d => d.status === 'success').length
  const failedCount = devices.filter(d => d.status === 'failed').length
  const progressPercentage = totalDevices > 0 ? (completedCount / totalDevices) * 100 : 0
  const allCompleted = completedCount === totalDevices
  const hasFailures = failedCount > 0

  const getDeviceIcon = (status: DeviceProgress['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive shrink-0" />
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin shrink-0" />
      default:
        return <div className="h-4 w-4 rounded-full border-2 border-muted shrink-0" />
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {allCompleted ? 'Complete' : `Processing device ${currentIndex + 1} of ${totalDevices}`}
              </span>
              <span className="font-medium">
                {successCount}/{totalDevices}
              </span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </div>

          {/* Device List */}
          <div className="border rounded-lg max-h-75 overflow-y-auto">
            <div className="divide-y">
              {devices.map((device, index) => (
                <div
                  key={device.deviceSn}
                  className={`flex items-start gap-3 p-3 ${index === currentIndex && isProcessing ? 'bg-blue-50' : ''
                    }`}
                >
                  {getDeviceIcon(device.status)}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      {device.deviceName}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {device.deviceSn}
                    </div>
                    {device.error && (
                      <div className="text-xs text-destructive mt-1">
                        {device.error}
                      </div>
                    )}
                  </div>
                  {device.status === 'success' && (
                    <span className="text-xs text-green-600 font-medium">Removed</span>
                  )}
                  {device.status === 'failed' && (
                    <span className="text-xs text-destructive font-medium">Failed</span>
                  )}
                  {device.status === 'processing' && (
                    <span className="text-xs text-blue-600 font-medium">Processing...</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          {allCompleted && (
            <Alert variant={hasFailures ? 'destructive' : 'default'}>
              {hasFailures ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              <AlertDescription>
                {hasFailures ? (
                  <>
                    Completed with errors: {successCount} succeeded, {failedCount} failed.
                    {failedCount > 0 && ' Review failed devices and retry if needed.'}
                  </>
                ) : (
                  `Successfully removed user from all ${successCount} devices.`
                )}
              </AlertDescription>
            </Alert>
          )}

        </div>

        {/* Actions — pinned bottom bar (only when an action is available) */}
        {((isProcessing && canCancel) || allCompleted) && (
          <DialogFooter variant="bar">
            {isProcessing && canCancel && (
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={!canCancel}
              >
                Cancel Remaining
              </Button>
            )}
            {allCompleted && (
              <Button onClick={() => onOpenChange(false)}>
                Close
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
