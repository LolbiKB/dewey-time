import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronRight, EyeOff, Loader2, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { DeviceService, type DeviceOptionEntry, type OptionKeyState } from '@/services/device-service'
import { OptionKeyActions } from '@/components/devices/option-key-actions'
import { useDevices } from '@/hooks/use-core-data'
import { signalText, signalAlert } from '@/lib/signal'
import { cn } from '@/lib/utils'
import {
  buildOptionMatrix,
  hasDrift,
  groupRowValues,
  deviceDeviations,
  deviceLabel,
  type MatrixRow,
  type MatrixCell,
} from '@/lib/device-option-matrix'

/**
 * Fleet configuration — "are my terminals the same?"
 *
 * BUILT FOR TEN-PLUS TERMINALS, not four. Two things break as a fleet grows,
 * and both are structural rather than cosmetic:
 *
 *   A settings-by-devices grid gets WIDER with every terminal, so the handful
 *   of settings that actually differ end up off-screen among seventy that do
 *   not. Fixed by grouping on VALUE — values are few, devices are many, so
 *   `VOLUME` across twenty terminals is still three lines — and by transposing
 *   the comparison table to devices-as-rows with only the DRIFTING settings as
 *   columns. That table is bounded by the number of problems, not the fleet.
 *
 *   Raw serials stop being readable. `PYA8261900039` and `PYA8261900038` differ
 *   in one character; twenty of them is noise. Operators know these boxes by
 *   where they are, so name and location lead and the serial is the subtitle.
 */

/** Matches the bridge's MAX_DEVICE_OPTIONS_PAGE. */
const OPTIONS_PAGE_LIMIT = 500

/** How many silent terminals to name before summarising the rest. */
const MAX_NAMED_SILENT = 4

function valueLabel(cell: MatrixCell | undefined): string {
  if (!cell?.present) return 'Not reported'
  if (cell.redacted) return 'Withheld'
  return cell.value === '' || cell.value == null ? '(empty)' : cell.value
}

function isSoft(cell: MatrixCell | undefined): boolean {
  return !cell?.present || cell.redacted
}

/** One drifting setting, its values grouped by how many terminals report each. */
function FindingCard({
  row,
  reportingDevices,
  label,
  actions,
}: {
  row: MatrixRow
  reportingDevices: string[]
  label: (sn: string) => string
  /** Write controls, when this key is one the bridge will accept a write for. */
  actions?: React.ReactNode
}) {
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
                <span className={cn(isSoft(sample) && signalText.idle)}>{valueLabel(sample)}</span>
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
                title={g.devices.map(label).join(', ')}
              >
                {g.devices.length} terminal{g.devices.length === 1 ? '' : 's'}
              </span>
            </div>
          )
        })}
      </div>

      {actions}
    </div>
  )
}

