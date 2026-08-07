import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { signalText, signalAlert, signalBadge } from '@/lib/signal'
import { cn } from '@/lib/utils'
import { deviceLabel } from '@/lib/device-option-matrix'
import { applyRefusal } from '@/lib/device-option-apply-gate'
import { wouldBeWritten, type KeyPlan } from '@/lib/device-option-plan'
import { describeKeyStatus, describeLastError, type KeyStatus } from '@/components/devices/option-key-copy'
import type { OptionWriteRecord } from '@/services/device-service'
import { FleetStandardField } from './fleet-standard-field'
import { TerminalValuesTable } from './terminal-values-table'
import { WriteEvidence } from './write-evidence'
import { nextCanaryTarget } from './setting-detail-target'

/** Badge tone per ladder rung — meaning, not decoration (see lib/signal.ts).
 *
 * `unsupported` gets the danger tone deliberately, not merely "not proven
 * yet": a terminal DID answer, and answered no (`device-detail-dialog.tsx`
 * maps its own rejected state to `signalBadge.danger` the same way).
 * Recoverability — a different value may still work — is carried by
 * `describeKeyStatus`'s words, not softened by the colour. */
const STATUS_TONE: Record<KeyStatus, string> = {
  proven: signalBadge.success,
  unsupported: signalBadge.danger,
  unproven: signalBadge.idle,
}

/**
 * The right-hand pane for one option key.
 *
 * PRESENTATIONAL ONLY — the caller owns every query and mutation, which is what
 * keeps this renderable without a QueryClientProvider under this package's
 * `renderToStaticMarkup`-only harness (there is no jsdom here).
 *
 * Composes the pieces built for this page: `FleetStandardField` (the one value),
 * `TerminalValuesTable` (what each terminal reports and would receive), and
 * `WriteEvidence` (the trail proving or disproving the ladder). Neither of the
 * first two is remounted on a key change — they already reset their own drafts
 * internally (see their own file comments) — so this component must not key
 * them by `optionKey` either, which would throw that reset logic away. The
 * CALLER owes this component the same courtesy: do not key `<SettingDetail>`
 * itself by `optionKey`. It carries its own in-place state (the canary
 * target, reconciled by `nextCanaryTarget` — see setting-detail-target.ts —
 * rather than reset), and a remount here would also discard the two
 * children's in-place reset logic one level up — the identical damage, just
 * relocated.
 *
 * D3, the design's central decision: what you SAVE is what a try sends and what
 * Apply pushes. There is no second, separate experiment box anywhere on this
 * pane — the canary always sends `plan.fleetStandard`.
 */
export function SettingDetail({
  optionKey,
  label,
  hint,
  plan,
  status,
  canaryInFlight,
  lastError,
  updatedBy,
  updatedAt,
  devices,
  writes,
  writesLoading,
  writesError,
  saving,
  pending,
  onSaveStandard,
  onOverride,
  onClearOverride,
  onCanary,
  onApply,
}: {
  optionKey: string
  label: string
  hint: string
  plan: KeyPlan
  status: KeyStatus
  canaryInFlight: boolean
  lastError: string | null
  updatedBy: string | null
  updatedAt: string | null
  devices: { serial_number: string; name?: string | null; location?: string | null }[]
  writes: OptionWriteRecord[]
  writesLoading: boolean
  writesError: Error | null
  saving: boolean
  pending: boolean
  onSaveStandard: (value: string) => void
  onOverride: (deviceSn: string, value: string) => void
  onClearOverride: (deviceSn: string) => void
  onCanary: (deviceSn: string, value: string) => void
  onApply: () => void
}) {
  const [target, setTarget] = useState('')
  // Derived state during render (see setting-detail-target.ts), not an
  // effect — same in-place-reuse reasoning as FleetStandardField and
  // TerminalValuesTable.
  const resolvedTarget = nextCanaryTarget(target, plan.terminals)
  if (resolvedTarget !== target) setTarget(resolvedTarget)

  const refusal = applyRefusal({ status, canaryInFlight, plan })
  const canaryValue = plan.fleetStandard ?? ''
  const canTry = !pending && resolvedTarget !== '' && canaryValue.trim() !== ''
  const errorText = describeLastError(lastError)

  // An Apply naming a single value promises that value lands everywhere it
  // writes. That is false the moment an OVERRIDE terminal is one of its
  // targets — that row gets its own value, not the fleet standard — and it
  // is unrenderable (not merely wrong) when there is no fleet standard at
  // all: `applyRefusal` allows Apply through on overrides alone
  // (device-option-apply-gate.ts), so `plan.fleetStandard` can be `null`
  // here while the button still has something true to say.
  const overrideIsTarget = plan.terminals.some((t) => t.isOverride && wouldBeWritten(t))
  const namesSingleValue = plan.fleetStandard != null && !overrideIsTarget
  const targetNoun = `${plan.targetCount} terminal${plan.targetCount === 1 ? '' : 's'}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">{label}</h2>
        <span className="font-mono text-xs text-muted-foreground">{optionKey}</span>
        <Badge variant="secondary" className={STATUS_TONE[status]}>
          {describeKeyStatus(status)}
        </Badge>
      </div>

      <FleetStandardField
        optionKey={optionKey}
        hint={hint}
        stored={plan.fleetStandard}
        updatedBy={updatedBy}
        updatedAt={updatedAt}
        saving={saving}
        onSave={onSaveStandard}
      />

      <TerminalValuesTable
        terminals={plan.terminals}
        devices={devices}
        optionKey={optionKey}
        onOverride={onOverride}
        onClearOverride={onClearOverride}
      />

      <div className="flex flex-wrap items-center gap-2">
        {plan.terminals.length === 0 ? (
          <p className={cn('text-xs', signalText.idle)}>No approved terminal to try this on.</p>
        ) : (
          <>
            <Select value={resolvedTarget} onValueChange={setTarget}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label={`Terminal to try ${optionKey} on`}>
                <SelectValue placeholder="Terminal" />
              </SelectTrigger>
              <SelectContent>
                {plan.terminals.map((t) => (
                  <SelectItem key={t.deviceSn} value={t.deviceSn}>
                    {deviceLabel(t.deviceSn, devices)}
                    {/* Named AND serial, never one or the other — two unnamed
                        terminals differ only in one character of their serial. */}
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                      {t.deviceSn}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!canTry}
              onClick={() => onCanary(resolvedTarget, canaryValue)}
            >
              Try {canaryValue.trim() || 'the standard'} on one terminal
            </Button>
          </>
        )}

        {refusal ? (
          <p className={cn('text-xs', signalText.idle)}>{refusal}</p>
        ) : (
          <Button size="sm" className="h-8" disabled={pending} onClick={onApply}>
            {namesSingleValue
              ? `Apply ${plan.fleetStandard} to ${targetNoun}`
              : `Apply the stored values to ${targetNoun}`}
          </Button>
        )}

        {pending && (
          <span className={cn('text-xs', signalText.attention)}>
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            {/* Not "that terminal" — a pending write here may be an Apply
                to several terminals, not just the last canary's target. */}
            Queued — verifying on next poll
          </span>
        )}
      </div>

      {errorText && (
        <div className={cn('rounded-md p-2 text-xs', signalAlert.attention)}>{errorText}</div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Evidence</p>
        <WriteEvidence records={writes} loading={writesLoading} error={writesError} />
      </div>
    </div>
  )
}
