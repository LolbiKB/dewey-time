import {
  Archive,
  Clock,
  CloudOff,
  CloudUpload,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { signalText } from '@/lib/signal'
import { attlogClosureBadgeConfig } from '@/lib/attlog-closure-display'

const badgeBase = 'w-fit pointer-events-none shrink-0 gap-1'

/**
 * Calm status indicator: a small colored dot + plain text (the zkteco_hr
 * design archetype) instead of icon-chips. `className` supplies the text
 * color; the dot inherits it via bg-current. Active/running states pulse.
 */
function SecondaryToneBadge({
  label,
  className,
  iconSpin,
  title,
}: {
  label: string
  className: string
  icon?: LucideIcon // accepted for caller compatibility; no longer rendered
  iconSpin?: boolean
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap', className)}
    >
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full bg-current opacity-80', iconSpin && 'animate-pulse')}
      />
      <span className="text-foreground/75">{label}</span>
    </span>
  )
}

/** Daily closeout — text-on-secondary (same as HR sync / verify). */
export function AttlogClosureBadge({
  status,
  label,
  className,
  title,
}: {
  status?: string | null
  label?: string
  className?: string
  title?: string
}) {
  const config = attlogClosureBadgeConfig(status)
  return (
    <SecondaryToneBadge
      title={title}
      label={label ?? config.label}
      className={cn(config.className, className)}
      icon={config.icon}
      iconSpin={status === 'backfill_running' || status === 'pending_verify'}
    />
  )
}

export function AttlogCatchUpBadge({ depth }: { depth: number }) {
  if (depth <= 0) return null
  return (
    <SecondaryToneBadge
      label={`${depth}d open`}
      className={signalText.attention}
      icon={Clock}
    />
  )
}

/** Layer 1 ledger trust on punch rows. */
export function LedgerTrustBadge({ closureStatus }: { closureStatus?: string }) {
  const closed = closureStatus === 'closed'
  if (closed) {
    return (
      <SecondaryToneBadge
        label="Archived"
        className={signalText.idle}
        icon={Archive}
      />
    )
  }
  return (
    <SecondaryToneBadge
      label="Provisional"
      className={signalText.attention}
      icon={Clock}
    />
  )
}

type HrSyncConfig = { label: string; className: string; icon: LucideIcon }

function hrSyncConfig(syncStatus?: string | null): HrSyncConfig {
  const status = (syncStatus || 'PENDING').toUpperCase()
  const config: Record<string, HrSyncConfig> = {
    SUCCESS: { label: 'Delivered', className: signalText.success, icon: CloudUpload },
    FAILED: { label: 'Failed', className: signalText.danger, icon: CloudOff },
    PENDING: { label: 'Pending', className: signalText.attention, icon: Clock },
    SKIPPED: { label: 'Not HR', className: signalText.idle, icon: CloudOff },
  }
  return config[status] || config.PENDING
}

/** Layer 2 ERP delivery — matches Attendance Logs HR sync column. */
export function HrSyncBadge({ syncStatus }: { syncStatus?: string | null }) {
  const { label, className, icon } = hrSyncConfig(syncStatus)
  return <SecondaryToneBadge label={label} className={className} icon={icon} />
}

/** command_queue row in ATTLOG tab. */
export function CommandQueueStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  if (normalized === 'pending') {
    return <SecondaryToneBadge label="Queued" className={signalText.attention} icon={Clock} />
  }
  if (normalized === 'sent') {
    return (
      <SecondaryToneBadge
        label="Sent"
        className={signalText.progress}
        icon={Loader2}
        iconSpin
      />
    )
  }
  if (normalized === 'success') {
    return (
      <SecondaryToneBadge
        label="Success"
        className={signalText.success}
        icon={CloudUpload}
      />
    )
  }
  if (normalized === 'failed') {
    return <SecondaryToneBadge label="Failed" className={signalText.danger} icon={CloudOff} />
  }
  return (
    <SecondaryToneBadge label={status} className={signalText.idle} icon={Clock} />
  )
}

export function AttlogCommandTypeBadge({ commandType }: { commandType: string }) {
  return (
    <Badge variant="outline" className={cn('font-mono text-[10px] pointer-events-none', badgeBase)}>
      {commandType}
    </Badge>
  )
}
