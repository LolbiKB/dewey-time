import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FleetStandardField } from './fleet-standard-field'
import { signalText } from '@/lib/signal'

describe('FleetStandardField', () => {
  test('says who set the stored value and when', () => {
    const updatedAt = '2026-08-06T14:22:00Z'
    const html = renderToStaticMarkup(
      <FleetStandardField optionKey="VOLUME" hint="This fleet reports values between 20 and 60."
        stored="50" updatedBy="a@b.c" updatedAt={updatedAt} saving={false} onSave={() => {}} />
    )
    expect(html).toContain('a@b.c')
    // "and when" was previously unasserted — deleting the `updatedAt` clause
    // from the component left this test green. Computed the same way the
    // component computes it (`new Date(...).toLocaleString()`) rather than
    // hardcoded, so this does not depend on this machine's locale/timezone.
    expect(html).toContain(new Date(updatedAt).toLocaleString())
  })

  test('says plainly that nothing is stored yet', () => {
    // The state that makes Apply answer 400. It must read as a missing step,
    // not as an empty field nobody notices.
    const html = renderToStaticMarkup(
      <FleetStandardField optionKey="VOLUME" hint="" stored={null}
        updatedBy={null} updatedAt={null} saving={false} onSave={() => {}} />
    )
    expect(html).toMatch(/no fleet standard/i)
    // Colour is not the only signal, but it must not silently regress to
    // idle grey either — this is the state that makes Apply answer 400.
    expect(html).toMatch(
      new RegExp(`class="[^"]*${signalText.attention}[^"]*"[^>]*>[^<]*no fleet standard`, 'i')
    )
  })

  test('shows the hint without claiming what a value means', () => {
    const html = renderToStaticMarkup(
      <FleetStandardField optionKey="Language" hint="Every terminal reports 69." stored={null}
        updatedBy={null} updatedAt={null} saving={false} onSave={() => {}} />
    )
    expect(html).toContain('Every terminal reports 69.')
    expect(html).not.toMatch(/english/i)
  })
})
