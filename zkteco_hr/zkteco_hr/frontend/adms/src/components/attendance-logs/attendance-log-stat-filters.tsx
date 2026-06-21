import { cn } from '@/lib/utils'
import type {
  AttendanceLogFilters,
  AttendanceLogStatFilter,
  AttendanceLogSummary,
} from '@/services/attendance-log-service'

const STATS: { id: AttendanceLogStatFilter; label: string; tone?: 'warn' | 'danger' }[] = [
  { id: 'today', label: 'today' },
  { id: 'pending_sync', label: 'pending', tone: 'warn' },
  { id: 'failed_sync', label: 'failed', tone: 'danger' },
  { id: 'suspicious', label: 'suspicious', tone: 'warn' },
]

interface AttendanceLogStatFiltersProps {
  filters: AttendanceLogFilters
  summary?: AttendanceLogSummary
  onToggle: (stat: AttendanceLogStatFilter) => void
}

export function AttendanceLogStatFilters({
  filters,
  summary,
  onToggle,
}: AttendanceLogStatFiltersProps) {
  const values: Record<AttendanceLogStatFilter, number | string> = {
    today: summary?.totalToday ?? '—',
    pending_sync: summary?.pendingSync ?? '—',
    failed_sync: summary?.failedSync ?? '—',
    suspicious: summary?.suspiciousToday ?? '—',
  }

  return (
    <div className="flex items-center gap-0.5 mr-2 shrink-0">
      {STATS.map((stat, index) => {
        const active = filters.preset === stat.id
        const toneClass =
          stat.tone === 'danger'
            ? active
              ? 'bg-destructive/10 text-destructive'
              : 'text-destructive/80 hover:bg-destructive/5'
            : stat.tone === 'warn'
              ? active
                ? 'bg-attention/15 text-attention'
                : 'text-attention/90 hover:bg-attention/10'
              : active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'

        return (
          <span key={stat.id} className="inline-flex items-center">
            {index > 0 && <span className="mx-1 text-border/80 select-none">·</span>}
            <button
              type="button"
              onClick={() => onToggle(stat.id)}
              className={cn(
                'inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors',
                toneClass
              )}
            >
              <span className="font-semibold tabular-nums">{values[stat.id]}</span>
              <span className="opacity-75">{stat.label}</span>
            </button>
          </span>
        )
      })}
    </div>
  )
}
