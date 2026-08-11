# Rollout Phases — Phase B (Surfaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR can see, on screen, when they are looking at pilot data or at a day the system was not yet watching.

**Architecture:** Phase A already returns everything needed — a `rollout` block on the flag-queue payload and a `rollout_phase` on every calendar day. This adds the two surfaces that read them: a banner above the flag queue, and a "Before go-live" chip on pre-cutoff calendar days. Banner copy is a pure function in `lib/`, so every state is testable without rendering.

**Tech Stack:** React 19 + TypeScript + Vite, `date-fns`, tested with `tsx --test` and `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-08-10-rollout-phases-design.md` (§ "Phase B") · Phase A shipped in #149.

## Global Constraints

- **No Python. No `bench migrate`. No cache-prefix bump.** Phase A deliberately landed both payloads so this pass touches no backend; `flag_queue:v3` → `v4` already happened in #149. If you find yourself editing a `.py` file, stop — something is wrong with the plan, not the backend.
- **`rollout` is a REQUIRED field on `QueuePayload`, not optional.** The existing comment on `outage_dates` in `src/types/flags.ts` records the rule: the queue's cache prefix is versioned by payload shape, and it was bumped when `rollout` was added, so a pre-deploy cache entry can never reach code expecting the field. Typing it optional would invite defensive `?.` chains that hide a real breakage.
- **Built assets are the deployed artifact and must be committed.** Frappe Cloud never builds this SPA (private `@lolbikb/dewey-ui` dependency). Task 4 covers the rebuild.
- Frontend baseline before this plan: **690 tests**. Report deltas, never absolutes.
- Commit trailers on every commit: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A`.

All paths are relative to `dewey_time/frontend/hr_attendance/`.

## The payload Phase A actually returns

Read from `flag_queue_api._rollout_block` / `_rollout_window`. This is the contract; do not re-derive it.

```json
"rollout": {
  "phases_configured": true,
  "range_phase": "LIVE" | "TESTING" | "MIXED",
  "testing_flag_count": 12,
  "total_flag_count": 40,
  "windows": [{ "branch": "Northgate" | null, "testing_start": "2026-08-15" | null, "go_live": "2026-09-01" | null }]
}
```

Two scopes, deliberately different, and the banner must respect both:

- `range_phase` and `windows` describe **the dates asked for**, computed over every flag in range regardless of tier filter. A tier filter must not make the pilot banner vanish.
- `testing_flag_count` / `total_flag_count` describe **the visible list**, post-filter. `"0 of 1"` is a legal, correct answer.

## Two gaps in the spec's banner table, closed here

The spec's table assumes every window has both dates. Neither of these is exotic:

**1. `go_live: null` is the normal ongoing pilot.** `rollout.phase_for` (`rollout.py:106`) reads `if go_live is None or day < go_live: return TESTING` — a window with no go-live is TESTING *indefinitely*. That is exactly the state after setting a testing start and not yet choosing a go-live date, so it is likely the **first** thing this banner ever renders. The spec's row would produce "Aug 15 – null is the pilot period".

**2. Both dates null.** `_rollout_window`'s docstring: a branch whose flags are pilot flags but whose configured dates were cleared since. Phase A hands Phase B the nulls rather than fabricating a range.

Resolution — a single window renders one of three period phrases, then the shared tail:

| Window | Phrase |
|---|---|
| both dates set | `Aug 15 – Sep 1 is the pilot period` |
| `testing_start` set, `go_live` null | `Aug 15 onward is the pilot period` |
| `testing_start` null | `This range falls in the pilot period` |

The third reuses the many-window sentence opener already in the spec, so the copy stays consistent rather than inventing a fourth shape. In all three, never drop the banner: `range_phase` is `TESTING` because real pilot flags are in range, and saying nothing would hide that.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/types/flags.ts` | *Modify.* `RolloutPhase`, `RolloutWindow`, `RolloutBlock`; `rollout` on `QueuePayload`. | 1 |
| `src/types/calendar.ts` | *Modify.* `rollout_phase` on `Day`. | 1 |
| `src/lib/rolloutBanner.ts` | *Create.* `rolloutBannerMessage()` — all copy, pure. | 1 |
| `src/lib/rolloutBanner.test.ts` | *Create.* Every state in the table above. | 1 |
| `src/ui/FlagQueuePage.tsx` | *Modify.* Render the banner. | 2 |
| `src/ui/flagQueueBanner.test.tsx` | *Create.* The banner renders and is absent when it should be. | 2 |
| `src/ui/DayChips.tsx` | *Modify.* "Before go-live" chip. | 3 |
| `src/ui/DayChips.test.tsx` | *Modify.* Chip present on PRELAUNCH, absent otherwise. | 3 |
| `dewey_time/public/**`, `dewey_time/www/*.html` | *Modify.* Rebuild. | 4 |
| `docs/ROLLOUT_PUNCH_LIST.md`, the spec | *Modify.* Record Phase B shipped. | 4 |

