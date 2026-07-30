import { AlertCircle, RotateCcw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface QueryErrorCardProps {
  /** What failed to load, e.g. "Error loading users". */
  title: string
  /** The query error — the message is shown so an outage is not mistaken for empty data. */
  error: unknown
  /** Retry handler (usually the query's refetch). Omit to hide the retry button. */
  onRetry?: () => void
  retryLabel?: string
}

/**
 * Shared failure state for a page whose primary query errored.
 * Mirrors the destructive card used by the Devices and Attendance Logs pages,
 * plus a retry affordance.
 */
export function QueryErrorCard({
  title,
  error,
  onRetry,
  retryLabel = 'Try again',
}: QueryErrorCardProps) {
  return (
    <div className="flex items-center justify-center flex-1 min-h-0">
      <Card className="border-destructive max-w-2xl w-full">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="font-semibold">{title}</p>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'An unknown error occurred'}
          </p>
          {onRetry && (
            <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {retryLabel}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
