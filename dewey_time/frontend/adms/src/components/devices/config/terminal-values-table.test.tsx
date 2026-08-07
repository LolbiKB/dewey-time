import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TerminalValuesTable } from './terminal-values-table'
import type { TerminalPlan } from '@/lib/device-option-plan'

const DEVICES = [{ serial_number: 'A', name: 'DIU', location: 'DIU' }]

function plan(over: Partial<TerminalPlan> = {}): TerminalPlan {
  return { deviceSn: 'A', reported: '50', redacted: false, effective: '50',
    isOverride: false, verdict: 'matches', ...over }
}

describe('TerminalValuesTable', () => {
  test('leads with the name and keeps the serial as a subtitle', () => {
    // Operators know these boxes by where they are; PYA8261900038 and
    // PYA8261900039 differ in one character.
    const html = renderToStaticMarkup(
      <TerminalValuesTable terminals={[plan()]} devices={DEVICES} optionKey="VOLUME"
        onOverride={() => {}} onClearOverride={() => {}} />
    )
    expect(html).toContain('DIU')
    expect(html).toContain('A')
  })

  test('renders a withheld value as withheld, not as blank', () => {
    const html = renderToStaticMarkup(
      <TerminalValuesTable terminals={[plan({ reported: null, redacted: true, verdict: 'withheld' })]}
        devices={DEVICES} optionKey="VOLUME" onOverride={() => {}} onClearOverride={() => {}} />
    )
    expect(html).toMatch(/withheld/i)
  })

  test('distinguishes never-reported from disagreeing', () => {
    const html = renderToStaticMarkup(
      <TerminalValuesTable terminals={[plan({ reported: null, verdict: 'not-reported' })]}
        devices={DEVICES} optionKey="VOLUME" onOverride={() => {}} onClearOverride={() => {}} />
    )
    expect(html).toMatch(/not reported/i)
    expect(html).not.toMatch(/will change/i)
  })

  /**
   * CORRECTION to the original brief (post-review): `not-reported` is a
   * TARGET, not a no-op. `wouldBeWritten` in device-option-plan.ts only
   * excludes the `matches` verdict, so a not-reported terminal with an
   * effective value is counted in `KeyPlan.targetCount` and is written to by
   * the bridge's `selectApplyTargets`. Rendering it in the idle tone would
   * read as "nothing happens here" while the Apply button's count already
   * includes this row — the count on the button and the table below it must
   * agree, or the operator has no way to reconcile "3 terminals" with a table
   * that only shows two changing. Absence is still not disagreement (no
   * "will change" wording, no mismatch styling), but it must not read as
   * idle either.
   */
  test('marks a not-reported terminal with the attention tone, because it will be written to', () => {
    const html = renderToStaticMarkup(
      <TerminalValuesTable terminals={[plan({ reported: null, verdict: 'not-reported' })]}
        devices={DEVICES} optionKey="VOLUME" onOverride={() => {}} onClearOverride={() => {}} />
    )
    expect(html).toMatch(/class="[^"]*text-attention[^"]*"[^>]*>[^<]*not reported/i)
    expect(html).not.toMatch(/class="[^"]*text-muted-foreground[^"]*"[^>]*>[^<]*not reported/i)
  })

  test('offers a clear only where an override exists', () => {
    const withOverride = renderToStaticMarkup(
      <TerminalValuesTable terminals={[plan({ isOverride: true, effective: '20', reported: '20' })]}
        devices={DEVICES} optionKey="VOLUME" onOverride={() => {}} onClearOverride={() => {}} />
    )
    const without = renderToStaticMarkup(
      <TerminalValuesTable terminals={[plan()]} devices={DEVICES} optionKey="VOLUME"
        onOverride={() => {}} onClearOverride={() => {}} />
    )
    expect(withOverride).toMatch(/clear/i)
    expect(without).not.toMatch(/clear/i)
  })
})
