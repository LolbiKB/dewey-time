import { test, expect, describe } from 'vitest'
import { nextCanaryTarget } from './setting-detail-target'
import type { TerminalPlan } from '@/lib/device-option-plan'

const TERMINALS: TerminalPlan[] = [
  { deviceSn: 'A', reported: '50', redacted: false, effective: '50', isOverride: false, verdict: 'matches' },
  { deviceSn: 'B', reported: '20', redacted: false, effective: '50', isOverride: false, verdict: 'will-change' },
]

describe('nextCanaryTarget', () => {
  test('keeps the current target when it is still among the terminals', () => {
    expect(nextCanaryTarget('B', TERMINALS)).toBe('B')
  })

  test('picks the first terminal once terminals become available for an empty target', () => {
    // Covers the pane mounting before terminals arrive: `target` starts at
    // '', which matches no terminal, so this is the same branch as below.
    expect(nextCanaryTarget('', TERMINALS)).toBe('A')
  })

  test('resets when the current target is no longer among the terminals', () => {
    // Covers a terminal leaving the fleet mid-session: without this, the
    // Select would render blank (a controlled value matching no item) while
    // Try stayed enabled with no visible target.
    expect(nextCanaryTarget('Z', TERMINALS)).toBe('A')
  })

  test('falls back to empty when there are no terminals at all', () => {
    expect(nextCanaryTarget('A', [])).toBe('')
  })
})
