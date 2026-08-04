import { test, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FlaggedCountIndicator } from './flagged-count-indicator'

/**
 * "Suspicious Attendance" used to be a full-width Alert banner above the table,
 * stacked with genuinely destructive notices — compromised users, a failed
 * refresh, a degraded read.
 *
 * The flag behind it fires on a duplicate punch inside the dedup window, or on
 * two devices punched at the same instant (attlog-ingest.ts). That is also what
 * testing a scanner looks like, and nothing ever clears the flag. So a routine,
 * frequently self-inflicted, often-benign signal was shouting in the same voice
 * as a real failure — which is how a banner stops being read at all.
 *
 * Every flagged row already carries its own marker in the table (columns.tsx,
 * the `attendance_flag` column). The page-level summary therefore only owes the
 * user a count, and it belongs in the toolbar as quiet muted text.
 */

test('renders nothing when no user on the page is flagged', () => {
  expect(renderToStaticMarkup(<FlaggedCountIndicator count={0} />)).toBe('')
})

test('shows the count when there is one', () => {
  const html = renderToStaticMarkup(<FlaggedCountIndicator count={3} />)
  expect(html).toContain('3 flagged')
})

test('is not an alert banner — that treatment is reserved for failures', () => {
  const html = renderToStaticMarkup(<FlaggedCountIndicator count={3} />)
  expect(html).not.toContain('role="alert"')
  expect(html).not.toContain('data-slot="alert"')
})

test('still explains what flagged means, since the label alone cannot', () => {
  const html = renderToStaticMarkup(<FlaggedCountIndicator count={1} />)
  expect(html).toMatch(/title="[^"]*duplicate punch[^"]*"/i)
})
