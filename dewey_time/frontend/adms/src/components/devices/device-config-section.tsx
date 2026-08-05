import { EyeOff, Loader2, RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signalText } from '@/lib/signal'
import { cn } from '@/lib/utils'
import type { DeviceOptionEntry } from '@/services/device-service'

/** When a terminal last answered. Never invents a date it does not have. */
export function formatReportedAt(reportedAt?: string | null): string {
  if (!reportedAt) return 'Never reported'
  const d = new Date(reportedAt)
  if (Number.isNaN(d.getTime())) return 'Never reported'
  return d.toLocaleString()
}

/**
 * What a terminal reports about its own configuration.
 *
 * Presentational only — the caller owns the query and the mutations, so this
 * renders without a QueryClientProvider and stays testable.
 *
 * A REDACTED option is not an unset one. The bridge records the key of every
 * option a terminal reports but the value only for keys on its allowlist,
 * because anything written to device_option_observed also lands in every later
 * backup and an unclassified value would be a one-way door. Rendering a
 * withheld credential as "not set" would tell an admin the device is
 * unconfigured when it is not — so withheld says so, and says why.
 */
export function DeviceConfigPanel({ options }: { options: DeviceOptionEntry[] }) {
  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This terminal has not reported its configuration yet. Use{' '}
        <span className="font-medium">Read from device</span> to ask it.
      </p>
    )
  }

  const withheld = options.filter((o) => o.redacted).length

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border rounded-lg border border-border">
        {options.map((o) => (
          <div key={o.key} className="flex items-baseline justify-between gap-4 px-3 py-2">
            <span className="font-mono text-xs text-muted-foreground break-all">{o.key}</span>
            {o.redacted ? (
              <span
                className={cn('flex shrink-0 items-center gap-1 text-xs', signalText.attention)}
                title="The device reported a value. It was not stored because this key has not been reviewed for the value allowlist."
              >
                <EyeOff className="h-3 w-3" />
                Not stored
              </span>
            ) : (
              <span className="font-mono text-xs break-all">{o.value}</span>
            )}
          </div>
        ))}
      </div>

      {withheld > 0 && (
        <p className="text-xs text-muted-foreground">
          {withheld} value{withheld === 1 ? '' : 's'} not stored. The key names are recorded, the
          values are withheld until the key is reviewed and added to the allowlist — anything saved
          here also lands in backups.
        </p>
      )}
    </div>
  )
}

interface DeviceConfigSectionProps {
  options: DeviceOptionEntry[]
  reportedAt?: string | null
  loading?: boolean
  refreshing?: boolean
  rebooting?: boolean
  /** Super Admin only — both actions command the physical terminal. */
  canCommand: boolean
  onRefresh: () => void
  onReboot: () => void
}

/**
 * The device configuration card: what the terminal reports, and the two
 * commands that act on it.
 *
 * Both actions are Super-Admin-gated by the bridge; hiding them for everyone
 * else is the UI half of that, not the enforcement.
 */
export function DeviceConfigSection({
  options,
  reportedAt,
  loading = false,
  refreshing = false,
  rebooting = false,
  canCommand,
  onRefresh,
  onReboot,
}: DeviceConfigSectionProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          Device configuration
        </div>
        {canCommand && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3 w-3" />
              )}
              Read from device
            </Button>
            <Button variant="outline" size="sm" onClick={onReboot} disabled={rebooting}>
              {rebooting ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3 w-3" />
              )}
              Reboot
            </Button>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Last reported: {formatReportedAt(reportedAt)}</p>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <DeviceConfigPanel options={options} />
      )}

      <p className="text-xs text-muted-foreground">
        Reading is a queued command — the terminal answers on its next poll, so values appear a few
        seconds later.
      </p>
    </div>
  )
}
