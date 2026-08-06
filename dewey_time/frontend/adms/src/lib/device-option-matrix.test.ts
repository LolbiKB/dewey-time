import { describe, test, expect } from 'vitest'
import {
  buildOptionMatrix,
  countDrift,
  hasDrift,
  groupRowValues,
  deviceDeviations,
  deviceLabel,
} from './device-option-matrix'
import type { DeviceOptionEntry } from '@/services/device-service'

/**
 * The fleet matrix decides what may be CONCLUDED from partial data, and every
 * way of getting that wrong produces a confident false alarm — the same failure
 * the capacity view already shipped once.
 *
 * Three traps, each pinned here:
 *   1. A withheld value is UNKNOWN, not different. authKey is redacted on every
 *      terminal; calling that agreement invents a fact, calling it drift
 *      invents an alarm.
 *   2. A device that has never reported is not a device that disagrees with
 *      everything. Otherwise approving a terminal turns all 78 rows red.
 *   3. A truncated row set makes present keys look absent, which renders as
 *      drift that is not real.
 */
const e = (
  device_sn: string,
  key: string,
  value: string | null,
  redacted = false,
  kind: 'setting' | 'identity' | 'counter' = 'setting'
): DeviceOptionEntry => ({
  device_sn,
  key,
  value,
  redacted,
  kind,
  reported_at: '2026-08-05T08:05:03.000Z',
})

const A = 'PYA8254100003'
const B = 'PYA8254100004'
const C = 'PYA8254100005'

describe('drift verdicts', () => {
  test('agrees when every reporting device reports the same value', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70'), e(B, 'VOLUME', '70')], [A, B])
    expect(m.rows[0].verdict).toBe('agree')
    expect(countDrift(m.rows)).toBe(0)
  })

  test('differs when they disagree', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70'), e(B, 'VOLUME', '20')], [A, B])
    expect(m.rows[0].verdict).toBe('differ')
    expect(hasDrift(m.rows[0])).toBe(true)
  })

  test('flags a key one terminal has and another does not', () => {
    const m = buildOptionMatrix(
      [e(A, 'QRCodeEnable', '1'), e(A, 'VOLUME', '70'), e(B, 'VOLUME', '70')],
      [A, B]
    )
    const qr = m.rows.find((r) => r.key === 'QRCodeEnable')!
    expect(qr.verdict).toBe('missing')
    expect(qr.cells[B].present).toBe(false)
  })
})

describe('withheld values are unknown, never a conclusion', () => {
  test('two withheld values are NOT agreement', () => {
    // authKey is redacted everywhere. Calling that "the fleet agrees" would
    // state a fact nobody has.
    const m = buildOptionMatrix(
      [e(A, 'authKey', null, true), e(B, 'authKey', null, true)],
      [A, B]
    )
    expect(m.rows[0].verdict).toBe('unknown')
    expect(hasDrift(m.rows[0])).toBe(false)
  })

  test('one withheld and one visible is NOT drift', () => {
    // We cannot know whether they match, so we must not raise an alarm.
    const m = buildOptionMatrix([e(A, 'authKey', null, true), e(B, 'authKey', 'x')], [A, B])
    expect(m.rows[0].verdict).toBe('unknown')
    expect(hasDrift(m.rows[0])).toBe(false)
  })

  test('a withheld cell still reads as withheld, not as unset', () => {
    const m = buildOptionMatrix([e(A, 'authKey', null, true), e(B, 'VOLUME', '1')], [A, B])
    const auth = m.rows.find((r) => r.key === 'authKey')!
    expect(auth.cells[A]).toMatchObject({ present: true, redacted: true })
    // B never reported authKey — that is absence, a different thing entirely.
    expect(auth.cells[B]).toMatchObject({ present: false, redacted: false })
  })
})

