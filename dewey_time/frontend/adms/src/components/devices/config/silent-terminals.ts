/**
 * Which unreported terminals are actually SILENT, and which the page simply
 * could not read.
 *
 * A terminal is absent from `OptionMatrix.reportingDevices` for two reasons
 * that look identical from the matrix and are not remotely the same fact:
 *
 *   IT HAS REPORTED NOTHING. Its read succeeded and came back empty. "Has not
 *   reported yet — a terminal reports on approval, when a watched setting
 *   changes, and at least twice a day" is a true and useful thing to say.
 *
 *   ITS READ FAILED. The page asked and never got an answer, so it knows
 *   nothing whatever about that terminal — it may well have reported. Saying
 *   the sentence above sends the operator to check the box's health and poll
 *   schedule for what is an outage on this side of the wire.
 *
 * Per-device option queries make the second case the NORMAL partial failure,
 * not an edge: one request out of ten failing leaves nine terminals' worth of
 * real data on screen and one terminal falsely described. The page already
 * refuses to make this claim from an incomplete read while LOADING; an errored
 * query is the same incomplete read, permanently.
 */

export interface TerminalRead {
  deviceSn: string
  /** The option query for this terminal is in an error state. */
  failed: boolean
  /** Rows currently in hand for it — a failed REFRESH still has the last load. */
  rowCount: number
}

export function splitSilentTerminals(
  silentDevices: string[],
  reads: TerminalRead[]
): { silent: string[]; unreadable: string[] } {
  // Failed AND empty. A terminal whose refresh failed while its previous load
  // is still on screen has reported — it is not in `silentDevices` at all, and
  // the stale-values alert is what covers its failure.
  const unreadable = new Set(
    reads.filter((r) => r.failed && r.rowCount === 0).map((r) => r.deviceSn)
  )

  // Both lists are filtered FROM `silentDevices`, so membership and order come
  // from the matrix and nothing can be invented here.
  return {
    silent: silentDevices.filter((sn) => !unreadable.has(sn)),
    unreadable: silentDevices.filter((sn) => unreadable.has(sn)),
  }
}
