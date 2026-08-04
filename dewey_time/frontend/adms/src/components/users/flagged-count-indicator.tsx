import { AlertTriangle } from 'lucide-react'
import { signalText } from '@/lib/signal'

/**
 * How many users on the current page carry an attendance flag — as a quiet
 * toolbar reading, not a banner.
 *
 * The flag is set by the bridge (attlog-ingest.ts) when a punch repeats inside
 * the dedup window, or when two devices record the same PIN at the same
 * instant. Both are ordinary: someone tapping twice, a clock skew between
 * terminals, or an admin testing a scanner all produce it. Nothing clears the
 * flag afterwards, so the count only ever grows.
 *
 * That is why this is not an Alert. A banner in the page's alert stack reads as
 * "something is wrong", and it sat directly beneath notices that actually mean
 * that — compromised users, a failed refresh, a degraded read. A permanent,
 * self-inflicted warning parked next to real ones teaches people to skip the
 * whole stack.
 *
 * The per-row marker in columns.tsx (`attendance_flag`) is the real signal and
 * is unchanged; this is only the summary that points at it.
 */
export function FlaggedCountIndicator({ count }: { count: number }) {
  if (count <= 0) return null

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title="Flagged on this page: a duplicate punch inside the dedup window, or two devices recording the same PIN at the same instant."
    >
      <AlertTriangle className={`h-3.5 w-3.5 ${signalText.attention}`} />
      {`${count} flagged`}
    </span>
  )
}
