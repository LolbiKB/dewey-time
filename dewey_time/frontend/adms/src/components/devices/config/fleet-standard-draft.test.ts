import { test, expect, describe } from 'vitest'
import { nextDraft } from './fleet-standard-draft'

/**
 * The bug this exists to prevent, stated once:
 *
 * `FleetStandardField` is reused in place across a selection change (the
 * page's selection lives in the URL, no remount happens). Without this
 * function's decision applied on every render, a draft typed for one key
 * survives into the next: select Speaker volume, type nothing (draft stays
 * at stored `50`), switch to Screen brightness (stored `3`) — the box still
 * reads `50`, `changed` becomes true with no operator action, and Save
 * would silently commit `50` as Brightness's fleet standard.
 */

describe('nextDraft', () => {
  test('drops the old draft when the key changes, even if the operator had typed something', () => {
    // The draft belonged to the OLD key. Keeping it — even a value the
    // operator deliberately typed — would let it get saved against a
    // setting the operator never touched.
    expect(nextDraft('VOLUME', 'Brightness', '99-typed-for-volume', '3', '50')).toBe('3')
  })

  test('drops the old draft when the key changes and stored is null for the new key', () => {
    expect(nextDraft('VOLUME', 'Brightness', '50', null, '50')).toBe('')
  })

  test('follows a stored value that moved under an unchanged key, if the operator has not typed', () => {
    // The draft still equals what this component last showed as `stored` —
    // nothing the operator typed is at risk, so it is safe (and correct) to
    // pick up the fresher value from another operator's save or the poll.
    expect(nextDraft('VOLUME', 'VOLUME', '50', '55', '50')).toBe('55')
  })

  test('does NOT clobber an in-progress edit when stored moves under an unchanged key', () => {
    // The operator has typed something that differs from the stored value
    // this component last rendered with. Overwriting it because `stored`
    // changed underneath them would silently discard their edit.
    expect(nextDraft('VOLUME', 'VOLUME', '61', '55', '50')).toBe('61')
  })

  test('is a no-op when neither the key nor stored has moved', () => {
    expect(nextDraft('VOLUME', 'VOLUME', '61', '50', '50')).toBe('61')
  })

  test('trims before comparing so trailing whitespace does not read as a typed edit', () => {
    expect(nextDraft('VOLUME', 'VOLUME', '50 ', '55', '50')).toBe('55')
  })
})
