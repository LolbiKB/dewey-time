import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeviceConfigPanel, formatReportedAt } from './device-config-section'
import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * The terminal-reported configuration panel.
 *
 * Presentational only — the caller owns the query and the mutations, which is
 * what keeps this renderable without a QueryClientProvider and therefore
 * testable under this package's renderToStaticMarkup-only harness.
 *
 * The load-bearing rule: a REDACTED option must never render like an unset one.
 * The bridge stores the key of every option a terminal reports but the value
 * only for allowlisted keys, because anything written to device_option_observed
 * is also in every later backup. Showing a withheld credential as "not set"
 * would tell an admin the device is unconfigured when it is not.
 */
const opt = (over: Partial<DeviceOptionEntry> = {}): DeviceOptionEntry => ({
  device_sn: 'PYA8254100003',
  key: '~ZKFPVersion',
  value: '10',
  redacted: false,
  reported_at: '2026-08-05T02:00:00.000Z',
  ...over,
})

describe('DeviceConfigPanel', () => {
  test('says nothing has been reported yet when the list is empty', () => {
    const html = renderToStaticMarkup(<DeviceConfigPanel options={[]} />)
    expect(html).toMatch(/not reported|no configuration|never/i)
  })

  test('renders a stored key and its value', () => {
    const html = renderToStaticMarkup(<DeviceConfigPanel options={[opt()]} />)
    expect(html).toContain('~ZKFPVersion')
    expect(html).toContain('10')
  })

  test('marks a withheld value as withheld, NOT as empty or unset', () => {
    const html = renderToStaticMarkup(
      <DeviceConfigPanel options={[opt({ key: 'ComKey', value: null, redacted: true })]} />
    )
    expect(html).toContain('ComKey')
    expect(html).toMatch(/not stored|withheld/i)
    // The failure this guards: presenting a withheld credential as an option
    // the device has not configured.
    expect(html).not.toMatch(/not set|unset|empty/i)
  })

  test('explains WHY a value was withheld, so the state is actionable', () => {
    const html = renderToStaticMarkup(
      <DeviceConfigPanel options={[opt({ key: 'ComKey', value: null, redacted: true })]} />
    )
    expect(html).toMatch(/allowlist|not yet reviewed|review/i)
  })

  test('never renders a null value as the string "null"', () => {
    const html = renderToStaticMarkup(
      <DeviceConfigPanel options={[opt({ key: 'ComKey', value: null, redacted: true })]} />
    )
    expect(html).not.toMatch(/>null</)
  })

  test('shows both stored and withheld options together', () => {
    const html = renderToStaticMarkup(
      <DeviceConfigPanel
        options={[opt(), opt({ key: 'ComKey', value: null, redacted: true })]}
      />
    )
    expect(html).toContain('~ZKFPVersion')
    expect(html).toContain('ComKey')
  })

  test('counts how many values are withheld, so the scale is visible', () => {
    const html = renderToStaticMarkup(
      <DeviceConfigPanel
        options={[
          opt(),
          opt({ key: 'A', value: null, redacted: true }),
          opt({ key: 'B', value: null, redacted: true }),
        ]}
      />
    )
    expect(html).toMatch(/2/)
  })
})

describe('formatReportedAt', () => {
  test('says never for a missing timestamp rather than printing a bad date', () => {
    expect(formatReportedAt(undefined)).toMatch(/never/i)
    expect(formatReportedAt(null)).toMatch(/never/i)
  })

  test('renders a real timestamp', () => {
    expect(formatReportedAt('2026-08-05T02:00:00.000Z')).not.toMatch(/never|invalid/i)
  })

  test('does not print "Invalid Date" for junk', () => {
    expect(formatReportedAt('not-a-date')).not.toMatch(/invalid date/i)
  })
})
