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

/**
 * The header description, read from the one element that renders it.
 *
 * `PageHeader` puts it in the <p> immediately after its <h1>. Matching the
 * bare text anywhere in the document would let the rail — which renders every
 * key and summary on the page — satisfy an assertion about the header.
 */
function headerDescription(html: string): string | null {
  return html.match(/<h1[^>]*>Fleet Configuration<\/h1><p[^>]*>([^<]*)<\/p>/)?.[1] ?? null
}

/**
 * Mirrors `useDevices({ limit: 200 })`'s cache entry — the filter shape comes
 * from `useDevices` in `src/hooks/use-core-data.ts`, which builds this key.
 */
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

function seedOptions(qc: QueryClient, extra: DeviceOptionEntry[] = []) {
  qc.setQueryData(
    ['device-options', 'PYA001'],
    [option('PYA001', 'VOLUME', '50'), ...extra.filter((e) => e.device_sn === 'PYA001')]
  )
  qc.setQueryData(
    ['device-options', 'PYA002'],
    [option('PYA002', 'VOLUME', '20'), ...extra.filter((e) => e.device_sn === 'PYA002')]
  )
}

function seedPolicy(qc: QueryClient) {
  qc.setQueryData(['device-option-policy'], { desired: [], keys: [] })
  qc.setQueryData(['device-option-writes', 'VOLUME'], [])
}

function seedFleet(qc: QueryClient) {
  seedDevices(qc)
  seedOptions(qc)
  seedPolicy(qc)
}

/** The same fleet plus a key that differs and is NOT one of the curated five. */
function seedFleetWithUncuratedDrift(qc: QueryClient) {
  seedDevices(qc)
  seedOptions(qc, [option('PYA001', 'IsSupportNFC', '1'), option('PYA002', 'IsSupportNFC', '0')])
  seedPolicy(qc)
}

describe('DeviceConfig', () => {
  test('keeps its frame while loading instead of replacing the page with a spinner', () => {
    const html = render()
    // The header and its action survive the load — both are rendered only by
    // this page's frame — and the panes fill with skeletons rather than the
    // page being swapped for a centred spinner.
    expect(html).toMatch(/<h1[^>]*>Fleet Configuration<\/h1>/)
    expect(html).toContain('Re-read all terminals')
    expect(html).toContain('data-slot="skeleton"')
  })

  test('says Loading rather than stating a fleet size it does not know yet', () => {
    // "0 terminals · 0 keys reported" is a FALSE statement about the fleet,
    // where "Loading…" is merely an absent one. Read from the header element
    // itself, so nothing elsewhere on the page can satisfy this.
    expect(headerDescription(render())).toBe('Loading…')
  })

  test('describes the fleet from what actually loaded', () => {
    expect(headerDescription(render(seedFleet))).toBe('2 terminals · 1 keys reported')
  })

  test('opens on the first curated setting, in the DETAIL pane', () => {
    const html = render(seedFleet)
    // "Speaker volume" alone proves nothing — the rail renders it for every
    // selection. These three come only from the detail pane: its heading
    // level, the fleet-standard field, and the per-terminal table.
    expect(html).toMatch(/<h2[^>]*>Speaker volume<\/h2>/)
    expect(html).toContain('Fleet standard')
    expect(html).toContain('Front door')
    expect(html).toContain('Workshop')
  })

  test('the URL decides the pane, so a reload or a shared link keeps the place', () => {
    const html = render(seedFleet, '/device-config?view=all')
    // Anchored to something ONLY AllKeysReference emits. The obvious markers —
    // the key, its summary, "read-only unless you configure one" — are all
    // rendered by the rail on every selection, so they would pass with this
    // route completely broken.
    expect(html).toContain('Across the fleet')
    // …and the detail pane it replaced is gone.
    expect(html).not.toContain('Fleet standard')
  })

  test('?view=drift renders the drift report, listing what differs outside the five', () => {
    const html = render(seedFleetWithUncuratedDrift, '/device-config?view=drift')
    // "By terminal" and the uncurated key are DriftReport-only: the rail lists
    // the curated five and counts the rest without naming any of them.
    expect(html).toContain('By terminal')
    expect(html).toContain('IsSupportNFC')
    expect(html).not.toContain('Fleet standard')
  })

  test('the drift view states an absence rather than drawing an empty table', () => {
    // Only VOLUME differs here, and VOLUME is curated — so this view has
    // nothing to show, and a bare "By terminal" header over a column of
    // "Not reported" would read as a finding.
    const html = render(seedFleet, '/device-config?view=drift')
    expect(html).toContain('Nothing outside the listed settings differs')
    expect(html).not.toContain('By terminal')
  })

  test('a policy still in flight is never rendered as "nothing is stored"', () => {
    // Devices and option rows in hand, the POLICY query still loading. Without
    // it in `loading`, the pane rendered "No fleet standard yet — save one
    // first" from a read that had not answered, inviting the operator to
    // overwrite a standard they could not yet see.
    const html = render((qc) => {
      seedDevices(qc)
      seedOptions(qc)
    })
    expect(html).not.toMatch(/No fleet standard yet/i)
    expect(headerDescription(html)).toBe('Loading…')
  })
})
