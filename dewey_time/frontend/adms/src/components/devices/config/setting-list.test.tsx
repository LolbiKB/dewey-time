import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingList } from './setting-list'

const ENTRIES = [
  { key: 'VOLUME', label: 'Speaker volume', summary: '3 differ', drifting: true },
  { key: 'Brightness', label: 'Screen brightness', summary: 'all agree', drifting: false },
]

describe('SettingList', () => {
  test('shows the key beside its label, never instead of it', () => {
    // The labels are our own naming. Hiding the key would turn a convenience
    // into a claim about the protocol.
    const html = renderToStaticMarkup(
      <SettingList entries={ENTRIES} driftCount={3} totalKeys={80}
        selected={{ kind: 'key', key: 'VOLUME' }} onSelect={() => {}} />
    )
    expect(html).toContain('Speaker volume')
    expect(html).toContain('VOLUME')
  })

  test('offers the two reference views with their counts', () => {
    const html = renderToStaticMarkup(
      <SettingList entries={ENTRIES} driftCount={3} totalKeys={80}
        selected={{ kind: 'key', key: 'VOLUME' }} onSelect={() => {}} />
    )
    expect(html).toMatch(/Unexpected differences/i)
    expect(html).toContain('80')
    // Both reference views, not just the drift one — the bare '80' above was
    // satisfied by either, so it did not actually pin "Everything reported".
    expect(html).toMatch(/Everything reported/i)
  })

  test('does not offer the drift view when nothing unexpected differs', () => {
    const html = renderToStaticMarkup(
      <SettingList entries={ENTRIES} driftCount={0} totalKeys={80}
        selected={{ kind: 'all' }} onSelect={() => {}} />
    )
    expect(html).not.toMatch(/Unexpected differences/i)
  })
})