---

### Task 1: Types and the banner copy

**Files:**
- Modify: `src/types/flags.ts`, `src/types/calendar.ts`
- Create: `src/lib/rolloutBanner.ts`, `src/lib/rolloutBanner.test.ts`

**Interfaces:**
- Produces: `RolloutPhase = "PRELAUNCH" | "TESTING" | "LIVE"`, `RolloutWindow`, `RolloutBlock` (all exported from `@/types/flags`); `rolloutBannerMessage(rollout: RolloutBlock | undefined): string | null` from `@/lib/rolloutBanner`. Tasks 2 and 3 consume these.
- `Day.rollout_phase?: RolloutPhase` is optional — `hr_calendar` has no cache prefix to version, so a stale payload genuinely can arrive one field short.

- [ ] **Step 1: Write the failing test**

Create `src/lib/rolloutBanner.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { rolloutBannerMessage } from "./rolloutBanner";
import type { RolloutBlock, RolloutWindow } from "@/types/flags";

function block(over: Partial<RolloutBlock> = {}): RolloutBlock {
  return {
    phases_configured: true,
    range_phase: "TESTING",
    testing_flag_count: 0,
    total_flag_count: 0,
    windows: [],
    ...over,
  };
}

const win = (over: Partial<RolloutWindow> = {}): RolloutWindow => ({
  branch: "Northgate",
  testing_start: "2026-08-15",
  go_live: "2026-09-01",
  ...over,
});

test("no rollout block at all is silent", () => {
  assert.equal(rolloutBannerMessage(undefined), null);
});

test("unconfigured phases say nothing", () => {
  // The safe upgrade default: no dates set anywhere means the system behaves
  // exactly as it did before rollout phases existed, and a banner would be
  // announcing a pilot nobody started.
  assert.equal(rolloutBannerMessage(block({ phases_configured: false })), null);
});

test("an all-live range says nothing", () => {
  assert.equal(rolloutBannerMessage(block({ range_phase: "LIVE" })), null);
});

test("a single named-branch window names the branch and both dates", () => {
  const msg = rolloutBannerMessage(block({ windows: [win()] }));
  assert.equal(
    msg,
    "Aug 15 – Sep 1 is the pilot period for Northgate — calibration data, not the official record.",
  );
});

test("a branchless window drops the branch clause and keeps the dates", () => {
  // The likeliest real rollout: global dates over a roster where most
  // employees have no branch set. Naming no branch is the honest form.
  const msg = rolloutBannerMessage(block({ windows: [win({ branch: null })] }));
  assert.equal(
    msg,
    "Aug 15 – Sep 1 is the pilot period — calibration data, not the official record.",
  );
});

test("no go-live yet reads as open-ended, not as a broken range", () => {
  // rollout.phase_for: `go_live is None` means TESTING indefinitely. This is
  // the state between setting a testing start and choosing a go-live date, so
  // it is probably the first banner ever rendered -- and the spec's table
  // would have printed "Aug 15 – null is the pilot period" here.
  const msg = rolloutBannerMessage(block({ windows: [win({ go_live: null })] }));
  assert.equal(
    msg,
    "Aug 15 onward is the pilot period for Northgate — calibration data, not the official record.",
  );
});

test("a window whose dates were cleared still announces the pilot", () => {
  // _rollout_window hands over nulls rather than fabricating a range. The
  // flags ARE pilot flags -- that is why range_phase is TESTING -- so dropping
  // the banner would hide real information. Only the dates go.
  const msg = rolloutBannerMessage(
    block({ windows: [win({ testing_start: null, go_live: null })] }),
  );
  assert.equal(
    msg,
    "This range falls in the pilot period for Northgate — calibration data, not the official record.",
  );
});

test("several windows give the branch count instead of a list of ranges", () => {
  // Branches roll out on different timetables by design; naming four date
  // ranges in one banner would be worse than naming none.
  const msg = rolloutBannerMessage(
    block({ windows: [win(), win({ branch: "Southgate" }), win({ branch: "Eastgate" })] }),
  );
  assert.equal(
    msg,
    "This range falls in the pilot period for 3 branches — calibration data, not the official record.",
  );
});

test("a null window alongside named ones counts toward the total", () => {
  // Per spec: those are people in the pilot on the global timetable, so 2 is
  // the correct count, not 1.
  const msg = rolloutBannerMessage(block({ windows: [win(), win({ branch: null })] }));
  assert.match(msg ?? "", /for 2 branches/);
});

test("a mixed range reports how much of the VISIBLE list is pilot data", () => {
  const msg = rolloutBannerMessage(
    block({ range_phase: "MIXED", testing_flag_count: 34, total_flag_count: 91 }),
  );
  assert.equal(msg, "This range spans go-live. 34 of 91 flags are from the pilot period.");
});

test("a mixed range with everything filtered out of view still reads correctly", () => {
  // testing_flag_count/total_flag_count are post-filter by design, so "0 of 0"
  // is legal. The banner must not divide, pluralise wrongly, or go blank.
  const msg = rolloutBannerMessage(
    block({ range_phase: "MIXED", testing_flag_count: 0, total_flag_count: 0 }),
  );
  assert.equal(msg, "This range spans go-live. 0 of 0 flags are from the pilot period.");
});

test("a testing range with no windows still says something", () => {
  // Phase A appends a null window precisely so this cannot happen, but the
  // banner should degrade to the truth rather than to silence if it ever does.
  const msg = rolloutBannerMessage(block({ windows: [] }));
  assert.equal(
    msg,
    "This range falls in the pilot period — calibration data, not the official record.",
  );
});

test("an unparseable date degrades to the dateless form", () => {
  const msg = rolloutBannerMessage(block({ windows: [win({ testing_start: "not-a-date" })] }));
  assert.equal(
    msg,
    "This range falls in the pilot period for Northgate — calibration data, not the official record.",
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -12
```

