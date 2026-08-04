/**
 * Bridge-API calls from DeviceService must get the Content-Type/body pairing
 * right, because Fastify rejects `Content-Type: application/json` with an empty
 * body as 400 FST_ERR_CTP_EMPTY_JSON_BODY *before* the route handler runs.
 *
 * approveDevice was doing exactly that — POST with getAuthHeaders() (which
 * always sets Content-Type) and no body — so device approval 400'd every time.
 * With connection_status defaulting to 'pending', that made onboarding a new
 * terminal impossible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('@/lib/auth-token', () => ({
  getAuthHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    Authorization: 'Bearer test-token',
  })),
}))

import { DeviceService } from './device-service'

const fetchMock = vi.fn()

function jsonOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeviceService.approveDevice', () => {
  it('sends a JSON body so Fastify does not 400 with FST_ERR_CTP_EMPTY_JSON_BODY', async () => {
    fetchMock.mockResolvedValue(
      jsonOk({ success: true, data: { serial_number: 'SN-1', connection_status: 'approved' } })
    )

    await DeviceService.approveDevice('SN-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/admin/devices/SN-1/approve')
    expect(init.method).toBe('POST')
    // A body must be present whenever Content-Type: application/json is sent.
    expect(init.body).toBe('{}')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('propagates the approved device row with derived presence', async () => {
    fetchMock.mockResolvedValue(
      jsonOk({ success: true, data: { serial_number: 'SN-1', connection_status: 'approved' } })
    )

    const device = await DeviceService.approveDevice('SN-1')

    expect(device.connection_status).toBe('approved')
    expect(device.status).toBe('offline')
    expect(device.last_seen_minutes).toBeNull()
  })
})

describe('DeviceService bridge requests without a body', () => {
  it('omits Content-Type entirely (Fastify rejects application/json with no body)', async () => {
    fetchMock.mockResolvedValue(jsonOk({ total: 0, synced: 0, syncing: 0, failed: 0 }))

    await DeviceService.getDeviceSyncSummary('SN-1')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers.Authorization).toBe('Bearer test-token')
  })
})

/**
 * REBOOT must go through the bridge, never command_queue.
 *
 * The dashboard used to INSERT 'REBOOT' straight into command_queue under the
 * user's JWT (device-service.ts queueDeviceCommand, reached from the "Reboot
 * Device" row action). getrequest ships command text to the terminal verbatim
 * and command_admin_full is role-blind, so any admin could reboot a device.
 * The allowlist trigger will reject that write; this is its replacement.
 */
describe('DeviceService.rebootDevice', () => {
  it('POSTs to the bridge reboot endpoint rather than writing command_queue', async () => {
    fetchMock.mockResolvedValue(jsonOk({ success: true, commandId: 7 }))

    const result = await DeviceService.rebootDevice('PYA8254100003')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/admin/devices/PYA8254100003/reboot')
    expect((init as RequestInit).method).toBe('POST')
    expect(result.commandId).toBe(7)
  })

  it('percent-encodes the serial number', async () => {
    fetchMock.mockResolvedValue(jsonOk({ success: true, commandId: 1 }))

    await DeviceService.rebootDevice('SN/WITH SLASH')

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('SN%2FWITH%20SLASH')
    expect(url).not.toContain('SN/WITH SLASH')
  })

  it('surfaces the bridge error message so a 403 reads as Super Admin only', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Super Admin required' }),
    })

    await expect(DeviceService.rebootDevice('SN-1')).rejects.toThrow('Super Admin required')
  })
})

/**
 * Option discovery goes through the bridge, not command_queue.
 *
 * Repointing "Request info" at POST /admin/devices/:sn/options/refresh removes
 * the dashboard's LAST direct INSERT into command_queue — after this,
 * `authenticated` needs no write access to that table at all.
 */
describe('DeviceService option discovery', () => {
  it('requests a refresh through the bridge endpoint', async () => {
    fetchMock.mockResolvedValue(jsonOk({ success: true, commandId: 77 }))

    const result = await DeviceService.refreshDeviceOptions('PYA8254100003')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/admin/devices/PYA8254100003/options/refresh')
    expect((init as RequestInit).method).toBe('POST')
    expect(result.commandId).toBe(77)
  })

  it('percent-encodes the serial on refresh', async () => {
    fetchMock.mockResolvedValue(jsonOk({ success: true, commandId: 1 }))
    await DeviceService.refreshDeviceOptions('SN/ODD')
    expect(fetchMock.mock.calls[0][0]).toContain('SN%2FODD')
  })

  it('reads observed options for one device', async () => {
    const rows = [{ key: 'VOLUME', value: '67', reported_at: '2026-08-04T00:00:00Z' }]
    fetchMock.mockResolvedValue(jsonOk({ success: true, data: rows }))

    const out = await DeviceService.getDeviceOptions('PYA8254100003')

    expect(fetchMock.mock.calls[0][0]).toContain('/admin/device-options?sn=PYA8254100003')
    expect(out).toEqual(rows)
  })

  it('returns an empty list rather than undefined when nothing is known', async () => {
    fetchMock.mockResolvedValue(jsonOk({ success: true, data: [] }))
    expect(await DeviceService.getDeviceOptions('SN-1')).toEqual([])
  })

  it('surfaces a bridge error on refresh', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Device is pending, not approved' }),
    })
    await expect(DeviceService.refreshDeviceOptions('SN-1')).rejects.toThrow(
      'Device is pending, not approved'
    )
  })
})
