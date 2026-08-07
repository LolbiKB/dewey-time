import { describe, test, expect } from 'vitest'
import { describeKeyStatus, describeLastError } from './option-key-copy'

describe('describeKeyStatus', () => {
  test('proven does not claim more than one terminal accepting the key once', () => {
    expect(describeKeyStatus('proven')).toMatch(/terminal has accepted/i)
    expect(describeKeyStatus('proven').toLowerCase()).not.toContain('applied')
  })

  test('unsupported says a terminal refused it', () => {
    expect(describeKeyStatus('unsupported')).toMatch(/refused/i)
  })

  test('unproven is not worded as a failure', () => {
    const text = describeKeyStatus('unproven')
    expect(text.toLowerCase()).not.toContain('fail')
    expect(text).toMatch(/try it on one terminal first/i)
  })
})

describe('describeLastError', () => {
  test('is null when there is no code', () => {
    expect(describeLastError(null)).toBeNull()
    expect(describeLastError(undefined)).toBeNull()
    expect(describeLastError('')).toBeNull()
  })

  test('a device code is passed through verbatim, not swallowed into prose', () => {
    expect(describeLastError('-1002')).toBe('The terminal answered -1002')
  })

  describe('delivery failures — never worded as a device refusal', () => {
    test('set_not_delivered', () => {
      const text = describeLastError('set_not_delivered')
      expect(text).toMatch(/never reached the terminal/i)
      expect(text?.toLowerCase()).not.toContain('refused')
    })

    test('reload_not_delivered', () => {
      const text = describeLastError('reload_not_delivered')
      expect(text).toMatch(/never reloaded its configuration/i)
      expect(text?.toLowerCase()).not.toContain('refused')
    })

    test('never_answered', () => {
      const text = describeLastError('never_answered')
      expect(text).toMatch(/never answered/i)
      expect(text?.toLowerCase()).not.toContain('refused')
    })
  })

  describe('bridge-side queue failures — the device was never asked', () => {
    // Same defect the set_not_delivered case was written to prevent: blaming
    // the hardware for a bridge failure sends the operator to check firmware
    // support for a key that was never sent.
    test('set_queue_failed', () => {
      const text = describeLastError('set_queue_failed')
      expect(text).toMatch(/could not even be queued/i)
      expect(text?.toLowerCase()).not.toContain('refused')
    })

    test('reload_queue_failed', () => {
      const text = describeLastError('reload_queue_failed')
      expect(text).toMatch(/could not queue the reload/i)
      expect(text?.toLowerCase()).not.toContain('refused')
    })

    test('info_queue_failed', () => {
      const text = describeLastError('info_queue_failed')
      expect(text).toMatch(/could not queue the read-back/i)
      expect(text?.toLowerCase()).not.toContain('refused')
    })

    test('chain_link_failed', () => {
      const text = describeLastError('chain_link_failed')
      expect(text).toMatch(/lost track of which commands belonged to it/i)
      expect(text?.toLowerCase()).not.toContain('refused')
    })

    test('abandoned', () => {
      const text = describeLastError('abandoned')
      expect(text).toMatch(/cancelled before it could reach the terminal/i)
      expect(text?.toLowerCase()).not.toContain('refused')
    })
  })
})