Expected: FAIL — `Cannot find module './rolloutBanner'`.

- [ ] **Step 3: Add the types**

In `src/types/flags.ts`, add above `QueuePayload`:

```ts
export type RolloutPhase = "PRELAUNCH" | "TESTING" | "LIVE";

/** One pilot window from the queue payload. Both dates are nullable and both
 * nulls are legitimate: `go_live: null` means the pilot runs indefinitely
 * (rollout.phase_for treats a missing go-live as TESTING forever), and
 * `testing_start: null` means the dates were cleared after those flags were
 * written. flag_queue_api._rollout_window hands over the nulls rather than
 * fabricating a range. */
export type RolloutWindow = {
  branch: string | null;
  testing_start: string | null;
  go_live: string | null;
};

/** Two different scopes in one block, and the difference is load-bearing:
 * `range_phase`/`windows` describe the DATES REQUESTED (computed over every
 * flag in range, so a tier filter cannot make the pilot banner vanish), while
 * the two counts describe the VISIBLE LIST after filtering. "0 of 1" is a
 * correct answer, not a bug. See flag_queue_api._rollout_block. */
export type RolloutBlock = {
  phases_configured: boolean;
  range_phase: "LIVE" | "TESTING" | "MIXED";
  testing_flag_count: number;
  total_flag_count: number;
  windows: RolloutWindow[];
};
```

Then add to `QueuePayload`, immediately after `outage_dates`:

```ts
  /**
   * Required, for the reason spelled out on `outage_dates` above: the cache
   * prefix is versioned by payload shape and was bumped to v4 when Phase A
   * added this block, so no pre-deploy entry can reach code expecting it.
   */
  rollout: RolloutBlock;
```

In `src/types/calendar.ts`, add to `Day`, after `flags`:

```ts
  /**
   * Which rollout phase this day fell in, from the day's OWN attendance_date.
   * Optional, unlike the queue's `rollout` block: hr_calendar has no cache
   * prefix to version, so a payload from before Phase A genuinely can arrive
   * without it. Absent reads as "no opinion", not as PRELAUNCH.
   */
  rollout_phase?: RolloutPhase;
```