describe('a silent device is not a dissenting device', () => {
  test('excludes a device that has reported nothing from every verdict', () => {
    // The case that would otherwise turn all 78 rows red the moment a terminal
    // is approved.
    const m = buildOptionMatrix([e(A, 'VOLUME', '70'), e(B, 'VOLUME', '70')], [A, B, C])

    expect(m.silentDevices).toEqual([C])
    expect(m.reportingDevices).toEqual([A, B])
    expect(m.rows[0].verdict).toBe('agree')
    expect(countDrift(m.rows)).toBe(0)
  })

  test('still renders a column for the silent device', () => {
    // Hiding it would misrepresent the fleet as smaller than it is.
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A, C])
    expect(m.rows[0].cells[C]).toMatchObject({ present: false })
  })

  test('cannot judge drift from a single reporter', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A, B])
    expect(m.rows[0].verdict).toBe('unknown')
  })
})

describe('truncation', () => {
  test('reports truncation when the API bound was reached', () => {
    // A truncated row set makes present keys look absent, which renders as
    // drift that is not real. The UI has to be able to say so.
    const entries = Array.from({ length: 500 }, (_, i) => e(A, `K${i}`, 'v'))
    const m = buildOptionMatrix(entries, [A], { limit: 500 })
    expect(m.truncated).toBe(true)
  })

  test('is not truncated below the bound', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A], { limit: 500 })
    expect(m.truncated).toBe(false)
  })

  test('is not truncated when no bound was given', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A])
    expect(m.truncated).toBe(false)
  })
})

describe('shape', () => {
  test('ignores rows for serials the caller did not ask about', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70'), e(C, 'VOLUME', '20')], [A, B])
    expect(m.rows[0].verdict).toBe('unknown')
    expect(m.rows[0].cells[C]).toBeUndefined()
  })

  test('sorts rows by key so the grid is stable between loads', () => {
    const m = buildOptionMatrix(
      [e(A, 'VOLUME', '1'), e(A, 'Brightness', '2'), e(A, 'Language', '3')],
      [A]
    )
    expect(m.rows.map((r) => r.key)).toEqual(['Brightness', 'Language', 'VOLUME'])
  })

  test('gives every row a cell for every requested device', () => {
    const m = buildOptionMatrix([e(A, 'VOLUME', '70')], [A, B, C])
    expect(Object.keys(m.rows[0].cells).sort()).toEqual([A, B, C].sort())
  })

  test('handles an empty fleet without inventing rows', () => {
    const m = buildOptionMatrix([], [])
    expect(m.rows).toEqual([])
    expect(m.reportingDevices).toEqual([])
  })
})

/**
 * Key classification — the fix for "10 differ" on a healthy fleet.
 *
 * The first version compared every key. Against the real four-terminal fleet it
 * reported ten differences, of which EIGHT were keys that must differ: serial
 * numbers, MAC addresses, IP addresses, and five live counters. Only FWVersion
 * (one terminal a patch behind) and VOLUME (60/60/20/70) were real.
 *
 * The fixture below is that exact fleet, so the count is pinned to reality.
 */
const D1 = 'PYA8261900039'
const D2 = 'PYA8261900038'
const D3 = 'PYA8254901742'
const D4 = 'PYA8254100003'
const FLEET = [D1, D2, D3, D4]

