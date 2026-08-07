import { describe, test, expect } from 'vitest'
import { applyRefusal } from './device-option-apply-gate'
import type { KeyPlan } from './device-option-plan'

const READY: KeyPlan = {
  key: 'VOLUME',
  fleetStandard: '50',
  terminals: [
    { deviceSn: 'A', reported: '50', redacted: false, effective: '50', isOverride: false, verdict: 'matches' },
    { deviceSn: 'B', reported: '20', redacted: false, effective: '50', isOverride: false, verdict: 'will-change' },
  ],
  targetCount: 1,
}

describe('applyRefusal', () => {
  test('is null for a proven key, no canary in flight, and something to push', () => {
    expect(applyRefusal({ status: 'proven', canaryInFlight: false, plan: READY })).toBeNull()
  })

  test('refuses when no value is stored to push', () => {
    // The 400 an operator actually hits: the ladder says proven, the button
    // looks live, and the endpoint refuses because device_option_desired is
    // empty. Say so before the click.
    const plan = { ...READY, fleetStandard: null, targetCount: 0,
      terminals: READY.terminals.map((t) => ({ ...t, effective: null, isOverride: false, verdict: 'no-standard' as const })) }
    expect(applyRefusal({ status: 'proven', canaryInFlight: false, plan })).toMatch(/fleet standard first/i)
  })

  test('an override alone is enough to have something to push', () => {
    const plan = { ...READY, fleetStandard: null,
      terminals: [
        { ...READY.terminals[0], effective: '20', isOverride: true, verdict: 'will-change' as const },
        { ...READY.terminals[1], effective: null, isOverride: false, verdict: 'no-standard' as const },
      ],
      targetCount: 1 }
    expect(applyRefusal({ status: 'proven', canaryInFlight: false, plan })).toBeNull()
  })

  test('refuses an unproven key', () => {
    expect(applyRefusal({ status: 'unproven', canaryInFlight: false, plan: READY }))
      .toMatch(/try it on one terminal/i)
  })

  test('refuses a key that was refused, and names the recovery as a different value', () => {
    // `unsupported` is not "never tried" — a terminal DID answer, and answered
    // no. Collapsing it into the unproven message ("try it on one terminal
    // first") is false (a terminal already accepted a try) and hides the way
    // forward: canarying a DIFFERENT value, not repeating the refused one.
    const result = applyRefusal({ status: 'unsupported', canaryInFlight: false, plan: READY })
    expect(result).toMatch(/refused/i)
    expect(result).toMatch(/different value/i)
    expect(result).not.toMatch(/try it on one terminal/i)
  })

  test('refuses while a try is unanswered', () => {
    // The bridge answers 409 for up to thirty minutes here, while the ladder
    // still reads `proven` — a pending canary is deliberately no evidence.
    expect(applyRefusal({ status: 'proven', canaryInFlight: true, plan: READY }))
      .toMatch(/still waiting/i)
  })

  test('refuses when nothing would change', () => {
    expect(applyRefusal({ status: 'proven', canaryInFlight: false, plan: { ...READY, targetCount: 0 } }))
      .toMatch(/already report/i)
  })

  test('names the missing standard before complaining the key is unproven', () => {
    // Both are true for a fresh key. "Set a standard" is the step that unblocks
    // the other, so it is the sentence to lead with.
    const plan = { ...READY, fleetStandard: null, targetCount: 0,
      terminals: READY.terminals.map((t) => ({ ...t, effective: null, isOverride: false, verdict: 'no-standard' as const })) }
    expect(applyRefusal({ status: 'unproven', canaryInFlight: false, plan })).toMatch(/fleet standard first/i)
  })

  describe('zero targets — the bridge answers this three different ways', () => {
    test('some matched, some withheld: agreement cannot be confirmed for the withheld ones', () => {
      const plan: KeyPlan = { ...READY, targetCount: 0,
        terminals: [
          { deviceSn: 'A', reported: '50', redacted: false, effective: '50', isOverride: false, verdict: 'matches' },
          { deviceSn: 'B', reported: null, redacted: true, effective: '50', isOverride: false, verdict: 'withheld' },
        ] }
      const result = applyRefusal({ status: 'proven', canaryInFlight: false, plan })
      expect(result).toMatch(/1 withheld/i)
      expect(result).toMatch(/cannot be confirmed/i)
    })

    test('not one terminal is comparable: a distinct outcome from agreement', () => {
      const plan: KeyPlan = { ...READY, targetCount: 0,
        terminals: [
          { deviceSn: 'A', reported: null, redacted: true, effective: '50', isOverride: false, verdict: 'withheld' },
          { deviceSn: 'B', reported: null, redacted: true, effective: '50', isOverride: false, verdict: 'withheld' },
        ] }
      const result = applyRefusal({ status: 'proven', canaryInFlight: false, plan })
      expect(result).not.toMatch(/already report/i)
      expect(result).toMatch(/cannot tell which terminals disagree/i)
    })
  })
})