and add `RolloutPhase` to the existing import from `@/types/flags` if one exists, or add `import type { RolloutPhase } from "@/types/flags";` at the top.

- [ ] **Step 4: Write the banner function**

Create `src/lib/rolloutBanner.ts`:

```ts
import { format, isValid, parseISO } from "date-fns";

import type { RolloutBlock, RolloutWindow } from "@/types/flags";

/** The tail every TESTING banner shares. The point of the banner is not that a
 * pilot exists, it is that HR should not treat what they are reading as the
 * official record. */
const CALIBRATION_TAIL = " — calibration data, not the official record.";

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = parseISO(iso);
  return isValid(parsed) ? format(parsed, "MMM d") : null;
}

/** "Aug 15 – Sep 1 is" / "Aug 15 onward is" / null when there is no usable start.
 *
 * The open-ended form is not an edge case: a window with no go-live is TESTING
 * indefinitely (rollout.phase_for), which is the state between setting a
 * testing start and picking a go-live date. */
function periodPhrase(window: RolloutWindow): string | null {
  const start = shortDate(window.testing_start);
  if (!start) return null;
  const end = shortDate(window.go_live);
  return end ? `${start} – ${end} is` : `${start} onward is`;
}

/**
 * What the flag queue should say about rollout phases, or null for silence.
 *
 * Pure so every state in the spec's table -- plus the two nullable-date cases
 * it did not cover -- is testable without rendering anything.
 */
export function rolloutBannerMessage(rollout: RolloutBlock | undefined): string | null {
  if (!rollout || !rollout.phases_configured) return null;
  if (rollout.range_phase === "LIVE") return null;

  if (rollout.range_phase === "MIXED") {
    return (
      `This range spans go-live. ${rollout.testing_flag_count} of ` +
      `${rollout.total_flag_count} flags are from the pilot period.`
    );
  }

  const windows = rollout.windows ?? [];

  if (windows.length > 1) {
    // A count, not a list. Branches roll out on different timetables by
    // design, so naming four date ranges would be worse than naming none. The
    // count includes a null (global) window when one is present: those are
    // people in the pilot on the global timetable.
    return `This range falls in the pilot period for ${windows.length} branches${CALIBRATION_TAIL}`;
  }

  const window = windows[0];
  const scope = window?.branch ? ` for ${window.branch}` : "";
  const phrase = window ? periodPhrase(window) : null;

  // No usable dates -- cleared config, an unparseable value, or (defensively)
  // no window at all. Still announce it: range_phase is TESTING because real
  // pilot flags are in range, and silence would hide that. Only the dates go.
  if (!phrase) return `This range falls in the pilot period${scope}${CALIBRATION_TAIL}`;

  return `${phrase} the pilot period${scope}${CALIBRATION_TAIL}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -6 && npm run typecheck 2>&1 | tail -5
