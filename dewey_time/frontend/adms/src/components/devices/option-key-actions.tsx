import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { signalText, signalAlert } from '@/lib/signal'
import { describeKeyStatus, describeLastError, type KeyStatus } from './option-key-copy'
import { cn } from '@/lib/utils'

/**
 * The write controls for one option key.
 *
 * PRESENTATIONAL ONLY — the caller owns the query and the mutations. That keeps
 * it renderable without a QueryClientProvider, which is what makes it testable
 * under this package's `renderToStaticMarkup`-only harness (there is no jsdom
 * here). It also keeps the cache-invalidation decision with the page that knows
 * which device rows went stale.
 *
 * NOTHING HERE IS A SECURITY CONTROL. Every refusal it draws is enforced by the
 * bridge, and a direct POST is refused whatever this renders. What it can do is
 * LIE — offer an action the server will refuse, or report a queued command as a
 * finished one — and both of those are what the rules below exist to prevent:
 *
 *   A ZKTeco terminal applies configuration when it NEXT POLLS. There is no
 *   synchronous success to report. Any word like "applied" or "done" is false
 *   for at least one poll cycle, and an operator who believes it walks away from
 *   a fleet that has not changed.
 *
 *   `proven` means ONE terminal accepted this key ONCE. It says nothing about
 *   the rest of the fleet, so the copy must not imply it does.
 *
 *   The canary stays available even when the key reads `unsupported`. The ladder
 *   is per-KEY while the evidence is per-(key, value), so that status also
 *   covers a key that is demonstrably writable and was refused for one value —
 *   canarying a different value is the only way back, and hiding the control
 *   would strand the key permanently.
 */

export interface OptionKeyActionsProps {
  status: KeyStatus
  optionKey: string
  /** Approved terminals a canary may target. */
  devices: string[]
  lastError?: string | null
  /** A write for this key is queued and not yet answered. */
  pending?: boolean
  /**
   * A CANARY for this key is queued and not yet answered.
   *
   * Distinct from `pending`, and it comes from the bridge rather than being
   * inferred here: the ladder still reports `proven` throughout this window
   * (a pending canary is deliberately no evidence), while the apply endpoint
   * refuses with 409 for up to thirty minutes. Without this the page would
   * offer an action the server has already decided to reject.
   */
  canaryInFlight?: boolean
  onCanary: (deviceSn: string, value: string) => void
  /**
   * NO VALUE ARGUMENT. The apply endpoint ignores its body by design — what
   * gets pushed is whatever is stored as the desired value. Accepting one here
   * would let the page show the operator V while the bridge sends W, and the
   * drift view would then disagree with what was just applied.
   */
  onApply: () => void
}

export function OptionKeyActions({
  status,
  optionKey,
  devices,
  lastError,
  pending,
  canaryInFlight,
  onCanary,
  onApply,
}: OptionKeyActionsProps) {
  const [target, setTarget] = useState(devices[0] ?? '')
  const [value, setValue] = useState('')

  const errorText = describeLastError(lastError)
  const canApply = status === 'proven' && !canaryInFlight && devices.length > 0 && !pending

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={cn(status === 'proven' ? signalText.success : signalText.idle)}>
          {status === 'proven' && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
          {describeKeyStatus(status)}
        </span>
        {pending && (
          <span className={cn('whitespace-nowrap', signalText.attention)}>
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            Queued — verifying on next poll
          </span>
        )}
      </div>

      {errorText && (
        <div className={cn('rounded-md p-2 text-xs', signalAlert.attention)}>
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          {errorText}
        </div>
      )}

      {devices.length === 0 ? (
        <p className={cn('text-xs', signalText.idle)}>
          No approved terminal to write to.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={`Terminal to try ${optionKey} on`}
            >
              {devices.map((sn) => (
                <option key={sn} value={sn}>
                  {sn}
                </option>
              ))}
            </select>
            <Input
              className="h-8 w-28 text-xs"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="value"
              aria-label={`New value for ${optionKey}`}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={pending || !target || value === ''}
              onClick={() => onCanary(target, value)}
            >
              Try on one terminal
            </Button>
          </div>

          {canApply ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={onApply}
            >
              Apply to all terminals
            </Button>
          ) : status === 'proven' && canaryInFlight ? (
            <p className={cn('text-xs', signalText.idle)}>
              Waiting for a terminal to answer the last try — the fleet write stays closed until it
              does.
            </p>
          ) : null}

          {status === 'proven' && (
            <p className={cn('text-xs', signalText.idle)}>
              Applies the stored fleet value, not the box above.
            </p>
          )}
        </>
      )}
    </div>
  )
}
