import { describe, it, expect } from 'vitest'
import {
  SIGNALS,
  signalText,
  signalDot,
  signalBorder,
  signalTile,
  signalBadge,
  signalAlert,
} from './signal'

const MAPS = {
  signalText,
  signalDot,
  signalBorder,
  signalTile,
  signalBadge,
  signalAlert,
} as const

// Raw Tailwind palette names — signal classes must use tokens only.
const RAW_COLOR =
  /\b(red|orange|amber|yellow|green|emerald|lime|teal|cyan|blue|indigo|violet|purple|fuchsia|pink|rose|sky|gray|slate|zinc|neutral|stone)-\d/

describe('signal system', () => {
  for (const [name, map] of Object.entries(MAPS)) {
    describe(name, () => {
      it('has a non-empty entry for every signal', () => {
        for (const s of SIGNALS) expect(map[s], s).toBeTruthy()
      })
      it('uses only token utilities (no raw color literals)', () => {
        for (const s of SIGNALS) expect(map[s], `${name}.${s}`).not.toMatch(RAW_COLOR)
      })
    })
  }

  it('anchors the canonical mappings', () => {
    expect(signalText.success).toBe('text-primary')
    expect(signalText.danger).toBe('text-destructive')
    expect(signalText.idle).toBe('text-muted-foreground')
    expect(signalDot.progress).toBe('bg-progress')
    expect(signalBorder.attention).toBe('border-attention')
    expect(signalBadge.attention).toContain('bg-attention/10')
  })

  it('tiles keep a neutral surface — accent on the border, never a signal fill', () => {
    for (const s of SIGNALS) {
      expect(signalTile[s]).toContain('bg-card')
      expect(signalTile[s]).not.toMatch(/\bbg-(primary|attention|destructive|progress)\b/)
    }
  })
})