```

Expected: PASS, **+13 from the 690 baseline = 703**. Typecheck clean.

If typecheck fails on `QueuePayload.rollout` being required, some existing test fixture builds a payload literal without it. Add `rollout` to that fixture rather than making the field optional — the required-ness is the point, and a fixture missing it is exactly the drift the type is there to catch.

- [ ] **Step 6: Mutation-check the two gap cases**

These are the cases the spec got wrong, so they are the ones most worth proving are defended.

| Mutation | Test that must fail |
|---|---|
| `return end ? ... : ...` → always the `–` form | `no go-live yet reads as open-ended…` (would render `Aug 15 – null is`) |
| `if (!phrase) return ...` → `if (!phrase) return null` | `a window whose dates were cleared still announces the pilot` |
| `windows.length > 1` → `>= 1` | `a single named-branch window names the branch and both dates` |

Record each observed result. A mutation that does not fail is a finding.

- [ ] **Step 7: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time
git add dewey_time/frontend/hr_attendance/src/types/flags.ts \
        dewey_time/frontend/hr_attendance/src/types/calendar.ts \
        dewey_time/frontend/hr_attendance/src/lib/rolloutBanner.ts \
        dewey_time/frontend/hr_attendance/src/lib/rolloutBanner.test.ts
git commit -m "feat(flags): the rollout banner's copy, as a pure function

Closes two gaps in the spec's banner table, neither exotic. go_live: null
means the pilot runs indefinitely (rollout.phase_for), which is the state
between setting a testing start and picking a go-live date -- the table would
have rendered 'Aug 15 – null is the pilot period' there. Both dates null is
a window whose config was cleared after its flags were written.

Neither drops the banner: range_phase is TESTING because real pilot flags are
in range, so silence would hide it. Only the dates go.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 2: Render the banner on the flag queue

**Files:**
- Modify: `src/ui/FlagQueuePage.tsx`
- Create: `src/ui/flagQueueBanner.test.tsx`

**Interfaces:**
- Consumes: `rolloutBannerMessage(rollout: RolloutBlock | undefined): string | null` from `@/lib/rolloutBanner`; `RolloutBlock` from `@/types/flags`.

- [ ] **Step 1: Locate the existing notice row**

```bash
cd dewey_time/frontend/hr_attendance && grep -n "AttentionStrip" src/ui/FlagQueuePage.tsx
```

The banner sits **above the queue list**, in the same stack as the existing `AttentionStrip` the page renders for the capped-scan case (around `:1027`). Put it **before** that one: a pilot period is context for everything below it, while the cap is a fact about one query.

Reuse `AttentionStrip` from `@/components/ui/notice` — do not introduce an `Alert` or a bespoke div. Its own docstring defines it as "Role 2 — attention. The data may be stale or incomplete; you might want to act, but nothing is broken", which is exactly what "calibration data, not the official record" says. It also already sets `role="status"` internally, described there as polite on purpose, so the accessibility question is settled by using it rather than by anything this task writes.

Its API:

```tsx
AttentionStrip(props: {
  tone: "amber" | "accent";
  icon: React.ReactNode;      // required
  children: React.ReactNode;
  detail?: React.ReactNode;   // makes the header a disclosure toggle
  count?: number;
})
```

- [ ] **Step 2: Write the failing test**

Create `src/ui/flagQueueBanner.test.tsx`. Rendering the whole `FlagQueuePage` needs a router, a query client, and network — so this renders the **banner element** the page renders, driven by the same function, and pins the wiring by source text:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { rolloutBannerMessage } from "@/lib/rolloutBanner";
import type { RolloutBlock } from "@/types/flags";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const LIVE: RolloutBlock = {
  phases_configured: true,
  range_phase: "LIVE",
  testing_flag_count: 0,
  total_flag_count: 12,
  windows: [],
};

test("FlagQueuePage asks rolloutBannerMessage rather than rebuilding the copy", () => {
  // The copy and every null-date rule live in one tested place. A second
  // formatting site in the page would drift from it silently -- the page has
  // no test that renders the real payload end to end.
  const src = readFileSync(resolve(PKG, "src/ui/FlagQueuePage.tsx"), "utf8");
  assert.match(src, /rolloutBannerMessage/, "the page calls the shared function");
  assert.doesNotMatch(
    src,
    /calibration data, not the official record/,
    "the page does not carry its own copy of the banner text",
  );
});

test("an all-live queue renders no banner", () => {
  assert.equal(rolloutBannerMessage(LIVE), null);
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -10
```

Expected: FAIL on `the page calls the shared function` — `FlagQueuePage.tsx` does not mention it yet.

- [ ] **Step 4: Render the banner**

In `src/ui/FlagQueuePage.tsx`, import:

```tsx
import { rolloutBannerMessage } from "@/lib/rolloutBanner";
```

Derive the message next to the page's other derived values:

```tsx
  // Copy and all the null-date rules live in lib/rolloutBanner, tested there.
  // Null means silence -- an unconfigured rollout or an all-live range has
  // nothing to say, and a banner on every queue page would train HR to ignore
  // the one that matters.
  const rolloutBanner = rolloutBannerMessage(data?.rollout);
```

(Use whatever the page already calls the query payload in place of `data`.)

Render it immediately before the existing capped-scan `AttentionStrip`:

```tsx
        {rolloutBanner ? (
          <AttentionStrip
            tone="accent"
            icon={<FlaskConicalIcon className="size-4 text-brand-accent" aria-hidden="true" />}
          >
            {rolloutBanner}
          </AttentionStrip>
        ) : null}
```

`tone="accent"`, not `"amber"`: amber is the page's warning tone, used for the capped scan. A pilot period is not a problem — the range is exactly what HR asked for, and the banner is telling them how to read it. Using the warning tone here would put a permanent amber bar above the queue for the whole pilot and teach HR to ignore it, which is the opposite of the point.

