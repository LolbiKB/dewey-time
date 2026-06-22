import {
  ATTLOG_CLOSURE_LEGEND_STATUSES,
  attlogClosureBadgeConfig,
  attlogClosureDotClass,
} from '@/lib/attlog-closure-display'

export function AttlogClosureLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? 'flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground'
          : 'flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground'
      }
    >
      {ATTLOG_CLOSURE_LEGEND_STATUSES.map((status) => {
        const key = status === 'not_started' ? 'default' : status
        const config = attlogClosureBadgeConfig(key)
        const Icon = config.icon
        return (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${attlogClosureDotClass(key)}`}
              aria-hidden
            />
            {!compact && <Icon className={`h-3 w-3 shrink-0 ${config.className}`} />}
            {config.label}
          </span>
        )
      })}
    </div>
  )
}
