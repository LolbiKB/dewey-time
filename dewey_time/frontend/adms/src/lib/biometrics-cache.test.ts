/**
 * Optimistic-update helper for the user-biometrics query cache.
 *
 * Regression suite for "Failed to delete biometric: i.filter is not a
 * function": useDeleteBiometric's onMutate called .filter() directly on the
 * cached value, which crashed (before the DELETE request ever fired) whenever
 * the cache held the legacy { success, data } wrapper shape instead of a bare
 * array — two useUserBiometrics hooks shared one query key with different
 * shapes.
 */
import { describe, it, expect } from 'vitest'
import { removeBiometricFromCache } from './biometrics-cache'

const LIST = [
  { id: 'a', type: 'fingerprint', finger_id: 1 },
  { id: 'b', type: 'fingerprint', finger_id: 2 },
  { id: 'c', type: 'face', finger_id: 0 },
]

describe('removeBiometricFromCache', () => {
  it('removes only the matching fingerprint when finger_id is given', () => {
    const out = removeBiometricFromCache(LIST, 'fingerprint', 1)
    expect(out).toEqual([
      { id: 'b', type: 'fingerprint', finger_id: 2 },
      { id: 'c', type: 'face', finger_id: 0 },
    ])
  })

  it('removes every entry of the type when finger_id is undefined', () => {
    const out = removeBiometricFromCache(LIST, 'fingerprint', undefined)
    expect(out).toEqual([{ id: 'c', type: 'face', finger_id: 0 }])
  })

  it('does not mutate the input list', () => {
    const copy = [...LIST]
    removeBiometricFromCache(LIST, 'face', 0)
    expect(LIST).toEqual(copy)
  })

  it('returns a legacy { success, data } wrapper unchanged instead of throwing', () => {
    // The exact cache state that produced "i.filter is not a function"
    const legacy = { success: true, data: LIST } as unknown
    expect(removeBiometricFromCache(legacy, 'fingerprint', 1)).toBe(legacy)
  })

  it('returns undefined/null cache states unchanged', () => {
    expect(removeBiometricFromCache(undefined, 'fingerprint', 1)).toBeUndefined()
    expect(removeBiometricFromCache(null, 'face', 0)).toBeNull()
  })
})
