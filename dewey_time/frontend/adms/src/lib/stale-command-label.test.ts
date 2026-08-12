import { test, expect, describe } from 'vitest'
import { describeStaleCommand, isFingerprintTemplatePush } from './stale-command-label'

describe('describeStaleCommand', () => {
  test('a command that was never sent is not described as awaiting an ACK', () => {
    // THE BUG THIS MODULE EXISTS FOR. The modal printed the literal
    // 'waiting for device ACK' whenever error_message was null, with no regard
    // for whether the command had ever been sent. On 2026-08-12 that made
    // command #7215 — status `pending`, sent_at null, sitting in the queue of a
    // terminal that had been OFFLINE for five days — read as though a device
    // had taken it and gone quiet. It sent the on-call reader looking for a
    // bridge fault when the answer was an unplugged terminal.
    const label = describeStaleCommand({ status: 'pending', command: 'C:7215:DATA UPDATE USERINFO PIN=146' })
    expect(label).not.toMatch(/ACK/i)
    expect(label).toMatch(/has not polled|hasn't polled/i)
  })

  test('a command actually in the device\'s hands still says awaiting an ACK', () => {
    // The other half: `sent` means the bridge handed it over and heard nothing
    // back, which is exactly what the original copy described. Keeping this
    // distinct from the pending case is the whole point.
    const label = describeStaleCommand({ status: 'sent', command: 'C:1:DATA UPDATE USERINFO PIN=1' })
    expect(label).toMatch(/waiting for device ACK/i)
  })

  test("the device's own error message wins over any generated description", () => {
    // A real error_message is the most specific thing anyone has; never bury it.
    const label = describeStaleCommand({
      status: 'sent',
      command: 'C:1:DATA UPDATE USERINFO PIN=1',
      error_message: 'device refused: -3',
    })
    expect(label).toBe('device refused: -3')
  })

  test('a biometric template push is described by what it is doing', () => {
    const label = describeStaleCommand({
      status: 'sent',
      command: 'C:9:DATA UPDATE FINGERTMP PIN=1',
    })
    expect(label).toMatch(/pushing template/i)
  })

  test('a template push that was never sent is still not an ACK wait', () => {
    // Ordering guard: the template branch must not swallow the pending case
    // into ACK language, and must not claim a push is underway when the device
    // has not collected it.
    const label = describeStaleCommand({
      status: 'pending',
      command: 'C:9:DATA UPDATE FINGERTMP PIN=1',
    })
    expect(label).not.toMatch(/ACK/i)
  })

  test('an empty error message does not blank the label', () => {
    // '' is falsy, so a row carrying an empty string must fall through to a
    // real description rather than rendering nothing at all.
    const label = describeStaleCommand({ status: 'sent', command: 'C:1:X', error_message: '' })
    expect(label.trim()).not.toBe('')
  })
})

describe('isFingerprintTemplatePush', () => {
  test('recognises fingerprint and face template pushes, with or without the C: prefix', () => {
    expect(isFingerprintTemplatePush('C:1:DATA UPDATE FINGERTMP PIN=1')).toBe(true)
    expect(isFingerprintTemplatePush('DATA UPDATE FACE PIN=1')).toBe(true)
  })

  test('a plain user push is not a template push', () => {
    expect(isFingerprintTemplatePush('C:1:DATA UPDATE USERINFO PIN=1')).toBe(false)
    expect(isFingerprintTemplatePush(undefined)).toBe(false)
  })
})