export function DeviceConfig() {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const devicesQuery = useDevices({ limit: 200 })
  const devices = useMemo(
    () =>
      (devicesQuery.data?.devices ?? []).filter(
        (d: { connection_status?: string }) => d.connection_status === 'approved'
      ),
    [devicesQuery.data]
  )
  const deviceSns: string[] = useMemo(
    () => devices.map((d: { serial_number: string }) => d.serial_number).sort(),
    [devices]
  )
  const label = useMemo(() => (sn: string) => deviceLabel(sn, devices), [devices])

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
  const truncated = optionQueries.some((q) => (q.data?.length ?? 0) >= OPTIONS_PAGE_LIMIT)

  /**
   * The write ladder, fleet-wide and independent of any one device's rows.
   *
   * Separate from the per-device option queries because it is per-KEY, not per
   * device — one call, whatever the fleet size.
   */
  const policyQuery = useQuery({
    queryKey: ['device-option-policy'],
    queryFn: () => DeviceService.getOptionPolicy(),
  })
  const keyState = useMemo(() => {
    const map = new Map<string, OptionKeyState>()
    for (const k of policyQuery.data?.keys ?? []) map.set(k.key, k)
    return map
  }, [policyQuery.data])

  const queryClient = useQueryClient()
  /**
   * Invalidate the DEVICE rows as well as the policy.
   *
   * A write does not land until the terminal next polls, so neither cache is
   * correct at this moment — but leaving the option rows stale is what makes the
   * drift view disagree with the ladder, and an operator reading two panels that
   * contradict each other trusts neither.
   */
  const refetchAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['device-option-policy'] })
    for (const sn of deviceSns) void queryClient.invalidateQueries({ queryKey: ['device-options', sn] })
  }

  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)

  const canaryMutation = useMutation({
    mutationFn: ({ key, sn, value }: { key: string; sn: string; value: string }) =>
      DeviceService.canaryOption(key, sn, value),
    onMutate: () => {
      setActionError(null)
      setActionNote(null)
    },
    onSuccess: (_data, vars) => {
      // "Queued", never "applied". The terminal has not been asked yet.
      setActionNote(`${vars.key} queued for ${vars.sn} — it applies when that terminal next polls.`)
      refetchAll()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const applyMutation = useMutation({
    mutationFn: (key: string) => DeviceService.applyOption(key),
    onMutate: () => {
      setActionError(null)
      setActionNote(null)
    },
    onSuccess: (result, key) => {
      // `queued: 0` reaching here means every terminal already matched. The
      // cases where nothing could be compared arrive as errors, not as this.
      setActionNote(
        result.queued === 0
          ? (result.message ?? `Every terminal already matches ${key}.`)
          : `${key} queued for ${result.queued} terminal${result.queued === 1 ? '' : 's'} — each applies when it next polls.`
      )
      refetchAll()
    },
    onError: (e: Error) => setActionError(e.message),
  })

  const pendingKey = canaryMutation.isPending
    ? canaryMutation.variables?.key
    : applyMutation.isPending
      ? applyMutation.variables
      : undefined

  const matrix = useMemo(() => buildOptionMatrix(entries, deviceSns), [entries, deviceSns])
  const driftRows = useMemo(() => matrix.rows.filter(hasDrift), [matrix.rows])
  const outlierCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of deviceDeviations(matrix.rows, matrix.reportingDevices)) {
      map.set(d.deviceSn, d.count)
    }
    return map
  }, [matrix.rows, matrix.reportingDevices])

  if (devicesQuery.isLoading || optionsLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading fleet configuration…
      </div>
    )
  }

  const namedSilent = matrix.silentDevices.slice(0, MAX_NAMED_SILENT).map(label)
  const extraSilent = matrix.silentDevices.length - namedSilent.length

  return (
    <div className="space-y-4 p-4 sm:p-6">
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
          {matrix.silentDevices.length} of {deviceSns.length} terminals have not reported yet (
          {namedSilent.join(', ')}
          {extraSilent > 0 ? ` and ${extraSilent} more` : ''}), so they are not compared. A terminal
          reports on approval, when a watched setting changes, and at least twice a day.
        </div>
      )}

      {/*
        The result of the last write action, stated as what actually happened.
        A queued command is not an applied one — the terminal has not been asked
        yet — and the errors here include the two the bridge answers when a
        fleet apply could not compare anything at all (409, the value is
        withheld) or covers no approved terminal (400). Neither is success, and
        neither may render as one.
      */}
      {actionError && (
        <div className={cn('flex gap-2 rounded-lg p-3 text-xs', signalAlert.danger)}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}
      {actionNote && !actionError && (
        <div className={cn('rounded-lg p-3 text-xs', signalAlert.attention)}>{actionNote}</div>
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
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {driftRows.map((row) => (
            <FindingCard
              key={row.key}
              row={row}
              reportingDevices={matrix.reportingDevices}
              label={label}
              actions={
                // Identity and live counters are not writable, and the bridge
                // refuses them anyway — offering a control for MAC or UserCount
                // would be an action that cannot succeed.
                row.kind === 'setting' ? (
                  <OptionKeyActions
                    status={keyState.get(row.key)?.status ?? 'unproven'}
                    optionKey={row.key}
                    devices={deviceSns}
                    lastError={keyState.get(row.key)?.lastError}
                    pending={pendingKey === row.key}
                    canaryInFlight={keyState.get(row.key)?.canaryInFlight}
                    onCanary={(sn, value) => canaryMutation.mutate({ key: row.key, sn, value })}
                    onApply={() => applyMutation.mutate(row.key)}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      {/*
        TRANSPOSED comparison: devices are ROWS and only the DRIFTING settings
        are columns. A settings-by-devices grid widens with the fleet; this one
        is bounded by the number of problems, which is what an operator is
        working through anyway. Expanding a row shows that terminal's full key
        list, which is the "what does this box actually have" question the wide
        grid used to answer badly.
      */}
      {matrix.rows.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium">By terminal</div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-xs font-medium">Terminal</th>
                  {driftRows.map((r) => (
                    <th key={r.key} className="px-3 py-2 font-mono text-xs font-medium">
                      {r.key}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-xs font-medium">Off majority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {deviceSns.map((sn) => {
                  const off = outlierCount.get(sn) ?? 0
                  const isOpen = expanded === sn
                  const own = entries
                    .filter((e) => e.device_sn === sn)
                    .sort((a, b) => a.key.localeCompare(b.key))

                  return (
                    // Key on the Fragment: a row expands into TWO <tr>s, and
                    // keying the children instead makes React treat each render
                    // as a fresh list.
                    <Fragment key={sn}>
                      <tr
                        className={cn('cursor-pointer hover:bg-muted/30', off > 0 && 'bg-attention/5')}
                        onClick={() => setExpanded(isOpen ? null : sn)}
                      >
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            <ChevronRight
                              className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-90')}
                            />
                            {label(sn)}
                          </span>
                          <span className={cn('ml-4.5 block font-mono text-[10px]', signalText.idle)}>
                            {sn}
                          </span>
                        </td>
                        {driftRows.map((r) => (
                          <td key={r.key} className="px-3 py-2">
                            <span
                              className={cn(
                                'font-mono text-xs break-all',
                                isSoft(r.cells[sn]) && signalText.idle
                              )}
                            >
                              {valueLabel(r.cells[sn])}
                            </span>
                          </td>
                        ))}
                        <td
                          className={cn(
                            'px-3 py-2 text-xs whitespace-nowrap',
                            off > 0 ? signalText.attention : signalText.idle
                          )}
                        >
                          {matrix.silentDevices.includes(sn) ? 'Not reported' : off > 0 ? off : '—'}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-muted/20">
                          <td colSpan={driftRows.length + 2} className="px-3 py-3">
                            {own.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                This terminal has not reported its configuration yet.
                              </p>
                            ) : (
                              <>
                                <Input
                                  value={search}
                                  onChange={(ev) => setSearch(ev.target.value)}
                                  placeholder="Filter keys…"
                                  className="mb-2 h-7 w-full sm:w-56"
                                  onClick={(ev) => ev.stopPropagation()}
                                />
                                <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                                  {own
                                    .filter((o) =>
                                      o.key.toLowerCase().includes(search.trim().toLowerCase())
                                    )
                                    .map((o) => (
                                      <div
                                        key={o.key}
                                        className="flex items-baseline justify-between gap-3 text-xs"
                                      >
                                        <span className="font-mono text-muted-foreground break-all">
                                          {o.key}
                                        </span>
                                        <span
                                          className={cn(
                                            'text-right font-mono break-all',
                                            o.redacted && signalText.idle
                                          )}
                                        >
                                          {o.redacted ? 'Withheld' : o.value || '(empty)'}
                                        </span>
                                      </div>
                                    ))}
                                </div>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
