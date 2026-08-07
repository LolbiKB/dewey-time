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
  if (status !== 'proven') {
    return 'No terminal has accepted this key yet. Try it on one terminal first.'
  }
  if (canaryInFlight) {
    return 'A try is still waiting for a terminal to answer. Its verdict is what decides whether this value is safe to push.'
  }
  if (plan.targetCount === 0) {
    return 'Every terminal already reports this value.'
  }
  return null
}
