import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DriftReport } from './drift-report'
import type { MatrixRow } from '@/lib/device-option-matrix'
import type { DeviceOptionEntry } from '@/services/device-service'

const DEVICES = [{ serial_number: 'A', name: 'DIU' }]

const rows: MatrixRow[] = [
  {
    key: 'VOLUME',
    kind: 'setting',
    verdict: 'differ',
    cells: {
      A: { present: true, redacted: false, value: '50' },
      B: { present: true, redacted: true, value: null },
      C: { present: false, redacted: false, value: null },
    },
  },
]

const entries: DeviceOptionEntry[] = [
  { device_sn: 'A', key: 'VOLUME', value: '50', redacted: false, reported_at: '2026-01-01', kind: 'setting' },
  { device_sn: 'A', key: 'authKey', value: null, redacted: true, reported_at: '2026-01-01', kind: 'setting' },
]

// Every device reports the SAME value, so the "Off majority" column for a
// silent terminal is exercised on its own, isolated from the absent-cell
// case above (which would also read "Not reported", but for a different
// reason — see the previous test).
const rowsAllAgree: MatrixRow[] = [
  {
    key: 'VOLUME',
    kind: 'setting',
    verdict: 'differ',
    cells: {
      A: { present: true, redacted: false, value: '50' },
      B: { present: true, redacted: false, value: '50' },
      C: { present: true, redacted: false, value: '50' },
    },
  },
]

describe('DriftReport', () => {
  test('a withheld cell reads Withheld, not blank', () => {
    // Anchored to the VOLUME column specifically, following the same caution
    // as TerminalValuesTable's test: "withheld" and "Not reported" both
    // appear elsewhere in this row (the Off majority column also says "Not
    // reported" for a silent terminal), so a bare substring match would pass
    // even if this cell regressed.
    const html = renderToStaticMarkup(
      <DriftReport rows={rows} deviceSns={['A', 'B', 'C']} entries={entries} silentDevices={['C']}
        devices={DEVICES} expanded={null} onExpand={() => {}} search="" onSearch={() => {}} />
    )
    const bRowStart = html.indexOf('>B<')
    const bRowEnd = html.indexOf('</tr>', bRowStart)
    expect(html.slice(bRowStart, bRowEnd)).toContain('Withheld')
  })

  test('an absent cell reads Not reported, not the same word choice as withheld', () => {
    const html = renderToStaticMarkup(
      <DriftReport rows={rows} deviceSns={['A', 'B', 'C']} entries={entries} silentDevices={[]}
        devices={DEVICES} expanded={null} onExpand={() => {}} search="" onSearch={() => {}} />
    )
    // C is a REPORTING device here (not in silentDevices) that simply never
    // sent VOLUME — distinct from a silent terminal that has reported nothing
    // at all, and distinct from B's withheld value above.
    const cRowStart = html.indexOf('>C<')
    const cRowEnd = html.indexOf('</tr>', cRowStart)
    expect(html.slice(cRowStart, cRowEnd)).toContain('Not reported')
  })

  test('a silent terminal is marked Not reported in the Off majority column, not counted as an outlier', () => {
    // rowsAllAgree: every device reports the same value, so if the silent
    // marker were missing, C's Off majority cell would read "—" (no
    // deviation), never "Not reported" — this isolates the silentDevices
    // branch from the absent-cell branch the previous test covers.
    const html = renderToStaticMarkup(
      <DriftReport rows={rowsAllAgree} deviceSns={['A', 'B', 'C']} entries={entries} silentDevices={['C']}
        devices={DEVICES} expanded={null} onExpand={() => {}} search="" onSearch={() => {}} />
    )
    const cRowStart = html.indexOf('>C<')
    const cRowEnd = html.indexOf('</tr>', cRowStart)
    expect(html.slice(cRowStart, cRowEnd)).toContain('Not reported')
  })

  test('expanding a terminal shows its own key list, with a withheld entry read as Withheld', () => {
    const html = renderToStaticMarkup(
      <DriftReport rows={rows} deviceSns={['A', 'B', 'C']} entries={entries} silentDevices={['C']}
        devices={DEVICES} expanded="A" onExpand={() => {}} search="" onSearch={() => {}} />
    )
    expect(html).toContain('authKey')
    const authKeyIdx = html.indexOf('authKey')
    expect(html.slice(authKeyIdx, authKeyIdx + 200)).toContain('Withheld')
  })

  test('a terminal with nothing reported says so instead of showing an empty expansion', () => {
    const html = renderToStaticMarkup(
      <DriftReport rows={rows} deviceSns={['A', 'B', 'C']} entries={entries} silentDevices={['C']}
        devices={DEVICES} expanded="C" onExpand={() => {}} search="" onSearch={() => {}} />
    )
    expect(html).toMatch(/has not reported its configuration yet/i)
  })
})
