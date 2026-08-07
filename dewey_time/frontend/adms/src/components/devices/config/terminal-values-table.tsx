import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { signalText } from '@/lib/signal'
import { cn } from '@/lib/utils'
import { deviceLabel } from '@/lib/device-option-matrix'
import type { TerminalPlan, TerminalVerdict } from '@/lib/device-option-plan'

/** One phrase per verdict. Each distinction here is one the fleet page exists to keep. */
function verdictLabel(t: TerminalPlan): { text: string; tone: string } {
  const map: Record<TerminalVerdict, { text: string; tone: string }> = {
    matches: { text: t.isOverride ? 'matches its override' : 'matches', tone: signalText.success },
    'will-change': { text: `will change → ${t.effective ?? ''}`, tone: signalText.attention },
    // Absence is not disagreement, so this must not say "will change" or read
    // as a mismatch — but `wouldBeWritten` (device-option-plan.ts) only
    // excludes the `matches` verdict, so a not-reported terminal with an
    // effective value IS one of `KeyPlan.targetCount`'s targets and IS
    // written to by the bridge's `selectApplyTargets`. The idle tone would
    // read as "nothing happens here" while the Apply button's count already
    // includes this row — the count and the table must agree, so this gets
    // the attention tone, not idle.
    'not-reported': { text: 'not reported — will be written', tone: signalText.attention },
    // Unknown is not different.
    withheld: { text: 'withheld — cannot compare', tone: signalText.idle },
    'no-standard': { text: 'no value stored', tone: signalText.idle },
  }
  return map[t.verdict]
}

export function TerminalValuesTable({
  terminals, devices, optionKey, onOverride, onClearOverride,
}: {
  terminals: TerminalPlan[]
  devices: { serial_number: string; name?: string | null; location?: string | null }[]
  optionKey: string
  onOverride: (deviceSn: string, value: string) => void
  onClearOverride: (deviceSn: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Terminal</TableHead>
          <TableHead>Reports</TableHead>
          <TableHead>Then</TableHead>
          <TableHead className="w-px" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {terminals.map((t) => {
          const { text, tone } = verdictLabel(t)
          return (
            <TableRow key={t.deviceSn}>
              <TableCell>
                <span className="block text-sm">{deviceLabel(t.deviceSn, devices)}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">{t.deviceSn}</span>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {t.redacted ? (
                  <span className={signalText.idle}>Withheld</span>
                ) : t.reported == null ? (
                  <span className={signalText.idle}>—</span>
                ) : (
                  t.reported
                )}
              </TableCell>
              <TableCell className={cn('text-xs', tone)}>
                {text}
                {t.isOverride && (
                  <span className={cn('ml-1 font-mono', signalText.idle)}>
                    (override {t.effective})
                  </span>
                )}
              </TableCell>
              <TableCell>
                {editing === t.deviceSn ? (
                  <span className="flex items-center gap-1.5">
                    <Input className="h-8 w-20 text-xs" value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label={`Override ${optionKey} on ${t.deviceSn}`} />
                    <Button size="sm" variant="outline" className="h-8" disabled={draft.trim() === ''}
                      onClick={() => { onOverride(t.deviceSn, draft.trim()); setEditing(null) }}>
                      Save
                    </Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" className="h-8 text-xs"
                      onClick={() => { setEditing(t.deviceSn); setDraft(t.effective ?? '') }}>
                      Override
                    </Button>
                    {t.isOverride && (
                      // Only where there is one. Setting an override back to the
                      // fleet value is not an undo — the row survives and keeps
                      // pinning this terminal past the next change of standard.
                      <Button size="sm" variant="ghost" className="h-8 text-xs"
                        onClick={() => onClearOverride(t.deviceSn)}>
                        Clear
                      </Button>
                    )}
                  </span>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
