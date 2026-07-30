import { test, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryErrorCard } from './query-error-card'

test('names the failure and offers a retry when a handler is given', () => {
  const html = renderToStaticMarkup(
    <QueryErrorCard
      title="Error loading users"
      error={new Error('Frappe request failed: 502 Bad Gateway')}
      onRetry={() => {}}
    />
  )
  expect(html).toMatch(/Error loading users/)
  expect(html).toMatch(/Frappe request failed: 502 Bad Gateway/)
  expect(html).toMatch(/Try again/)
})

test('falls back to a generic reason for non-Error failures', () => {
  const html = renderToStaticMarkup(<QueryErrorCard title="Error loading users" error="boom" />)
  expect(html).toMatch(/An unknown error occurred/)
})

test('omits the retry button when no handler is given', () => {
  const html = renderToStaticMarkup(
    <QueryErrorCard title="Error loading users" error={new Error('nope')} />
  )
  expect(html).not.toMatch(/Try again/)
})
