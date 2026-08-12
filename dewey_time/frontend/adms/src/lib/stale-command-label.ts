/**
 * What to say about a command that has been sitting longer than the freshness
 * window, given only what the row actually establishes.
 *
 * The modal used to print the literal `'waiting for device ACK'` whenever
 * `error_message` was null — with no regard for whether the command had ever
 * been sent. Command #7215 on 2026-08-12 was `pending` with `sent_at` null, in
 * the queue of a terminal that had been offline for five days, and the UI
 * reported it as a device that had taken the command and gone quiet. That is
 * the same defect class the rest of this dashboard keeps hitting: a surface
 * asserting something it has not established. `pending` and `sent` are
 * different facts and must read differently.
 */

/** A biometric template push — the payload, not the envelope. */
export function isFingerprintTemplatePush(cmd: string | undefined | null): boolean {
  if (!cmd) return false
  const body = cmd.replace(/^C:\d+:/, '')
  return body.includes('DATA UPDATE') && (body.includes('FINGERTMP') || body.includes('FACE'))
}

export function describeStaleCommand(cmd: {
  status: string
  command?: string | null
  error_message?: string | null
}): string {
  // The device's own words are the most specific thing anyone has.
  if (cmd.error_message) return cmd.error_message

  // Never sent: the bridge is holding it, so nothing can be owed an ACK. This
  // is checked BEFORE the template branch — "pushing template to device" would
  // be just as untrue about a command no device has collected.
  if (cmd.status !== 'sent') return 'queued — the device has not polled yet'

  if (isFingerprintTemplatePush(cmd.command)) return 'pushing template to device'
  return 'waiting for device ACK'
}
