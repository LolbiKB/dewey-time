import { Fragment } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { signalText } from '@/lib/signal'
import { cn } from '@/lib/utils'
import { type MatrixRow } from '@/lib/device-option-matrix'
import { valueLabel, isSoft } from '@/lib/device-option-cell-label'
// The summary sentence lives in its own module: it is a judgement about what
// may be CLAIMED from partial data (see fleet-summary-label.ts), and this
// suite renders statically, so it is pinned by unit tests rather than by
// reading it back out of a table.
import { fleetSummaryLabel } from './fleet-summary-label'

/**
 * Every key any terminal has reported — the audit view beneath the curated
 * settings and the drift report. One row per key with its fleet summary from
 * `groupRowValues`; expanding shows the value each reporting terminal
 * actually sent, withheld and absent kept distinct as everywhere else on
 * this page.
 *
 * `open` is a controlled prop, not local state: there is no jsdom in this
 * suite to click a row open with, so the expansion — the one place the
 * withheld/absent distinction actually renders per terminal — has to be
 * reachable by passing a value in, the same way DriftReport's `expanded` is.
 */
export function AllKeysReference({
  rows, reportingDevices, search, onSearch, onConfigure, open, onOpen,
}: {
  rows: MatrixRow[]
  reportingDevices: string[]
  search: string
  onSearch: (s: string) => void
  onConfigure: (key: string) => void
  open: string | null
  onOpen: (key: string | null) => void
}) {
  const visible = rows.filter((r) => r.key.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="space-y-2">
      <Input value={search} onChange={(e) => onSearch(e.target.value)}
        placeholder="Filter keys…" className="h-8 w-full sm:w-56" />
      {visible.length === 0 ? (
        // Do not blame a filter the operator never touched: an empty ROW SET
        // (no terminal has reported anything yet) and an empty FILTER RESULT
        // (something has reported, but nothing matches the search) are
        // different situations with different next steps.
        <EmptyState
          title={rows.length === 0 ? 'No terminal has reported any keys yet' : 'No key matches that filter'}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Key</TableHead><TableHead>Across the fleet</TableHead>
              <TableHead className="w-px" /></TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              return (
                <Fragment key={row.key}>
                  <TableRow className="cursor-pointer hover:bg-muted/30"
                    onClick={() => onOpen(open === row.key ? null : row.key)}>
                    <TableCell className="font-mono text-xs break-all">{row.key}</TableCell>
                    <TableCell className="text-xs">
                      {fleetSummaryLabel(row, reportingDevices)}
                    </TableCell>
                    <TableCell>
                      {/* Only where a write could succeed. The bridge refuses
                          identity and counter keys, so a control on MAC or
                          UserCount would be an action that cannot work. */}
                      {row.kind === 'setting' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); onConfigure(row.key) }}>
                          Configure this key
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {open === row.key && (
                    <TableRow className="bg-muted/20">
                      <TableCell colSpan={3}>
                        <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                          {reportingDevices.map((sn) => {
                            const cell = row.cells[sn]
                            return (
                              <div
                                key={sn}
                                className="flex items-baseline justify-between gap-3 text-xs"
                              >
                                <span className="font-mono text-muted-foreground break-all">{sn}</span>
                                <span
                                  className={cn(
                                    'text-right font-mono break-all',
                                    isSoft(cell) && signalText.idle
                                  )}
                                >
                                  {valueLabel(cell)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
