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
import type { KeyPlan } from '@/lib/device-option-plan'
import { describeKeyStatus, describeLastError, type KeyStatus } from '@/components/devices/option-key-copy'
import type { OptionWriteRecord } from '@/services/device-service'
import { FleetStandardField } from './fleet-standard-field'
import { TerminalValuesTable } from './terminal-values-table'
import { WriteEvidence } from './write-evidence'

/** Badge tone per ladder rung — meaning, not decoration (see lib/signal.ts). */
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
 * them by `optionKey` either, which would throw that reset logic away.
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
  const [target, setTarget] = useState(plan.terminals[0]?.deviceSn ?? '')

  const refusal = applyRefusal({ status, canaryInFlight, plan })
  const canaryValue = plan.fleetStandard ?? ''
  const errorText = describeLastError(lastError)

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
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label={`Terminal to try ${optionKey} on`}>
            <SelectValue placeholder="Terminal" />
          </SelectTrigger>
          <SelectContent>
            {plan.terminals.map((t) => (
              <SelectItem key={t.deviceSn} value={t.deviceSn}>
                {deviceLabel(t.deviceSn, devices)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={pending || !target || canaryValue === ''}
          onClick={() => onCanary(target, canaryValue)}
        >
          Try {canaryValue || 'the standard'} on one terminal
        </Button>

        {refusal ? (
          <p className={cn('text-xs', signalText.idle)}>{refusal}</p>
        ) : (
          <Button size="sm" className="h-8" onClick={onApply}>
            Apply {plan.fleetStandard} to {plan.targetCount} terminal
            {plan.targetCount === 1 ? '' : 's'}
          </Button>
        )}

        {pending && (
          <span className={cn('text-xs', signalText.attention)}>
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            Queued — it applies when that terminal next polls
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
