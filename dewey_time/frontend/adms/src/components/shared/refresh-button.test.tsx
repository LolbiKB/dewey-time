import { test, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RefreshButton } from './refresh-button'

/**
 * The manual refresh on every data table looked dead. The design-system table
 * keys its built-in refresh spinner and disabled state off `loading`, and every
 * page passed TanStack's `isLoading` — which is `isPending && isFetching`, i.e.
 * true ONLY before the first data arrives. A `refetch()` on a table that
 * already has rows sets `isFetching` and never touches `isLoading`, so the icon
 * never spun, the button never disabled, and `keepPreviousData` meant the rows
 * did not blank either. The request went out; nothing on screen moved.
 *
 * This button keys off `isFetching` instead. `loading` stays bound to
 * `isLoading` on the table itself so a background refetch never flashes the
 * body back to skeleton rows.
 */

// The button's class list carries Tailwind's `disabled:` variants
// unconditionally, so a bare /disabled/ match is always true. Assert the real
// DOM attribute instead.
const DISABLED_ATTR = /<button[^>]*\sdisabled(=|\s|>)/

test('spins and disables while a refetch is in flight', () => {
  const html = renderToStaticMarkup(<RefreshButton onRefresh={() => {}} refreshing />)
  expect(html).toMatch(/animate-spin/)
  expect(html).toMatch(DISABLED_ATTR)
})

test('is idle and clickable when no refetch is in flight', () => {
  const html = renderToStaticMarkup(
    <RefreshButton onRefresh={() => {}} refreshing={false} />
  )
  expect(html).not.toMatch(/animate-spin/)
  expect(html).not.toMatch(DISABLED_ATTR)
})

test('defaults to idle when refreshing is omitted', () => {
  const html = renderToStaticMarkup(<RefreshButton onRefresh={() => {}} />)
  expect(html).not.toMatch(/animate-spin/)
  expect(html).not.toMatch(DISABLED_ATTR)
})

test('is reachable by its accessible name', () => {
  const html = renderToStaticMarkup(<RefreshButton onRefresh={() => {}} />)
  expect(html).toMatch(/aria-label="Refresh"/)
})
