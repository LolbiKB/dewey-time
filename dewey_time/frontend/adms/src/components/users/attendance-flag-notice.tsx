import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signalText } from '@/lib/signal'

/**
 * Human-readable cause for an attendance flag.
 *
 * The vocabulary matches attendance_logs.suspicious_reason, which is what the
 * bridge now writes to users.attendance_flag_reason. It did not always: before
 * 2026-08-04 every flag was stamped 'multi_device_same_time_attendance'
 * regardless of which rule fired, so that value tells you a flag was raised and
 * nothing more. Rows carrying it get an honest "cause not recorded" rather than
 * a confident sentence the data does not support.
 */
export function describeFlagReason(reason?: string | null): string {
  switch (reason) {
    case 'duplicate_punch_window':
      return 'Two punches on the same device within two minutes.'
    case 'multi_device_same_time':
      return 'Two devices recorded this PIN at the same instant.'
    case 'multi_device_same_time_attendance':
      return 'Cause not recorded — this flag predates accurate reason tracking.'
    default:
      return 'Cause not recorded.'
  }
}

interface AttendanceFlagNoticeProps {
  flaggedAt?: string | null
  reason?: string | null
  onDismiss: () => void
  dismissing?: boolean
}

/**
 * Why this user is flagged, and a way to say "seen, it's fine".
 *
 * Presentational only — the mutation lives with the caller. That keeps it
 * renderable without a QueryClientProvider, which is what makes it testable.
 *
 * Until this shipped there was no clearing path anywhere in the system. The
 * flag fires on ordinary events (a double tap; two terminals with skewed
 * clocks), so the flagged set only ever grew and a permanent warning is one
 * nobody reads.
 */
export function AttendanceFlagNotice({
  flaggedAt,
  reason,
  onDismiss,
  dismissing = false,
}: AttendanceFlagNoticeProps) {
  if (!flaggedAt) return null

  return (
    <div className="flex items-start gap-2.5 rounded-md border border-attention/40 bg-attention/5 px-3 py-2">
      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${signalText.attention}`} />
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-medium">Attendance flagged</p>
        <p className="text-muted-foreground">{describeFlagReason(reason)}</p>
        <p className="mt-0.5 text-muted-foreground">
          Dismissing clears the marker only. The attendance records that raised it are kept, and a
          later suspicious punch raises it again.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 bg-background hover:bg-background/80"
        onClick={onDismiss}
        disabled={dismissing}
      >
        {dismissing && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
        Dismiss
      </Button>
    </div>
  )
}
