import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function AttlogHealthMetric({
  label,
  value,
  highlight,
  mono,
  icon,
  hint,
}: {
  label: string
  value: string
  highlight?: boolean
  mono?: boolean
  icon?: ReactNode
  /** Hover explanation of what the metric means / how it's computed. */
  hint?: string
}) {
  return (
    <div
      title={hint}
      className={cn(
        'p-3 rounded-lg border bg-muted/40 border-border/60',
        highlight && 'ring-1 ring-amber-400/50 border-amber-200',
        hint && 'cursor-help'
      )}
    >
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p
        className={cn(
          'text-sm font-medium flex items-center gap-1',
          mono && 'font-mono text-xs'
        )}
      >
        {icon}
        {value}
      </p>
    </div>
  )
}
