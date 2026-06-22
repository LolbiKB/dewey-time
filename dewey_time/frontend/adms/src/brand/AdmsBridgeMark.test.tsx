import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdmsBridgeMark, ADMS_BRIDGE_PATH } from './AdmsBridgeMark'

const HERE = dirname(fileURLToPath(import.meta.url))

test('renders the glyph + orange pen as one continuous path each, decorative', () => {
  const html = renderToStaticMarkup(<AdmsBridgeMark />)
  expect(html).toMatch(/class="adms-glyph"/)
  expect(html).toMatch(/class="adms-pen"/)
  expect(html).toMatch(/aria-hidden/)
  // the one shared route path, not separate circles/lines
  expect(html).toContain('M10.586 5.414')
})

test('the single path traces all three bridge connectors in route order', () => {
  expect(ADMS_BRIDGE_PATH).toContain('L5.414 10.586') // connector 1 (top → left)
  expect(ADMS_BRIDGE_PATH).toContain('M6 12 L18 12') // connector 2 (left → right)
  expect(ADMS_BRIDGE_PATH).toContain('L13.414 18.586') // connector 3 (right → bottom)
})

test('color rides the brand tokens (no hardcoded brand hex)', () => {
  const css = readFileSync(resolve(HERE, 'brand-motion.css'), 'utf8')
  expect(css).toMatch(/\.adms-glyph[^}]*stroke:\s*var\(--primary\)/)
  expect(css).toMatch(/\.adms-pen[^}]*stroke:\s*var\(--signal-attention\)/)
  expect(/#066031/i.test(css)).toBe(false)
  expect(/#c2410c/i.test(css)).toBe(false)
})

test('dash-draw is minifier-safe: no pathLength, draw blanks to the dash length', () => {
  // pathLength normalization makes dasharray unitless while the minifier emits
  // `stroke-dashoffset:100px` — that mismatch breaks the draw. Guard against it.
  const html = renderToStaticMarkup(<AdmsBridgeMark />)
  expect(html).not.toMatch(/pathLength/)
  const css = readFileSync(resolve(HERE, 'brand-motion.css'), 'utf8')
  const dash = css.match(/\.adms-glyph[^}]*stroke-dasharray:\s*(\d+)/)?.[1]
  const drawFrom = css.match(/@keyframes adms-draw\s*\{\s*from\s*\{\s*stroke-dashoffset:\s*(\d+)/)?.[1]
  expect(dash).toBeDefined()
  expect(drawFrom).toBe(dash) // the draw starts fully blank (offset == dash length) and fills to 0
})
