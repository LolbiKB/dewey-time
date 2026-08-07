import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signalText } from '@/lib/signal'
import { cn } from '@/lib/utils'
import { nextDraft } from './fleet-standard-draft'

/**
 * The one value on the page.
 *
 * What you save here IS the fleet standard, IS what a try sends, and IS what
 * Apply pushes. The previous version had a separate experiment box and had to
 * apologise in copy — "Applies the stored fleet value, not the box above" —
 * which meant an operator could prove one value and push another.
 *
 * The input is deliberately a plain text box. Nothing in this codebase
 * establishes what a `Language` or `DtFmt` value MEANS, and a picker asserting
 * otherwise would be a confident guess rendered as fact.
 */
export function FleetStandardField({
  optionKey, hint, stored, updatedBy, updatedAt, saving, onSave,
}: {
  optionKey: string
  hint: string
  stored: string | null
  updatedBy: string | null
  updatedAt: string | null
  saving: boolean
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(stored ?? '')
  const [prevKey, setPrevKey] = useState(optionKey)
  const [prevStored, setPrevStored] = useState(stored)

  // Derived state during render (React's documented pattern for "adjust
  // state when a prop changes"), not an effect: the page's selection lives
  // in the URL and this component is reused IN PLACE across a selection
  // change, so `useState(stored ?? '')` above only runs once, on first
  // mount. Without this, a draft typed for one key survives into the next
  // and can get saved against it. See fleet-standard-draft.ts for why a key
  // switch and a `stored` value moving under an unchanged key resolve
  // oppositely.
  if (prevKey !== optionKey || prevStored !== stored) {
    const resolved = nextDraft(prevKey, optionKey, draft, stored, prevStored)
    setPrevKey(optionKey)
    setPrevStored(stored)
    if (resolved !== draft) setDraft(resolved)
  }

  const changed = draft.trim() !== (stored ?? '').trim()

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`standard-${optionKey}`} className="text-xs text-muted-foreground">
            Fleet standard
          </Label>
          <Input
            id={`standard-${optionKey}`}
            className="h-8 w-28"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="value"
          />
        </div>
        <Button size="sm" variant="outline" className="h-8"
          disabled={saving || !changed || draft.trim() === ''} onClick={() => onSave(draft.trim())}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {stored == null ? (
        // The state behind the 400: the ladder can read `proven`, the button can
        // look live, and Apply still refuses because nothing is stored to push.
        <p className={cn('text-xs', signalText.attention)}>
          No fleet standard yet — Apply pushes the stored value, so save one first.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Stored: <span className="font-mono">{stored}</span>
          {updatedBy ? ` · set by ${updatedBy}` : ''}
          {updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ''}
        </p>
      )}

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