Add the imports:

```tsx
import { AttentionStrip } from "@/components/ui/notice";
import { FlaskConicalIcon } from "lucide-react";
```

`AttentionStrip` may already be imported — check before adding a duplicate. `FlaskConicalIcon` joins the existing `lucide-react` import at `:5` rather than starting a second one.

- [ ] **Step 5: Run tests and typecheck**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -6 && npm run typecheck 2>&1 | tail -5
```

Expected: PASS, **+2 = 705**. Typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time
git add dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx \
        dewey_time/frontend/hr_attendance/src/ui/flagQueueBanner.test.tsx
git commit -m "feat(flags): show the pilot banner above the flag queue

role=status rather than alert: standing context about the range on screen,
not something that just went wrong.

The page holds no copy of its own -- a source-text test pins that, because
the page has no end-to-end render test and a second formatting site would
drift from the tested one in silence.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 3: "Before go-live" chip on pre-cutoff calendar days

This is the one place the cutoff can actively mislead. A day the engine never evaluated is pixel-identical to a clean day, and an HR user reviewing a week has no way to tell the difference.

**Files:**
- Modify: `src/ui/DayChips.tsx`, `src/ui/DayChips.test.tsx`

**Interfaces:**
- Consumes: `Day.rollout_phase?: RolloutPhase` from Task 1.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/DayChips.test.tsx`:

```tsx
test("a pre-cutoff day says so instead of looking clean", () => {
  // The whole point of the chip: an unevaluated day and a genuinely clean day
  // are otherwise identical on screen.
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <DayChips day={{ date: "2026-03-01", rollout_phase: "PRELAUNCH" }} />
    </TooltipProvider>,
  );
  assert.match(html, />Before go-live</);
});

test("a live day gets no rollout chip", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <DayChips day={{ date: "2026-03-20", rollout_phase: "LIVE" }} />
    </TooltipProvider>,
  );
  assert.doesNotMatch(html, /Before go-live/);
});

test("a day with no phase at all gets no chip", () => {
  // hr_calendar has no cache prefix to version, so a payload from before
  // Phase A can arrive without the field. Absent means "no opinion", which
  // must not render as "before go-live".
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <DayChips day={{ date: "2026-03-20" }} />
    </TooltipProvider>,
  );
  assert.doesNotMatch(html, /Before go-live/);
});

test("a pre-cutoff day with nothing else on it still renders the chip row", () => {
  // DayChips returns null when a day has no leave, no off-shift flag, no
  // alert and is not a clock day. The rollout chip has to be part of that
  // condition or it never appears on the quiet days it exists for -- which
  // are most pre-cutoff days.
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <DayChips day={{ date: "2026-03-01", rollout_phase: "PRELAUNCH" }} alerts={[]} />
    </TooltipProvider>,
  );
  assert.notEqual(html, "");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -10
```

Expected: the two positive tests FAIL (no chip renders); the two negative ones already pass — which is why the positives are what matter here.

- [ ] **Step 3: Add the chip**

In `src/ui/DayChips.tsx`, after the `hasAlert` line:

```tsx
  // A day before the branch's testing start was never evaluated: no flags were
  // written for it and none ever will be. Without this it is pixel-identical
  // to a clean day, which is the one way the cutoff can actively mislead.
  const beforeGoLive = props.day?.rollout_phase === "PRELAUNCH";
```

Extend the early return — this is the load-bearing edit, since most pre-cutoff days have nothing else on them:

```tsx
  if (!onLeave && !offShiftFlag && !hasAlert && !props.isClockDay && !beforeGoLive) return null;
```

And render it as the first chip, using the existing neutral style:

```tsx
      {beforeGoLive ? (
        <AppTooltip content="Before this branch's start date — the system was not watching yet" side="bottom">
          <span className={NEUTRAL_CHIP}>Before go-live</span>
        </AppTooltip>
      ) : null}
```

`NEUTRAL_CHIP`, not the destructive tone: this is information, not a problem with the day.

