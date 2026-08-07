import { Fragment, useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { signalText } from '@/lib/signal'
import { cn } from '@/lib/utils'
import { groupRowValues, type MatrixCell, type MatrixRow } from '@/lib/device-option-matrix'

function valueLabel(cell: MatrixCell | undefined): string {
  if (!cell?.present) return 'Not reported'
  if (cell.redacted) return 'Withheld'
  return cell.value === '' || cell.value == null ? '(empty)' : cell.value
}

function isSoft(cell: MatrixCell | undefined): boolean {
  return !cell?.present || cell.redacted
}

/**
 * Every key any terminal has reported — the audit view beneath the curated
 * settings and the drift report. One row per key with its fleet summary from
 * `groupRowValues`; expanding shows the value each reporting terminal
 * actually sent, withheld and absent kept distinct as everywhere else on
 * this page.
 */
export function AllKeysReference({
  rows, reportingDevices, search, onSearch, onConfigure,
}: {
  rows: MatrixRow[]
  reportingDevices: string[]
  search: string
  onSearch: (s: string) => void
  onConfigure: (key: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const visible = rows.filter((r) => r.key.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="space-y-2">
      <Input value={search} onChange={(e) => onSearch(e.target.value)}
        placeholder="Filter keys…" className="h-8 w-full sm:w-56" />
      {visible.length === 0 ? (
        <EmptyState title="No key matches that filter" />
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
                    onClick={() => setOpen(open === row.key ? null : row.key)}>
                    <TableCell className="font-mono text-xs break-all">{row.key}</TableCell>
                    <TableCell className="text-xs">
                      {groups.length === 1
                        ? `all ${reportingDevices.length} agree · ${valueLabel(sample)}`
                        : `${groups.length} values`}
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
