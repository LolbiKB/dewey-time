import { describeLastError } from '@/components/devices/option-key-copy'
import type { OptionWriteRecord } from '@/services/device-service'

/**
 * One row of the write ledger, as a line an operator can read.
 *
 * The ladder is a VERDICT; this is the working. `mismatched` (every command
 * succeeded and the terminal still reports the old value) and `rejected` (the
 * terminal said no, and its code says why) are different problems with
 * different fixes, and the ladder cannot tell them apart.
 */
export interface EvidenceLine {
  when: string
  what: string
  outcome: string
  /** Null when the write is unresolved or the timestamps do not parse. Never fabricated. */
  elapsed: string | null
  detail: string | null
}

function describeOutcome(status: string): string {
  switch (status) {
    case 'applied':
      return 'applied'
    case 'mismatched':
      // Every command succeeded; the value simply is not there.
      return 'did not stick'
    case 'rejected':
      return 'refused by the terminal'
    case 'abandoned':
      return 'no answer'
    case 'pending':
      // Not a failure and not a success — it has not happened yet.
      return 'waiting for the terminal'
    default:
      return status
  }
}

/** Elapsed time, or null. A missing or unparsable pair yields nothing, never 0. */
function elapsedLabel(createdAt: string, resolvedAt: string | null): string | null {
  if (!resolvedAt) return null
  const start = Date.parse(createdAt)
  const end = Date.parse(resolvedAt)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  const seconds = Math.round((end - start) / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function toEvidenceLine(record: OptionWriteRecord): EvidenceLine {
  const stamp = Date.parse(record.created_at)
  return {
    when: Number.isNaN(stamp) ? record.created_at : new Date(stamp).toLocaleString(),
    what: `${record.desired_value} on ${record.device_sn}${record.is_canary ? ' (try)' : ''}`,
    outcome: describeOutcome(record.status),
    elapsed: elapsedLabel(record.created_at, record.resolved_at),
    // describeLastError already draws the line between a device refusal and a
    // command that never arrived — reused rather than restated.
    detail:
      describeLastError(record.error_code) ??
      (record.status === 'mismatched' && record.observed_value != null
        ? `The terminal still reports ${record.observed_value}`
        : null),
  }
}
