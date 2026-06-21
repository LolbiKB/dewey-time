import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { signalText } from '@/lib/signal'

interface TimelinePunch {
  seq: number
  time: string
  loc: string
}

interface DayTimelineStripProps {
  userPin: string
  punches: TimelinePunch[]
  warnings: string[]
}

export function DayTimelineStrip({ userPin, punches, warnings }: DayTimelineStripProps) {
  if (punches.length === 0) return null

  return (
    <div className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/40 py-1.5 text-xs">
      <span className="text-muted-foreground whitespace-nowrap">
        PIN {userPin}
      </span>
      <div className="flex flex-wrap items-center gap-1 min-w-0">
        {punches.map((p) => (
          <Badge
            key={p.seq}
            variant="secondary"
            className="h-5 px-1.5 font-mono text-[10px] font-normal"
          >
            {p.seq} {p.time} {p.loc}
          </Badge>
        ))}
      </div>
      {warnings.map((w) => (
        <span
          key={w}
          className={`inline-flex items-center gap-0.5 ${signalText.attention}`}
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="line-clamp-1">{w}</span>
        </span>
      ))}
    </div>
  )
}
