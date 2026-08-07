import { describe, test, expect } from 'vitest'
import { applyNote, rereadNote } from './fleet-action-note'

/** The page labels a terminal by name; the tests pin that it is used. */
const label = (sn: string) => (sn === 'A' ? 'Front door' : sn)

describe('applyNote', () => {
  test('counts what the SERVER queued, not what the page previewed', () => {
    // `plan.targetCount` is an estimate computed from the last INFO dump; the
    // bridge recomputes against current state and its number is the one that
    // happened.
    expect(applyNote('VOLUME', { success: true, queued: 3 })).toBe(
      'VOLUME queued for 3 terminals — each applies when it next polls.'
    )
  })

  test('says queued, never applied — the terminal has not been asked yet', () => {
    const note = applyNote('VOLUME', { success: true, queued: 1 })
    expect(note).toBe('VOLUME queued for 1 terminal — each applies when it next polls.')
    expect(note).not.toMatch(/\bapplied\b/i)
  })

  test('prefers the bridge’s own wording when nothing was queued', () => {
    expect(
      applyNote('VOLUME', { success: true, queued: 0, message: 'Every terminal already reports 50.' })
    ).toBe('Every terminal already reports 50.')
  })

  test('falls back to a plain statement of agreement when the bridge said nothing', () => {
    expect(applyNote('VOLUME', { success: true, queued: 0 })).toBe(
      'Every terminal already matches VOLUME.'
    )
  })

  test('names the terminals whose value was withheld, so agreement is not implied for them', () => {
    const note = applyNote('VOLUME', {
      success: true,
      queued: 2,
      unverifiable: ['PYA8261900039', 'PYA8261900038'],
    })
    expect(note).toContain('queued for 2 terminals')
    expect(note).toContain(
      'Could not compare PYA8261900039, PYA8261900038 — their value is withheld.'
    )
  })
})

describe('rereadNote', () => {
  test('says queued, never refreshed — a terminal answers when it next polls', () => {
    const note = rereadNote(
      [
        { deviceSn: 'A', queued: true },
        { deviceSn: 'B', queued: true },
      ],
      label
    )
    expect(note).toBe(
      'A configuration read is queued for 2 terminals — each answers when it next polls.'
    )
    expect(note).not.toMatch(/refresh/i)
  })

  test('names the terminals it could not queue rather than reporting a round number', () => {
    const note = rereadNote(
      [
        { deviceSn: 'A', queued: false },
        { deviceSn: 'B', queued: true },
      ],
      label
    )
    expect(note).toContain('queued for 1 of 2 terminals')
    expect(note).toContain('Could not queue one for Front door.')
  })

  test('claims nothing was queued when nothing was', () => {
    const note = rereadNote(
      [
        { deviceSn: 'A', queued: false },
        { deviceSn: 'B', queued: false },
      ],
      label
    )
    expect(note).toBe('Could not queue a configuration read for Front door, B.')
    expect(note).not.toMatch(/is queued/)
  })

  test('an empty fleet is stated as such, not as a successful read of nothing', () => {
    expect(rereadNote([], label)).toBe('No approved terminal to read from.')
  })
})
