import { describe, test, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import type { DeviceOptionEntry } from '@/services/device-service'
import { DeviceConfig } from './DeviceConfig'

/**
 * The page composes eight modules, each already tested on its own. What is
 * only testable HERE is the frame: what the page states while it is still
 * loading, and that a selection from the URL reaches the right pane.
 *
 * There is no jsdom in this suite, so this renders statically with the query
 * cache SEEDED — no request is made and nothing is clicked. That bounds what
 * these tests can claim, and they claim nothing more.
 */
function render(seed?: (qc: QueryClient) => void, path = '/device-config') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed?.(qc)
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <DeviceConfig />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** Mirrors `useDevices({ limit: 200 })`'s cache entry. */
function seedDevices(qc: QueryClient) {
  qc.setQueryData(
    queryKeys.devices.list({ page: 1, limit: 200, sortBy: 'created_at', sortOrder: 'desc' }),
    {
      devices: [
        { serial_number: 'PYA001', name: 'Front door', connection_status: 'approved' },
        { serial_number: 'PYA002', name: 'Workshop', connection_status: 'approved' },
      ],
      rawTotal: 2,
      page: 1,
      limit: 200,
    }
  )
}

function option(device_sn: string, key: string, value: string): DeviceOptionEntry {
  return { device_sn, key, value, redacted: false, reported_at: '2026-01-01T00:00:00Z', kind: 'setting' }
}

function seedFleet(qc: QueryClient) {
  seedDevices(qc)
  qc.setQueryData(['device-options', 'PYA001'], [option('PYA001', 'VOLUME', '50')])
  qc.setQueryData(['device-options', 'PYA002'], [option('PYA002', 'VOLUME', '20')])
  qc.setQueryData(['device-option-policy'], { desired: [], keys: [] })
  qc.setQueryData(['device-option-writes', 'VOLUME'], [])
}

describe('DeviceConfig', () => {
  test('keeps its frame while loading instead of replacing the page with a spinner', () => {
    const html = render()
    expect(html).toContain('Fleet Configuration')
    expect(html).toContain('Re-read all terminals')
  })

  test('says Loading rather than stating a fleet size it does not know yet', () => {
    // "0 terminals · 0 keys reported" is a FALSE statement about the fleet,
    // where "Loading…" is merely an absent one.
    const html = render()
    expect(html).toContain('Loading')
    expect(html).not.toContain('0 terminals')
  })

  test('describes the fleet from what actually loaded', () => {
    const html = render(seedFleet)
    expect(html).toContain('2 terminals · 1 keys reported')
  })

  test('opens on the first curated setting, with the terminals that reported it', () => {
    const html = render(seedFleet)
    expect(html).toContain('Speaker volume')
    // The detail pane for VOLUME, not just the rail entry: both terminals'
    // reported values are in its table.
    expect(html).toContain('Front door')
    expect(html).toContain('Workshop')
  })

  test('the URL decides the pane, so a reload or a shared link keeps the place', () => {
    const html = render(seedFleet, '/device-config?view=all')
    expect(html).toMatch(/read-only unless you configure one/i)
    // The reference view lists every reported key with its fleet summary.
    expect(html).toContain('VOLUME')
    expect(html).toContain('2 values')
  })
})
