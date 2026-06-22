import { Fragment, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { signalDot, signalText } from '@/lib/signal'
import {
  Check,
  Loader2,
  X,
  ArrowUpRight,
  PackageCheck,
  Send,
  CircleCheck,
} from 'lucide-react'
import type { CommandQueueEntry } from '@/services/user-service'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StepStatus = 'completed' | 'sent' | 'waiting' | 'failed' | 'idle'

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

function circleClass(status: StepStatus) {
  switch (status) {
    case 'completed':
      return `${signalDot.success} text-white`
    case 'sent':
      return `${signalDot.progress} text-white ring-2 ring-progress/20`
    case 'waiting':
      return 'bg-muted border border-border text-muted-foreground'
    case 'failed':
      return `${signalDot.danger} text-white`
    default:
      return 'bg-muted/50 border border-border/50 text-muted-foreground/40'
  }
}

function labelClass(status: StepStatus) {
  switch (status) {
    case 'completed':
      return signalText.success
    case 'sent':
      return `${signalText.progress} font-medium`
    case 'failed':
      return signalText.danger
    default:
      return 'text-muted-foreground'
  }
}

function connectorClass(left: StepStatus, right: StepStatus) {
  if (left === 'completed' && (right === 'completed' || right === 'sent'))
    return signalDot.success
  if (left === 'failed') return signalDot.danger
  return 'bg-border'
}

function statusIcon(status: StepStatus, IdleIcon: typeof Check) {
  switch (status) {
    case 'completed':
      return <Check className="h-3 w-3" />
    case 'sent':
      return <ArrowUpRight className="h-3 w-3" />
    case 'waiting':
      return <Loader2 className="h-3 w-3 animate-spin" />
    case 'failed':
      return <X className="h-3 w-3" />
    default:
      return <IdleIcon className="h-3 w-3" />
  }
}

// ---------------------------------------------------------------------------
// Batch helper — latest batch of commands for this device (30s window)
// ---------------------------------------------------------------------------

function getLatestBatch(deviceSn: string, commands: CommandQueueEntry[]) {
  const deviceCmds = commands
    .filter((c) => c.device_sn === deviceSn)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )

  if (deviceCmds.length === 0) return []

  const latestTime = new Date(deviceCmds[0].created_at).getTime()
  return deviceCmds.filter(
    (c) => latestTime - new Date(c.created_at).getTime() < 30_000,
  )
}

// ===========================================================================
// DeviceSyncPipeline — per-device, 3 simple steps
//
//   1. Queuing — API call in flight (isSyncing=true)
//   2. Syncing — device processing commands
//   3. Done    — all commands succeeded
// ===========================================================================

interface DeviceSyncPipelineProps {
  deviceSn: string
  commands: CommandQueueEntry[]
  isSyncing: boolean
}

export function DeviceSyncPipeline({
  deviceSn,
  commands,
  isSyncing,
}: DeviceSyncPipelineProps) {
  const cmds = useMemo(
    () => getLatestBatch(deviceSn, commands),
    [deviceSn, commands],
  )

  const hasAnyCmd = cmds.length > 0

  // Don't render if nothing is happening
  if (!hasAnyCmd && !isSyncing) return null

  const allSuccess = hasAnyCmd && cmds.every((c) => c.status === 'success')
  const hasFailed = cmds.some((c) => c.status === 'failed')
  const anySent = cmds.some((c) => c.status === 'sent' || c.status === 'success')

  // Step 1: Queuing — API call in flight
  const queueStatus: StepStatus = isSyncing
    ? 'waiting'
    : hasAnyCmd
      ? 'completed'
      : 'idle'

  // Step 2: Syncing — device picking up / processing commands
  // When a new sync is in flight, reset to idle so stale completed state doesn't linger
  const syncStatus: StepStatus = isSyncing
    ? 'idle'
    : allSuccess
      ? 'completed'
      : hasFailed
        ? 'failed'
        : anySent
          ? 'sent'
          : hasAnyCmd
            ? 'waiting'
            : 'idle'

  // Step 3: Done
  const doneStatus: StepStatus = isSyncing
    ? 'idle'
    : allSuccess
      ? 'completed'
      : hasFailed
        ? 'failed'
        : 'idle'

  const steps: { label: string; status: StepStatus; icon: typeof Check }[] = [
    { label: 'Queuing', status: queueStatus, icon: PackageCheck },
    { label: 'Syncing', status: syncStatus, icon: Send },
    { label: 'Done', status: doneStatus, icon: CircleCheck },
  ]

  return (
    <div className="py-2">
      <div className="flex items-start">
        {steps.map((step, i) => (
          <Fragment key={step.label}>
            <div className="flex flex-col items-center" style={{ minWidth: 48 }}>
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300',
                  circleClass(step.status),
                )}
              >
                {statusIcon(step.status, step.icon)}
              </div>
              <span
                className={cn(
                  'text-[10px] mt-0.5 leading-tight text-center whitespace-nowrap',
                  labelClass(step.status),
                )}
              >
                {step.label}
              </span>
            </div>

            {i < steps.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mt-3 mx-0.5 rounded-full transition-colors duration-300',
                  connectorClass(step.status, steps[i + 1].status),
                )}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
