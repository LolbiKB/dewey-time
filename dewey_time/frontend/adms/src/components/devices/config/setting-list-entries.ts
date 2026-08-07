import { CURATED_SETTINGS, isCurated } from '@/lib/device-option-catalogue'
import { hasDrift, type MatrixRow } from '@/lib/device-option-matrix'
import type { SettingListEntry } from './setting-list'

/**
 * What the left rail says about one curated setting, and which drifting keys
 * fall outside that rail entirely.
 *
 * Split out of the page for the same reason `nextDraft` and `nextCanaryTarget`
 * are split out of their components: it is a decision about what may be
 * CLAIMED from partial data, and this suite has no jsdom to reach it through a
 * rendered page.
 *
 * Every phrase below is derived from `MatrixRow.verdict` rather than
 * re-inspecting the cells, so the rail cannot reach a different conclusion
 * from the drift report reading the same row. The traps it exists to avoid:
 *
 *   A key WITHHELD by every terminal groups down to one bucket exactly like a
 *   key everybody agrees on. Reading that as "all agree" fabricates agreement
 *   about a value nobody can see — the same defect already fixed once in the
 *   all-keys reference's summary line.
 *
 *   A key NO terminal has reported is not a disagreement; and a fleet with a
 *   single reporting terminal has nothing to disagree about at all.
 */
function settingSummary(row: MatrixRow | undefined, reportingDevices: string[]): string {
  if (!row) return 'not reported'

  const total = reportingDevices.length
  const present = reportingDevices.filter((sn) => row.cells[sn]?.present)

  switch (row.verdict) {
    case 'agree':
      return 'all agree'
    case 'differ': {
      // The VALUES, not the terminals: "3 differ" beside three terminals
      // reporting two values reads as "three terminals differ", which is a
      // different (and wrong) statement.
      const distinct = new Set(present.map((sn) => row.cells[sn].value))
      return `${distinct.size} values`
    }
    case 'missing':
      return `reported by ${present.length} of ${total}`
    case 'unknown':
      if (present.length === 0) return 'not reported'
      // `verdictFor` reaches 'unknown' with two or more reporting terminals
      // only when a value was withheld — anything else is 'missing' or a
      // real comparison.
      return total < 2 ? 'one terminal reporting' : 'withheld — cannot compare'
    default:
      // Identity and counters. A curated key is never one, but the phrase
      // must exist rather than fall through to an agreement claim.
      return 'not compared'
  }
}

/** One entry per curated setting, in catalogue order, reported or not. */
export function settingListEntries(
  rows: MatrixRow[],
  reportingDevices: string[]
): SettingListEntry[] {
  return CURATED_SETTINGS.map((setting) => {
    const row = rows.find((r) => r.key === setting.key)
    return {
      key: setting.key,
      label: setting.label,
      summary: settingSummary(row, reportingDevices),
      drifting: row ? hasDrift(row) : false,
    }
  })
}

/**
 * Drifting keys the curated rail does not show — what "Unexpected differences"
 * counts and what its view lists. `hasDrift` already excludes identity and
 * counter kinds, which differ by nature.
 */
export function uncuratedDriftRows(rows: MatrixRow[]): MatrixRow[] {
  return rows.filter((r) => hasDrift(r) && !isCurated(r.key))
}