- [ ] **Step 4: Run tests and typecheck**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -6 && npm run typecheck 2>&1 | tail -5
```

Expected: PASS, **+4 = 709**. Typecheck clean.

- [ ] **Step 5: Mutation-check the early return**

Revert only the early-return line to its original form (dropping `&& !beforeGoLive`), leaving the chip JSX in place. `a pre-cutoff day with nothing else on it still renders the chip row` and `a pre-cutoff day says so instead of looking clean` must both fail. Restore.

This is the mutation worth running: the chip JSX alone looks correct in review and would still never appear on a quiet day.

- [ ] **Step 6: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time
git add dewey_time/frontend/hr_attendance/src/ui/DayChips.tsx \
        dewey_time/frontend/hr_attendance/src/ui/DayChips.test.tsx
git commit -m "feat(calendar): mark pre-cutoff days instead of letting them look clean

A day before the branch's testing start was never evaluated, and is otherwise
identical on screen to a day the engine judged and found nothing wrong with.

The early return is the load-bearing part: DayChips renders nothing when a day
has no leave, flag, alert or clock marker, which describes most pre-cutoff
days. Mutation-checked -- the chip JSX alone reviews as correct and never
appears.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

### Task 4: Rebuild and close the record

**Files:**
- Modify: `dewey_time/public/**`, `dewey_time/www/*.html`, `docs/ROLLOUT_PUNCH_LIST.md`, `docs/superpowers/specs/2026-08-10-rollout-phases-design.md`

- [ ] **Step 1: Rebuild**

```bash
cd dewey_time/frontend/hr_attendance && npm run build 2>&1 | tail -12
```

If it fails on a missing `@lolbikb/dewey-ui`, that is the private-registry auth problem — stop and report rather than working around it.

- [ ] **Step 2: Confirm the copy reached the bundle**

```bash
cd /Users/lolbikb/projects/dewey-time
grep -c "calibration data, not the official record" dewey_time/public/hr_attendance/assets/index.js
grep -c "Before go-live" dewey_time/public/hr_attendance/assets/index.js
```

Expected: at least 1 each. **Zero means the deploy would ship nothing**, which is the exact failure the committed-assets rule exists to prevent — stop and investigate rather than committing.

- [ ] **Step 3: Mark Phase B shipped in the spec**

In `docs/superpowers/specs/2026-08-10-rollout-phases-design.md`, immediately under the "Phase B — surfaces." paragraph near the top, add:

```markdown
> **Shipped 2026-08-11.** Both surfaces built as specified, with two additions
> the banner table did not cover: a window with `go_live: null` renders
> "Aug 15 onward is the pilot period" (an ongoing pilot is TESTING
> indefinitely, so this is the normal state before a go-live date is chosen),
> and a window whose dates were cleared renders "This range falls in the pilot
> period" rather than dropping the banner. Copy lives in
> `src/lib/rolloutBanner.ts`, tested exhaustively there.
```

- [ ] **Step 4: Record it in the punch list**

In `docs/ROLLOUT_PUNCH_LIST.md`, under "Launch checklist record", add:

```markdown
**Rollout phases, Phase B — shipped 2026-08-11.** The flag queue shows a pilot
banner when the range is TESTING or MIXED, and pre-cutoff calendar days carry a
"Before go-live" chip. No backend change: Phase A (#149) landed both payloads
deliberately, so this pass needed no migration and no cache-prefix bump.

Two states the spec's banner table did not cover, found while planning:
`go_live: null` is an ongoing pilot rather than a broken range (it would have
rendered "Aug 15 – null"), and a cleared window still announces the pilot
without dates rather than going silent.
```

- [ ] **Step 5: Full frontend lane**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -3
```

Expected: **709**, typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time
git add dewey_time/public dewey_time/www docs/ROLLOUT_PUNCH_LIST.md \
        docs/superpowers/specs/2026-08-10-rollout-phases-design.md
git commit -m "build(hr): rebuild with the rollout surfaces, close Phase B

Built assets are the deployed artifact -- Frappe Cloud never builds this SPA --
so the bundle is checked for both new strings before committing; zero would
mean the deploy ships nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A"
```

---

## Out of scope

- **Any backend change.** Phase A landed both payloads for exactly this reason.
- **A per-row "Pilot" badge**, which the spec rejects by name: the banner already says the range is pilot data, and a badge on every row would be noise on the screen HR spends most of their time on.
- **A phase indicator on the schedule page.** Nothing there is judged by the flag engine, so there is no misleading state to correct.
