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
        onConfigure={() => {}} open={null} onOpen={() => {}} />
    )
    const flash = html.slice(html.indexOf('FlashSize'), html.indexOf('MAC'))
    expect(flash).toMatch(/configure/i)
    expect(html.slice(html.indexOf('MAC'))).not.toMatch(/configure/i)
  })

  test('does not claim agreement about a value every terminal withholds', () => {
    // groupRowValues buckets every withheld cell together, same as it would
    // a value every terminal genuinely agreed on — so a naive "one group
    // means agreement" reading renders "all 2 agree · Withheld", asserting
    // something about a value nobody can see. authKey is withheld on every
    // device by construction (device-option-matrix.ts), so this row is
    // guaranteed to appear on every real fleet, not a hypothetical.
    const withheldRow: MatrixRow[] = [
      { key: 'authKey', kind: 'setting', verdict: 'unknown',
        cells: {
          A: { present: true, redacted: true, value: null },
          B: { present: true, redacted: true, value: null },
        } },
    ]
    const html = renderToStaticMarkup(
      <AllKeysReference rows={withheldRow} reportingDevices={['A', 'B']} search=""
        onSearch={() => {}} onConfigure={() => {}} open={null} onOpen={() => {}} />
    )
    expect(html).not.toMatch(/agree/i)
    expect(html).toMatch(/withheld on all 2/i)
  })

  test('does not claim agreement about a key no terminal reported', () => {
    // The same fabricated-agreement risk on the absent side: a key nobody
    // sent also collapses to one group, and absent must not read as
    // "withheld" or as "agree" — it is its own, third thing.
    const absentRow: MatrixRow[] = [
      { key: 'GhostKey', kind: 'setting', verdict: 'unknown',
        cells: {
          A: { present: false, redacted: false, value: null },
          B: { present: false, redacted: false, value: null },
        } },
    ]
    const html = renderToStaticMarkup(
      <AllKeysReference rows={absentRow} reportingDevices={['A', 'B']} search=""
        onSearch={() => {}} onConfigure={() => {}} open={null} onOpen={() => {}} />
    )
    expect(html).not.toMatch(/agree/i)
    expect(html).not.toMatch(/withheld/i)
    expect(html).toMatch(/not reported by any of 2/i)
  })

  test('opening a row keeps withheld and absent distinct in the per-terminal expansion', () => {
    const mixedRow: MatrixRow[] = [
      { key: 'Mixed', kind: 'setting', verdict: 'missing',
        cells: {
          A: { present: true, redacted: true, value: null },
          B: { present: false, redacted: false, value: null },
        } },
    ]
    const html = renderToStaticMarkup(
      <AllKeysReference rows={mixedRow} reportingDevices={['A', 'B']} search=""
        onSearch={() => {}} onConfigure={() => {}} open="Mixed" onOpen={() => {}} />
    )
    // Anchored per device: "A" and "B" both appear as row labels elsewhere
    // (the fleet-summary column also mentions counts), so each terminal's
    // value is read from the slice between its own serial and the next one.
    const aStart = html.indexOf('>A<')
    const bStart = html.indexOf('>B<')
    expect(html.slice(aStart, bStart)).toContain('Withheld')
    expect(html.slice(bStart)).toContain('Not reported')
  })

  test('a closed row shows no per-terminal expansion', () => {
    const mixedRow: MatrixRow[] = [
      { key: 'Mixed', kind: 'setting', verdict: 'missing',
        cells: {
          A: { present: true, redacted: true, value: null },
          B: { present: false, redacted: false, value: null },
        } },
    ]
    const html = renderToStaticMarkup(
      <AllKeysReference rows={mixedRow} reportingDevices={['A', 'B']} search=""
        onSearch={() => {}} onConfigure={() => {}} open={null} onOpen={() => {}} />
    )
    expect(html).not.toContain('>A<')
    expect(html).not.toContain('>B<')
  })

  test('an empty row set blames no filter, since the operator has not searched', () => {
    const html = renderToStaticMarkup(
      <AllKeysReference rows={[]} reportingDevices={[]} search="" onSearch={() => {}}
        onConfigure={() => {}} open={null} onOpen={() => {}} />
    )
    expect(html).toMatch(/no terminal has reported/i)
    expect(html).not.toMatch(/matches that filter/i)
  })

  test('a search with no matches blames the filter, not the fleet', () => {
    const html = renderToStaticMarkup(
      <AllKeysReference rows={rows} reportingDevices={['A']} search="doesnotexist"
        onSearch={() => {}} onConfigure={() => {}} open={null} onOpen={() => {}} />
    )
    expect(html).toMatch(/no key matches that filter/i)
  })
})
