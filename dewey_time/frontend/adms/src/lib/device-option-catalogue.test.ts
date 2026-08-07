import { describe, test, expect } from 'vitest'
import { CURATED_SETTINGS, curatedLabel, isCurated, parseSelection } from './device-option-catalogue'

describe('the curated set', () => {
  test('is the five keys the Part 3a spec named as the real target', () => {
    expect(CURATED_SETTINGS.map((s) => s.key)).toEqual([
      'VOLUME', 'Brightness', 'Language', 'DtFmt', '~DSTF',
    ])
  })

  test('labels the key without replacing it', () => {
    expect(curatedLabel('VOLUME')).toBe('Speaker volume')
    expect(curatedLabel('FlashSize')).toBeNull()
  })

  test('matches keys exactly, never case-insensitively', () => {
    // The write path compares observed keys case-SENSITIVELY (that was a fix:
    // a case-insensitive match manufactured proof from a different key). A
    // catalogue that matched loosely would label a key the writer would treat
    // as a different one. Failing to curate is safe — the key stays reachable
    // from the reference list; mislabelling is not.
    expect(isCurated('VOLUME')).toBe(true)
    expect(isCurated('volume')).toBe(false)
  })
})

describe('parseSelection', () => {
  test('defaults to the first curated setting', () => {
    expect(parseSelection(null, null)).toEqual({ kind: 'key', key: 'VOLUME' })
  })

  test('selects any key by name, curated or not', () => {
    expect(parseSelection('FlashSize', null)).toEqual({ kind: 'key', key: 'FlashSize' })
  })

  test('selects the two reference views', () => {
    expect(parseSelection(null, 'drift')).toEqual({ kind: 'drift' })
    expect(parseSelection(null, 'all')).toEqual({ kind: 'all' })
  })

  test('a key wins over an unrecognised view rather than showing nothing', () => {
    expect(parseSelection('VOLUME', 'nonsense')).toEqual({ kind: 'key', key: 'VOLUME' })
    expect(parseSelection(null, 'nonsense')).toEqual({ kind: 'key', key: 'VOLUME' })
  })
})
