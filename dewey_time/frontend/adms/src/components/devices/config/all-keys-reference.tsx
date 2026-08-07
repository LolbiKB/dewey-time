import { Fragment } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { signalText } from '@/lib/signal'
import { cn } from '@/lib/utils'
import { groupRowValues, type MatrixCell, type MatrixRow, type ValueGroup } from '@/lib/device-option-matrix'
import { valueLabel, isSoft } from '@/lib/device-option-cell-label'

/**
 * The fleet-agreement summary for one key, from its `groupRowValues` output.
 *
 * A single group is NOT the same claim as agreement. `groupRowValues` puts
 * every withheld cell in one bucket and every absent cell in another — so a
 * key withheld on every terminal groups down to exactly one bucket, same as
 * a key every terminal genuinely agrees on. Saying "all N agree · Withheld"
 * for the withheld case would be a fabricated agreement about a value nobody
 * can see (device-option-matrix.ts's whole reason for calling such a row
 * INCOMPARABLE) — so a single-group row only reads as agreement when its
 * sample cell is actually a known, comparable value.
 */
function summaryLabel(
  groups: ValueGroup[],
  sample: MatrixCell | undefined,
  reportingDeviceCount: number
): string {
  if (groups.length !== 1) return `${groups.length} values`
  if (isSoft(sample)) {
    return sample?.present
      ? `withheld on all ${reportingDeviceCount}`
      : `not reported by any of ${reportingDeviceCount}`
  }
  return `all ${reportingDeviceCount} agree · ${valueLabel(sample)}`
}

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
              const groups = groupRowValues(row, reportingDevices)
              // The group's own `value` is null for BOTH withheld and absent
              // buckets — it cannot say which. The sample cell can, so a single
              // agreeing group is described from one of its member cells, the
              // same way FindingCard reads a group.
              const sample = groups[0] ? row.cells[groups[0].devices[0]] : undefined
              return (
                <Fragment key={row.key}>
                  <TableRow className="cursor-pointer hover:bg-muted/30"
                    onClick={() => onOpen(open === row.key ? null : row.key)}>
                    <TableCell className="font-mono text-xs break-all">{row.key}</TableCell>
                    <TableCell className="text-xs">
                      {summaryLabel(groups, sample, reportingDevices.length)}
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
