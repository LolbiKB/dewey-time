import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdmsBridgeIntro } from './AdmsBridgeIntro'

const HERE = dirname(fileURLToPath(import.meta.url))

test('intro overlay draws the mark onto a blank canvas with the ADMS Bridge wordtext', () => {
  const html = renderToStaticMarkup(<AdmsBridgeIntro />)
  expect(html).toMatch(/fixed inset-0/) // full-screen overlay
  expect(html).toMatch(/aria-label="ADMS Bridge"/)
  expect(html).toMatch(/adms-draw/) // triggers the self-draw on the mark
  expect(html).toMatch(/adms-glyph/) // the house mark
  expect(html).toMatch(/adms-intro-rise/) // wordtext rises after the draw
  expect(html).toMatch(/ADMS/)
  expect(html).toMatch(/Bridge/)
})

test('intro is restrained — once per session, reduced-motion aware, skippable', () => {
  const src = readFileSync(resolve(HERE, 'AdmsBridgeIntro.tsx'), 'utf8')
  expect(src).toMatch(/sessionStorage/)
  expect(src).toMatch(/prefers-reduced-motion/)
  expect(src).toMatch(/skip/)
})

test('the self-draw motion is defined and disabled under reduced motion', () => {
  const css = readFileSync(resolve(HERE, 'brand-motion.css'), 'utf8')
  expect(css).toMatch(/@keyframes adms-draw/)
  const reduceIdx = css.indexOf('prefers-reduced-motion')
  expect(reduceIdx).toBeGreaterThan(-1)
  expect(css.indexOf('adms-glyph', reduceIdx)).toBeGreaterThan(-1)
})

test('intro is mounted in the authenticated app shell', () => {
  const app = readFileSync(resolve(HERE, '..', 'App.tsx'), 'utf8')
  expect(app).toMatch(/AdmsBridgeIntro/)
})
