import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  MinusCircle,
} from 'lucide-react'
import { signalBadge, signalDot, signalText } from '@/lib/signal'

export type AttlogClosureStatus =
  | 'pending_verify'
  | 'backfill_running'
  | 'closed'
  | 'deferred_offline'
  | 'closure_failed'

export type AttlogClosureBadgeConfig = {
  label: string
  className: string
  icon: LucideIcon
}

/** Text-on-secondary badge style (matches HR sync / verify columns). */
export function attlogClosureBadgeConfig(
  status: AttlogClosureStatus | string | null | undefined
): AttlogClosureBadgeConfig {
  switch (status) {
    case 'closed':
      return {
        label: 'Closed',
        className: signalText.success,
        icon: CheckCircle2,
      }
    case 'deferred_offline':
      return {
        label: 'Deferred (offline)',
        className: signalText.attention,
        icon: Clock,
      }
    case 'backfill_running':
      return {
        label: 'Backfill',
        className: signalText.progress,
        icon: Loader2,
      }
    case 'pending_verify':
      return {
        label: 'Verifying',
        className: signalText.progress,
        icon: Loader2,
      }
    case 'closure_failed':
      return {
        label: 'Failed',
        className: signalText.danger,
        icon: AlertCircle,
      }
    default:
      return {
        label: 'Not started',
        className: signalText.idle,
        icon: MinusCircle,
      }
  }
}

export function attlogClosureLabel(status: AttlogClosureStatus | string | null | undefined): string {
  switch (status) {
    case 'closed':
      return 'Closed'
    case 'deferred_offline':
      return 'Deferred (offline)'
    case 'backfill_running':
      return 'Backfill'
    case 'closure_failed':
      return 'Failed'
    case 'pending_verify':
      return 'Verifying'
    default:
      return 'Not started'
  }
}

/** @deprecated Use attlogClosureBadgeConfig + variant secondary badges */
export function attlogClosureBadgeClass(status: AttlogClosureStatus | string | null | undefined): string {
  return attlogClosureBadgeConfig(status).className
}

const LEGEND_STATUSES: (AttlogClosureStatus | 'not_started')[] = [
  'closed',
  'pending_verify',
  'closure_failed',
  'deferred_offline',
  'not_started',
]

/** Solid status-dot color for the closeout calendar + legend. */
export function attlogClosureDotClass(
  status: AttlogClosureStatus | string | null | undefined
): string {
  switch (status) {
    case 'closed':
      return signalDot.success
    case 'closure_failed':
      return signalDot.danger
    case 'deferred_offline':
      return signalDot.attention
    case 'backfill_running':
      return signalDot.progress
    case 'pending_verify':
      return signalDot.progress
    default:
      return signalDot.idle
  }
}

/** Ring/bar colors for closeout calendar cells (matches badge semantics). */
export function attlogClosureCellRingClass(
  status: AttlogClosureStatus | string | null | undefined
): string {
  switch (status) {
    case 'closed':
      return `ring-2 ${signalBadge.success}`
    case 'closure_failed':
      return `ring-2 ${signalBadge.danger}`
    case 'deferred_offline':
      return `ring-2 ${signalBadge.attention}`
    case 'backfill_running':
      return `ring-2 ${signalBadge.progress}`
    case 'pending_verify':
      return `ring-2 ${signalBadge.progress}`
    default:
      return signalBadge.idle
  }
}

export const ATTLOG_CLOSURE_LEGEND_STATUSES = LEGEND_STATUSES
