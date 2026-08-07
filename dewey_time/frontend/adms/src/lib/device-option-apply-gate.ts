import type { KeyStatus } from '@/components/devices/option-key-copy'
import type { KeyPlan } from './device-option-plan'

export interface ApplyGateInput {
  status: KeyStatus
  canaryInFlight: boolean
  plan: KeyPlan
}

/**
 * Why Apply is unavailable — or null when it is available.
 *
 * MIRRORS the bridge's four refusals so the page does not offer an action the
 * server has already decided to reject. IT ENFORCES NOTHING: a direct POST is
 * refused server-side whatever this returns, and if the two disagree the server
 * is right. Its only job is to turn a 400 or a 409 into a sentence you can read
 * before you click.
 *
 * The order is the order of usefulness, not of severity. A fresh key trips the
 * first two at once, and "set a standard" is the step that unblocks the other.
 */
export function applyRefusal({ status, canaryInFlight, plan }: ApplyGateInput): string | null {
  const nothingStored = plan.fleetStandard == null && !plan.terminals.some((t) => t.isOverride)
  if (nothingStored) {
    return 'Set a fleet standard first — Apply pushes the stored value, and there is not one yet.'
  }
  if (status === 'unsupported') {
    // THE LADDER IS PER-KEY; THE EVIDENCE IS PER-(KEY, VALUE) — mirrors
    // assertApplyAllowed. A refusal can retract an earlier proof, so `unsupported`
    // also covers a key that is demonstrably writable and was refused for ONE
    // value. The way back is trying a DIFFERENT value on one terminal, not
    // repeating the one that was already refused, and not "never tried".
    return `${plan.key} was refused the last time it was tried on a terminal. Try a different value on one terminal — if that is refused too, the firmware does not support this key.`
  }
  if (status !== 'proven') {
    return 'No terminal has accepted this key yet. Try it on one terminal first.'
  }
  if (canaryInFlight) {
    return 'A try is still waiting for a terminal to answer. Its verdict is what decides whether this value is safe to push.'
  }
  if (plan.targetCount === 0) {
    return zeroTargetRefusal(plan)
  }
  return null
}

/**
 * Zero targets has three causes on the bridge (handleDeviceOptionApply,
 * admin-devices.ts, ~line 1177) and they are not the same answer:
 *
 *  - every comparable terminal matches, nothing withheld → agreement
 *  - some matched, some withheld → agreement cannot be CONFIRMED for those
 *  - not one terminal's value could be read at all → a distinct, 409 outcome
 *
 * Flattening all three into "every terminal already reports this value" would
 * assert something the last two do not support.
 */
function zeroTargetRefusal(plan: KeyPlan): string {
  const matched = plan.terminals.filter((t) => t.verdict === 'matches')
  const unverifiable = plan.terminals.filter((t) => t.verdict === 'withheld')

  if (matched.length === 0) {
    return `No terminal's current ${plan.key} is recorded, so the bridge cannot tell which terminals disagree. Review the key, or write it one terminal at a time.`
  }
  if (unverifiable.length > 0) {
    return `Every terminal that can be checked already reports this value; ${unverifiable.length} withheld this value, so agreement cannot be confirmed.`
  }
  return 'Every terminal already reports this value.'
}
