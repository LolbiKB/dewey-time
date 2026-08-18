import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ZK_PROTOCOL_FINGER_GRID_LETTERS,
  ZK_PROTOCOL_FINGER_LABELS,
} from './zk-finger-fid'

/**
 * This table is the INPUT side of a number the employee later reads as words.
 *
 * An operator picks a finger here; the FID travels to the device, comes back on
 * the device's own operlog record, reaches Frappe, and `finger_slots.py` turns
 * it into the slug the Mini App renders on that employee's phone. Two separate
 * tables in two languages therefore describe one integer, and if they ever
 * disagree the app tells someone they enrolled a finger the operator never
 * selected — silently, and only for the FIDs that drifted.
 *
 * So the Python is the source of truth and this reads it directly. Correcting
 * the mapping means editing `finger_slots.py`; these tests then fail until this
 * file follows, which is the point.
 */
function pythonFingerSlugs(): Map<number, string> {
  const path = fileURLToPath(
    new URL('../../../../attendance_engine/finger_slots.py', import.meta.url)
  )
  const source = readFileSync(path, 'utf8')

  const table = /FINGER_SLUGS\s*=\s*\{([\s\S]*?)\}/.exec(source)
  if (!table) throw new Error('FINGER_SLUGS not found — has finger_slots.py moved?')

  const slugs = new Map<number, string>()
  for (const [, fid, slug] of table[1].matchAll(/(\d+)\s*:\s*"([a-z_]+)"/g)) {
    slugs.set(Number(fid), slug)
  }
  return slugs
}

/** 'L-Index' -> 'left_index', the shape finger_slots.py speaks. */
function labelToSlug(label: string): string {
  const [hand, finger] = label.split('-')
  return `${hand === 'L' ? 'left' : hand === 'R' ? 'right' : hand}_${finger?.toLowerCase()}`
}

describe('the operator picker agrees with finger_slots.py', () => {
  const python = pythonFingerSlugs()

  // Guards the regex above: a parse that silently found nothing would make
  // every per-FID assertion below vacuous.
  it('reads all ten slots out of the Python', () => {
    expect(python.size).toBe(10)
    expect([...python.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('names the same finger for every FID', () => {
    const ours = Object.fromEntries(
      Object.entries(ZK_PROTOCOL_FINGER_LABELS).map(([fid, label]) => [fid, labelToSlug(label)])
    )
    const theirs = Object.fromEntries([...python].map(([fid, slug]) => [String(fid), slug]))
    expect(ours).toEqual(theirs)
  })

  it('shows a grid letter that belongs to the finger it names', () => {
    // The letter is what the operator actually SEES on the button; the full
    // label is only a hover title, so a wrong letter misleads in silence.
    for (const [fid, slug] of python) {
      const finger = slug.split('_')[1]
      expect(ZK_PROTOCOL_FINGER_GRID_LETTERS[fid]).toBe(finger[0].toUpperCase())
    }
  })
})
