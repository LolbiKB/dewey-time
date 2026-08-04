import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AttendanceFlagNotice, describeFlagReason } from './attendance-flag-notice'

/**
 * The attendance flag had no clearing path until 2026-08-04 — nothing in the
 * bridge, the dashboard, or poll maintenance ever set attendance_flagged_at
 * back to null. It is raised by ordinary events, so the flagged set only grew.
 *
 * This is where a flag becomes explicable and dismissable: what tripped it, and
 * a button to wave it away. Purely presentational on purpose — the modal owns
 * the mutation, so this renders without a QueryClientProvider and stays testable.
 */

describe('describeFlagReason', () => {
  test('names the rule that actually fired', () => {
    expect(describeFlagReason('duplicate_punch_window')).toMatch(/same device/i)
    expect(describeFlagReason('multi_device_same_time')).toMatch(/two devices/i)
  })

  test('does NOT re-assert the old hardcoded reason as if it were the cause', () => {
    // Every flag written before 2026-08-04 got 'multi_device_same_time_attendance'
    // regardless of which rule fired (attlog-ingest.ts hardcoded it). Rendering
    // that as "two devices at the same instant" would repeat a claim the data
    // does not support, so these rows say the cause was not recorded.
    const legacy = describeFlagReason('multi_device_same_time_attendance')
    expect(legacy).toMatch(/not recorded|before/i)
    expect(legacy).not.toMatch(/two devices recorded/i)
  })

  test('degrades to something readable for an unknown code', () => {
    expect(describeFlagReason('some_future_rule')).toBeTruthy()
    expect(describeFlagReason(null)).toBeTruthy()
  })
})

describe('AttendanceFlagNotice', () => {
  const FLAGGED = {
    flaggedAt: '2026-08-01T03:00:00.000Z',
    reason: 'duplicate_punch_window',
    onDismiss: () => {},
    dismissing: false,
  }

  test('renders nothing for a user who is not flagged', () => {
    const html = renderToStaticMarkup(
      <AttendanceFlagNotice {...FLAGGED} flaggedAt={null} />
    )
    expect(html).toBe('')
  })

  test('explains what tripped the flag', () => {
    const html = renderToStaticMarkup(<AttendanceFlagNotice {...FLAGGED} />)
    expect(html).toMatch(/same device/i)
  })

  test('offers a dismiss control', () => {
    const html = renderToStaticMarkup(<AttendanceFlagNotice {...FLAGGED} />)
    expect(html).toMatch(/<button/)
    expect(html).toMatch(/dismiss/i)
  })

  test('disables the control while a dismissal is in flight', () => {
    const html = renderToStaticMarkup(<AttendanceFlagNotice {...FLAGGED} dismissing />)
    expect(html).toMatch(/<button[^>]*\sdisabled(=|\s|>)/)
  })

  test('says the underlying records are kept, so dismissing is not deleting', () => {
    const html = renderToStaticMarkup(<AttendanceFlagNotice {...FLAGGED} />)
    expect(html).toMatch(/attendance record|log|kept|retain/i)
  })
})
