import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeviceFactStrip, formatReportedAt } from './device-config-section'
import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * The per-device configuration summary.
 *
 * This card used to render the terminal's whole reported list — 78 rows inside
 * a modal tab. That is reference data in a container built for a summary, and
 * the comparison it was really serving (device vs device) could not be made
 * there at all. The full list moved to the fleet page; what stays is the four
 * facts that answer "what am I looking at".
 *
 * The load-bearing rule survives the move: a REDACTED option must never render
 * like an unset one. The bridge stores the key of every option a terminal
 * reports but the value only for allowlisted keys, because anything written is
 * also in every later backup. Showing a withheld credential as blank would tell
 * an admin the device is unconfigured when it is not.
 */
const opt = (key: string, value: string | null, redacted = false): DeviceOptionEntry => ({
  device_sn: 'PYA8254100003',
  key,
  value,
  redacted,
  reported_at: '2026-08-05T08:05:03.000Z',
})

const REAL = [
  opt('~DeviceName', 'SenseFace 4A'),
  opt('FWVersion', 'ZAM70-NF43VA-Ver3.3.13'),
  opt('IPAddress', '192.168.1.218'),
  opt('PushVersion', 'Ver 3.1.2S-20250616'),
]

describe('DeviceFactStrip', () => {
  test('renders the four facts from a real dump', () => {
    const html = renderToStaticMarkup(<DeviceFactStrip options={REAL} />)
    expect(html).toContain('SenseFace 4A')
    expect(html).toContain('ZAM70-NF43VA-Ver3.3.13')
    expect(html).toContain('192.168.1.218')
    expect(html).toContain('Ver 3.1.2S-20250616')
  })

  test('marks a withheld value as withheld, NOT as empty or unset', () => {
    const html = renderToStaticMarkup(
      <DeviceFactStrip options={[opt('IPAddress', null, true)]} />
    )
    expect(html).toContain('Not stored')
    for (const wrong of ['not set', 'unset', 'empty']) {
      expect(html.toLowerCase()).not.toContain(wrong)
    }
  })

  test('says a key was not reported rather than rendering a blank row', () => {
    const html = renderToStaticMarkup(<DeviceFactStrip options={[]} />)
    expect(html).toMatch(/not reported/i)
  })

  test('always lists every fact label, so an omission never reads as absent', () => {
    const html = renderToStaticMarkup(<DeviceFactStrip options={[]} />)
    for (const label of ['Model', 'Firmware', 'Network', 'Protocol']) {
      expect(html).toContain(label)
    }
  })

  test('is case-insensitive about firmware key casing', () => {
    // The bridge allowlist matches case-insensitively for the same reason:
    // firmware casing is not guaranteed across models.
    const html = renderToStaticMarkup(<DeviceFactStrip options={[opt('fwversion', '3.3.13')]} />)
    expect(html).toContain('3.3.13')
  })

  test('treats an empty string as not reported, not as a value', () => {
    // Ten keys in the real dump came back with no value at all.
    const html = renderToStaticMarkup(<DeviceFactStrip options={[opt('IPAddress', '')]} />)
    expect(html).toMatch(/not reported/i)
  })
})

describe('formatReportedAt', () => {
  test('never invents a date it does not have', () => {
    expect(formatReportedAt(null)).toBe('Never reported')
    expect(formatReportedAt(undefined)).toBe('Never reported')
    expect(formatReportedAt('not-a-date')).toBe('Never reported')
  })

  test('formats a real timestamp', () => {
    expect(formatReportedAt('2026-08-05T08:05:03.000Z')).not.toBe('Never reported')
  })
})
