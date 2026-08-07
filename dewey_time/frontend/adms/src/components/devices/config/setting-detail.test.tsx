import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingDetail } from './setting-detail'
import type { KeyPlan } from '@/lib/device-option-plan'

const PLAN: KeyPlan = {
  key: 'VOLUME', fleetStandard: '50',
  terminals: [
    { deviceSn: 'A', reported: '50', redacted: false, effective: '50', isOverride: false, verdict: 'matches' },
    { deviceSn: 'B', reported: '20', redacted: false, effective: '50', isOverride: false, verdict: 'will-change' },
  ],
  targetCount: 1,
}

const props = {
  optionKey: 'VOLUME', label: 'Speaker volume', hint: '',
  plan: PLAN, status: 'proven' as const, canaryInFlight: false,
  lastError: null, updatedBy: null, updatedAt: null,
  devices: [{ serial_number: 'A' }, { serial_number: 'B' }],
  writes: [], writesLoading: false, writesError: null,
  saving: false, pending: false,
  onSaveStandard: () => {}, onOverride: () => {}, onClearOverride: () => {},
  onCanary: () => {}, onApply: () => {},
}

describe('SettingDetail', () => {
  test('never says a queued write was applied', () => {
    // A terminal applies configuration when it NEXT POLLS. Any word like
    // "applied" is false for at least one poll cycle, and an operator who
    // believes it walks away from a fleet that has not changed.
    const html = renderToStaticMarkup(<SettingDetail {...props} pending />)
    expect(html).toMatch(/queued/i)
    expect(html).not.toMatch(/\bapplied\b/i)
  })

  test('states why Apply is unavailable instead of just disabling it', () => {
    const html = renderToStaticMarkup(<SettingDetail {...props} status="unproven" />)
    expect(html).toMatch(/try it on one terminal/i)
  })

  test('offers Apply with the target count when nothing blocks it', () => {
    const html = renderToStaticMarkup(<SettingDetail {...props} />)
    expect(html).toMatch(/apply .*1 terminal/i)
  })

  test('does not imply proven says anything about the fleet', () => {
    const html = renderToStaticMarkup(<SettingDetail {...props} />)
    expect(html).toContain('A terminal has accepted this key')
  })

  test('shows the key beside its label', () => {
    const html = renderToStaticMarkup(<SettingDetail {...props} />)
    expect(html).toContain('Speaker volume')
    expect(html).toContain('VOLUME')
  })
})
