import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, EyeOff, Loader2, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DeviceService, type DeviceOptionEntry } from '@/services/device-service'
import { useDevices } from '@/hooks/use-core-data'
import { signalText, signalAlert } from '@/lib/signal'
import { cn } from '@/lib/utils'
import {
  buildOptionMatrix,
  hasDrift,
  groupRowValues,
  deviceDeviations,
  type MatrixRow,
  type DriftVerdict,
} from '@/lib/device-option-matrix'

/**
 * Fleet configuration — "are my terminals the same?"
 *
 * FINDINGS FIRST, GRID SECOND. The first version led with a rows-by-devices
 * matrix. That is readable at four terminals and unusable at ten: its width
 * grows with the fleet, so the two settings that actually differ end up
 * off-screen among seventy that do not.
 *
 * Values are few and devices are many, so this groups by VALUE. `VOLUME` across
 * twenty terminals is still three lines. The grid stays behind a toggle for
 * when someone genuinely wants to read every cell.
 */

/** Matches the bridge's MAX_DEVICE_OPTIONS_PAGE. */
const OPTIONS_PAGE_LIMIT = 500

const VERDICT_TEXT: Record<DriftVerdict, string> = {
  agree: 'All match',
  differ: 'Values differ',
  missing: 'Not on every device',
  unknown: 'Cannot compare',
  'per-device': 'Per device',
  volatile: 'Live counter',
}

function valueLabel(value: string | null, present: boolean, redacted: boolean): string {
  if (!present) return 'Not reported'
  if (redacted) return 'Withheld'
  return value === '' || value == null ? '(empty)' : value
}

