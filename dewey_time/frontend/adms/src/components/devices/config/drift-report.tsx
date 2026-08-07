import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { signalText } from '@/lib/signal'
import { cn } from '@/lib/utils'
import { deviceDeviations, deviceLabel, type MatrixRow } from '@/lib/device-option-matrix'
import { valueLabel, isSoft } from '@/lib/device-option-cell-label'
import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * TRANSPOSED comparison: devices are ROWS and only the DRIFTING settings are
 * columns. A settings-by-devices grid widens with the fleet; this one is
 * bounded by the number of problems, which is what an operator is working
 * through anyway. Expanding a row shows that terminal's full key list, which
 * is the "what does this box actually have" question the wide grid used to
 * answer badly.
 */
export function DriftReport({
  rows,
  deviceSns,
  entries,
  silentDevices,
  unreadableDevices,
  devices,
  expanded,
  onExpand,
  search,
  onSearch,
}: {
  rows: MatrixRow[]
  deviceSns: string[]
  entries: DeviceOptionEntry[]
  /** Terminals with nothing on hand — the silent AND the unreadable together. */
  silentDevices: string[]
  /**
   * The subset whose READ FAILED, so nothing whatever is known about them.
   *
   * Required rather than optional: the two "nothing here" statements below are
   * about the TERMINAL, and getting the reason wrong sends an operator to check
   * the health and poll schedule of a box that may have reported perfectly
   * well. A caller who has not thought about it should not be able to skip it.
   */
  unreadableDevices: string[]
  devices: { serial_number: string; name?: string | null; location?: string | null }[]
  expanded: string | null
  onExpand: (sn: string | null) => void
  search: string
  onSearch: (s: string) => void
}) {
  const label = (sn: string) => deviceLabel(sn, devices)
  const reportingDevices = deviceSns.filter((sn) => !silentDevices.includes(sn))
  const outlierCount = new Map<string, number>()
  for (const d of deviceDeviations(rows, reportingDevices)) outlierCount.set(d.deviceSn, d.count)

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">By terminal</div>
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            <TableHead>Terminal</TableHead>
            {rows.map((r) => (
              <TableHead key={r.key} className="font-mono text-xs">
                {r.key}
              </TableHead>
            ))}
            <TableHead>Off majority</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
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
                <TableRow
                  className={cn(
                    'cursor-pointer hover:bg-muted/30',
                    // Signal color lives on text/icon/border, never a surface
                    // fill (lib/signal.ts) — an off-majority row gets a left
                    // accent border, not a tinted background.
                    off > 0 && 'border-l-2 border-l-attention'
                  )}
                  onClick={() => onExpand(isOpen ? null : sn)}
                >
                  <TableCell>
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <ChevronRight
                        className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-90')}
                      />
                      {label(sn)}
                    </span>
                    <span className={cn('ml-4.5 block font-mono text-[10px]', signalText.idle)}>
                      {sn}
                    </span>
                  </TableCell>
                  {rows.map((r) => (
                    <TableCell key={r.key}>
                      <span
                        className={cn(
                          'font-mono text-xs break-all',
                          isSoft(r.cells[sn]) && signalText.idle
                        )}
                      >
                        {valueLabel(r.cells[sn])}
                      </span>
                    </TableCell>
                  ))}
                  <TableCell
                    className={cn(
                      'text-xs whitespace-nowrap',
                      off > 0 ? signalText.attention : signalText.idle
                    )}
                  >
                    {/* "—" means "no deviations", so it may never stand for a
                        terminal nothing is known about: that would claim it
                        matches the majority everywhere. The two causes are
                        named apart for the same reason the expansion below
                        names them apart. */}
                    {unreadableDevices.includes(sn)
                      ? 'Not read'
                      : silentDevices.includes(sn)
                        ? 'Not reported'
                        : off > 0
                          ? off
                          : '—'}
                  </TableCell>
                </TableRow>

                {isOpen && (
                  <TableRow className="bg-muted/20">
                    <TableCell colSpan={rows.length + 2}>
                      {own.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {/* A read that FAILED is not a terminal that stayed
                              quiet. Saying it "has not reported" here would
                              contradict the page's own banner, which says the
                              dashboard could not load this terminal — and it
                              would send the operator to check a box that may
                              have reported perfectly well. */}
                          {unreadableDevices.includes(sn)
                            ? 'This terminal’s configuration could not be loaded, so none is on hand to show.'
                            : 'This terminal has not reported its configuration yet.'}
                        </p>
                      ) : (
                        <>
                          <Input
                            value={search}
                            onChange={(ev) => onSearch(ev.target.value)}
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
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
