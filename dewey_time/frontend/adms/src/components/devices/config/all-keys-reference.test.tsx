import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AllKeysReference } from './all-keys-reference'
import type { MatrixRow } from '@/lib/device-option-matrix'

const rows: MatrixRow[] = [
  { key: 'FlashSize', kind: 'setting', verdict: 'agree',
    cells: { A: { present: true, redacted: false, value: '512' } } },
  { key: 'MAC', kind: 'identity', verdict: 'per-device',
    cells: { A: { present: true, redacted: false, value: '00:17' } } },
]

describe('AllKeysReference', () => {
  test('offers Configure only on keys the bridge calls a setting', () => {
    // A control on MAC is an action that cannot succeed — the bridge refuses
    // identity keys, so offering it would be the page lying about what it can do.
    const html = renderToStaticMarkup(
      <AllKeysReference rows={rows} reportingDevices={['A']} search="" onSearch={() => {}}
        onConfigure={() => {}} />
    )
    const flash = html.slice(html.indexOf('FlashSize'), html.indexOf('MAC'))
    expect(flash).toMatch(/configure/i)
    expect(html.slice(html.indexOf('MAC'))).not.toMatch(/configure/i)
  })
})
