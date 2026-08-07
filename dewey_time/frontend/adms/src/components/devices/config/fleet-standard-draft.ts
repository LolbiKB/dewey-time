/**
 * What the fleet-standard input should show after a render where `optionKey`
 * or `stored` may have moved since the previous one.
 *
 * `FleetStandardField` is reused IN PLACE across a selection change — the
 * page's selection lives in the URL and re-reads without a remount, so
 * `useState(stored ?? '')` only initialises the draft on the very first
 * mount. Left alone, switching from Speaker volume (stored `50`) to Screen
 * brightness (stored `3`) leaves `50` sitting in the box: `changed` flips
 * true with no operator action, Save enables itself, and clicking it stores
 * `50` as Brightness's fleet standard. Not the wrong terminal — the wrong
 * key. This function is the extracted decision, kept pure so it can be
 * pinned by a test — `renderToStaticMarkup` renders once and cannot exercise
 * a prop change on a live component instance.
 *
 * Two triggers, and they resolve OPPOSITELY:
 *
 *   The KEY changed. Whatever is in the box belongs to the OLD key — always
 *   drop it and start from the new key's stored value, regardless of
 *   whether the operator had typed something.
 *
 *   The key is the SAME but `stored` moved — another operator saved while
 *   this page was open, or the next poll picked up a fresher value. Follow
 *   it ONLY if the operator has not started typing (the draft still equals
 *   the stored value this component last rendered with). If they have typed
 *   something else, keep it: silently clobbering an in-progress edit because
 *   the stored value changed underneath it is worse than a `Stored:` line
 *   that briefly disagrees with the box — that line is still visible and
 *   the operator can act on it deliberately.
 */
export function nextDraft(
  prevKey: string,
  optionKey: string,
  currentDraft: string,
  stored: string | null,
  prevStored: string | null
): string {
  if (prevKey !== optionKey) return stored ?? ''

  if (prevStored !== stored) {
    const operatorHasNotTyped = currentDraft.trim() === (prevStored ?? '').trim()
    if (operatorHasNotTyped) return stored ?? ''
  }

  return currentDraft
}
