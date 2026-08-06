/**
 * The words the fleet-config write controls use.
 *
 * Split from the component so a change to the COPY is reviewable on its own —
 * and because every rule below is about not lying, which is exactly the kind of
 * thing that should be testable without rendering anything.
 */

export type KeyStatus = 'unproven' | 'proven' | 'unsupported'

export function describeKeyStatus(status: KeyStatus): string {
  switch (status) {
    case 'proven':
      // Deliberately not "applied" or anything fleet-shaped: one terminal
      // accepted it once, which is all this status claims.
      return 'A terminal has accepted this key'
    case 'unsupported':
      return 'A terminal refused this value'
    default:
      // Never tried is not the same as failed, so no failure words.
      return 'Not written yet — try it on one terminal first'
  }
}

/**
 * `lastError` is no longer always a device refusal.
 *
 * Abandoned writes carry `set_not_delivered` / `reload_not_delivered`, meaning
 * the command never reached the terminal. Wording those as a refusal blames the
 * hardware for a delivery failure and sends the operator to the wrong place —
 * they would go looking at firmware support for a key when the actual problem
 * was the command queue.
 *
 * Anything else is passed through verbatim. Device codes are the terminal's own
 * words and the only actionable part of a real refusal, so they are never
 * swallowed into prose.
 */
export function describeLastError(code: string | null | undefined): string | null {
  if (!code) return null
  if (code === 'set_not_delivered') {
    return 'The last write never reached the terminal, so nothing was learned about this key'
  }
  if (code === 'reload_not_delivered') {
    return 'The terminal took the write but never reloaded its configuration, so the read-back proved nothing'
  }
  return `The terminal answered ${code}`
}
