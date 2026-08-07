import { groupRowValues, type MatrixRow } from '@/lib/device-option-matrix'
import { isSoft, valueLabel } from '@/lib/device-option-cell-label'

/**
 * One key's fleet summary for the reference table: what is known, from how
 * many terminals, and what could not be read.
 *
 * COUNTS VALUES, NOT BUCKETS. `groupRowValues` buckets every withheld cell
 * together and every absent cell together, exactly as it buckets a real value
 * — so counting groups renders "2 values" for one terminal reporting 50 and
 * another withholding, which asserts a disagreement out of an unknown. That
 * contradicts device-option-matrix.ts's rule that unknown is not different,
 * and it contradicts the left rail, which calls the identical state
 * uncomparable.
 *
 * Withheld and absent are also kept apart from each other, here as everywhere
 * else on this page: one is a value the bridge declined to store, the other is
 * a key the terminal never sent.
 */
export function fleetSummaryLabel(row: MatrixRow, reportingDevices: string[]): string {
  const groups = groupRowValues(row, reportingDevices)
  const total = reportingDevices.length

  // A group's own `value` is null for BOTH the withheld and the absent bucket
  // — it cannot say which. A member cell can, so each group is classified from
  // one of its cells, the same way the per-terminal expansion reads them.
  const known = groups.filter((g) => !isSoft(row.cells[g.devices[0]]))
  const withheld = groups.find((g) => {
    const cell = row.cells[g.devices[0]]
    return cell?.present === true && cell.redacted
  })
  const absent = groups.find((g) => row.cells[g.devices[0]]?.present !== true)

  const unknownNote = [
    withheld ? `${withheld.devices.length} withheld` : null,
    absent ? `${absent.devices.length} not reported` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  if (known.length === 0) {
    // Naming the single cause where there is one; neither sentence may be used
    // when both causes are present, since each would be false of half the fleet.
    if (withheld && !absent) return `withheld on all ${total}`
    if (absent && !withheld) return `not reported by any of ${total}`
    return `no value on hand from any of ${total}`
  }

  if (known.length === 1) {
    const only = known[0]
    const text = valueLabel(row.cells[only.devices[0]])
    // Agreement is a claim about EVERY reporting terminal, so it may only be
    // made when every one of them is comparable.
    if (!unknownNote) return `all ${total} agree · ${text}`
    return `${only.devices.length} of ${total} report ${text} · ${unknownNote}`
  }

  return unknownNote ? `${known.length} values · ${unknownNote}` : `${known.length} values`
}