const REAL_FLEET_ROWS: DeviceOptionEntry[] = [
  ...[D1, D2, D3, D4].map((sn) => e(sn, '~SerialNumber', sn, false, 'identity')),
  ...[['70', D1], ['83', D2], ['67', D3], ['68', D4]].map(([v, sn]) =>
    e(sn, 'FPCount', v, false, 'counter')
  ),
  ...[['5076300', D1], ['5076100', D2], ['5075924', D3], ['5075920', D4]].map(([v, sn]) =>
    e(sn, 'FreeFlashSize', v, false, 'counter')
  ),
  e(D1, 'FWVersion', 'ZAM70-NF43VA-Ver3.3.12', false, 'setting'),
  ...[D2, D3, D4].map((sn) => e(sn, 'FWVersion', 'ZAM70-NF43VA-Ver3.3.13', false, 'setting')),
  ...[['192.168.1.202', D1], ['192.168.1.132', D2], ['192.168.1.11', D3], ['192.168.1.218', D4]].map(
    ([v, sn]) => e(sn, 'IPAddress', v, false, 'identity')
  ),
  ...[['00:17:61:12:d0:50', D1], ['00:17:61:12:d0:39', D2], ['00:17:61:11:7b:92', D3], ['00:17:61:10:d8:b6', D4]].map(
    ([v, sn]) => e(sn, 'MAC', v, false, 'identity')
  ),
  ...[['5', D1], ['8', D2], ['116', D3], ['78', D4]].map(([v, sn]) =>
    e(sn, 'TransactionCount', v, false, 'counter')
  ),
  ...[['73', D1], ['85', D2], ['70', D3], ['71', D4]].map(([v, sn]) =>
    e(sn, 'UserCount', v, false, 'counter')
  ),
  ...[['65', D1], ['76', D2], ['65', D3], ['63', D4]].map(([v, sn]) =>
    e(sn, 'UserPhotoCount', v, false, 'counter')
  ),
  ...[['60', D1], ['60', D2], ['20', D3], ['70', D4]].map(([v, sn]) =>
    e(sn, 'VOLUME', v, false, 'setting')
  ),
]

describe('the real four-terminal fleet', () => {
  const matrix = () => buildOptionMatrix(REAL_FLEET_ROWS, FLEET)

  test('reports TWO real differences, not ten', () => {
    const drifting = matrix().rows.filter(hasDrift).map((r) => r.key).sort()
    expect(drifting).toEqual(['FWVersion', 'VOLUME'])
    expect(countDrift(matrix().rows)).toBe(2)
  })

  test('never flags identity keys, which are unique by definition', () => {
    const rows = matrix().rows
    for (const key of ['~SerialNumber', 'IPAddress', 'MAC']) {
      const row = rows.find((r) => r.key === key)!
      expect(row.kind).toBe('identity')
      expect(row.verdict).toBe('per-device')
      expect(hasDrift(row)).toBe(false)
    }
  })

  test('never flags live counters, whose values are supposed to move', () => {
    const rows = matrix().rows
    for (const key of ['FPCount', 'UserCount', 'TransactionCount', 'UserPhotoCount', 'FreeFlashSize']) {
      const row = rows.find((r) => r.key === key)!
      expect(row.kind).toBe('counter')
      expect(row.verdict).toBe('volatile')
      expect(hasDrift(row)).toBe(false)
    }
  })

  test('still catches the terminal a firmware patch behind', () => {
    const fw = matrix().rows.find((r) => r.key === 'FWVersion')!
    expect(fw.verdict).toBe('differ')
    expect(fw.cells[D1].value).toBe('ZAM70-NF43VA-Ver3.3.12')
  })

  test('still catches inconsistent volume', () => {
    const vol = matrix().rows.find((r) => r.key === 'VOLUME')!
    expect(vol.verdict).toBe('differ')
  })
})

/**
 * Scaling past a grid.
 *
 * A matrix widens with the fleet, so at ten-plus terminals the settings that
 * actually differ are off-screen. Values are few and devices are many, so
 * grouping by value collapses the axis that grows.
 */
describe('groupRowValues', () => {
  const rowFor = (entries: DeviceOptionEntry[], sns: string[]) =>
    buildOptionMatrix(entries, sns).rows[0]

  test('collapses many devices into few value groups', () => {
    // The whole point: twenty terminals, three lines.
    const sns = Array.from({ length: 20 }, (_, i) => `SN${i}`)
    const entries = sns.map((sn, i) => e(sn, 'VOLUME', i < 17 ? '60' : i < 19 ? '20' : '70'))
    const groups = groupRowValues(rowFor(entries, sns), sns)

    expect(groups).toHaveLength(3)
    expect(groups[0]).toMatchObject({ value: '60', isMajority: true })
    expect(groups[0].devices).toHaveLength(17)
  })

  test('declares no majority on a tie', () => {
    // Standardising on a value with no more support than its rival is advice
    // the data does not justify.
    const sns = ['A', 'B']
    const groups = groupRowValues(rowFor([e('A', 'VOLUME', '60'), e('B', 'VOLUME', '20')], sns), sns)
    expect(groups.every((g) => !g.isMajority)).toBe(true)
  })

  test('keeps withheld, absent and real values in separate groups', () => {
    const sns = ['A', 'B', 'C']
    const row = rowFor([e('A', 'K', '1'), e('B', 'K', null, true), e('C', 'OTHER', 'x')], sns)
    const groups = groupRowValues(row, sns)

    // Three distinct states, never folded together.
    expect(groups).toHaveLength(3)
    expect(groups.filter((g) => g.value === null)).toHaveLength(2)
  })
})

