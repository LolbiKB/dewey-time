import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-mode', () => ({ isFrappeMode: true }))
vi.mock('@/services/frappe-direct', () => ({ fetchFrappeEmployeesDirect: vi.fn() }))

import { betaEmployeeRead } from './beta-direct'
import { fetchFrappeEmployeesDirect } from '@/services/frappe-direct'
import type { UsersResponse } from '@/services/user-service'

/**
 * 2026-08-04: an admin was served 49 rows with every registered employee badged
 * "Compromised User Detected", while the bridge — in the very same call — had
 * 504 employees with correct statuses. The direct path reads Employee with the
 * LOGGED-IN USER's Frappe session (credentials: 'include'), and that account's
 * permissions returned nothing.
 *
 * The comparator DETECTED all 46 discrepancies, logged them, and served the
 * broken data anyway. A comparator that notices the new path disagreeing with
 * the trusted one and then returns the new path's answer is not a safety net.
 */
function resp(rows: Array<Record<string, unknown>>, total = rows.length): UsersResponse {
  return {
    success: true,
    data: rows as never,
    meta: { total, page: 1, limit: 20, totalPages: 1, hasNext: false, hasPrev: false },
  }
}

const HEALTHY = resp([
  { frappe_employee_id: 'DI-0285', name: 'A', pin: '1', status: 'active' },
])

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('betaEmployeeRead', () => {
  it('serves the direct result when it agrees with the bridge', async () => {
    ;(fetchFrappeEmployeesDirect as never as ReturnType<typeof vi.fn>).mockResolvedValue(HEALTHY)

    const out = await betaEmployeeRead({}, async () => HEALTHY)

    expect(out.data).toHaveLength(1)
    expect(out.degraded).toBeUndefined()
  })

  it('serves the BRIDGE result when the two disagree', async () => {
    // The field case: direct says compromised, bridge says active.
    const direct = resp([
      { frappe_employee_id: 'DI-0285', name: 'A', pin: '1', status: 'compromised' },
    ])
    ;(fetchFrappeEmployeesDirect as never as ReturnType<typeof vi.fn>).mockResolvedValue(direct)

    const out = await betaEmployeeRead({}, async () => HEALTHY)

    expect((out.data[0] as unknown as { status: string }).status).toBe('active')
    expect(out.degraded?.reason).toBe('direct-read-mismatch')
    expect(out.degraded?.diffCount).toBeGreaterThan(0)
  })

  it('flags a total mismatch, which is what 49-vs-504 looked like', async () => {
    ;(fetchFrappeEmployeesDirect as never as ReturnType<typeof vi.fn>).mockResolvedValue(
      resp([], 49)
    )

    const out = await betaEmployeeRead({}, async () => resp([], 504))

    expect(out.meta.total).toBe(504)
    expect(out.degraded).toBeDefined()
  })

  it('carries a message naming the likely cause, so the user can act', async () => {
    ;(fetchFrappeEmployeesDirect as never as ReturnType<typeof vi.fn>).mockResolvedValue(
      resp([], 0)
    )

    const out = await betaEmployeeRead({}, async () => HEALTHY)

    expect(out.degraded?.message).toMatch(/User Permissions/i)
    expect(out.degraded?.message).toMatch(/Employee/i)
  })

  it('falls back to the bridge when the direct read throws', async () => {
    ;(fetchFrappeEmployeesDirect as never as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('HTTP 403')
    )

    const out = await betaEmployeeRead({}, async () => HEALTHY)

    expect(out.data).toHaveLength(1)
  })

  it('serves direct when the bridge itself failed — the one unverified case', async () => {
    ;(fetchFrappeEmployeesDirect as never as ReturnType<typeof vi.fn>).mockResolvedValue(HEALTHY)

    const out = await betaEmployeeRead({}, async () => {
      throw new Error('bridge down')
    })

    expect(out.data).toHaveLength(1)
    expect(out.degraded).toBeUndefined()
  })

  it('rethrows only when BOTH paths fail', async () => {
    ;(fetchFrappeEmployeesDirect as never as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('direct down')
    )

    await expect(
      betaEmployeeRead({}, async () => {
        throw new Error('bridge down')
      })
    ).rejects.toThrow('direct down')
  })
})
