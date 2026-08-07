/**
 * The settings this page puts controls on.
 *
 * The bridge classifies an UNKNOWN key as `setting` — deliberately, so an
 * unclassified key that differs becomes a finding rather than being silently
 * hidden. The consequence is that 66 of the 80 keys four SenseFace 4A terminals
 * report are "settings", and about sixty of those are firmware capability flags
 * (`IsSupportNFC`, `~MaxUserCount`, `FlashSize`). Putting a write box on all of
 * them is how the previous version came to offer one for `FWVersion`.
 *
 * These five are the target set named in the Part 3a spec. Nothing else is
 * hidden: any key the bridge calls a `setting` can be configured from the
 * reference view, which opens the same detail pane. This list decides what is
 * PROMINENT, not what is permitted — the bridge decides that.
 *
 * The labels are our own naming, inferred from the key names. They are a
 * convenience and never a claim about the protocol, so the raw key is always
 * rendered beside its label rather than replaced by it.
 *
 * The hints say nothing about what a value MEANS — nothing here establishes
 * that `Language=69` is English — and they are worded in the PAST TENSE
 * deliberately. Each is a snapshot taken when this list was compiled, rendered
 * beside a live table of what the terminals report now. "Every terminal
 * reports 0" is a present-tense claim a hard-coded file cannot keep: the
 * moment one terminal changes, the hint contradicts the table three inches
 * below it, and the table is the one that is actually looking.
 */
export interface CuratedSetting {
  key: string
  label: string
  hint: string
}

export const CURATED_SETTINGS: readonly CuratedSetting[] = [
  {
    key: 'VOLUME',
    label: 'Speaker volume',
    hint: 'When this list was compiled, terminals here reported values between 20 and 60.',
  },
  {
    key: 'Brightness',
    label: 'Screen brightness',
    hint: 'When this list was compiled, every terminal reported 0.',
  },
  {
    key: 'Language',
    label: 'Language',
    hint: 'When this list was compiled, every terminal reported 69.',
  },
  {
    key: 'DtFmt',
    label: 'Date format',
    hint: 'When this list was compiled, every terminal reported 9.',
  },
  {
    key: '~DSTF',
    label: 'Daylight saving',
    hint: 'When this list was compiled, every terminal reported the same value.',
  },
]

/**
 * EXACT match, never case-insensitive.
 *
 * `classifyObservedWrite` on the bridge compares observed keys case-sensitively
 * — a case-insensitive match there manufactured proof from a different key.
 * Matching loosely here would label a key the writer treats as a distinct one.
 * Failing to curate is safe (the key is still reachable from the reference
 * list); mislabelling is not.
 */
export function curatedLabel(key: string): string | null {
  return CURATED_SETTINGS.find((s) => s.key === key)?.label ?? null
}

export function isCurated(key: string): boolean {
  return CURATED_SETTINGS.some((s) => s.key === key)
}

/** What the page is showing, parsed from the query string. */
export type Selection =
  | { kind: 'key'; key: string }
  | { kind: 'drift' }
  | { kind: 'all' }

/**
 * The selection lives in the URL so a poll, a reload, or a shared link does not
 * lose the operator's place — the page re-reads itself every 5s while a write
 * is outstanding, and local-only state would survive that but not a refresh.
 *
 * A key always wins: an unrecognised `view` falls back to the default setting
 * rather than rendering nothing, because a blank pane reads as "no data" when
 * the real problem is a typo in a link.
 */
export function parseSelection(key: string | null, view: string | null): Selection {
  const trimmed = key?.trim()
  if (trimmed) return { kind: 'key', key: trimmed }
  if (view === 'drift') return { kind: 'drift' }
  if (view === 'all') return { kind: 'all' }
  return { kind: 'key', key: CURATED_SETTINGS[0].key }
}
