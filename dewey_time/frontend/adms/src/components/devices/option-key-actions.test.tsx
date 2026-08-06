import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OptionKeyActions } from './option-key-actions'
import { describeKeyStatus, describeLastError } from './option-key-copy'

/**
 * The write controls on the fleet config page.
 *
 * THE GATE THESE RENDER IS ENFORCED SERVER-SIDE, and nothing here is a security
 * control — a direct POST to the bridge is refused whatever this component
 * draws. What it CAN do is lie: offer an action the server will refuse, or
 * report a queued command as a finished one.
 *
 * That second one is the sharp edge. A ZKTeco terminal applies configuration
 * when it next POLLS. Anything that reads as done is false for at least one
 * poll cycle, and the operator who believes it walks away from a fleet that has
 * not changed yet.
 */

const noop = () => {}
const devices = ['PYA8254100003', 'PYA8261900039']

describe('OptionKeyActions', () => {
  test('offers only a single-terminal try for an unproven key', () => {
    const html = renderToStaticMarkup(
      <OptionKeyActions
        status="unproven"
        optionKey="VOLUME"
        devices={devices}
        onCanary={noop}
        onApply={noop}
      />
    )
    expect(html).toMatch(/one terminal/i)
    expect(html).not.toMatch(/apply to all/i)
  })

  test('offers fleet apply once proven', () => {
    const html = renderToStaticMarkup(
      <OptionKeyActions
        status="proven"
        optionKey="VOLUME"
        devices={devices}
        onCanary={noop}
        onApply={noop}
      />
    )
    expect(html).toMatch(/apply to all/i)
  })

  test('offers NO write action for an unsupported key, and says why', () => {
    const html = renderToStaticMarkup(
      <OptionKeyActions
        status="unsupported"
        optionKey="DtFmt"
        devices={devices}
        lastError="-1"
        onCanary={noop}
        onApply={noop}
      />
    )
    expect(html).not.toMatch(/apply to all/i)
    expect(html).toContain('-1')
  })

  test('still offers a canary for an unsupported key — that is the only way back', () => {
    // The ladder is per-KEY while the evidence is per-(key, value), so
    // `unsupported` also covers a writable key refused for ONE value. Hiding the
    // canary would strand it permanently.
    const html = renderToStaticMarkup(
      <OptionKeyActions
        status="unsupported"
        optionKey="DtFmt"
        devices={devices}
        lastError="-1"
        onCanary={noop}
        onApply={noop}
      />
    )
    expect(html).toMatch(/one terminal/i)
  })

  test('never claims success on enqueue', () => {
    // A device applies config when it next polls. Anything that reads as done
    // is a lie for at least one poll cycle.
    const html = renderToStaticMarkup(
      <OptionKeyActions
        status="proven"
        optionKey="VOLUME"
        devices={devices}
        pending
        onCanary={noop}
        onApply={noop}
      />
    )
    expect(html).toMatch(/queued|verifying/i)
    expect(html).not.toMatch(/\bapplied\b|\bdone\b|\bsuccess\b/i)
  })

  /**
   * The window where the ladder says `proven` and the server says 409.
   *
   * `deriveKeyStatus` treats a pending canary as no evidence — correctly — so
   * the status falls back to the older proof. The bridge refuses apply anyway,
   * for up to thirty minutes. Rendering Apply as available here means the
   * operator learns the rule by clicking it.
   */
  test('withholds fleet apply while a canary is still unanswered', () => {
    const html = renderToStaticMarkup(
      <OptionKeyActions
        status="proven"
        optionKey="VOLUME"
        devices={devices}
        canaryInFlight
        onCanary={noop}
        onApply={noop}
      />
    )
    expect(html).not.toMatch(/apply to all/i)
    expect(html).toMatch(/waiting|still|answer/i)
  })

  test('restores fleet apply once the canary resolves', () => {
    const html = renderToStaticMarkup(
      <OptionKeyActions
        status="proven"
        optionKey="VOLUME"
        devices={devices}
        canaryInFlight={false}
        onCanary={noop}
        onApply={noop}
      />
    )
    expect(html).toMatch(/apply to all/i)
  })

  test('names the terminals a canary can target', () => {
    const html = renderToStaticMarkup(
      <OptionKeyActions
        status="unproven"
        optionKey="VOLUME"
        devices={devices}
        onCanary={noop}
        onApply={noop}
      />
    )
    for (const sn of devices) expect(html).toContain(sn)
  })

  test('offers nothing to write when no terminal is available', () => {
    const html = renderToStaticMarkup(
      <OptionKeyActions status="unproven" optionKey="VOLUME" devices={[]} onCanary={noop} onApply={noop} />
    )
    expect(html).not.toMatch(/apply to all/i)
    expect(html).toMatch(/no approved terminal/i)
  })
})

describe('describeKeyStatus', () => {
  test('says unsupported plainly rather than implying a retry will help', () => {
    expect(describeKeyStatus('unsupported')).toMatch(/refused/i)
  })

  test('does not describe unproven as broken', () => {
    // Never tried is not the same as failed.
    expect(describeKeyStatus('unproven')).not.toMatch(/fail|error|refus/i)
  })

  test('does not claim a proven key is applied everywhere', () => {
    // `proven` means one terminal accepted it once. It says nothing about the
    // rest of the fleet, and a word like "applied" would imply otherwise.
    expect(describeKeyStatus('proven')).not.toMatch(/\ball\b|everywhere|fleet/i)
  })
})

/**
 * `lastError` is not always a device refusal any more.
 *
 * Abandoned writes carry `set_not_delivered` / `reload_not_delivered`, which
 * mean the command never reached the terminal. Wording those as a refusal blames
 * the hardware for a delivery failure and sends the operator to the wrong place.
 */
describe('describeLastError', () => {
  test('distinguishes a delivery failure from a refusal', () => {
    const set = describeLastError('set_not_delivered')
    expect(set).toMatch(/reach|deliver/i)
    expect(set).not.toMatch(/refus/i)

    const reload = describeLastError('reload_not_delivered')
    expect(reload).toMatch(/reach|deliver|reload/i)
    expect(reload).not.toMatch(/refus/i)
  })

  test('says an unanswered write was never answered, not that it was refused', () => {
    // The most common abandonment: the terminal was offline. Wording it as a
    // refusal would send the operator to look at firmware support for the key.
    const s = describeLastError('never_answered')
    expect(s).toMatch(/never answered|no answer/i)
    expect(s).not.toMatch(/refus/i)
  })

  test('passes a device code through rather than inventing prose for it', () => {
    // Appendix 1 codes are the terminal's own words and the only actionable
    // part of a refusal. Never swallow one.
    expect(describeLastError('-1')).toContain('-1')
  })

  test('says nothing when there is nothing to say', () => {
    expect(describeLastError(null)).toBeNull()
  })
})
