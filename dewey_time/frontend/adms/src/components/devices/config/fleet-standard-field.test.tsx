import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FleetStandardField } from './fleet-standard-field'

describe('FleetStandardField', () => {
  test('says who set the stored value and when', () => {
    const html = renderToStaticMarkup(
      <FleetStandardField optionKey="VOLUME" hint="This fleet reports values between 20 and 60."
        stored="50" updatedBy="a@b.c" updatedAt="2026-08-06T14:22:00Z" saving={false} onSave={() => {}} />
    )
    expect(html).toContain('a@b.c')
  })

  test('says plainly that nothing is stored yet', () => {
    // The state that makes Apply answer 400. It must read as a missing step,
    // not as an empty field nobody notices.
    const html = renderToStaticMarkup(
      <FleetStandardField optionKey="VOLUME" hint="" stored={null}
        updatedBy={null} updatedAt={null} saving={false} onSave={() => {}} />
    )
    expect(html).toMatch(/no fleet standard/i)
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
