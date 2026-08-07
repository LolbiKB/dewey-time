import { test, expect, describe } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingDetail } from './setting-detail'
import { signalBadge } from '@/lib/signal'
import type { KeyPlan } from '@/lib/device-option-plan'

const PLAN: KeyPlan = {
  key: 'VOLUME', fleetStandard: '50',
  terminals: [
    { deviceSn: 'A', reported: '50', redacted: false, effective: '50', isOverride: false, verdict: 'matches' },
    { deviceSn: 'B', reported: '20', redacted: false, effective: '50', isOverride: false, verdict: 'will-change' },
  ],
  targetCount: 1,
}

const props = {
  optionKey: 'VOLUME', label: 'Speaker volume', hint: '',
  plan: PLAN, status: 'proven' as const, canaryInFlight: false,
  lastError: null, updatedBy: null, updatedAt: null,
  devices: [{ serial_number: 'A' }, { serial_number: 'B' }],
  writes: [], writesLoading: false, writesError: null,
  saving: false, pending: false,
  onSaveStandard: () => {}, onOverride: () => {}, onClearOverride: () => {},
  onCanary: () => {}, onApply: () => {},
}

/** Finds a single top-level button's opening+closing tags by its visible text. */
function buttonWithText(html: string, text: string): string | null {
  const re = new RegExp(`<button[^>]*>[^<]*${text}[^<]*</button>`)
  return html.match(re)?.[0] ?? null
}

