import { test, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Brandmark } from './Brandmark'

test('header lockup carries the hover-redraw hook, the mark, and the wordtext', () => {
  const html = renderToStaticMarkup(<Brandmark />)
  expect(html).toMatch(/adms-lockup/) // hover/focus draws the mark (brand-motion.css)
  expect(html).toMatch(/adms-glyph/) // the animated house mark
  expect(html).toMatch(/ADMS/)
  expect(html).toMatch(/Bridge/)
})