describe('deviceDeviations', () => {
  test('ranks the odd terminals out, worst first', () => {
    // "Which box is wrong" is one site visit; "which setting differs" is not.
    const sns = ['A', 'B', 'C']
    const m = buildOptionMatrix(
      [
        e('A', 'VOLUME', '60'), e('B', 'VOLUME', '60'), e('C', 'VOLUME', '20'),
        e('A', 'Brightness', '5'), e('B', 'Brightness', '5'), e('C', 'Brightness', '9'),
        e('A', 'Language', '69'), e('B', 'Language', '1'), e('C', 'Language', '69'),
      ],
      sns
    )
    const dev = deviceDeviations(m.rows, m.reportingDevices)

    expect(dev[0]).toMatchObject({ deviceSn: 'C', count: 2 })
    expect(dev[0].keys.sort()).toEqual(['Brightness', 'VOLUME'])
    expect(dev[1]).toMatchObject({ deviceSn: 'B', count: 1 })
    expect(dev.find((d) => d.deviceSn === 'A')).toBeUndefined()
  })

  test('blames nobody when there is no majority', () => {
    const sns = ['A', 'B']
    const m = buildOptionMatrix([e('A', 'VOLUME', '60'), e('B', 'VOLUME', '20')], sns)
    expect(deviceDeviations(m.rows, m.reportingDevices)).toEqual([])
  })

  test('ignores identity and counters, which are never anyones fault', () => {
    const sns = ['A', 'B']
    const m = buildOptionMatrix(
      [
        e('A', 'MAC', 'x', false, 'identity'),
        e('B', 'MAC', 'y', false, 'identity'),
        e('A', 'UserCount', '1', false, 'counter'),
        e('B', 'UserCount', '99', false, 'counter'),
      ],
      sns
    )
    expect(deviceDeviations(m.rows, m.reportingDevices)).toEqual([])
  })

  test('names the real fleet outliers', () => {
    const m = buildOptionMatrix(REAL_FLEET_ROWS, FLEET)
    const dev = deviceDeviations(m.rows, m.reportingDevices)
    // FWVersion: three agree, D1 alone. VOLUME: 60 is the majority, D3 and D4 differ.
    expect(dev.map((d) => d.deviceSn).sort()).toEqual([D1, D3, D4].sort())
  })
})

describe('deviceLabel', () => {
  const devices = [
    { serial_number: 'SN1', name: 'Front Door', location: 'Lobby' },
    { serial_number: 'SN2', name: 'Back Door', location: 'Back Door' },
    { serial_number: 'SN3', name: null, location: 'Warehouse' },
    { serial_number: 'SN4', name: null, location: null },
  ]

  test('leads with name and location, since operators know boxes by place', () => {
    expect(deviceLabel('SN1', devices)).toBe('Front Door · Lobby')
  })

  test('does not repeat itself when name and location match', () => {
    expect(deviceLabel('SN2', devices)).toBe('Back Door')
  })

  test('falls back through location to the serial', () => {
    expect(deviceLabel('SN3', devices)).toBe('Warehouse')
    expect(deviceLabel('SN4', devices)).toBe('SN4')
  })

  test('falls back to the serial for a device it does not know', () => {
    expect(deviceLabel('SN9', devices)).toBe('SN9')
  })

  test('ignores whitespace-only names', () => {
    expect(deviceLabel('SN5', [{ serial_number: 'SN5', name: '   ', location: null }])).toBe('SN5')
  })
})
