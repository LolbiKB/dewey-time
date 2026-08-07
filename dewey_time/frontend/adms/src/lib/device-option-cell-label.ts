import type { MatrixCell } from './device-option-matrix'

/**
 * How one terminal's reported value for a key is described to an operator.
 *
 * This is the single encoding of "withheld vs. absent vs. empty vs. a real
 * value" for the fleet page. Every view that shows a `MatrixCell` — the
 * drift report's by-terminal grid, the all-keys reference's per-terminal
 * expansion — must read a REDACTED cell and an ABSENT cell as different
 * things, never folded into each other (device-option-matrix.ts explains
 * why: a withheld value is unknown, not equal to another withheld value).
 *
 * This used to be copied by hand into each view. A copy that drifts is
 * exactly how "all 4 agree · Withheld" — a fabricated agreement about a
 * value nobody can see — shipped once already, in a summary line that read
 * a group's absence of dissent as agreement without checking whether the
 * group's one value was even knowable.
 */
export function valueLabel(cell: MatrixCell | undefined): string {
  if (!cell?.present) return 'Not reported'
  if (cell.redacted) return 'Withheld'
  return cell.value === '' || cell.value == null ? '(empty)' : cell.value
}

/** True for a cell whose value is unknown rather than known-and-comparable. */
export function isSoft(cell: MatrixCell | undefined): boolean {
  return !cell?.present || cell.redacted
}