/** One drifting setting, its values grouped by how many terminals report each. */
function FindingCard({ row, reportingDevices }: { row: MatrixRow; reportingDevices: string[] }) {
  const groups = groupRowValues(row, reportingDevices)

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs font-medium break-all">{row.key}</span>
        <span className={cn('text-xs whitespace-nowrap', signalText.attention)}>
          {groups.length} value{groups.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-1">
        {groups.map((g, i) => {
          const sample = row.cells[g.devices[0]]
          return (
            <div key={i} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="flex items-baseline gap-1.5 font-mono break-all">
                {sample?.present && sample.redacted && (
                  <EyeOff className={cn('h-3 w-3 shrink-0', signalText.idle)} />
                )}
                <span className={cn(!sample?.present || sample.redacted ? signalText.idle : '')}>
                  {valueLabel(g.value, !!sample?.present, !!sample?.redacted)}
                </span>
                {g.isMajority && (
                  <span className={cn('text-[10px] uppercase tracking-wide', signalText.idle)}>
                    most common
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap',
                  g.isMajority ? signalText.idle : signalText.attention
                )}
                title={g.devices.join(', ')}
              >
                {g.devices.length} terminal{g.devices.length === 1 ? '' : 's'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DeviceConfig() {
  const [search, setSearch] = useState('')
  const [showGrid, setShowGrid] = useState(false)

  const devicesQuery = useDevices({ limit: 200 })

  // Only approved terminals. Pending and rejected units would generate phantom
  // drift nobody can act on.
  const deviceSns: string[] = useMemo(
    () =>
      (devicesQuery.data?.devices ?? [])
        .filter((d: { connection_status?: string }) => d.connection_status === 'approved')
        .map((d: { serial_number: string }) => d.serial_number)
        .sort(),
    [devicesQuery.data]
  )

  // PER DEVICE, not one fleet-wide call. A single bounded query truncates once
  // the fleet outgrows it — ten terminals at ~78 keys is 780 rows against a 500
  // cap — and a cut key looks absent everywhere, which reads as drift that is
  // not real. Per-device queries stay far under the bound however large the
  // fleet gets, and React Query caches each separately.
  const optionQueries = useQueries({
    queries: deviceSns.map((sn) => ({
      queryKey: ['device-options', sn],
      queryFn: () => DeviceService.getDeviceOptions(sn),
    })),
  })

  const optionsLoading = optionQueries.some((q) => q.isLoading)
  const stamp = optionQueries.map((q) => q.dataUpdatedAt).join(',')
  const entries: DeviceOptionEntry[] = useMemo(
    () => optionQueries.flatMap((q) => q.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stamp]
  )
  // A single terminal reporting 500+ keys is the only remaining way to truncate.
  const truncated = optionQueries.some((q) => (q.data?.length ?? 0) >= OPTIONS_PAGE_LIMIT)

  const matrix = useMemo(() => buildOptionMatrix(entries, deviceSns), [entries, deviceSns])
  const driftRows = useMemo(() => matrix.rows.filter(hasDrift), [matrix.rows])
  const outliers = useMemo(
    () => deviceDeviations(matrix.rows, matrix.reportingDevices),
    [matrix.rows, matrix.reportingDevices]
  )

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? matrix.rows.filter((r) => r.key.toLowerCase().includes(q)) : matrix.rows
  }, [matrix.rows, search])

  if (devicesQuery.isLoading || optionsLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading fleet configuration…
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          {matrix.reportingDevices.length} terminal
          {matrix.reportingDevices.length === 1 ? '' : 's'} · {matrix.rows.length} keys
          {driftRows.length > 0 ? (
            <span className={signalText.attention}>
              · {driftRows.length} setting{driftRows.length === 1 ? '' : 's'} to review
            </span>
          ) : (
            <span className={cn('inline-flex items-center gap-1', signalText.success)}>
              <Check className="h-3.5 w-3.5" />
              settings match
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowGrid((v) => !v)}>
          <ChevronDown
            className={cn('mr-1.5 h-3 w-3 transition-transform', showGrid && 'rotate-180')}
          />
          {showGrid ? 'Hide' : 'Show'} full grid
        </Button>
      </div>

      {truncated && (
        <div className={cn('flex gap-2 rounded-lg p-3 text-xs', signalAlert.danger)}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            A terminal reported more than {OPTIONS_PAGE_LIMIT} keys, so some are missing here. A key
            that was cut looks absent on every terminal, which reads as drift that may not be real —{' '}
            <strong>do not act on this view until it is resolved.</strong>
          </span>
        </div>
      )}

      {matrix.silentDevices.length > 0 && (
        <div className={cn('rounded-lg p-3 text-xs', signalAlert.attention)}>
          {matrix.silentDevices.length} terminal{matrix.silentDevices.length === 1 ? '' : 's'} have
          not reported yet ({matrix.silentDevices.join(', ')}), so they are not compared. A terminal
          reports on approval, when a watched setting changes, and at least twice a day.
        </div>
      )}

      {outliers.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="text-xs font-medium">Terminals outside the majority</div>
          <div className="space-y-1">
            {outliers.map((d) => (
              <div key={d.deviceSn} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-mono break-all">{d.deviceSn}</span>
                <span className={signalText.attention} title={d.keys.join(', ')}>
                  {d.count} setting{d.count === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            One terminal off on several settings is a single visit; several off on one each is a
            different job.
          </p>
        </div>
      )}

      {matrix.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No terminal has reported its configuration yet.
        </p>
      ) : driftRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every comparable setting matches across the fleet. Identity and live counters differ by
          nature and are not compared.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {driftRows.map((row) => (
            <FindingCard key={row.key} row={row} reportingDevices={matrix.reportingDevices} />
          ))}
        </div>
      )}

      {showGrid && matrix.rows.length > 0 && (
        <div className="space-y-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter keys…"
            className="h-8 w-full sm:w-64"
          />
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-max text-left">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-xs font-medium">Setting</th>
                  {deviceSns.map((sn) => (
                    <th key={sn} className="px-3 py-2 font-mono text-xs font-medium">
                      {sn}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-xs font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleRows.map((row) => (
                  <tr key={row.key} className={cn(hasDrift(row) && 'bg-attention/5')}>
                    <td
                      className={cn(
                        'px-3 py-2 font-mono text-xs break-all',
                        row.kind !== 'setting' && 'text-muted-foreground'
                      )}
                    >
                      {row.key}
                    </td>
                    {deviceSns.map((sn) => {
                      const cell = row.cells[sn]
                      return (
                        <td key={sn} className="px-3 py-2">
                          <span
                            className={cn(
                              'font-mono text-xs break-all',
                              (!cell?.present || cell.redacted) && signalText.idle
                            )}
                          >
                            {valueLabel(cell?.value ?? null, !!cell?.present, !!cell?.redacted)}
                          </span>
                        </td>
                      )
                    })}
                    <td
                      className={cn(
                        'px-3 py-2 text-xs whitespace-nowrap',
                        hasDrift(row) ? signalText.attention : signalText.idle
                      )}
                    >
                      {VERDICT_TEXT[row.verdict]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleRows.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No key matches that filter.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
