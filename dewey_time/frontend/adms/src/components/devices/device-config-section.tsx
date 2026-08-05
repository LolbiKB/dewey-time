import { Link } from 'react-router-dom'
import { ArrowRight, EyeOff, Loader2, RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react'
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
 * The four facts that answer "what am I looking at" for one terminal.
 *
 * This used to be the full reported list — 78 rows inside a modal tab, which
 * is reference data in a container built for a summary. The whole list now
 * lives on the fleet page, where it can be compared ACROSS terminals, which is
 * the question it was always really answering.
 */
const FACTS: readonly { label: string; key: string }[] = [
  { label: 'Model', key: '~DeviceName' },
  { label: 'Firmware', key: 'FWVersion' },
  { label: 'Network', key: 'IPAddress' },
  { label: 'Protocol', key: 'PushVersion' },
]

export function DeviceFactStrip({ options }: { options: DeviceOptionEntry[] }) {
  const byKey = new Map(options.map((o) => [o.key.toLowerCase(), o]))

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      {FACTS.map(({ label, key }) => {
        const entry = byKey.get(key.toLowerCase())
        return (
          <div key={key} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-mono break-all">
              {!entry ? (
                <span className={signalText.idle}>Not reported</span>
              ) : entry.redacted ? (
                // A withheld value is not an unset one. Rendering it as blank
                // would say the device is unconfigured when it is not.
                <span
                  className={cn('inline-flex items-center gap-1', signalText.idle)}
                  title="The device reported a value. It was not stored because this key is not on the value allowlist."
                >
                  <EyeOff className="h-3 w-3" />
                  Not stored
                </span>
              ) : (
                entry.value || <span className={signalText.idle}>Not reported</span>
              )}
            </dd>
          </div>
        )
      })}
    </dl>
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
 * Per-device configuration summary and the two commands that act on it.
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
          Configuration
        </div>
        {canCommand && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3 w-3" />
              )}
              Read now
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

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This terminal has not reported its configuration yet. It reports on approval, when a
          watched setting changes, and at least twice a day.
        </p>
      ) : (
        <DeviceFactStrip options={options} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
        <span className="text-xs text-muted-foreground">
          Last reported: {formatReportedAt(reportedAt)}
        </span>
        <Link
          to="/device-config"
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
        >
          View fleet configuration
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
