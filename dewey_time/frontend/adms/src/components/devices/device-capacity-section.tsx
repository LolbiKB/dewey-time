import { Gauge, Loader2 } from 'lucide-react'
import { signalText, signalDot, type Signal } from '@/lib/signal'
import { cn } from '@/lib/utils'
import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * How full a terminal is, derived from what it reports about itself.
 *
 * The first real INFO dump turned out to be mostly capacity limits and live
 * counters rather than settings, which makes fleet fullness a free by-product
 * of discovery. It is worth having: the photo cap is currently a non-retryable
 * enrollment failure you find out about by hitting it.
 *
 * The only way this feature can hurt anyone is by rendering a confident number
 * that is wrong, so three rules hold throughout:
 *
 *   - Only unambiguous pairs are declared. `ATTPhotoCount` and
 *     `~MaxBioPhotoCount` name different resources and are deliberately NOT
 *     paired, however tempting the shape is.
 *   - An unknown side yields an unknown percentage, never zero. Every value on
 *     this fleet is withheld until its key is reviewed, so "not reported" is
 *     the normal state, not an error state.
 *   - Nothing unknown renders as healthy.
 *
 * This is display only. Gating enrollment on a capacity number the bridge has
 * never actually read would be acting on an unverified value, which is how the
 * photo outage happened in the first place.
 */

interface CapacityPair {
  label: string
  usedKey: string
  limitKey: string
  /** The device reports what REMAINS, not what is consumed (flash storage). */
  reportsFree?: boolean
}

/**
 * Declared pairs, each verified by name correspondence against the 2026-08-05
 * SenseFace dump. Adding a pair means asserting the two keys measure the same
 * resource — if that is a guess, leave it out and show the raw counter instead.
 */
const CAPACITY_PAIRS: readonly CapacityPair[] = [
  { label: 'Users', usedKey: 'UserCount', limitKey: '~MaxUserCount' },
  { label: 'Fingerprints', usedKey: 'FPCount', limitKey: '~MaxFingerCount' },
  { label: 'Faces', usedKey: 'FaceCount', limitKey: '~MaxFaceCount' },
  { label: 'Palm', usedKey: 'PvCount', limitKey: '~MaxPvCount' },
  { label: 'Finger vein', usedKey: 'FvCount', limitKey: '~MaxFvCount' },
  { label: 'User photos', usedKey: 'UserPhotoCount', limitKey: '~MaxUserPhotoCount' },
  { label: 'Attendance records', usedKey: 'TransactionCount', limitKey: '~MaxAttLogCount' },
  { label: 'Storage', usedKey: 'FreeFlashSize', limitKey: 'FlashSize', reportsFree: true },
]

export interface CapacityMetric {
  label: string
  usedKey: string
  limitKey: string
  used: number | null
  limit: number | null
  /** Null whenever either side is unknown — never a fabricated 0. */
  percent: number | null
}

/**
 * A device value as a number, or null.
 *
 * Values arrive as strings straight off the wire. `Number('')` is 0 and
 * `Number('x')` is NaN; both would render as a real figure if passed through.
 */
function toNumber(entry: DeviceOptionEntry | undefined): number | null {
  if (!entry || entry.redacted) return null
  const raw = entry.value?.trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

export function deriveCapacity(options: DeviceOptionEntry[]): CapacityMetric[] {
  const byKey = new Map(options.map((o) => [o.key.toLowerCase(), o]))
  const lookup = (key: string) => toNumber(byKey.get(key.toLowerCase()))

  return CAPACITY_PAIRS.map(({ label, usedKey, limitKey, reportsFree }) => {
    const limit = lookup(limitKey)
    const reported = lookup(usedKey)

    // An inverted pair reports what is free, so consumed is the remainder.
    // Clamped: firmware disagreeing with itself must not yield a negative bar.
    const used =
      reportsFree && reported != null && limit != null
        ? Math.max(0, limit - reported)
        : reportsFree
          ? null
          : reported

    const percent =
      used != null && limit != null && limit > 0 ? Math.round((used / limit) * 100) : null

    return { label, usedKey, limitKey, used, limit, percent }
  })
}

/** Unknown is not healthy — it is idle, and must never render green. */
export function capacitySignal(percent: number | null): Signal {
  if (percent == null) return 'idle'
  if (percent >= 90) return 'danger'
  if (percent >= 75) return 'attention'
  return 'success'
}

export function formatCapacityValue(value: number | null): string {
  if (value == null) return 'Not reported'
  return value.toLocaleString()
}

export function DeviceCapacityPanel({ options }: { options: DeviceOptionEntry[] }) {
  const metrics = deriveCapacity(options)
  const known = metrics.filter((m) => m.percent != null).length

  return (
    <div className="space-y-3">
      <div className="space-y-2.5">
        {metrics.map((m) => {
          const signal = capacitySignal(m.percent)
          return (
            <div key={m.label} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium">{m.label}</span>
                {m.percent == null ? (
                  <span
                    className={signalText.idle}
                    title={`Needs ${m.usedKey} and ${m.limitKey}. Values are withheld until their keys are reviewed.`}
                  >
                    Not reported
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    <span className={cn('font-medium', signalText[signal])}>{m.percent}%</span>
                    {' · '}
                    {formatCapacityValue(m.used)} of {formatCapacityValue(m.limit)}
                  </span>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                {m.percent != null && (
                  <div
                    className={cn('h-full rounded-full', signalDot[signal])}
                    style={{ width: `${Math.min(100, m.percent)}%` }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {known === 0 && (
        <p className="text-xs text-muted-foreground">
          Capacity needs the counter and limit values, which are withheld until their keys are
          reviewed. Once they are, this fills in on the next read.
        </p>
      )}
    </div>
  )
}

interface DeviceCapacitySectionProps {
  options: DeviceOptionEntry[]
  loading?: boolean
}

/** Capacity card. Reads the same options query the configuration card uses. */
export function DeviceCapacitySection({ options, loading = false }: DeviceCapacitySectionProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        Capacity
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <DeviceCapacityPanel options={options} />
      )}
    </div>
  )
}
