import { signalText } from '@/lib/signal'
import { cn } from '@/lib/utils'
import type { Selection } from '@/lib/device-option-catalogue'

export interface SettingListEntry {
  key: string
  label: string
  /** One phrase about the fleet: "3 differ" / "all agree" / "not reported". */
  summary: string
  drifting: boolean
}

/**
 * The left rail — and the audit view.
 *
 * Fleet agreement is visible per setting without a click, which is what keeps
 * a configure-first page from costing the drift report. The two reference
 * entries sit below a rule because they are not settings.
 */
export function SettingList({
  entries, driftCount, totalKeys, selected, onSelect,
}: {
  entries: SettingListEntry[]
  /** Drifting keys OUTSIDE the curated set. Zero hides the entry entirely. */
  driftCount: number
  totalKeys: number
  selected: Selection
  onSelect: (s: Selection) => void
}) {
  const isOn = (s: Selection) =>
    s.kind === selected.kind && (s.kind !== 'key' || s.key === (selected as { key: string }).key)

  const selectionKey = (s: Selection) => (s.kind === 'key' ? `key:${s.key}` : s.kind)

  const row = (s: Selection, main: React.ReactNode, sub: React.ReactNode) => (
    <button
      key={selectionKey(s)}
      type="button"
      onClick={() => onSelect(s)}
      aria-current={isOn(s) || undefined}
      className={cn(
        'w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/40',
        isOn(s) && 'bg-muted font-medium'
      )}
    >
      {main}
      {sub}
    </button>
  )

  return (
    <nav className="flex flex-col" aria-label="Settings">
      {entries.map((e) =>
        row(
          { kind: 'key', key: e.key },
          <span className="block text-sm">{e.label}</span>,
          <span className="block font-mono text-[11px] text-muted-foreground">
            {e.key}
            <span className={cn('ml-2', e.drifting ? signalText.attention : signalText.success)}>
              {e.summary}
            </span>
          </span>
        )
      )}

      <div className="my-1 border-t border-border" />

      {driftCount > 0 &&
        row(
          { kind: 'drift' },
          <span className="block text-sm">Unexpected differences</span>,
          <span className={cn('block text-[11px]', signalText.attention)}>
            {driftCount} key{driftCount === 1 ? '' : 's'} outside these settings
          </span>
        )}

      {row(
        { kind: 'all' },
        <span className="block text-sm">Everything reported</span>,
        <span className="block text-[11px] text-muted-foreground">
          {totalKeys} keys · read-only unless you configure one
        </span>
      )}
    </nav>
  )
}
