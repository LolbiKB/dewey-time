/**
 * Whether the page may state anything about STORED configuration.
 *
 * The desired values and the write ladder come from one query
 * (`/admin/device-option-policy`). When it fails, `desired` falls back to `[]`
 * and the key state to nothing — and every claim built on that inverts into a
 * confident falsehood about the bridge's database:
 *
 *   "No fleet standard yet — Apply pushes the stored value, so save one first."
 *   invites an operator to overwrite a standard they simply could not see.
 *   The idle "Not written yet" badge denies proof that may exist. And with the
 *   write trail failing alongside it, the evidence panel honestly says it could
 *   not load the history directly beneath a badge asserting there is none.
 *
 * The bridge's own handler was hardened against exactly this, and its comment
 * says why: "'Nothing is configured' and 'the database did not answer' are not
 * the same page." An empty answer is a fact; a failed one is the absence of any
 * fact at all.
 *
 * DATA IN HAND WINS OVER A FAILED REFETCH. React Query keeps the last good
 * policy while a later poll errors — those values are real, merely possibly
 * stale, and the page's "could not refresh" alert is what covers them. Blanking
 * the pane then would throw away true information because a background poll
 * failed.
 */
export type PolicyAvailability =
  /** Nothing has arrived yet. Say nothing about stored state; show skeletons. */
  | 'loading'
  /** The read failed and nothing is in hand. Say why; claim nothing. */
  | 'unavailable'
  /** Values are in hand (possibly stale — the refresh alert covers that). */
  | 'available'

export function policyAvailability(input: {
  loading: boolean
  failed: boolean
  hasData: boolean
}): PolicyAvailability {
  if (input.hasData) return 'available'
  if (input.failed) return 'unavailable'
  // Nothing in hand and nothing wrong yet: the read is in flight, or about to
  // be. Either way nothing is KNOWN, which is not the same as knowing that
  // nothing is stored — that is a fact the bridge has to answer with.
  return 'loading'
}
