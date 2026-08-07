import { AlertTriangle, Loader2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { signalText, signalAlert } from '@/lib/signal'
import { cn } from '@/lib/utils'
import { toEvidenceLine } from '@/lib/device-option-evidence'
import type { OptionWriteRecord } from '@/services/device-service'

/**
 * Matches the bridge's `MAX_KEY_WRITE_HISTORY` (admin-devices.ts). The bound is
 * FLEET-WIDE for this key, not per device — four terminals sharing one fleet
 * apply consume four rows between them, so the trail this panel shows is
 * roughly a quarter as many applies as it looks like at first glance.
 *
 * The endpoint gives no truncation signal, so a page receiving exactly this
 * many rows cannot tell "that is the whole history" from "history was cut" —
 * it must say the trail may be incomplete rather than presenting it as the
 * full story.
 */
const MAX_KEY_WRITE_HISTORY = 50

/**
 * The working behind the ladder verdict.
 *
 * An empty trail means "never written". A FAILED READ must therefore never
 * render as an empty trail — the two are indistinguishable to an operator, and
 * one of them sends them to re-run an experiment that already has an answer.
 */
export function WriteEvidence({
  records, loading, error,
}: {
  records: OptionWriteRecord[]
  loading: boolean
  error: Error | null
}) {
  if (error) {
    return (
      <div className={cn('flex gap-2 rounded-lg p-3 text-xs', signalAlert.danger)}>
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Could not load the write history — {error.message}</span>
      </div>
    )
  }

  if (loading) return <Skeleton className="h-16 w-full" />

  if (records.length === 0) {
    return <p className="text-xs text-muted-foreground">This key has never been written.</p>
  }

  return (
    <ul className="space-y-1.5">
      {records.length >= MAX_KEY_WRITE_HISTORY && (
        <li className={cn('text-xs', signalText.idle)}>
          Showing the {MAX_KEY_WRITE_HISTORY} most recent writes for this key across the fleet — the
          trail may be incomplete beyond this point.
        </li>
      )}
      {records.map((r) => {
        const line = toEvidenceLine(r)
        return (
          <li key={r.id} className="text-xs">
            <span className={signalText.idle}>{line.when}</span>
            <span className="mx-1.5 font-mono">{line.what}</span>
            <span className={r.status === 'applied' ? signalText.success : signalText.attention}>
              {line.outcome}
            </span>
            {line.elapsed && <span className={cn('ml-1.5', signalText.idle)}>{line.elapsed}</span>}
            {r.status === 'pending' && (
              <Loader2 className={cn('ml-1 inline h-3 w-3 animate-spin', signalText.attention)} />
            )}
            {line.detail && (
              <span className={cn('ml-1.5 block', signalText.idle)}>{line.detail}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
