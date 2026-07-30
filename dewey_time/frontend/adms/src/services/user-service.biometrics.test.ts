/**
 * The user-biometrics query key must hold ONE shape everywhere: a bare
 * BiometricEntry[]. Two hooks share the key ['users','detail',id,'biometrics']
 * (use-users.ts via this service, use-core-data.ts via direct supabase), so a
 * wrapper-object return here made the cached shape flip with whichever
 * queryFn refetched last — blanking biometric lists in the user modal and
 * crashing the optimistic delete ("i.filter is not a function").
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({
          data: [
            { id: 'a', type: 'fingerprint', finger_id: 1 },
            { id: 'c', type: 'face', finger_id: 0 },
          ],
          error: null,
        })),
      })),
    })),
  },
}))
vi.mock('@/lib/auth-token', () => ({ getAuthHeaders: vi.fn(async () => ({})) }))
vi.mock('@/lib/beta-direct', () => ({
  isBetaDirectReads: vi.fn(() => false),
  betaEmployeeRead: vi.fn(),
}))

import { UserService } from './user-service'

describe('UserService.getUserBiometrics', () => {
  it('resolves to a bare array — the single cache shape for the biometrics key', async () => {
    const result = await UserService.getUserBiometrics('u1')
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'a', type: 'fingerprint' })
  })
})