describe('SettingDetail', () => {
  test('never says a queued write was applied', () => {
    // A terminal applies configuration when it NEXT POLLS. Any word like
    // "applied" is false for at least one poll cycle, and an operator who
    // believes it walks away from a fleet that has not changed.
    const html = renderToStaticMarkup(<SettingDetail {...props} pending />)
    expect(html).toMatch(/queued/i)
    expect(html).not.toMatch(/\bapplied\b/i)
  })

  test('states why Apply is unavailable instead of just disabling it', () => {
    // Anchored to the refusal's distinctive words rather than a phrase the
    // status badge alone would also satisfy: `describeKeyStatus('unproven')`
    // is "Not written yet — try it on one terminal first", which on its own
    // would make a bare /try it on one terminal/i check pass even if the
    // refusal paragraph were deleted entirely and the Apply button rendered
    // regardless. Asserting the button is gone is what actually pins "say
    // why, don't just disable".
    const html = renderToStaticMarkup(<SettingDetail {...props} status="unproven" />)
    expect(html).toMatch(/No terminal has accepted this key yet/i)
    expect(html).not.toMatch(/Apply .* to \d+ terminal/)
  })

  test('offers Apply with the target count when nothing blocks it', () => {
    const html = renderToStaticMarkup(<SettingDetail {...props} />)
    expect(html).toMatch(/apply .*1 terminal/i)
  })

  test('does not imply proven says anything about the fleet', () => {
    const html = renderToStaticMarkup(<SettingDetail {...props} />)
    expect(html).toContain('A terminal has accepted this key')
  })

  test('shows the key beside its label, not merely somewhere in the document', () => {
    // Anchored to adjacency: the key span must directly follow the label
    // heading with nothing between them. A bare `toContain('VOLUME')` also
    // passes off the FleetStandardField input's `id="standard-VOLUME"`, the
    // terminal Select's `aria-label`, and the table's override
    // `aria-label`s — none of which is "beside the label" and all of which
    // would survive deleting the header's own key span.
    const html = renderToStaticMarkup(<SettingDetail {...props} />)
    expect(html).toContain('Speaker volume')
    expect(html).toContain('VOLUME')
    expect(html).toMatch(/<h2[^>]*>Speaker volume<\/h2>\s*<span[^>]*>VOLUME<\/span>/)
  })

  describe('Apply never names a value it might not push', () => {
    test('says "the stored values" rather than a missing one when only overrides are set', () => {
      // applyRefusal allows Apply through here — an override alone is enough
      // to have something to push (device-option-apply-gate.test.ts) — so
      // `plan.fleetStandard` is null while the button still renders. Naming
      // it directly would print "Apply  to 1 terminal": a promise with no
      // visible value.
      const plan: KeyPlan = {
        key: 'VOLUME', fleetStandard: null,
        terminals: [
          { deviceSn: 'A', reported: '20', redacted: false, effective: '20', isOverride: true, verdict: 'matches' },
          { deviceSn: 'B', reported: '10', redacted: false, effective: '30', isOverride: true, verdict: 'will-change' },
        ],
        targetCount: 1,
      }
      const html = renderToStaticMarkup(<SettingDetail {...props} plan={plan} />)
      const applyButton = buttonWithText(html, 'Apply')
      expect(applyButton).not.toBeNull()
      expect(applyButton).toMatch(/Apply the stored values to 1 terminal/i)
      expect(applyButton).not.toMatch(/Apply\s+to/i)
      expect(applyButton).not.toMatch(/>Apply null/i)
    })

    test('does not name a whitespace-only stored standard, which renders as nothing', () => {
      // Non-null but invisible: "Apply    to 1 terminal" is the same promise
      // with no visible value as the null case above, one step along. The UI
      // cannot store one — the field saves trimmed — but an API row can.
      const plan: KeyPlan = { ...PLAN, fleetStandard: '   ' }
      const html = renderToStaticMarkup(<SettingDetail {...props} plan={plan} />)
      const applyButton = buttonWithText(html, 'Apply')
      expect(applyButton).not.toBeNull()
      expect(applyButton).toMatch(/Apply the stored values to 1 terminal/i)
      expect(applyButton).not.toMatch(/Apply\s\s+to/i)
    })

    test('says "the stored values" rather than overclaiming when an override is also a target', () => {
      // A fleet standard of 50 does not land on terminal B — its override
      // (30) does. "Apply 50 to 2 terminals" would say the wrong thing for
      // one of the two.
      const plan: KeyPlan = {
        key: 'VOLUME', fleetStandard: '50',
        terminals: [
          { deviceSn: 'A', reported: '20', redacted: false, effective: '50', isOverride: false, verdict: 'will-change' },
          { deviceSn: 'B', reported: '10', redacted: false, effective: '30', isOverride: true, verdict: 'will-change' },
        ],
        targetCount: 2,
      }
      const html = renderToStaticMarkup(<SettingDetail {...props} plan={plan} />)
      const applyButton = buttonWithText(html, 'Apply')
      expect(applyButton).not.toBeNull()
      expect(applyButton).toMatch(/Apply the stored values to 2 terminals/i)
      expect(applyButton).not.toMatch(/Apply 50 to/i)
    })

    test('still names the single stored value when no override is a target', () => {
      // The common case, and the one the earlier "offers Apply with the
      // target count" test already covers implicitly — pinned again here
      // directly against the button so a regression that makes EVERY apply
      // say "the stored values" (losing the useful specific case) also fails.
      const html = renderToStaticMarkup(<SettingDetail {...props} />)
      const applyButton = buttonWithText(html, 'Apply')
      expect(applyButton).toMatch(/Apply 50 to 1 terminal/i)
    })
  })

  test('disables Apply while a write for this key is already queued', () => {
    // applyRefusal does not know about `pending` (it only sees
    // canaryInFlight) — this pane is the only guard, and without it a
    // fleet-wide Apply could be queued twice from two clicks while the
    // first is still in flight.
    //
    // Anchored to the literal `disabled=""` boolean-attribute rendering, not
    // a bare /disabled/ regex: the Button primitive's class string always
    // contains the Tailwind variants `disabled:pointer-events-none
    // disabled:opacity-50` whether or not the button is actually disabled,
    // so /disabled/ matches every button unconditionally and would not have
    // caught the guard being dropped (confirmed by mutation: removing
    // `disabled={pending}` left a bare /disabled/ assertion green).
    const html = renderToStaticMarkup(<SettingDetail {...props} pending />)
    const applyButton = buttonWithText(html, 'Apply')
    expect(applyButton).not.toBeNull()
    expect(applyButton).toContain('disabled=""')
  })

  test('disables Try when there is no fleet standard to send', () => {
    // D3: the canary sends the stored fleet standard, never a separate box.
    // With nothing stored there is nothing to send, so Try must refuse
    // rather than firing an empty value. Same `disabled=""` anchor as above.
    const plan: KeyPlan = { ...PLAN, fleetStandard: null }
    const html = renderToStaticMarkup(<SettingDetail {...props} plan={plan} />)
    const tryButton = buttonWithText(html, 'Try')
    expect(tryButton).not.toBeNull()
    expect(tryButton).toContain('disabled=""')
  })

  test('a key refused on a previous try gets the unsupported badge and a way back', () => {
    const html = renderToStaticMarkup(<SettingDetail {...props} status="unsupported" />)
    expect(html).toContain('A terminal refused this value')
    expect(html).toMatch(/different value/i)
  })

  test('says there is nothing to try on when no terminal is approved', () => {
    const plan: KeyPlan = { ...PLAN, terminals: [], targetCount: 0 }
    const html = renderToStaticMarkup(<SettingDetail {...props} plan={plan} devices={[]} />)
    expect(html).toMatch(/no approved terminal/i)
    expect(html).not.toContain('Try ')
  })

  test('passes real device names through to the terminal table, not just serials', () => {
    const devices = [{ serial_number: 'A', name: 'Front Desk', location: 'Lobby' }, { serial_number: 'B' }]
    const html = renderToStaticMarkup(<SettingDetail {...props} devices={devices} />)
    expect(html).toContain('Front Desk')
  })

  describe('the status badge tone follows the ladder rung, not merely which words it uses', () => {
    // `describeKeyStatus`'s own tests already pin the WORDS; these pin the
    // COLOUR, which nothing else asserts. `unsupported` gets danger rather
    // than idle deliberately — a terminal DID answer, and answered no — the
    // same way `device-detail-dialog.tsx` maps its own rejected state to
    // `signalBadge.danger`. Anchored to the class token appearing beside the
    // status text specifically, not merely present anywhere in the page.
    test('proven gets the success tone', () => {
      const html = renderToStaticMarkup(<SettingDetail {...props} status="proven" />)
      expect(html).toMatch(
        new RegExp(`class="[^"]*${signalBadge.success}[^"]*"[^>]*>[^<]*A terminal has accepted this key`)
      )
    })

    test('unsupported gets the danger tone', () => {
      const html = renderToStaticMarkup(<SettingDetail {...props} status="unsupported" />)
      expect(html).toMatch(
        new RegExp(`class="[^"]*${signalBadge.danger}[^"]*"[^>]*>[^<]*A terminal refused this value`)
      )
    })

    test('unproven gets the idle tone, not danger — never tried is not the same as failed', () => {
      const html = renderToStaticMarkup(<SettingDetail {...props} status="unproven" />)
      expect(html).toMatch(
        new RegExp(`class="[^"]*${signalBadge.idle}[^"]*"[^>]*>[^<]*Not written yet`)
      )
    })
  })
})

// The canary-target reconciliation (`nextCanaryTarget`) is pinned directly in
// setting-detail-target.test.ts — it moved to its own module so
// `SettingDetail`'s file exports only the component, which
// react-refresh/only-export-components requires.
