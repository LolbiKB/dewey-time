import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, EyeOff, Loader2, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DeviceService } from '@/services/device-service'
import { useDevices } from '@/hooks/use-core-data'
import { signalText, signalAlert } from '@/lib/signal'
import { cn } from '@/lib/utils'
import {
  buildOptionMatrix,
  countDrift,
  hasDrift,
  type MatrixRow,
  type DriftVerdict,
} from '@/lib/device-option-matrix'

/**
 * Fleet configuration — "are my terminals the same?"
 *
 * Its own route on purpose. A per-device dialog is the wrong container for
 * fleet state: the question is device-vs-device, and the answer only exists
 * across columns. This works before any desired-state table exists, which is
 * the state the fleet is actually in.
 *
 * Read-only. Writing a fleet baseline is Part 3 and slots into this same grid
 * as an extra column plus an Apply action, with no redesign.
 */

/** Matches the bridge's MAX_DEVICE_OPTIONS_PAGE. See the truncation banner. */
const OPTIONS_PAGE_LIMIT = 500

const VERDICT_TEXT: Record<DriftVerdict, string> = {
  agree: 'All match',
  differ: 'Values differ',
  missing: 'Not on every device',
  unknown: 'Cannot compare',
  // Not findings. Serial numbers, MACs and IPs are unique by definition, and
  // counters move with use — comparing either produced eight false alarms on a
  // fleet whose only real problems were firmware version and volume.
  'per-device': 'Per device',
  volatile: 'Live counter',
}

function CellValue({ row, sn }: { row: MatrixRow; sn: string }) {
  const cell = row.cells[sn]
  if (!cell?.present) {
    return <span className={cn('text-xs', signalText.idle)}>—</span>
  }
  if (cell.redacted) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-xs', signalText.idle)}
        title="The device reported a value. It was not stored because this key is not on the value allowlist."
      >
        <EyeOff className="h-3 w-3" />
        Withheld
      </span>
    )
  }
  return <span className="font-mono text-xs break-all">{cell.value || '(empty)'}</span>
}

export function DeviceConfig() {
  const [search, setSearch] = useState('')
  const [driftOnly, setDriftOnly] = useState(false)

  const devicesQuery = useDevices({ limit: 200 })
  const optionsQuery = useQuery({
    queryKey: ['device-options', 'fleet'],
    queryFn: () => DeviceService.getAllDeviceOptions(OPTIONS_PAGE_LIMIT),
  })

  // Only approved terminals. Pending and rejected units would otherwise
  // generate phantom drift that nobody can act on.
  const deviceSns = useMemo(
    () =>
      (devicesQuery.data?.devices ?? [])
        .filter((d: { connection_status?: string }) => d.connection_status === 'approved')
        .map((d: { serial_number: string }) => d.serial_number),
    [devicesQuery.data]
  )

  const matrix = useMemo(
    () => buildOptionMatrix(optionsQuery.data ?? [], deviceSns, { limit: OPTIONS_PAGE_LIMIT }),
    [optionsQuery.data, deviceSns]
  )

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return matrix.rows.filter((r) => {
      if (driftOnly && !hasDrift(r)) return false
      if (q && !r.key.toLowerCase().includes(q)) return false
      return true
    })
  }, [matrix.rows, driftOnly, search])

  const driftCount = countDrift(matrix.rows)
  const loading = devicesQuery.isLoading || optionsQuery.isLoading

  if (loading) {
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
        <div className="flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          {matrix.rows.length} key{matrix.rows.length === 1 ? '' : 's'} across{' '}
          {matrix.reportingDevices.length} terminal
          {matrix.reportingDevices.length === 1 ? '' : 's'}
          {driftCount > 0 ? (
            <span className={cn('ml-2', signalText.attention)}>
              · {driftCount} setting{driftCount === 1 ? '' : 's'} differ
              {driftCount === 1 ? 's' : ''}
            </span>
          ) : (
            <span className={cn('ml-2', signalText.success)}>· settings match</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter keys…"
            className="h-8 w-44"
          />
          <Button
            variant={driftOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDriftOnly((v) => !v)}
          >
            Show drift only
          </Button>
        </div>
      </div>

      {matrix.truncated && (
        <div className={cn('flex gap-2 rounded-lg p-3 text-xs', signalAlert.danger)}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            The configuration list hit its {OPTIONS_PAGE_LIMIT}-row limit, so settings are missing
            from this grid. A key that was cut looks absent on every terminal, which reads as drift
            that may not be real — <strong>do not act on this view until it is resolved.</strong>
          </span>
        </div>
      )}

      {matrix.silentDevices.length > 0 && (
        <div className={cn('rounded-lg p-3 text-xs', signalAlert.attention)}>
          {matrix.silentDevices.join(', ')} {matrix.silentDevices.length === 1 ? 'has' : 'have'} not
          reported any configuration yet, so {matrix.silentDevices.length === 1 ? 'it is' : 'they are'}{' '}
          shown but not compared. A terminal reports on approval, when a watched setting changes, and
          at least twice a day.
        </div>
      )}

      {matrix.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No terminal has reported its configuration yet.
        </p>
      ) : (
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
                      // Identity and counters are context, not candidates for
                      // action. Muting them keeps the eye on what can be fixed.
                      row.kind !== 'setting' && 'text-muted-foreground'
                    )}
                  >
                    {row.key}
                  </td>
                  {deviceSns.map((sn) => (
                    <td key={sn} className="px-3 py-2">
                      <CellValue row={row} sn={sn} />
                    </td>
                  ))}
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
            <p className="p-4 text-sm text-muted-foreground">
              {driftOnly ? 'Every comparable setting matches across the fleet.' : 'No key matches that filter.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
