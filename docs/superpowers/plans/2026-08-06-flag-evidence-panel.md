# Flag Evidence Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flag panel's thirteen-row evidence dump with a verdict headline, at most four causing facts, and a timeline only where the finding is a relationship between clock positions.

**Architecture:** One new pure module, `lib/flagNarrative.ts`, maps `(flag, day)` to a `FlagNarrative` — headline, subline, facts, and a compositional timeline spec. Both existing panels already funnel through a single evidence function (`FlagDecisionPanel.tsx:172-174` calls this out as deliberate), so replacing what they render lands in both surfaces at once. The full evidence blob stays behind the existing disclosure, unchanged.

**Tech Stack:** React 19 + TypeScript, `tsx --test` + `node:test` + `renderToStaticMarkup`, TailwindCSS v4, existing `shiftTimeline.ts` / `attendancePunches.ts` helpers.

**Spec:** `docs/superpowers/specs/2026-08-06-flag-evidence-panel-design.md`

---

## Global Constraints

1. **Rendering change only.** Never modify what the engine writes to evidence. `closeout.py`, `intraday.py`, `record_issue_flags.py`, `absence_flags.py`, `lunch_flags.py` are read-only in this plan.
2. **No stored decision may be disturbed.** `evidence_fingerprint` hashes `{"minutes", "reason"}` only. Nothing here touches either, and nothing here may add or remove an evidence key.
3. **The full blob stays behind the disclosure.** Every key removed from the fact list must still render inside the collapsed section, exactly as today. Nothing becomes unreachable.
4. **Never read `grace_minutes`.** It is an alias whose meaning depends on which flag's `extra_evidence` wrote it last. Read the explicit `effective_start_grace_minutes` / `effective_end_grace_minutes` / `effective_lunch_return_grace_minutes` for the code.
5. **Grace is never its own fact.** State the cutoff time — it already has grace baked in — and mention the grace figure in the headline only when non-zero.
6. **Never render as a fact, for any flag:** `employee`, `date`, `attendance_date`, `on_shift`, `provisional`, `custom_grace_minutes`, `late_entry_grace_period`, `early_exit_grace_period`.
7. **Relevance is scoped to `(flag_code, reason)`, not `flag_code`.** `device_sn` is buried provenance for `single_checkin` and a first-class fact for `delivery_failed`.
8. **Never name a device serial in user-facing copy** except where the spec's table explicitly does (`delivery_failed`'s "Reported by"). There is no device↔branch registry.
9. **Timelines are drawn only when the finding is a relationship between clock positions.** Not for categorical findings (which branch, which device, which day type) and not when there is no trustworthy timestamp for the thing being flagged.
10. **Draw only the boundary the flag is about.** `LATE_START` gets the start boundary and first segment — no lunch band, no shift-end band.
11. **Feed the timeline from the day's checkin list, never the evidence blob.** Evidence carries `first_in`/`last_out` strings, never the punch list.
12. **Evidence supplies the finding; the live calendar supplies context.** Gap, punch time and counts come from evidence. Shift window, lunch window and punch list come from the day.
13. **`test:web` is a non-recursive per-directory glob.** New tests go directly in `src/lib/` or `src/ui/`. Verify the `# tests N` count rises; the exit code is not evidence.
14. **Built assets are the deployed artifact.** The last task rebuilds and commits `public/hr_attendance/**` and `www/hr-*.html`. Frappe Cloud never builds this SPA.
15. **The build has a silent-failure mode.** Tailwind's `@source` is a filesystem glob; with no `node_modules` at `dewey_time/frontend/hr_attendance/` it emits a ~90 kB `index.css` instead of ~172 kB and exits 0. `copy-html-entry.mjs` now guards this — if the build fails on the size floor, symlink `node_modules` rather than removing the guard.
16. Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
17. **`sortCheckinsByTime` and `deriveSegments` each exist in two modules.** `attendancePunches.ts`
    exports the dependency-injected originals (`sortCheckinsByTime(checkins, parseTime)`,
    `deriveSegments(checkins, {parseTime, minutesFromDateTime, clamp})`); `segmentInspector.ts`
    exports same-named pre-bound wrappers taking `(checkins)` alone. Every call site in this plan
    imports from `@/lib/attendancePunches` and passes the helpers explicitly. If an editor
    auto-import produces an arity error on these two names, the fix is the import path, not the
    call.

---

## File Structure

**New**

| File | Responsibility |
|---|---|
| `src/lib/flagNarrative.ts` | Pure. `(flag, day) -> FlagNarrative`. All per-scenario logic and copy. |
| `src/lib/flagNarrative.test.ts` | Per-scenario tests, including absence assertions. |
| `src/ui/FlagEvidenceTimeline.tsx` | Renders a `FlagTimelineSpec`. No flag knowledge. |
| `src/ui/flagEvidenceTimeline.test.tsx` | Render tests. |

**Modified**

| File | Change |
|---|---|
| `src/ui/FlagDetailPanel.tsx` | Render the narrative above the disclosure. |
| `src/ui/FlagDecisionPanel.tsx` | Same. |
| `src/lib/flagDetails.ts` | `formatFlagEvidenceDetails` stays, now feeding only the disclosure. |

`flagNarrative.ts` is pure and imports no React — same discipline as `flagDecisionState.ts`.

---

## Interface Contract

Binding. Every task uses these exact names and shapes.

```ts
// src/lib/flagNarrative.ts

export type FlagFact = { label: string; value: string };

/** Minutes from local midnight. */
export type Minute = number;

export type TimelineSpan = { startMin: Minute; endMin: Minute; tone: "worked" | "gap" };
export type TimelineMark = { atMin: Minute; tone: "normal" | "alert"; label?: string };

export type FlagTimelineSpec = {
  /** Axis bounds. Always present when a spec exists. */
  window: { startMin: Minute; endMin: Minute };
  /** The scheduled shift band, or null when no shift was assigned. */
  band: { startMin: Minute; endMin: Minute } | null;
  /** The scheduled lunch window, drawn only where the flag is about lunch. */
  lunch: { startMin: Minute; endMin: Minute } | null;
  /** A cutoff line — late threshold, return deadline. */
  threshold: Minute | null;
  spans: TimelineSpan[];
  marks: TimelineMark[];
};

export type FlagNarrative = {
  headline: string;
  subline: string | null;
  facts: FlagFact[];
  /** null when a timeline does not earn its place for this scenario. */
  timeline: FlagTimelineSpec | null;
};

export type NarrativeDay = {
  /** The day's checkins, for timelines. Never read evidence for these. */
  checkins: Checkin[];
  shift?: ShiftContext | null;
  holiday?: HolidayContext | null;
  observedLunch?: ObservedLunch | null;
};

export function flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative;

/** Exported for tests and for the no-detector fallback. */
export const NO_DETECTOR_CODES: readonly string[];
export function isEmittedCode(flagCode: string): boolean;
```

```tsx
// src/ui/FlagEvidenceTimeline.tsx
export function FlagEvidenceTimeline(props: { spec: FlagTimelineSpec; ariaLabel: string }): JSX.Element;
```

**Reuse rather than reinvent:** `shiftTimeline.ts`'s `computeExpectedWindowPct`, `computeLunchWindowPct`, `computeLateness`, `deriveMissingExpectedIntervals`; `attendancePunches.ts`'s `computeDayTimeWindow`, `sortCheckinsByTime`, `directionForCheckin`; `flagLabels.ts`'s `formatFlagLabel` and `parseFlagEvidence`; `attendanceTime.ts`'s time formatters. Do not write a second time formatter.

---

## Task list

| # | Task | Deliverable |
|---|---|---|
| 1 | Narrative types + shared helpers | `flagNarrative.ts` skeleton, `flagNarrative()` dispatching to a stub per code, disclosure untouched |
| 2 | Boundary flags | `LATE_START`, `LEFT_EARLY`, `LATE_FROM_LUNCH` |
| 3 | Gap and absence | `MISSING_TIME`, `UNNOTIFIED_ABSENCE` (both producers) |
| 4 | Categorical flags | `OFF_SHIFT_PUNCH` (both reasons), `NON_PRIMARY_SITE_PUNCH` |
| 5 | Record issues | `ATTENDANCE_ISSUE` × 4 reasons, plus the no-detector fallback |
| 6 | Timeline component | `FlagEvidenceTimeline.tsx` |
| 7 | Wire both panels | Both surfaces render the narrative; rebuild and commit assets |

---

### Task 1: Narrative types and dispatch

Creates the module every later task extends. It establishes the `(flag_code, evidence.reason)`
dispatch seam, the shared helpers (minute conversion, time text, fact building), and the two
*generic* narratives — the no-detector fallback (spec cross-cutting rule 11) and the interim
result for an emitted code whose per-scenario builder is not written yet. After this task
`flagNarrative()` returns a correct, non-throwing narrative for **every** flag code; Tasks 2–5
replace the interim results one scenario at a time.

Nothing in `flagDetails.ts` changes. `formatFlagEvidenceDetails` (`flagDetails.ts:221`) survives
untouched and keeps feeding the collapsed disclosure — this module only replaces what the panel
shows in the *primary* position (Global Constraint 3).

All commands run from `dewey_time/frontend/hr_attendance`.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts`
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts`

**Interfaces:**

- Consumes (all already exist; do not write replacements):
  - `@/lib/flagLabels` — `parseFlagEvidence(evidence: unknown): FlagEvidence | null`,
    `formatFlagLabel(flagCode: string, evidence?: FlagEvidence | null): string`,
    `type FlagEvidence`
  - `@/lib/attendanceTime` — `minutesFromDateTime(value: string | null | undefined): number | null`,
    `parseDateTimeLocal(value: string): Date`,
    `formatCheckinTime(value: string | null | undefined): string`
  - `@/types/calendar` — `type Checkin`, `type Flag`, `type HolidayContext`,
    `type ObservedLunch`, `type ShiftContext`

- Produces (Tasks 2–7 rely on these exact shapes):
  ```ts
  export type FlagFact = { label: string; value: string };
  export type Minute = number;
  export type TimelineSpan = { startMin: Minute; endMin: Minute; tone: "worked" | "gap" };
  export type TimelineMark = { atMin: Minute; tone: "normal" | "alert"; label?: string };
  export type FlagTimelineSpec = {
    window: { startMin: Minute; endMin: Minute };
    band: { startMin: Minute; endMin: Minute } | null;
    lunch: { startMin: Minute; endMin: Minute } | null;
    threshold: Minute | null;
    spans: TimelineSpan[];
    marks: TimelineMark[];
  };
  export type FlagNarrative = {
    headline: string;
    subline: string | null;
    facts: FlagFact[];
    timeline: FlagTimelineSpec | null;
  };
  export type NarrativeDay = {
    checkins: Checkin[];
    shift?: ShiftContext | null;
    holiday?: HolidayContext | null;
    observedLunch?: ObservedLunch | null;
  };
  export type NarrativeEvidence = Record<string, unknown>;
  export type NarrativeInput = {
    flag: Flag;
    evidence: NarrativeEvidence;
    reason: string | null;
    day: NarrativeDay;
    dateKey: string;
  };
  export function flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative;
  export const NO_DETECTOR_CODES: readonly string[];
  export function isEmittedCode(flagCode: string): boolean;

  export const MAX_FACTS: number;                      // 4
  export const EMPTY_EVIDENCE_NOTE: string;
  export function readEvidence(flag: Flag): NarrativeEvidence;
  export function hasEvidence(evidence: NarrativeEvidence): boolean;
  export function evidenceReason(evidence: NarrativeEvidence): string | null;
  export function evidenceMinute(value: unknown): Minute | null;
  export function evidenceTimeText(value: unknown): string | null;
  export function fact(label: string, value: string | null | undefined): FlagFact | null;
  export function buildFacts(entries: Array<FlagFact | null | undefined>): FlagFact[];
  ```

  Dispatch is a plain `switch (flag.flag_code)` inside `flagNarrative()`, with one
  arm per emitted code. Tasks 2–5 each replace their own arms' stub return with a
  call to the builder they write. Codes whose treatment splits by `evidence.reason`
  (`OFF_SHIFT_PUNCH`, `ATTENDANCE_ISSUE`) branch on reason **inside** their builder,
  so the switch stays one level deep.

---

- [ ] **Step 1: Write the failing test**

Create `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts` with exactly this
content. It goes directly in `src/lib/` — `test:web` is a non-recursive per-directory glob, so a
test in a subfolder never runs (Global Constraint 13).

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFacts,
  evidenceMinute,
  evidenceTimeText,
  flagNarrative,
  isEmittedCode,
  EMPTY_EVIDENCE_NOTE,
  MAX_FACTS,
  NO_DETECTOR_CODES,
  type FlagNarrative,
  type NarrativeDay,
} from "@/lib/flagNarrative";
import { FLAG_LABELS } from "@/lib/flagLabels";
import type { Flag } from "@/types/calendar";

const DATE_KEY = "2026-08-06";
const EMPTY_DAY: NarrativeDay = { checkins: [] };

function flag(over: Partial<Flag> & { flag_code: string }): Flag {
  return { name: "AF-0001", source: "AUTO", day_closed: 1, ...over };
}

/**
 * The exact thirteen-row blob from the design doc's opening screenshot. The
 * engine builds ONE mutable evidence dict per employee-day and stamps
 * `shift_start`, all seven grace keys and `late_threshold` onto it
 * (closeout.py:505-516, :606-611), then merges that same dict into every flag
 * it inserts for the day (`_insert_flags`, closeout.py:732). So a
 * `single_checkin` row — which writes only
 * `reason`, `checkins_count`, `punch_time` (record_issue_flags.py:24-34) —
 * arrives at the panel carrying ten keys it never compared against.
 */
const FULL_DAY_EVIDENCE = {
  first_in: "2026-08-06 14:23:00",
  last_out: "2026-08-06 14:23:00",
  shift_start: "2026-08-06 08:00:00",
  late_threshold: "2026-08-06 08:10:00",
  punch_time: "2026-08-06 14:23:00",
  grace_minutes: 10,
  effective_start_grace_minutes: 10,
  effective_end_grace_minutes: 10,
  effective_lunch_return_grace_minutes: 10,
  custom_grace_minutes: 10,
  late_entry_grace_period: 10,
  early_exit_grace_period: 10,
  reason: "single_checkin",
  checkins_count: 1,
};

const EMITTED = [
  "LATE_START",
  "LEFT_EARLY",
  "LATE_FROM_LUNCH",
  "MISSING_TIME",
  "UNNOTIFIED_ABSENCE",
  "OFF_SHIFT_PUNCH",
  "NON_PRIMARY_SITE_PUNCH",
  "ATTENDANCE_ISSUE",
  // Created on the Bridge delivery path, never by this repo, but real enough
  // that closeout queries for it — so it must not be told it has no detector.
  "DELIVERY_FAILED",
];

/** Everything the reader can actually see, minus the timeline (a spec, not copy). */
function renderedText(narrative: FlagNarrative): string {
  return [
    narrative.headline,
    narrative.subline ?? "",
    ...narrative.facts.map((f) => `${f.label} ${f.value}`),
  ].join(" | ");
}

test("flagNarrative returns a usable narrative for every declared code and for an unknown one", () => {
  for (const code of [...Object.keys(FLAG_LABELS), "SOMETHING_NOBODY_DECLARED"]) {
    const narrative = flagNarrative(
      flag({ flag_code: code, evidence: FULL_DAY_EVIDENCE }),
      EMPTY_DAY,
      DATE_KEY,
    );
    assert.ok(narrative.headline.length > 0, `${code} produced an empty headline`);
    assert.ok(Array.isArray(narrative.facts), `${code} produced no fact array`);
    assert.ok(
      narrative.facts.length <= MAX_FACTS,
      `${code} produced ${narrative.facts.length} facts, over the cap of ${MAX_FACTS}`,
    );
  }
});

// The defect this module exists to fix is EXTRA rows, so the load-bearing
// assertions are absences. `single_checkin` is the design doc's own example:
// seven grace rows and two boundary times for a finding that is "one punch,
// then nothing".
test("a single_checkin ATTENDANCE_ISSUE render contains no grace string at all", () => {
  const text = renderedText(
    flagNarrative(
      flag({ flag_code: "ATTENDANCE_ISSUE", evidence: FULL_DAY_EVIDENCE }),
      EMPTY_DAY,
      DATE_KEY,
    ),
  );
  assert.doesNotMatch(text, /grace/i, "a grace row reached the narrative");
  assert.doesNotMatch(text, /10m/, "a grace duration reached the narrative");
  // `late_threshold` is a comparison this flag never made, and `shift_start` is
  // inherited from the shared per-day dict — neither caused this flag.
  assert.doesNotMatch(text, /8:10 AM/, "late_threshold reached the narrative");
  assert.doesNotMatch(text, /8:00 AM/, "shift_start reached the narrative");
});

test("the three no-detector codes get the generic treatment, not a confident finding", () => {
  assert.deepEqual(
    [...NO_DETECTOR_CODES].sort(),
    ["MISSING_IN_OR_OUT", "MISSING_LUNCH", "NO_CHECKIN_YET"],
  );
  for (const code of NO_DETECTOR_CODES) {
    assert.equal(isEmittedCode(code), false, `${code} must not be treated as emitted`);
    const narrative = flagNarrative(flag({ flag_code: code }), EMPTY_DAY, DATE_KEY);
    assert.match(narrative.headline, /isn't a rule this engine currently checks automatically\./);
    assert.equal(narrative.timeline, null, `${code} must not draw a timeline`);
  }
  assert.equal(
    flagNarrative(flag({ flag_code: "MISSING_IN_OR_OUT" }), EMPTY_DAY, DATE_KEY).headline,
    `"Missing in or out" isn't a rule this engine currently checks automatically.`,
  );
});

// Rule 11's specific trap: TIME_EVIDENCE_KEYS / GRACE_EVIDENCE_KEYS
// (flagDetails.ts:65-94) are keyed by string NAME across all codes, so a
// hand-typed key that happens to be called `shift_start` would be formatted as
// a clock time and promoted as the cause of a finding no detector ever made.
test("an unknown code never promotes a key merely because it is named shift_start", () => {
  const narrative = flagNarrative(
    flag({
      flag_code: "SOMETHING_NOBODY_DECLARED",
      evidence: {
        shift_start: "2026-08-06 08:00:00",
        late_threshold: "2026-08-06 08:10:00",
        effective_start_grace_minutes: 15,
        reason: "typed by hand",
      },
    }),
    EMPTY_DAY,
    DATE_KEY,
  );
  const text = renderedText(narrative);
  assert.doesNotMatch(text, /Shift start/i);
  assert.doesNotMatch(text, /Late threshold/i);
  assert.doesNotMatch(text, /8:00 AM/);
  assert.doesNotMatch(text, /8:10 AM/);
  assert.doesNotMatch(text, /grace/i);
  assert.doesNotMatch(text, /15m/);
  // The reason IS promoted — it is the one self-describing field.
  assert.match(text, /typed by hand/);
});

test("the no-detector fallback promotes evidence.reason verbatim and unmapped", () => {
  const narrative = flagNarrative(
    flag({ flag_code: "MISSING_LUNCH", source: "HR", evidence: { reason: "single_checkin" } }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.deepEqual(narrative.facts, [
    { label: "Raised by", value: "HR" },
    { label: "Recorded reason", value: "single_checkin" },
  ]);
  // REASON_LABELS (flagDetails.ts:26-35) would render this as "Single punch
  // only" — a mapped label asserting a finding the engine never made, on a row
  // a human typed.
  assert.doesNotMatch(renderedText(narrative), /Single punch only/);
});

test("empty evidence still names who raised the flag, and says the blob was empty", () => {
  const narrative = flagNarrative(
    flag({ flag_code: "NO_CHECKIN_YET", source: "EMPLOYEE", evidence: null }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.deepEqual(narrative.facts, [{ label: "Raised by", value: "The employee" }]);
  assert.ok(narrative.subline != null, "an empty blob still needs a sub-line");
  assert.ok(
    narrative.subline.includes(EMPTY_EVIDENCE_NOTE),
    "an empty blob must say so rather than render a blank card",
  );
});

test("malformed evidence degrades instead of throwing", () => {
  const narrative = flagNarrative(
    flag({ flag_code: "MISSING_IN_OR_OUT", evidence: "{not json" }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.match(narrative.headline, /isn't a rule this engine currently checks automatically\./);
  assert.ok(narrative.subline != null && narrative.subline.includes(EMPTY_EVIDENCE_NOTE));
});

test("isEmittedCode is true exactly for the codes a detector produces", () => {
  for (const code of EMITTED) {
    assert.equal(isEmittedCode(code), true, `${code} has a detector and must be emitted`);
  }
  // Declared in AUTO_FLAG_CODES but never written as a flag_code by any
  // detector: unknown branches fold into ATTENDANCE_ISSUE reason
  // `unknown_device_branch`. Takes the no-detector path without being named in
  // NO_DETECTOR_CODES.
  for (const code of ["UNKNOWN_DEVICE_BRANCH", "WHATEVER"]) {
    assert.equal(isEmittedCode(code), false, `${code} has no detector and must not be emitted`);
  }
});

// DELIVERY_FAILED is the awkward one and the reason `isEmittedCode` is not
// simply "has a builder". No code in this repo inserts one, so it is tempting to
// group it with the hand-created codes — but closeout.py:386-395 queries for
// existing DELIVERY_FAILED rows with source "AUTO", which only makes sense
// because the Bridge delivery path writes them. Telling HR that a real
// machine-written flag "isn't a rule this engine currently checks
// automatically" would be a false statement about their own data.
test("DELIVERY_FAILED is treated as emitted even though no builder handles it", () => {
  assert.equal(isEmittedCode("DELIVERY_FAILED"), true);
  const narrative = flagNarrative(
    flag({ flag_code: "DELIVERY_FAILED", evidence: { reason: "delivery_failed" } }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.doesNotMatch(narrative.headline, /isn't a rule this engine currently checks automatically/);
  // No builder, so no invented finding: the label, and the blob in the disclosure.
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});

test("an emitted code never gets the no-detector copy", () => {
  for (const code of EMITTED) {
    const narrative = flagNarrative(
      flag({ flag_code: code, evidence: FULL_DAY_EVIDENCE }),
      EMPTY_DAY,
      DATE_KEY,
    );
    assert.doesNotMatch(
      narrative.headline,
      /isn't a rule this engine currently checks automatically/,
      `${code} has a detector — telling HR otherwise is false`,
    );
  }
});

// A reason string no builder recognises must still land on a narrative —
// otherwise the panel loses its entire primary zone the first time the engine
// adds a reason.
test("an emitted code with an unrecognised reason falls back without throwing", () => {
  const narrative = flagNarrative(
    flag({ flag_code: "OFF_SHIFT_PUNCH", evidence: { reason: "a_reason_nobody_built_yet" } }),
    EMPTY_DAY,
    DATE_KEY,
  );
  assert.ok(narrative.headline.length > 0);
  assert.doesNotMatch(narrative.headline, /isn't a rule this engine currently checks automatically/);
});

test("evidenceMinute converts a Frappe timestamp to minutes from local midnight", () => {
  assert.equal(evidenceMinute("2026-08-06 14:23:00"), 14 * 60 + 23);
  assert.equal(evidenceMinute("2026-08-06T08:00:00"), 8 * 60);
});

test("evidenceMinute rejects everything that is not a parsable timestamp", () => {
  // null rather than 0: a missing cutoff must never be drawn at midnight.
  assert.equal(evidenceMinute(null), null);
  assert.equal(evidenceMinute(undefined), null);
  assert.equal(evidenceMinute(""), null);
  assert.equal(evidenceMinute("   "), null);
  assert.equal(evidenceMinute(10), null);
  assert.equal(evidenceMinute("not a date"), null);
  assert.equal(evidenceMinute({ time: "2026-08-06 08:00:00" }), null);
});

test("evidenceTimeText formats through the shared formatter and returns null, never an em dash", () => {
  assert.equal(evidenceTimeText("2026-08-06 14:23:00"), "2:23 PM");
  assert.equal(evidenceTimeText(null), null);
  assert.equal(evidenceTimeText(undefined), null);
  assert.equal(evidenceTimeText("not a date"), null);
  assert.equal(evidenceTimeText(0), null);
  // formatCheckinTime returns "—" for a missing value; a fact whose value is a
  // dash is worse than no fact, so the null has to survive as far as buildFacts.
  assert.notEqual(evidenceTimeText(undefined), "—");
});

test("buildFacts drops the entries that had nothing to say and caps the list at four", () => {
  assert.equal(MAX_FACTS, 4);
  assert.deepEqual(
    buildFacts([
      { label: "Only punch", value: "2:23 PM" },
      null,
      undefined,
      { label: "From", value: "ZK-A4-014" },
    ]),
    [
      { label: "Only punch", value: "2:23 PM" },
      { label: "From", value: "ZK-A4-014" },
    ],
  );
  const many = buildFacts(Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, value: `V${i}` })));
  assert.equal(many.length, MAX_FACTS);
  assert.deepEqual(
    many.map((f) => f.label),
    ["L0", "L1", "L2", "L3"],
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)

Expected: FAIL. `src/lib/flagNarrative.ts` does not exist, so the whole test file errors at import
time before a single test runs:

```
✖ src/lib/flagNarrative.test.ts
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/lib/flagNarrative' imported from '.../src/lib/flagNarrative.test.ts'
```

The failure **must be a module-resolution error, not an assertion failure** — an assertion failure
here would mean the file resolved to something unexpected.

Before moving on, write down the `# tests N` and `# pass N` numbers this run prints. Step 7
compares against them: the exit code alone is not evidence that the new file was picked up
(Global Constraint 13).

- [ ] **Step 3: Create the module with its types and code inventory**

Create `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts`:

```ts
/**
 * Turns one Attendance Flag into the four things the panel shows in its PRIMARY
 * position — a verdict headline, a sub-line, at most four causing facts, and a
 * timeline spec.
 *
 * This replaces `formatFlagEvidenceDetails` (flagDetails.ts:221) as the panel's
 * headline content only. That function is untouched and still renders the
 * complete blob inside the collapsed disclosure, so nothing becomes
 * unreachable — it just stops being the first thing HR reads.
 *
 * Pure: no React, no fetching, no `new Date()`. Same discipline as
 * flagDecisionState.ts.
 *
 * Two hard rules live at this seam rather than inside any one builder:
 *
 *  - **A code with no detector never reaches a per-scenario builder.** Nothing
 *    writes MISSING_IN_OR_OUT, NO_CHECKIN_YET, MISSING_LUNCH or
 *    UNKNOWN_DEVICE_BRANCH as a flag_code, so a row carrying one of those was
 *    created by hand and its keys mean whatever the person meant. Running
 *    them through the shared TIME_EVIDENCE_KEYS / GRACE_EVIDENCE_KEYS maps
 *    (flagDetails.ts:65-94) would be wrong in a specific, silent way: those maps
 *    are keyed by string NAME across all codes, so a manual entry that happens
 *    to use the name `shift_start` would be formatted as a clock time and
 *    promoted as the cause of a finding no rule ever made.
 *    `noDetectorNarrative` therefore reads exactly two things — `flag.source`
 *    off the record, and `evidence.reason` verbatim.
 *
 *  - **Grace is never its own fact.** `_generate_for_employee_date` builds ONE
 *    mutable evidence dict per employee-day, stamps `shift_start`, all seven
 *    `grace_evidence()` keys and `late_threshold` onto it
 *    (closeout.py:505-516, :606-611), and merges that same dict into every flag
 *    it inserts for the day (:531). Every flag therefore inherits comparisons it
 *    never made. Builders state the CUTOFF time — which already has grace baked
 *    in — and mention the grace figure in the headline sentence only when it is
 *    non-zero.
 *
 * Never read `grace_minutes`: it is an alias whose meaning depends on which
 * flag's `extra_evidence` wrote it last (start grace for LATE_START, end grace
 * for LEFT_EARLY at closeout.py:669, lunch-return grace at lunch_flags.py:60).
 * Read the explicit `effective_*` key for the code instead.
 */
import {
  formatCheckinTime,
  minutesFromDateTime,
  parseDateTimeLocal,
} from "@/lib/attendanceTime";
import { formatFlagLabel, parseFlagEvidence, type FlagEvidence } from "@/lib/flagLabels";
import type {
  Checkin,
  Flag,
  HolidayContext,
  ObservedLunch,
  ShiftContext,
} from "@/types/calendar";

export type FlagFact = { label: string; value: string };

/** Minutes from local midnight. */
export type Minute = number;

export type TimelineSpan = { startMin: Minute; endMin: Minute; tone: "worked" | "gap" };
export type TimelineMark = { atMin: Minute; tone: "normal" | "alert"; label?: string };

export type FlagTimelineSpec = {
  /** Axis bounds. Always present when a spec exists. */
  window: { startMin: Minute; endMin: Minute };
  /** The scheduled shift band, or null when no shift was assigned. */
  band: { startMin: Minute; endMin: Minute } | null;
  /** The scheduled lunch window, drawn only where the flag is about lunch. */
  lunch: { startMin: Minute; endMin: Minute } | null;
  /** A cutoff line — late threshold, return deadline. */
  threshold: Minute | null;
  spans: TimelineSpan[];
  marks: TimelineMark[];
};

export type FlagNarrative = {
  headline: string;
  subline: string | null;
  facts: FlagFact[];
  /** null when a timeline does not earn its place for this scenario. */
  timeline: FlagTimelineSpec | null;
};

export type NarrativeDay = {
  /** The day's checkins, for timelines. Never read evidence for these. */
  checkins: Checkin[];
  shift?: ShiftContext | null;
  holiday?: HolidayContext | null;
  observedLunch?: ObservedLunch | null;
};

/** The parsed evidence blob. Untyped on purpose — the engine's keys vary by code. */
export type NarrativeEvidence = Record<string, unknown>;

export type NarrativeInput = {
  flag: Flag;
  evidence: NarrativeEvidence;
  /** `evidence.reason`, trimmed; null when absent or not a string. */
  reason: string | null;
  day: NarrativeDay;
  dateKey: string;
};

/** At most four causing facts — the design's cap, enforced by `buildFacts`. */
export const MAX_FACTS = 4;

/** Explicit copy for a truly empty blob; an empty card reads as broken. */
export const EMPTY_EVIDENCE_NOTE = "No evidence was recorded on this flag.";

const NO_DETECTOR_SUBLINE = "Nothing here has been machine-verified.";

/**
 * The codes a detector actually produces. Kept as the POSITIVE list because it
 * is both shorter and safer: a code someone adds to `AUTO_FLAG_CODES` without
 * writing a detector defaults to the honest generic treatment instead of
 * inheriting a confident sentence about a comparison nothing performed.
 */
const EMITTED_CODES: ReadonlySet<string> = new Set([
  "LATE_START",
  "LEFT_EARLY",
  "LATE_FROM_LUNCH",
  "MISSING_TIME",
  "UNNOTIFIED_ABSENCE",
  "OFF_SHIFT_PUNCH",
  "NON_PRIMARY_SITE_PUNCH",
  "ATTENDANCE_ISSUE",
  // Real, and deliberately without a builder of its own. Nothing in this repo
  // INSERTS a DELIVERY_FAILED flag — it is created on the Bridge delivery path
  // — but closeout.py:386-395 queries for existing ones and
  // attendance_flag.py:40 has a validate branch for them, so HR can genuinely
  // be looking at one. It is a real detected condition, so it must NOT get the
  // "isn't a rule this engine currently checks automatically" copy. With no arm
  // in the switch it lands on `default:` → `emittedFallbackNarrative`: the
  // formatted label, no invented finding, full evidence in the disclosure.
  // (Distinct from ATTENDANCE_ISSUE reason `delivery_failed`, which Task 5
  // narrates properly — that is the path the engine itself writes.)
  "DELIVERY_FAILED",
]);

/**
 * The three codes the spec's treatment table names under "no detector".
 *
 * This is a NAMED SUBSET for the copy and the tests, not the gate —
 * `isEmittedCode` is the gate. UNKNOWN_DEVICE_BRANCH is declared in
 * `AUTO_FLAG_CODES` but no detector ever writes it as a flag_code (unknown
 * branches fold into ATTENDANCE_ISSUE reason `unknown_device_branch`), so it
 * takes the no-detector path without being listed here.
 */
export const NO_DETECTOR_CODES: readonly string[] = [
  "MISSING_IN_OR_OUT",
  "NO_CHECKIN_YET",
  "MISSING_LUNCH",
];

export function isEmittedCode(flagCode: string): boolean {
  return EMITTED_CODES.has(flagCode);
}
```

- [ ] **Step 4: Append the shared evidence and fact helpers**

Append to the end of `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts`. Every later
task uses these instead of writing its own — in particular there is **no** second time formatter
and **no** second flag-code label map in this file.

```ts
/**
 * The flag's evidence as a plain object, never throwing. `parseFlagEvidence`
 * already try/catches a malformed JSON string (flagLabels.ts:43); an array or a
 * scalar becomes `{}` so callers can always spread and index it.
 */
export function readEvidence(flag: Flag): NarrativeEvidence {
  const parsed = parseFlagEvidence(flag.evidence);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as NarrativeEvidence;
}

/** True when the blob carried at least one value worth showing. */
export function hasEvidence(evidence: NarrativeEvidence): boolean {
  return Object.values(evidence).some((value) => value != null && value !== "");
}

export function evidenceReason(evidence: NarrativeEvidence): string | null {
  const reason = evidence.reason;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed ? trimmed : null;
}

/**
 * Minutes from local midnight for an evidence timestamp — Frappe's
 * "2026-08-06 14:23:00" or an ISO string.
 *
 * Anything that is not a parsable timestamp (a grace count, an object, a blank)
 * returns null rather than 0, so a cutoff that was never written can never be
 * drawn on the timeline at midnight.
 */
export function evidenceMinute(value: unknown): Minute | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return minutesFromDateTime(value);
}

/**
 * "2:23 PM" for an evidence timestamp, or null.
 *
 * Deliberately not `formatCheckinTime` on its own: that returns "—" for a
 * missing value, and a fact whose value is a dash is worse than no fact at all.
 * The null has to survive as far as `buildFacts`, which drops the row.
 */
export function evidenceTimeText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (Number.isNaN(parseDateTimeLocal(value).getTime())) return null;
  return formatCheckinTime(value);
}

/** A fact, or null when the value was missing — `buildFacts` drops the nulls. */
export function fact(label: string, value: string | null | undefined): FlagFact | null {
  if (value == null || value === "") return null;
  return { label, value };
}

/** Drops the entries that had nothing to say, then enforces the four-fact cap. */
export function buildFacts(entries: Array<FlagFact | null | undefined>): FlagFact[] {
  return entries.filter((entry): entry is FlagFact => entry != null).slice(0, MAX_FACTS);
}

```

- [ ] **Step 5: Append the two generic narratives**

Append to the end of `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts`:

```ts
/**
 * `flag.source` translated. HR should never read an engine noun, and this is
 * read off the RECORD rather than the blob so it survives empty evidence.
 */
const FLAG_SOURCE_LABELS: Record<string, string> = {
  AUTO: "The attendance engine",
  EMPLOYEE: "The employee",
  HR: "HR",
};

function sourceText(flag: Flag): string | null {
  const source = typeof flag.source === "string" ? flag.source.trim() : "";
  if (!source) return null;
  return FLAG_SOURCE_LABELS[source] ?? source;
}

/**
 * The whole treatment for a code no detector produces — the three named in
 * NO_DETECTOR_CODES plus UNKNOWN_DEVICE_BRANCH and anything unrecognised.
 * (NOT DELIVERY_FAILED: the Bridge delivery path really does write those, so it
 * counts as emitted and takes the `default:` arm instead.)
 *
 * Exactly two facts, and both come from somewhere a hand-typed key cannot
 * mislead us:
 *   - `flag.source` off the record.
 *   - `evidence.reason` VERBATIM and unmapped. REASON_LABELS
 *     (flagDetails.ts:26-35) would turn a typed "single_checkin" into "Single
 *     punch only", asserting a finding the engine never made on a row a human
 *     created.
 *
 * Nothing else in the blob is touched, which is what keeps the shared key maps
 * (flagDetails.ts:65-94) away from keys whose names collide by accident.
 */
function noDetectorNarrative(input: NarrativeInput): FlagNarrative {
  const label = formatFlagLabel(input.flag.flag_code, input.evidence as FlagEvidence);
  return {
    headline: `"${label}" isn't a rule this engine currently checks automatically.`,
    subline: hasEvidence(input.evidence)
      ? NO_DETECTOR_SUBLINE
      : `${NO_DETECTOR_SUBLINE} ${EMPTY_EVIDENCE_NOTE}`,
    facts: buildFacts([
      fact("Raised by", sourceText(input.flag)),
      fact("Recorded reason", input.reason),
    ]),
    timeline: null,
  };
}

/**
 * The seam's other half: a code a detector DOES produce, whose per-scenario
 * builder is not registered yet (Tasks 2-5 fill these in one scenario at a
 * time).
 *
 * It must not throw — the panel would lose its entire primary zone — and it must
 * not borrow the no-detector copy, which would tell HR that LATE_START is not a
 * rule this engine checks.
 *
 * Zero facts is the correct interim answer, not a stub: every key is still one
 * click away in the disclosure, and promoting anything generically here would
 * re-import exactly the inherited grace and boundary rows this module exists to
 * remove.
 */
function emittedFallbackNarrative(input: NarrativeInput): FlagNarrative {
  return {
    headline: formatFlagLabel(input.flag.flag_code, input.evidence as FlagEvidence),
    subline: hasEvidence(input.evidence) ? null : EMPTY_EVIDENCE_NOTE,
    facts: [],
    timeline: null,
  };
}
```

- [ ] **Step 6: Append the dispatch entry point**

Append to the end of `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts`:

```ts
export function flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readEvidence(flag);
  const input: NarrativeInput = {
    flag,
    evidence,
    reason: evidenceReason(evidence),
    day,
    dateKey,
  };

  // Checked BEFORE the switch, so a hand-created row can never reach a builder
  // that assumes engine-written keys.
  if (!isEmittedCode(flag.flag_code)) return noDetectorNarrative(input);

  // No per-code builders exist yet, so every emitted code gets the generic
  // treatment. Task 2 converts this single return into a
  // `switch (flag.flag_code)` whose `default:` arm is this same call; Tasks 3-5
  // then add their own arms to that switch:
  //   Task 2 — LATE_START, LEFT_EARLY, LATE_FROM_LUNCH
  //   Task 3 — MISSING_TIME, UNNOTIFIED_ABSENCE
  //   Task 4 — OFF_SHIFT_PUNCH, NON_PRIMARY_SITE_PUNCH
  //   Task 5 — ATTENDANCE_ISSUE
  //
  // Stub arms are deliberately NOT scaffolded here: eight case labels that all
  // return the same thing as `default:` are dead weight until the task that
  // fills them lands.
  //
  // Codes whose treatment splits by evidence.reason branch on it INSIDE their
  // builder (Global Constraint 7: relevance is scoped to (flag_code, reason) —
  // `device_sn` is buried provenance for `single_checkin` and a first-class
  // fact for `delivery_failed`, same code, opposite treatment). Keeping that
  // second level inside the builder leaves the eventual switch one level deep.
  return emittedFallbackNarrative(input);
}
```

- [ ] **Step 7: Run the test to verify it passes and the suite grew**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)

Expected: PASS, `# fail 0`, and — the part that actually matters — `# tests N` is **15 higher**
than the number recorded in Step 2, because `src/lib/flagNarrative.test.ts` contributes fifteen
tests. If the count did not move, the glob did not pick the file up: confirm it is at
`src/lib/flagNarrative.test.ts` and not in a subdirectory (Global Constraint 13).

- [ ] **Step 8: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts
git commit -m "$(cat <<'EOF'
feat(hr-attendance): flag narrative types, dispatch seam and no-detector fallback

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Boundary flags

**Files:**
- Modify: `src/lib/flagNarrative.ts:1-160` (Task 1's skeleton — merge in the imports below, add the `BoundaryEvidence` type and the boundary-timeline helpers, add the three builder functions, and wire the `LATE_START` / `LEFT_EARLY` / `LATE_FROM_LUNCH` arms of `flagNarrative()`'s switch to them)
- Test: `src/lib/flagNarrative.test.ts` (Task 1's skeleton — append the scenario tests below)

**Interfaces:**
- Consumes:
  - `flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative` — Task 1's dispatcher; this task fills in three of its `switch` arms.
  - Types from `src/lib/flagNarrative.ts` (Task 1): `FlagFact = { label: string; value: string }`, `Minute = number`, `TimelineSpan = { startMin: Minute; endMin: Minute; tone: "worked" | "gap" }`, `TimelineMark = { atMin: Minute; tone: "normal" | "alert"; label?: string }`, `FlagTimelineSpec`, `FlagNarrative`, `NarrativeDay`.
  - From `src/types/calendar.ts`: `Flag`, `Checkin`, `ShiftContext`, `ObservedLunch`.
  - Reused as-is: `parseFlagEvidence` (`src/lib/flagLabels.ts`); `formatCheckinTime`, `formatDurationMinutes`, `parseDateTimeLocal`, `minutesFromDateTime`, `clamp` (`src/lib/attendanceTime.ts`); `sortCheckinsByTime` (`src/lib/attendancePunches.ts`); `computeExpectedWindowPct`, `computeLunchWindowPct` (`src/lib/shiftTimeline.ts`); `observedLunchMinuteRange` (`src/lib/lunchDetection.ts`).
- Produces:
  - `buildLateStartNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative`, `buildLeftEarlyNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative`, `buildLateFromLunchNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative` — module-local, wired into `flagNarrative()`'s switch. Task 7 relies on those three switch arms no longer returning Task 1's stub when it wires both panels.
  - Module-local helpers `minutesBetweenIso`, `minuteWindowFromAnchors`, `toMinuteRange`, `BOUNDARY_WINDOW_MARGIN_MIN`, and the `BoundaryEvidence` type, all in `flagNarrative.ts` — available for Tasks 3–5 to reuse for their own timeline specs in the same file; not required of them.

---

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/flagNarrative.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { flagNarrative } from "@/lib/flagNarrative";
import type { NarrativeDay } from "@/lib/flagNarrative";
import type { Checkin, Flag, ObservedLunch, ShiftContext } from "@/types/calendar";

const DATE_KEY = "2026-08-03";

function flag(flagCode: string, evidence: Record<string, unknown>): Flag {
  return {
    name: "AFD-test",
    flag_code: flagCode,
    severity: "WARNING",
    status: "OPEN",
    source: "AUTO",
    day_closed: 1,
    evidence,
  };
}

function checkin(time: string): Checkin {
  return { time };
}

const FULL_SHIFT: ShiftContext = {
  shift_assigned: true,
  start_time: "08:00",
  end_time: "17:00",
  grace_minutes: 10,
  lunch_start: "12:00",
  lunch_end: "13:00",
};

function day(over: Partial<NarrativeDay>): NarrativeDay {
  return { checkins: [], shift: FULL_SHIFT, ...over };
}

test("flagNarrative: LATE_START with grace states the cutoff, not the raw grace_minutes alias", () => {
  const late = flag("LATE_START", {
    employee: "HR-EMP-00001",
    date: DATE_KEY,
    first_in: "2026-08-03T08:23:00",
    shift_start: "2026-08-03T08:00:00",
    late_threshold: "2026-08-03T08:10:00",
    effective_start_grace_minutes: 10,
    effective_end_grace_minutes: 0,
    effective_lunch_return_grace_minutes: 10,
    custom_grace_minutes: 10,
    late_entry_grace_period: 0,
    early_exit_grace_period: 0,
    // Deliberately wrong for the generic `grace_minutes` alias. shift_grace.py's
    // grace_evidence() (shift_grace.py:80-95) can leave this holding a different
    // flag's effective grace for the same employee-day (rule 3 —
    // docs/superpowers/specs/2026-08-06-flag-evidence-panel-design.md). If
    // flagNarrative ever reads it directly, this wrong number leaks into the
    // headline instead of the correct effective_start_grace_minutes (10).
    grace_minutes: 999,
  });
  const d = day({
    checkins: [checkin("2026-08-03T08:23:00"), checkin("2026-08-03T12:00:00")],
  });

  const narrative = flagNarrative(late, d, DATE_KEY);

  assert.equal(
    narrative.headline,
    "Clocked in at 8:23 AM — 13 minutes late, even after a 10-minute grace period."
  );
  assert.equal(narrative.subline, null);
  // Exactly three facts — not the thirteen-row evidence dump this replaces — and
  // no separate "grace" row, since the cutoff already has grace baked in (rule 4).
  assert.deepEqual(narrative.facts, [
    { label: "Clocked in", value: "8:23 AM" },
    { label: "Cutoff", value: "8:10 AM" },
    { label: "Past cutoff", value: "13m" },
  ]);
});

test("flagNarrative: LATE_START with zero grace names the shift start instead of a redundant cutoff, and draws no threshold line", () => {
  const late = flag("LATE_START", {
    first_in: "2026-08-03T08:15:00",
    shift_start: "2026-08-03T08:00:00",
    late_threshold: "2026-08-03T08:00:00",
    effective_start_grace_minutes: 0,
    grace_minutes: 0,
  });
  const d = day({ checkins: [checkin("2026-08-03T08:15:00")] });

  const narrative = flagNarrative(late, d, DATE_KEY);

  assert.equal(
    narrative.headline,
    "Clocked in at 8:15 AM — 15 minutes after the 8:00 AM shift start."
  );
  // The grace=0 variant swaps "Cutoff" for "Shift start" — the two coincide, so a
  // separate cutoff row would just repeat the shift-start row under a new name.
  assert.deepEqual(narrative.facts, [
    { label: "Clocked in", value: "8:15 AM" },
    { label: "Shift start", value: "8:00 AM" },
    { label: "Late by", value: "15m" },
  ]);
  assert.ok(!narrative.facts.some((f) => f.label === "Cutoff"));

  assert.ok(narrative.timeline);
  assert.equal(narrative.timeline!.threshold, null);
  assert.equal(narrative.timeline!.lunch, null);
  assert.deepEqual(narrative.timeline!.spans, [{ startMin: 480, endMin: 495, tone: "gap" }]);
  assert.deepEqual(narrative.timeline!.marks, [
    { atMin: 495, tone: "alert", label: "Clocked in" },
  ]);
});

test("flagNarrative: LATE_START timeline covers only the start boundary and first segment — shift end never enters the visible window", () => {
  const late = flag("LATE_START", {
    first_in: "2026-08-03T08:23:00",
    shift_start: "2026-08-03T08:00:00",
    late_threshold: "2026-08-03T08:10:00",
    effective_start_grace_minutes: 10,
  });
  const d = day({
    checkins: [checkin("2026-08-03T08:23:00"), checkin("2026-08-03T12:00:00")],
  });

  const timeline = flagNarrative(late, d, DATE_KEY).timeline!;

  assert.deepEqual(timeline.window, { startMin: 435, endMin: 765 });
  // `band` still carries the full scheduled shift (rule 10 is enforced by keeping
  // it out of the window, not by hiding the field) — 1020 (5pm) is shift end.
  assert.deepEqual(timeline.band, { startMin: 480, endMin: 1020 });
  assert.equal(timeline.lunch, null);
  assert.equal(timeline.threshold, 490);
  assert.deepEqual(timeline.spans, [
    { startMin: 480, endMin: 503, tone: "gap" },
    { startMin: 503, endMin: 720, tone: "worked" },
  ]);
  assert.deepEqual(timeline.marks, [{ atMin: 503, tone: "alert", label: "Clocked in" }]);
  assert.ok(timeline.window.endMin < timeline.band!.endMin);
});

test("flagNarrative: LEFT_EARLY states the raw shift end and folds grace into the magnitude, not a headline clause", () => {
  const leftEarly = flag("LEFT_EARLY", {
    last_out: "2026-08-03T16:37:00",
    shift_end: "2026-08-03T17:00:00",
    early_threshold: "2026-08-03T16:50:00",
    effective_end_grace_minutes: 10,
    grace_minutes: 10,
  });
  const d = day({
    checkins: [checkin("2026-08-03T08:05:00"), checkin("2026-08-03T16:37:00")],
  });

  const narrative = flagNarrative(leftEarly, d, DATE_KEY);

  // Unlike LATE_START, the design gives LEFT_EARLY a single headline shape — the
  // grace figure never appears as a clause here, only folded into "Early by".
  assert.equal(
    narrative.headline,
    "Clocked out at 4:37 PM, 13 minutes before their shift was scheduled to end."
  );
  assert.equal(narrative.subline, null);
  assert.deepEqual(narrative.facts, [
    { label: "Clocked out", value: "4:37 PM" },
    { label: "Shift end", value: "5:00 PM" },
    { label: "Early by", value: "13m" },
  ]);
  assert.ok(!narrative.facts.some((f) => /grace/i.test(f.label)));

  const timeline = narrative.timeline!;
  assert.deepEqual(timeline.window, { startMin: 952, endMin: 1065 });
  assert.deepEqual(timeline.band, { startMin: 480, endMin: 1020 });
  assert.equal(timeline.lunch, null);
  assert.equal(timeline.threshold, 1010);
  assert.deepEqual(timeline.spans, [{ startMin: 997, endMin: 1020, tone: "gap" }]);
  assert.deepEqual(timeline.marks, [{ atMin: 997, tone: "alert", label: "Clocked out" }]);
});

test("flagNarrative: LATE_FROM_LUNCH draws both the scheduled band and the observed overshoot", () => {
  const observedLunch: ObservedLunch = {
    lunch_out: "2026-08-03T12:05:00",
    lunch_in: "2026-08-03T13:23:00",
    minutes: 78,
    lunch_start: "2026-08-03T12:00:00",
    lunch_end: "2026-08-03T13:00:00",
    return_threshold: "2026-08-03T13:10:00",
    late_return: true,
  };
  const lateLunch = flag("LATE_FROM_LUNCH", {
    lunch_out: "2026-08-03T12:05:00",
    lunch_in: "2026-08-03T13:23:00",
    lunch_start: "2026-08-03T12:00:00",
    lunch_end: "2026-08-03T13:00:00",
    return_threshold: "2026-08-03T13:10:00",
    grace_minutes: 10,
  });
  const d = day({
    checkins: [
      checkin("2026-08-03T08:00:00"),
      checkin("2026-08-03T12:05:00"),
      checkin("2026-08-03T13:23:00"),
      checkin("2026-08-03T17:00:00"),
    ],
    observedLunch,
  });

  const narrative = flagNarrative(lateLunch, d, DATE_KEY);

  assert.equal(
    narrative.headline,
    "Left for lunch at 12:05 PM, back at 1:23 PM — 13 min past the return deadline."
  );
  assert.deepEqual(narrative.facts, [
    { label: "Actual lunch", value: "12:05 PM – 1:23 PM" },
    { label: "Scheduled", value: "12:00 PM – 1:00 PM" },
    { label: "Deadline", value: "1:10 PM" },
    { label: "Late by", value: "13m" },
  ]);

  const timeline = narrative.timeline!;
  // "Scheduled" (the fact) and `lunch` (the band) both read the raw window — grace
  // only ever shows up baked into `threshold` / "Deadline", never doubled into the
  // band too (rule 4).
  assert.deepEqual(timeline.lunch, { startMin: 720, endMin: 780 });
  assert.deepEqual(timeline.band, { startMin: 480, endMin: 1020 });
  assert.equal(timeline.threshold, 790);
  assert.deepEqual(timeline.spans, [{ startMin: 725, endMin: 803, tone: "gap" }]);
  assert.deepEqual(timeline.marks, [
    { atMin: 725, tone: "normal", label: "Left for lunch" },
    { atMin: 803, tone: "alert", label: "Back" },
  ]);
  assert.deepEqual(timeline.window, { startMin: 675, endMin: 848 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)
Expected: FAIL. `flagNarrative()` for `LATE_START`, `LEFT_EARLY` and `LATE_FROM_LUNCH` still returns Task 1's stub narrative (a placeholder headline, no facts, `timeline: null`), so every `assert.equal(narrative.headline, …)` and `assert.deepEqual(narrative.facts, …)` above throws an `AssertionError: Expected values to be strictly equal`, and the `narrative.timeline!` non-null assertions throw on the stub's `null` timeline. The `# fail` count in the `tsx --test` summary rises by 5 (one per test above).

- [ ] **Step 3: Add the boundary-evidence type and shared timeline helpers**

Add near the top of `src/lib/flagNarrative.ts`, merging into Task 1's existing import block:

```ts
import {
  clamp,
  formatCheckinTime,
  formatDurationMinutes,
  minutesFromDateTime,
  parseDateTimeLocal,
} from "@/lib/attendanceTime";
import { sortCheckinsByTime } from "@/lib/attendancePunches";
import { parseFlagEvidence } from "@/lib/flagLabels";
import { computeExpectedWindowPct, computeLunchWindowPct } from "@/lib/shiftTimeline";
import { observedLunchMinuteRange } from "@/lib/lunchDetection";
```

Then add the shared boundary-flag helpers (place after Task 1's type declarations, before `flagNarrative()`):

```ts
/**
 * Evidence keys read for the three boundary flags (LATE_START / LEFT_EARLY /
 * LATE_FROM_LUNCH). closeout.py:606-674 and lunch_flags.py:58-63 write these onto
 * the shared per-employee-day evidence dict. `grace_minutes` is deliberately NOT
 * in this list — rule 3 forbids reading it here because it is an alias whose
 * meaning depends on which flag's extra_evidence wrote it last
 * (shift_grace.py:80-95's grace_evidence()); read the effective_*_grace_minutes
 * key for the flag instead.
 */
type BoundaryEvidence = {
  first_in?: string;
  last_out?: string;
  shift_start?: string;
  shift_end?: string;
  late_threshold?: string;
  early_threshold?: string;
  effective_start_grace_minutes?: number;
  lunch_out?: string;
  lunch_in?: string;
  lunch_start?: string;
  lunch_end?: string;
  return_threshold?: string;
};

/** Boundary-flag timelines stay narrow: the boundary plus ~45min of runway either side. */
const BOUNDARY_WINDOW_MARGIN_MIN = 45;

/**
 * Minutes between two evidence ISO datetimes (later - earlier), floored at 0.
 * Epoch-based, not minute-of-day: LEFT_EARLY's shift_end/early_threshold can roll
 * to the next calendar day for an overnight shift (closeout.py:660), and a
 * minute-of-day subtraction would silently go negative across that rollover.
 */
function minutesBetweenIso(laterIso: string | undefined, earlierIso: string | undefined): number {
  if (!laterIso || !earlierIso) return 0;
  const later = parseDateTimeLocal(laterIso).getTime();
  const earlier = parseDateTimeLocal(earlierIso).getTime();
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return 0;
  return Math.max(0, Math.round((later - earlier) / 60000));
}

/**
 * computeDayTimeWindow (attendancePunches.ts:605) only takes real checkins, but a
 * boundary flag's window also needs the shift boundary and the cutoff line in
 * view even when neither is itself a punch. Same margin-and-clamp shape, built
 * from raw minute anchors instead.
 */
function minuteWindowFromAnchors(
  anchors: Array<number | null | undefined>,
  marginMin: number = BOUNDARY_WINDOW_MARGIN_MIN
): { startMin: Minute; endMin: Minute } {
  const finite = anchors.filter((n): n is number => n != null && Number.isFinite(n));
  if (!finite.length) return { startMin: 0, endMin: 24 * 60 };
  return {
    startMin: clamp(Math.min(...finite) - marginMin, 0, 24 * 60),
    endMin: clamp(Math.max(...finite) + marginMin, 0, 24 * 60),
  };
}

/** Strips computeExpectedWindowPct/computeLunchWindowPct's pct fields down to the contract's {startMin,endMin}. */
function toMinuteRange(
  win: { startMin: number; endMin: number } | null
): { startMin: Minute; endMin: Minute } | null {
  return win ? { startMin: win.startMin, endMin: win.endMin } : null;
}

function pluralMinutes(n: number): string {
  return n === 1 ? "minute" : "minutes";
}

/** flag.evidence is `unknown`; parseFlagEvidence only narrows it to the generic FlagEvidence shape. */
function readBoundaryEvidence(flag: Flag): BoundaryEvidence {
  return (parseFlagEvidence(flag.evidence) ?? {}) as unknown as BoundaryEvidence;
}
```

- [ ] **Step 4: Run the tests again — still failing, now on missing narrative content rather than a crash**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)
Expected: FAIL, same 5 tests as Step 2 — Step 3 added helpers but nothing calls them yet, so `flagNarrative()`'s switch is untouched and still returns Task 1's stub for all three codes.

- [ ] **Step 5: Implement LATE_START**

Add to `src/lib/flagNarrative.ts`:

```ts
function buildLateStartTimeline(
  day: NarrativeDay,
  evidence: BoundaryEvidence,
  grace: number
): FlagTimelineSpec {
  // Rule 11: spans/marks come from the day's real punches, not evidence.first_in.
  const sorted = sortCheckinsByTime(day.checkins, parseDateTimeLocal);
  const arrivalMin = sorted[0]
    ? minutesFromDateTime(sorted[0].time)
    : minutesFromDateTime(evidence.first_in);
  const nextMin = sorted[1] ? minutesFromDateTime(sorted[1].time) : null;

  const band = day.shift ? toMinuteRange(computeExpectedWindowPct(day.shift)) : null;
  const shiftStartMin = band?.startMin ?? minutesFromDateTime(evidence.shift_start);
  // The threshold line must match the headline's "past cutoff" number exactly
  // (voice rule 2), so both are read from the same frozen evidence field.
  const thresholdMin = minutesFromDateTime(evidence.late_threshold);

  const spans: TimelineSpan[] = [];
  if (shiftStartMin != null && arrivalMin != null && arrivalMin > shiftStartMin) {
    spans.push({ startMin: shiftStartMin, endMin: arrivalMin, tone: "gap" });
  }
  if (arrivalMin != null && nextMin != null && nextMin > arrivalMin) {
    spans.push({ startMin: arrivalMin, endMin: nextMin, tone: "worked" });
  }

  const marks: TimelineMark[] =
    arrivalMin != null ? [{ atMin: arrivalMin, tone: "alert", label: "Clocked in" }] : [];

  return {
    window: minuteWindowFromAnchors([shiftStartMin, arrivalMin, nextMin]),
    band,
    lunch: null,
    // grace=0 makes the cutoff and shift start the same minute — a threshold line
    // on top of the band's own start edge would be a redundant line, not a fact.
    threshold: grace > 0 ? thresholdMin : null,
    spans,
    marks,
  };
}

function buildLateStartNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readBoundaryEvidence(flag);
  const grace = evidence.effective_start_grace_minutes ?? 0;
  const firstInLabel = formatCheckinTime(evidence.first_in);
  const lateMinutes = minutesBetweenIso(evidence.first_in, evidence.late_threshold);

  const headline =
    grace > 0
      ? `Clocked in at ${firstInLabel} — ${lateMinutes} ${pluralMinutes(lateMinutes)} late, even after a ${grace}-minute grace period.`
      : `Clocked in at ${firstInLabel} — ${lateMinutes} ${pluralMinutes(lateMinutes)} after the ${formatCheckinTime(evidence.shift_start)} shift start.`;

  const facts: FlagFact[] =
    grace > 0
      ? [
          { label: "Clocked in", value: firstInLabel },
          { label: "Cutoff", value: formatCheckinTime(evidence.late_threshold) },
          { label: "Past cutoff", value: formatDurationMinutes(lateMinutes) },
        ]
      : [
          { label: "Clocked in", value: firstInLabel },
          { label: "Shift start", value: formatCheckinTime(evidence.shift_start) },
          { label: "Late by", value: formatDurationMinutes(lateMinutes) },
        ];

  return {
    headline,
    subline: null,
    facts,
    timeline: buildLateStartTimeline(day, evidence, grace),
  };
}
```

- [ ] **Step 6: Implement LEFT_EARLY**

Add to `src/lib/flagNarrative.ts`:

```ts
function buildLeftEarlyTimeline(day: NarrativeDay, evidence: BoundaryEvidence): FlagTimelineSpec {
  const sorted = sortCheckinsByTime(day.checkins, parseDateTimeLocal);
  const last = sorted[sorted.length - 1];
  const departureMin = last
    ? minutesFromDateTime(last.time)
    : minutesFromDateTime(evidence.last_out);

  const band = day.shift ? toMinuteRange(computeExpectedWindowPct(day.shift)) : null;
  const shiftEndMin = band?.endMin ?? minutesFromDateTime(evidence.shift_end);
  const thresholdMin = minutesFromDateTime(evidence.early_threshold);

  const spans: TimelineSpan[] = [];
  if (departureMin != null && shiftEndMin != null && shiftEndMin > departureMin) {
    spans.push({ startMin: departureMin, endMin: shiftEndMin, tone: "gap" });
  }

  const marks: TimelineMark[] =
    departureMin != null ? [{ atMin: departureMin, tone: "alert", label: "Clocked out" }] : [];

  return {
    window: minuteWindowFromAnchors([departureMin, thresholdMin, shiftEndMin]),
    band,
    lunch: null,
    threshold: thresholdMin,
    spans,
    marks,
  };
}

function buildLeftEarlyNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readBoundaryEvidence(flag);
  const lastOutLabel = formatCheckinTime(evidence.last_out);
  const earlyMinutes = minutesBetweenIso(evidence.early_threshold, evidence.last_out);

  const headline = `Clocked out at ${lastOutLabel}, ${earlyMinutes} ${pluralMinutes(earlyMinutes)} before their shift was scheduled to end.`;

  const facts: FlagFact[] = [
    { label: "Clocked out", value: lastOutLabel },
    { label: "Shift end", value: formatCheckinTime(evidence.shift_end) },
    { label: "Early by", value: formatDurationMinutes(earlyMinutes) },
  ];

  return {
    headline,
    subline: null,
    facts,
    timeline: buildLeftEarlyTimeline(day, evidence),
  };
}
```

- [ ] **Step 7: Implement LATE_FROM_LUNCH**

Add to `src/lib/flagNarrative.ts`:

```ts
function buildLateFromLunchTimeline(day: NarrativeDay, evidence: BoundaryEvidence): FlagTimelineSpec {
  // Rule 11: feed spans/marks from the day's real lunch detection, not the frozen
  // evidence pair. day.observedLunch is lunchDetection.ts's detectObservedLunch()
  // re-run against the live punch list; evidence.lunch_out/lunch_in are only the
  // fallback for a caller that has not populated observedLunch.
  const observed = observedLunchMinuteRange(day.observedLunch);
  const outMin = observed?.startMin ?? minutesFromDateTime(evidence.lunch_out);
  const inMin = observed?.endMin ?? minutesFromDateTime(evidence.lunch_in);

  // Raw scheduled window, no grace — grace lives in `threshold` alone (rule 4),
  // so the "Scheduled" fact and this band never disagree with each other.
  const lunch = day.shift ? toMinuteRange(computeLunchWindowPct(day.shift)) : null;
  const band = day.shift ? toMinuteRange(computeExpectedWindowPct(day.shift)) : null;
  const thresholdMin = minutesFromDateTime(evidence.return_threshold);

  const spans: TimelineSpan[] = [];
  if (outMin != null && inMin != null && inMin > outMin) {
    spans.push({ startMin: outMin, endMin: inMin, tone: "gap" });
  }

  const marks: TimelineMark[] = [];
  if (outMin != null) marks.push({ atMin: outMin, tone: "normal", label: "Left for lunch" });
  if (inMin != null) marks.push({ atMin: inMin, tone: "alert", label: "Back" });

  return {
    window: minuteWindowFromAnchors([outMin, inMin, lunch?.startMin, thresholdMin]),
    band,
    lunch,
    threshold: thresholdMin,
    spans,
    marks,
  };
}

function buildLateFromLunchNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readBoundaryEvidence(flag);
  const outLabel = formatCheckinTime(evidence.lunch_out);
  const inLabel = formatCheckinTime(evidence.lunch_in);
  const lateMinutes = minutesBetweenIso(evidence.lunch_in, evidence.return_threshold);

  const headline = `Left for lunch at ${outLabel}, back at ${inLabel} — ${lateMinutes} min past the return deadline.`;

  const facts: FlagFact[] = [
    { label: "Actual lunch", value: `${outLabel} – ${inLabel}` },
    {
      label: "Scheduled",
      value: `${formatCheckinTime(evidence.lunch_start)} – ${formatCheckinTime(evidence.lunch_end)}`,
    },
    { label: "Deadline", value: formatCheckinTime(evidence.return_threshold) },
    { label: "Late by", value: formatDurationMinutes(lateMinutes) },
  ];

  return {
    headline,
    subline: null,
    facts,
    timeline: buildLateFromLunchTimeline(day, evidence),
  };
}
```

- [ ] **Step 8: Wire the three builders into `flagNarrative()`'s switch**

Task 1 left `flagNarrative()` ending in a single `return emittedFallbackNarrative(input);`.
This task is the first to add per-code arms, so it introduces the switch. Replace that
lone return with:

```ts
  switch (flag.flag_code) {
    case "LATE_START":
      return buildLateStartNarrative(flag, day, dateKey);
    case "LEFT_EARLY":
      return buildLeftEarlyNarrative(flag, day, dateKey);
    case "LATE_FROM_LUNCH":
      return buildLateFromLunchNarrative(flag, day, dateKey);
    default:
      // Emitted codes with no builder yet — Tasks 3-5 add their arms above this.
      return emittedFallbackNarrative(input);
  }
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)
Expected: PASS. The 5 tests added in Step 1 now pass; the `# tests` and `# pass` counts in the `tsx --test` summary both rise by 5 over the pre-Step-1 baseline, `# fail` returns to its pre-Step-1 value.

- [ ] **Step 10: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts
git commit -m "$(cat <<'EOF'
feat(hr-attendance): narrate LATE_START/LEFT_EARLY/LATE_FROM_LUNCH in the flag panel

Replace the evidence dump for the three grace-boundary flags with a verdict
headline, a compact fact list built from the effective_*_grace_minutes evidence
(never the aliased grace_minutes), and a timeline scoped to just the boundary
each flag is about.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Gap and absence flags

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts` (the `MISSING_TIME` and `UNNOTIFIED_ABSENCE` stub cases and their supporting helpers, added by Task 1's skeleton)
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts` (append new cases; the file itself was created in Task 1)

**Interfaces:**
- Consumes:
  - `export type FlagFact = { label: string; value: string };`
  - `export type Minute = number;`
  - `export type TimelineSpan = { startMin: Minute; endMin: Minute; tone: "worked" | "gap" };`
  - `export type TimelineMark = { atMin: Minute; tone: "normal" | "alert"; label?: string };`
  - `export type FlagTimelineSpec = { window: { startMin: Minute; endMin: Minute }; band: { startMin: Minute; endMin: Minute } | null; lunch: { startMin: Minute; endMin: Minute } | null; threshold: Minute | null; spans: TimelineSpan[]; marks: TimelineMark[] };`
  - `export type FlagNarrative = { headline: string; subline: string | null; facts: FlagFact[]; timeline: FlagTimelineSpec | null };`
  - `export type NarrativeDay = { checkins: Checkin[]; shift?: ShiftContext | null; holiday?: HolidayContext | null; observedLunch?: ObservedLunch | null };`
  - `export function flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative;` — the dispatcher shell and its `MISSING_TIME` / `UNNOTIFIED_ABSENCE` stub cases, both from Task 1.
  - `FlagEvidence`, `parseFlagEvidence` from `src/lib/flagLabels.ts` — `FlagEvidence` already models `interval_start` / `interval_end` / `minutes` / `kind` / `reason` verbatim, which is everything `MISSING_TIME`'s evidence carries.
  - `computeDayTimeWindow` from `src/lib/attendancePunches.ts`.
  - `clamp`, `formatCheckinTime`, `formatDurationMinutes`, `formatMinuteOnDay`, `minutesFromDateTime`, `parseTimeToMinutes` from `src/lib/attendanceTime.ts`.
- Produces: real narration behind `flagNarrative()` for `flag.flag_code === "MISSING_TIME"` and `"UNNOTIFIED_ABSENCE"` (both producers). Task 6's `FlagEvidenceTimeline` renders whatever `FlagTimelineSpec` these two return — including the `lunch`-set/`band`-null shape for `MISSING_TIME` and the `band`-set/zero-`marks` shape for `UNNOTIFIED_ABSENCE` — and Task 7 wires `FlagDetailPanel.tsx` / `FlagDecisionPanel.tsx` to call `flagNarrative()` for every flag they render, these two codes included.

- [ ] **Step 1: Write the failing tests**

Append to the bottom of `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts`. If the file's top-of-file imports don't already include `flagNarrative` and the `NarrativeDay` type from `@/lib/flagNarrative`, or `Flag` from `@/types/calendar`, merge them into the existing import statements (do not add a second `import` line for a module already imported).

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { flagNarrative, type NarrativeDay } from "@/lib/flagNarrative";
import type { Flag } from "@/types/calendar";

test("MISSING_TIME states the gap's relationship to lunch, not just its duration", () => {
  // absence_flags.py:34-67 (evaluate_missing_time_flags) — evidence is
  // exactly interval_start/interval_end/minutes/kind/threshold_minutes.
  const flag: Flag = {
    name: "AUTO-mt-1",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T10:00:00",
      interval_end: "2026-08-06T10:45:00",
      minutes: 45,
      kind: "away",
      threshold_minutes: 30,
    },
  };
  const day: NarrativeDay = {
    checkins: [{ time: "2026-08-06 08:00:00" }, { time: "2026-08-06 17:00:00" }],
    shift: {
      shift_assigned: true,
      start_time: "08:00",
      end_time: "17:00",
      lunch_start: "12:00",
      lunch_end: "12:30",
    },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Gone from 10:00 AM to 10:45 AM — 45m unaccounted, and it wasn't lunch."
  );
  assert.deepEqual(narrative.facts, [
    { label: "Gap", value: "45m" },
    { label: "Left", value: "10:00 AM" },
    { label: "Back", value: "10:45 AM" },
    { label: "Lunch window", value: "12:00 PM – 12:30 PM" },
  ]);
  // Rule 10's corollary: draw only the boundary the flag is about. This
  // flag's boundary is the lunch comparison, not shift start/end, so the
  // shift band must stay off the timeline entirely (band: null) — asserted
  // by absence, since the defect this task fixes is extra rows/marks, not
  // just wrong ones.
  assert.deepEqual(narrative.timeline, {
    window: { startMin: 450, endMin: 1050 },
    band: null,
    lunch: { startMin: 720, endMin: 750 },
    threshold: null,
    spans: [{ startMin: 600, endMin: 645, tone: "gap" }],
    marks: [],
  });
});

test("MISSING_TIME flips the relationship when the gap overlaps the scheduled lunch window", () => {
  const flag: Flag = {
    name: "AUTO-mt-2",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T12:00:00",
      interval_end: "2026-08-06T13:15:00",
      minutes: 75,
      kind: "away",
      threshold_minutes: 30,
    },
  };
  const day: NarrativeDay = {
    checkins: [{ time: "2026-08-06 08:00:00" }, { time: "2026-08-06 17:00:00" }],
    shift: {
      shift_assigned: true,
      start_time: "08:00",
      end_time: "17:00",
      lunch_start: "12:00",
      lunch_end: "12:30",
    },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Gone from 12:00 PM to 1:15 PM — 1h 15m unaccounted, overlapping the scheduled lunch window."
  );
  assert.equal(narrative.facts.find((f) => f.label === "Gap")?.value, "1h 15m");
  assert.deepEqual(narrative.timeline?.lunch, { startMin: 720, endMin: 750 });
});

test("MISSING_TIME degrades to 'wasn't lunch' when the day has no scheduled lunch window", () => {
  const flag: Flag = {
    name: "AUTO-mt-3",
    flag_code: "MISSING_TIME",
    evidence: {
      interval_start: "2026-08-06T10:00:00",
      interval_end: "2026-08-06T10:30:00",
      minutes: 30,
      kind: "away",
      threshold_minutes: 30,
    },
  };
  const day: NarrativeDay = {
    checkins: [{ time: "2026-08-06 08:00:00" }, { time: "2026-08-06 17:00:00" }],
    shift: {
      shift_assigned: true,
      start_time: "08:00",
      end_time: "17:00",
      lunch_start: null,
      lunch_end: null,
    },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.match(narrative.headline, /and it wasn't lunch\.$/);
  assert.deepEqual(narrative.facts.find((f) => f.label === "Lunch window"), {
    label: "Lunch window",
    value: "No scheduled lunch",
  });
  assert.equal(narrative.timeline?.lunch, null);
});

test("UNNOTIFIED_ABSENCE (device closeout) takes its shift label from the live calendar, not evidence.shift_type", () => {
  // closeout.py:505-516 + :588-590 — the device-closeout producer's evidence
  // carries shift_type, employee_branch and device_sn (frozen at emission
  // time), merged with {reason: "on_shift_no_checkins"}.
  const flag: Flag = {
    name: "AUTO-ua-1",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00001",
      date: "2026-08-06",
      on_shift: true,
      reason: "on_shift_no_checkins",
      shift_type: "Night Shift", // frozen at emission — deliberately NOT "Morning"
      employee_branch: "BRANCH-1",
      checkins_count: 0,
      first_in: null,
      last_out: null,
      device_sn: "ZK-EAST-01",
      holiday: null,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: true, shift_type: "Morning", start_time: "09:00", end_time: "17:00" },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  // If this read evidence.shift_type it would say "Night Shift" — reading
  // "Morning" instead proves the headline is sourced from the live
  // calendar (rule 10), which is the only source the company-fallback
  // producer below can supply at all.
  assert.equal(
    narrative.headline,
    "Scheduled for the Morning shift, but never checked in — zero punches all day."
  );
  assert.deepEqual(narrative.facts, [
    { label: "Shift", value: "Morning" },
    { label: "Punches", value: "0" },
    { label: "Caught by", value: "Confirmed at end-of-day device closeout" },
  ]);
  // device_sn is buried provenance here, not a fact (rule 8 — no device
  // serial in user-facing copy outside delivery_failed's "Reported by").
  assert.ok(!narrative.facts.some((f) => f.value.includes("ZK-EAST-01")));
  assert.ok(!narrative.headline.includes("ZK-EAST-01"));
  assert.deepEqual(narrative.timeline, {
    window: { startMin: 510, endMin: 1050 },
    band: { startMin: 540, endMin: 1020 },
    lunch: null,
    threshold: null,
    spans: [{ startMin: 540, endMin: 1020, tone: "gap" }],
    marks: [],
  });
});

test("UNNOTIFIED_ABSENCE (company fallback) resolves the same way even though its evidence carries no shift_type at all", () => {
  // closeout.py:301-313 — the ~3am company-fallback producer's evidence is
  // exactly {employee, date, on_shift, reason, checkins_count}. No
  // shift_type, no employee_branch, no device_sn, no first_in/last_out/holiday.
  const flag: Flag = {
    name: "AUTO-ua-2",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00002",
      date: "2026-08-06",
      on_shift: true,
      reason: "company_fallback_no_checkins",
      checkins_count: 0,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: true, shift_type: "Evening", start_time: "14:00", end_time: "22:00" },
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Scheduled for the Evening shift, but never checked in — zero punches all day."
  );
  assert.equal(
    narrative.facts.find((f) => f.label === "Caught by")?.value,
    "Confirmed by the overnight company-wide check"
  );
  // Headline voice rule 3: HR should never read the engine's internal name
  // for this producer.
  assert.ok(!narrative.headline.toLowerCase().includes("fallback"));
  assert.ok(!narrative.facts.some((f) => f.value.toLowerCase().includes("fallback")));
});

test("UNNOTIFIED_ABSENCE degrades to the generic headline and drops its timeline when the calendar can't resolve a shift", () => {
  const flag: Flag = {
    name: "AUTO-ua-3",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00003",
      date: "2026-08-06",
      on_shift: true,
      reason: "on_shift_no_checkins",
      shift_type: "Morning", // present on evidence — must still be ignored
      checkins_count: 0,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: false }, // assignment was edited away after the flag was raised
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Scheduled to work, but never checked in — zero punches all day."
  );
  assert.equal(
    narrative.facts.find((f) => f.label === "Shift")?.value,
    "Not resolved on this calendar"
  );
  // Rule 9's second clause: no trustworthy timestamp for the thing being
  // flagged (no shift band to size the hatched absence against) — the
  // timeline does not earn its place rather than fabricating a full-day axis.
  assert.equal(narrative.timeline, null);
});

test("UNNOTIFIED_ABSENCE falls back to a start–end time range in the Shift fact when the calendar has a shift but no named shift_type", () => {
  const flag: Flag = {
    name: "AUTO-ua-4",
    flag_code: "UNNOTIFIED_ABSENCE",
    evidence: {
      employee: "HR-EMP-00004",
      date: "2026-08-06",
      on_shift: true,
      reason: "on_shift_no_checkins",
      checkins_count: 0,
    },
  };
  const day: NarrativeDay = {
    checkins: [],
    shift: { shift_assigned: true, start_time: "09:00", end_time: "13:00" }, // no shift_type
  };

  const narrative = flagNarrative(flag, day, "2026-08-06");

  // The headline stays generic — "Scheduled for the 9:00 AM – 1:00 PM
  // shift" reads like a typo, not a schedule. The extra detail belongs in
  // the more-verbose facts row instead.
  assert.equal(
    narrative.headline,
    "Scheduled to work, but never checked in — zero punches all day."
  );
  assert.equal(
    narrative.facts.find((f) => f.label === "Shift")?.value,
    "9:00 AM – 1:00 PM"
  );
  assert.deepEqual(narrative.timeline?.band, { startMin: 540, endMin: 780 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:web` (from dewey_time/frontend/hr_attendance)
Expected: FAIL. Task 1's `MISSING_TIME` / `UNNOTIFIED_ABSENCE` stub cases don't yet produce this task's copy or shapes, so `assert.equal(narrative.headline, ...)` fails against whatever placeholder text the stub returns, and the `assert.deepEqual` calls on `narrative.facts` / `narrative.timeline` fail the same way (empty array, raw evidence dump, or a stub timeline that doesn't match the `band`/`lunch`/`spans`/`marks` shapes asserted above).

- [ ] **Step 3: Implement `MISSING_TIME`**

In `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts`, merge these named imports into the file's existing `import` statements (add only the names not already present; do not create a second `import` line for a module already imported):

```ts
import { computeDayTimeWindow } from "@/lib/attendancePunches";
import {
  clamp,
  formatCheckinTime,
  formatDurationMinutes,
  formatMinuteOnDay,
  minutesFromDateTime,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";
```

Then replace the `MISSING_TIME` stub with:

```ts
// --- MISSING_TIME --------------------------------------------------------
//
// absence_flags.py:34-67 (evaluate_missing_time_flags, called from both
// closeout.py and the 30-min intraday scheduler) writes exactly
// { interval_start, interval_end, minutes, kind, threshold_minutes } — the
// first four already model 1:1 onto flagLabels.ts's FlagEvidence, so no
// local evidence type is needed for this flag.
//
// The decisive question for HR is not "how long" but "was it lunch": the
// same 45 minutes is a fed employee inside the scheduled lunch window and
// unaccounted time everywhere else. Rule 12 draws that comparison from the
// gap (evidence) against the lunch window (the live calendar's day.shift)
// — never from an evidence-side shift_start/shift_type, which this flag's
// evidence dict doesn't carry in the first place.

function missingTimeGapMinutes(evidence: FlagEvidence): { startMin: number; endMin: number } {
  const startMin = minutesFromDateTime(evidence.interval_start) ?? 0;
  const endMin = minutesFromDateTime(evidence.interval_end) ?? startMin;
  return { startMin, endMin };
}

function narrateMissingTime(
  evidence: FlagEvidence,
  day: NarrativeDay,
  dateKey: string
): FlagNarrative {
  const { startMin: gapStartMin, endMin: gapEndMin } = missingTimeGapMinutes(evidence);
  const minutes = evidence.minutes ?? Math.max(0, gapEndMin - gapStartMin);
  const durationLabel = formatDurationMinutes(minutes);
  const startLabel = formatCheckinTime(evidence.interval_start);
  const endLabel = formatCheckinTime(evidence.interval_end);

  const lunchStartMin = parseTimeToMinutes(day.shift?.lunch_start ?? null);
  const lunchEndMin = parseTimeToMinutes(day.shift?.lunch_end ?? null);
  const hasLunchWindow =
    lunchStartMin != null && lunchEndMin != null && lunchEndMin > lunchStartMin;
  const overlapsLunch =
    hasLunchWindow && gapStartMin < lunchEndMin! && gapEndMin > lunchStartMin!;

  const lunchRelationship = overlapsLunch
    ? "overlapping the scheduled lunch window"
    : "and it wasn't lunch";

  // Feed the axis from the day's real checkin list (rule 11), then widen it
  // to guarantee the gap itself is never clipped — a "trailing" gap (left
  // early) can run past shift end well beyond the checkins-derived margin.
  const punchWindow = computeDayTimeWindow(day.checkins, minutesFromDateTime);

  return {
    headline: `Gone from ${startLabel} to ${endLabel} — ${durationLabel} unaccounted, ${lunchRelationship}.`,
    subline: null,
    facts: [
      { label: "Gap", value: durationLabel },
      { label: "Left", value: startLabel },
      { label: "Back", value: endLabel },
      {
        label: "Lunch window",
        value: hasLunchWindow
          ? `${formatMinuteOnDay(dateKey, lunchStartMin!)} – ${formatMinuteOnDay(dateKey, lunchEndMin!)}`
          : "No scheduled lunch",
      },
    ],
    timeline: {
      window: {
        startMin: Math.min(punchWindow?.startMin ?? gapStartMin, gapStartMin),
        endMin: Math.max(punchWindow?.endMin ?? gapEndMin, gapEndMin),
      },
      // No shift band: this flag's finding is the lunch comparison, not the
      // shift boundary — rule 10's corollary (draw only the boundary the
      // flag is about; LATE_START gets the start boundary, this gets lunch).
      band: null,
      lunch: hasLunchWindow ? { startMin: lunchStartMin!, endMin: lunchEndMin! } : null,
      threshold: null,
      spans: [{ startMin: gapStartMin, endMin: gapEndMin, tone: "gap" }],
      marks: [],
    },
  };
}
```

Add a `case "MISSING_TIME":` arm to `flagNarrative()`'s switch (introduced by Task 2), above the `default:` arm, pointing at this function:

```ts
    case "MISSING_TIME":
      return narrateMissingTime(evidence, day, dateKey);
```

- [ ] **Step 4: Run the `MISSING_TIME` tests to verify they pass**

Run: `npm run test:web` (from dewey_time/frontend/hr_attendance)
Expected: the three `MISSING_TIME` tests from Step 1 pass; the four `UNNOTIFIED_ABSENCE` tests still fail (unimplemented).

- [ ] **Step 5: Implement `UNNOTIFIED_ABSENCE`**

In `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts`, replace the `UNNOTIFIED_ABSENCE` stub with:

```ts
// --- UNNOTIFIED_ABSENCE ---------------------------------------------------
//
// Two producers write this code with different evidence:
//  - device closeout, reason "on_shift_no_checkins" (closeout.py:505-516 +
//    :588-590): evidence includes shift_type, employee_branch, device_sn,
//    first_in: null, last_out: null, holiday — merged with {reason}.
//  - the ~3am company fallback, reason "company_fallback_no_checkins"
//    (closeout.py:301-313): evidence is exactly {employee, date, on_shift,
//    reason, checkins_count} — no shift_type, no employee_branch, no
//    device_sn.
//
// Rule 10: never source the "Shift" fact or the headline's shift name from
// evidence.shift_type — read the live calendar (day.shift) instead, so both
// producers describe the same situation identically. device_sn is buried
// provenance here (rule 8: no device serial in user-facing copy outside
// delivery_failed's "Reported by"), so it is read nowhere below.

type UnnotifiedAbsenceEvidence = FlagEvidence & { checkins_count?: number };

const UNNOTIFIED_ABSENCE_CAUGHT_BY: Record<string, string> = {
  on_shift_no_checkins: "Confirmed at end-of-day device closeout",
  company_fallback_no_checkins: "Confirmed by the overnight company-wide check",
};

function unnotifiedAbsenceCaughtBy(reason: string | undefined): string {
  return (reason && UNNOTIFIED_ABSENCE_CAUGHT_BY[reason]) ?? "Confirmed automatically";
}

function unnotifiedAbsenceBand(
  shift: NarrativeDay["shift"]
): { startMin: number; endMin: number } | null {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  const endMin = parseTimeToMinutes(shift.end_time ?? null);
  // Same overnight guard as shiftTimeline.ts's computeExpectedWindowPct
  // (end < start) — an inverted band is out of scope for this task.
  if (startMin == null || endMin == null || endMin <= startMin) return null;
  return { startMin, endMin };
}

/** Named shift only, for the headline sentence. A synthesized time range
 * read as "the 9:00 AM – 1:00 PM shift" scans like a typo, not a schedule —
 * the headline degrades straight to the generic sentence instead. */
function unnotifiedAbsenceHeadlineShiftLabel(shift: NarrativeDay["shift"]): string | null {
  if (!shift?.shift_assigned) return null;
  const type = shift.shift_type?.trim();
  return type || null;
}

/** Shift fact value: same named-shift-first source as the headline, but
 * falls back to a start–end time range — more detail than the headline
 * needs — before giving up. Never evidence.shift_type (rule 10). */
function unnotifiedAbsenceShiftFactLabel(shift: NarrativeDay["shift"], dateKey: string): string {
  const named = unnotifiedAbsenceHeadlineShiftLabel(shift);
  if (named) return named;
  const band = unnotifiedAbsenceBand(shift);
  if (!band) return "Not resolved on this calendar";
  return `${formatMinuteOnDay(dateKey, band.startMin)} – ${formatMinuteOnDay(dateKey, band.endMin)}`;
}

/** Rule 7: UNNOTIFIED_ABSENCE keeps its empty timeline — hatched so it reads
 * as absence, not a chart. Width is the point (a 4h shift reads differently
 * from a 10h shift), so band and window both come from the shift; nothing
 * else is drawn — "zero marks, band only": no lunch subdivision, no cutoff
 * line, the whole band is uniformly "gone". */
function unnotifiedAbsenceTimeline(band: { startMin: number; endMin: number }): FlagTimelineSpec {
  const ABSENCE_TIMELINE_MARGIN_MIN = 30; // matches computeDayTimeWindow's own default margin
  return {
    window: {
      startMin: clamp(band.startMin - ABSENCE_TIMELINE_MARGIN_MIN, 0, 24 * 60),
      endMin: clamp(band.endMin + ABSENCE_TIMELINE_MARGIN_MIN, 0, 24 * 60),
    },
    band,
    lunch: null,
    threshold: null,
    spans: [{ startMin: band.startMin, endMin: band.endMin, tone: "gap" }],
    marks: [],
  };
}

function narrateUnnotifiedAbsence(
  evidence: UnnotifiedAbsenceEvidence,
  day: NarrativeDay,
  dateKey: string
): FlagNarrative {
  const shiftName = unnotifiedAbsenceHeadlineShiftLabel(day.shift);
  const headline = shiftName
    ? `Scheduled for the ${shiftName} shift, but never checked in — zero punches all day.`
    : "Scheduled to work, but never checked in — zero punches all day.";

  const band = unnotifiedAbsenceBand(day.shift);

  return {
    headline,
    subline: null,
    facts: [
      { label: "Shift", value: unnotifiedAbsenceShiftFactLabel(day.shift, dateKey) },
      { label: "Punches", value: String(evidence.checkins_count ?? 0) },
      { label: "Caught by", value: unnotifiedAbsenceCaughtBy(evidence.reason) },
    ],
    // Rule 9's second clause: no trustworthy timestamp for the thing being
    // flagged when the calendar can't resolve a shift band — the timeline
    // does not earn its place rather than fabricating a full-day axis.
    timeline: band ? unnotifiedAbsenceTimeline(band) : null,
  };
}
```

Add a `case "UNNOTIFIED_ABSENCE":` arm to `flagNarrative()`'s switch (introduced by Task 2), above the `default:` arm, pointing at this function:

```ts
    case "UNNOTIFIED_ABSENCE":
      return narrateUnnotifiedAbsence(evidence as UnnotifiedAbsenceEvidence, day, dateKey);
```

- [ ] **Step 6: Run the full suite to verify all seven new tests pass**

Run: `npm run test:web` (from dewey_time/frontend/hr_attendance)
Expected: PASS. All three `MISSING_TIME` tests and all four `UNNOTIFIED_ABSENCE` tests from Step 1 pass; the printed `# tests N` count is at least 7 higher than it was before Step 1 (Global Constraint 13 — `test:web`'s non-recursive glob means a file placed anywhere but `src/lib/` or `src/ui/` silently never runs, so the count rising is the actual evidence, not the exit code).

- [ ] **Step 7: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts
git commit -m "$(cat <<'EOF'
feat(hr-attendance): narrate MISSING_TIME and UNNOTIFIED_ABSENCE evidence panels

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Categorical flags

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts` (replace the `OFF_SHIFT_PUNCH` and `NON_PRIMARY_SITE_PUNCH` stub branches in the `flagNarrative()` dispatcher that Task 1's skeleton created, one stub per code)
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts` (append; file created by Task 1)

**Interfaces:**
- Consumes:
  - `export function flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative;` — Task 1's dispatcher. This task fills in the `case "OFF_SHIFT_PUNCH":` and `case "NON_PRIMARY_SITE_PUNCH":` arms.
  - `export type FlagNarrative = { headline: string; subline: string | null; facts: FlagFact[]; timeline: FlagTimelineSpec | null };`
  - `export type FlagFact = { label: string; value: string };`
  - `export type Minute = number;`
  - `export type TimelineSpan = { startMin: Minute; endMin: Minute; tone: "worked" | "gap" };`
  - `export type TimelineMark = { atMin: Minute; tone: "normal" | "alert"; label?: string };`
  - `export type FlagTimelineSpec = { window: { startMin: Minute; endMin: Minute }; band: { startMin: Minute; endMin: Minute } | null; lunch: { startMin: Minute; endMin: Minute } | null; threshold: Minute | null; spans: TimelineSpan[]; marks: TimelineMark[] };`
  - `export type NarrativeDay = { checkins: Checkin[]; shift?: ShiftContext | null; holiday?: HolidayContext | null; observedLunch?: ObservedLunch | null };`
  - `Flag`, `Checkin`, `HolidayContext` from `@/types/calendar`.
  - `parseFlagEvidence` from `@/lib/flagLabels`; `formatCheckinTime`, `formatBranchLabel`, `minutesFromDateTime`, `parseDateTimeLocal` from `@/lib/attendanceTime`; `computeDayTimeWindow`, `sortCheckinsByTime` from `@/lib/attendancePunches`.
- Produces: the completed `OFF_SHIFT_PUNCH` (both `holiday_has_checkins` and `off_shift_has_checkins` reasons) and `NON_PRIMARY_SITE_PUNCH` branches of `flagNarrative()`. Task 6's `FlagEvidenceTimeline({ spec, ariaLabel })` must handle both outputs this task produces: a marks-only `FlagTimelineSpec` with `band: null` (OFF_SHIFT_PUNCH), and `timeline: null` meaning "render nothing" (NON_PRIMARY_SITE_PUNCH). Task 7 wires both panels to read `narrative.timeline` before deciding whether to mount the timeline at all.

- [ ] **Step 1: Write the failing tests**

Append the following to `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts` (merge the `import` lines into the file's existing import block from Task 1/2/3 — drop any that are already there rather than duplicating):

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { computeDayTimeWindow } from "@/lib/attendancePunches";
import { minutesFromDateTime } from "@/lib/attendanceTime";
import { flagNarrative, type NarrativeDay } from "@/lib/flagNarrative";
import type { Checkin, Flag } from "@/types/calendar";

// --- OFF_SHIFT_PUNCH · holiday_has_checkins -------------------------------
// Evidence shape mirrors the shared per-employee-day dict (closeout.py:505-516)
// merged with the holiday branch's extra_evidence (closeout.py:524): every key
// below except `reason` and `holiday` is either constraint-6 noise (employee,
// date, on_shift, shift_type) or constraint-8 provenance (device_sn) that must
// never surface in the narrative, on either scenario in this file.
const holidayEvidence = {
  employee: "HR-EMP-00007",
  date: "2026-08-06",
  on_shift: false,
  shift_type: null,
  employee_branch: "Riverside",
  checkins_count: 2,
  first_in: "2026-08-06T10:15:00",
  last_out: "2026-08-06T14:40:00",
  device_sn: "ZK-A4-014",
  holiday: { description: "Founders' Day", weekly_off: false },
  reason: "holiday_has_checkins",
};

const holidayFlag: Flag = {
  name: "AF-HOLIDAY-1",
  flag_code: "OFF_SHIFT_PUNCH",
  day_closed: 1,
  evidence: holidayEvidence,
};

const holidayCheckins: Checkin[] = [
  { time: "2026-08-06 10:15:00", custom_device_branch: "Riverside" },
  { time: "2026-08-06 14:40:00", custom_device_branch: "Riverside" },
];

const holidayDay: NarrativeDay = { checkins: holidayCheckins };

test("OFF_SHIFT_PUNCH (holiday_has_checkins) promotes the holiday name to a fact instead of losing it to the disclosure", () => {
  const narrative = flagNarrative(holidayFlag, holidayDay, "2026-08-06");

  assert.equal(
    narrative.headline,
    "Punched 2 times on Founders' Day, a public holiday — nobody was scheduled."
  );
  assert.equal(narrative.subline, null);

  // This is the fix for the design doc's counter-example: formatEvidenceValue
  // (flagDetails.ts:187-219) returns null for the holiday object so it never
  // reached a row, while employee_branch got a first-class one. Assert both
  // halves of the inversion are gone: the holiday IS a fact, employee_branch
  // is NOT.
  assert.deepEqual(narrative.facts, [
    { label: "Day", value: "Founders' Day" },
    { label: "Punch times", value: "10:15 AM, 2:40 PM" },
  ]);
  assert.ok(!narrative.facts.some((f) => f.label === "Employee branch"));
  assert.ok(narrative.facts.length <= 4);

  // Constraint 8: no device serial anywhere in user-facing copy, even though
  // evidence.device_sn is present on this flag.
  assert.ok(!narrative.headline.includes("ZK-A4-014"));
  assert.ok(!narrative.facts.some((f) => f.value.includes("ZK-A4-014")));

  // No shift exists for either OFF_SHIFT_PUNCH reason, so there is no shift
  // band to draw — but the axis must still auto-scale to the punches
  // (design rule 6), never a blank 24-hour axis.
  assert.ok(narrative.timeline);
  const expectedWindow = computeDayTimeWindow(holidayCheckins, minutesFromDateTime)!;
  assert.deepEqual(narrative.timeline!.window, {
    startMin: expectedWindow.startMin,
    endMin: expectedWindow.endMin,
  });
  assert.equal(narrative.timeline!.band, null);
  assert.equal(narrative.timeline!.lunch, null);
  assert.equal(narrative.timeline!.threshold, null);
  assert.deepEqual(narrative.timeline!.spans, []);
  assert.deepEqual(narrative.timeline!.marks, [
    { atMin: minutesFromDateTime("2026-08-06 10:15:00"), tone: "alert" },
    { atMin: minutesFromDateTime("2026-08-06 14:40:00"), tone: "alert" },
  ]);
});

// --- OFF_SHIFT_PUNCH · off_shift_has_checkins -----------------------------
// Same shared dict shape, holiday is null (closeout.py:559's branch is only
// reached once the holiday branch at :520 has already returned).
const noShiftEvidence = {
  employee: "HR-EMP-00009",
  date: "2026-08-06",
  on_shift: false,
  shift_type: null,
  employee_branch: null,
  checkins_count: 1,
  first_in: "2026-08-06T09:05:00",
  last_out: "2026-08-06T09:05:00",
  device_sn: "ZK-B1-002",
  holiday: null,
  reason: "off_shift_has_checkins",
};

const noShiftFlag: Flag = {
  name: "AF-NOSHIFT-1",
  flag_code: "OFF_SHIFT_PUNCH",
  day_closed: 1,
  evidence: noShiftEvidence,
};

const noShiftCheckins: Checkin[] = [
  { time: "2026-08-06 09:05:00", custom_device_branch: null },
];

const noShiftDay: NarrativeDay = { checkins: noShiftCheckins };

test("OFF_SHIFT_PUNCH (off_shift_has_checkins) gets its own headline, no Day fact, and no grace anywhere", () => {
  const narrative = flagNarrative(noShiftFlag, noShiftDay, "2026-08-06");

  // Different reason, different story — a day with literally no shift
  // assigned is not the same finding as a public holiday, so this must not
  // reuse the holiday headline template.
  assert.equal(
    narrative.headline,
    "Punched 1 time — no shift was scheduled for this employee that day."
  );
  assert.equal(narrative.subline, null);
  assert.deepEqual(narrative.facts, [{ label: "Punch times", value: "9:05 AM" }]);
  assert.ok(!narrative.facts.some((f) => f.label === "Day"));

  // Neither OFF_SHIFT_PUNCH reason writes a grace-bearing extra_evidence key
  // (closeout.py:524 and :559 both write only `reason`), so nothing here
  // should ever mention grace — the defect this whole plan exists to remove.
  assert.ok(!narrative.headline.toLowerCase().includes("grace"));
  assert.ok(!narrative.facts.some((f) => f.value.toLowerCase().includes("grace")));

  assert.ok(narrative.timeline);
  const expectedWindow = computeDayTimeWindow(noShiftCheckins, minutesFromDateTime)!;
  assert.deepEqual(narrative.timeline!.window, {
    startMin: expectedWindow.startMin,
    endMin: expectedWindow.endMin,
  });
  assert.equal(narrative.timeline!.band, null);
  assert.deepEqual(narrative.timeline!.marks, [
    { atMin: minutesFromDateTime("2026-08-06 09:05:00"), tone: "alert" },
  ]);
});

// --- NON_PRIMARY_SITE_PUNCH ------------------------------------------------
// Evidence shape mirrors _non_primary_site_punch_flag (closeout.py:413-436),
// merged into either producer's shared dict — closeout.py:732 (inside
// `_insert_flags`) or intraday.py:137-141 — both of which carry checkins_count. Only the
// closeout path also carries device_sn (closeout.py:514); this fixture
// includes it to prove it is read nowhere near this flag.
const nonPrimaryEvidence = {
  employee: "HR-EMP-00003",
  date: "2026-08-06",
  on_shift: true,
  shift_type: "Day Shift",
  employee_branch: "Riverside",
  checkins_count: 5,
  first_in: "2026-08-06T08:02:00",
  last_out: "2026-08-06T16:58:00",
  device_sn: "ZK-A4-014",
  non_primary_checkins: 3,
};

const nonPrimaryFlag: Flag = {
  name: "AF-NONPRIMARY-1",
  flag_code: "NON_PRIMARY_SITE_PUNCH",
  day_closed: 1,
  evidence: nonPrimaryEvidence,
};

const nonPrimaryCheckins: Checkin[] = [
  { time: "2026-08-06 08:02:00", custom_device_branch: "Riverside" },
  { time: "2026-08-06 10:30:00", custom_device_branch: "Elm Street" },
  { time: "2026-08-06 12:00:00", custom_device_branch: "Elm Street" },
  { time: "2026-08-06 13:15:00", custom_device_branch: "Elm Street" },
  { time: "2026-08-06 16:58:00", custom_device_branch: "Riverside" },
];

const nonPrimaryDay: NarrativeDay = { checkins: nonPrimaryCheckins };

test("NON_PRIMARY_SITE_PUNCH states WHERE, drops the timeline entirely, and never names a device", () => {
  const narrative = flagNarrative(nonPrimaryFlag, nonPrimaryDay, "2026-08-06");

  assert.equal(
    narrative.headline,
    "3 of 5 punches today were at a site other than Riverside, this employee's home branch."
  );
  assert.equal(narrative.subline, null);
  assert.deepEqual(narrative.facts, [
    { label: "Home branch", value: "Riverside" },
    { label: "Punches elsewhere", value: "3 of 5" },
  ]);
  assert.ok(narrative.facts.length <= 4);

  // This is the first flag in the plan where the timeline is honestly
  // dropped (design rule 5 / row "NON_PRIMARY_SITE_PUNCH ... No"). The
  // finding is WHICH branch, not WHEN — a timeline would render five
  // evenly-spaced marks and say nothing a clock face can answer.
  assert.equal(narrative.timeline, null);

  // Constraint 8: evidence.device_sn is present on this fixture (inherited
  // from the shared closeout evidence dict) but must never be named — there
  // is no device↔branch registry to resolve it against the punch that was
  // actually off-site.
  assert.ok(!narrative.headline.includes("ZK-A4-014"));
  assert.ok(!narrative.facts.some((f) => f.value.includes("ZK-A4-014")));
  assert.ok(!/device/i.test(narrative.headline));
  assert.ok(!narrative.facts.some((f) => /device/i.test(f.label)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)

Expected: FAIL. Task 1's skeleton leaves `OFF_SHIFT_PUNCH` and `NON_PRIMARY_SITE_PUNCH` as stubs (placeholder headline/facts, not evidence-derived), so all three new tests fail on the `assert.equal(narrative.headline, ...)` / `assert.deepEqual(narrative.facts, ...)` lines with an `AssertionError` showing the stub's placeholder string instead of the exact sentence above. The `NON_PRIMARY_SITE_PUNCH` test additionally fails `assert.equal(narrative.timeline, null)` if the stub's placeholder timeline is non-null.

- [ ] **Step 3: Implement the OFF_SHIFT_PUNCH branch**

In `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts`, add the imports this task needs (merge with what Task 1/2/3 already imported — do not duplicate):

```ts
import { computeDayTimeWindow, sortCheckinsByTime } from "@/lib/attendancePunches";
import { formatBranchLabel, formatCheckinTime, minutesFromDateTime, parseDateTimeLocal } from "@/lib/attendanceTime";
import { parseFlagEvidence } from "@/lib/flagLabels";
```

Add these module-private helpers (near the per-code builder functions Tasks 2-3 added), then add a `case "OFF_SHIFT_PUNCH":` arm to the `flagNarrative()` switch, above `default:`, calling `buildOffShiftPunchNarrative(flag, day, dateKey)`:

```ts
/**
 * OFF_SHIFT_PUNCH's shared per-employee-day evidence dict (closeout.py:505-516)
 * merged with one of two extra_evidence reasons (closeout.py:524, :559). Only
 * the keys this scenario reads are typed here — employee, date, on_shift,
 * shift_type, first_in, last_out and device_sn all ride along on the shared
 * dict but are exactly the constraint-6/constraint-8 fields this function
 * must never promote to a fact or name in copy.
 */
type OffShiftPunchEvidence = {
  reason?: "holiday_has_checkins" | "off_shift_has_checkins";
  checkins_count?: number;
  holiday?: { description: string; weekly_off: boolean } | null;
};

function punchTimesFact(checkins: Checkin[]): FlagFact {
  const sorted = sortCheckinsByTime(checkins, parseDateTimeLocal);
  const value = sorted.length
    ? sorted.map((c) => formatCheckinTime(c.time)).join(", ")
    : "—";
  return { label: "Punch times", value };
}

/**
 * Punch marks only, no band, no threshold — the shift half of a
 * FlagTimelineSpec never applies to OFF_SHIFT_PUNCH because neither reason
 * runs against a resolved shift (closeout.py:524 fires inside `if holiday:`
 * before any shift lookup for the day completes; :559 fires inside
 * `if not on_shift:`). The axis still auto-scales to the punches themselves
 * (design rule 6) rather than falling back to a blank 24-hour axis.
 */
function punchMarksTimeline(checkins: Checkin[]): FlagTimelineSpec | null {
  const window = computeDayTimeWindow(checkins, minutesFromDateTime);
  if (!window) return null;

  const sorted = sortCheckinsByTime(checkins, parseDateTimeLocal);
  return {
    window: { startMin: window.startMin, endMin: window.endMin },
    band: null,
    lunch: null,
    threshold: null,
    spans: [],
    marks: sorted
      .map((c) => minutesFromDateTime(c.time))
      .filter((atMin): atMin is number => atMin != null)
      .map((atMin) => ({ atMin, tone: "alert" as const })),
  };
}

/**
 * OFF_SHIFT_PUNCH carries two reasons that are unrelated stories to a human —
 * a public holiday nobody was scheduled to work, versus simply having no
 * shift assignment at all — so each gets its own headline.
 *
 * The holiday name is read from evidence.holiday, not day.holiday: it is the
 * frozen finding the engine judged (design rule 9), and it is the exact
 * value the current panel loses — formatEvidenceValue (flagDetails.ts:
 * 187-219) returns null for object values, so `holiday` never reaches a row
 * while `employee_branch` gets a first-class one. Promoting it to a fact
 * here is that fix.
 */
function buildOffShiftPunchNarrative(
  flag: Flag,
  day: NarrativeDay,
  _dateKey: string
): FlagNarrative {
  const evidence = (parseFlagEvidence(flag.evidence) ?? {}) as OffShiftPunchEvidence;
  const checkins = day.checkins ?? [];
  const n = evidence.checkins_count ?? checkins.length;
  const times = n === 1 ? "time" : "times";
  const timeline = punchMarksTimeline(checkins);

  if (evidence.reason === "holiday_has_checkins") {
    const holidayName = evidence.holiday?.description ?? "a holiday";
    return {
      headline: `Punched ${n} ${times} on ${holidayName}, a public holiday — nobody was scheduled.`,
      subline: null,
      facts: [{ label: "Day", value: holidayName }, punchTimesFact(checkins)],
      timeline,
    };
  }

  // off_shift_has_checkins: no holiday, and no Shift Assignment covers the day.
  return {
    headline: `Punched ${n} ${times} — no shift was scheduled for this employee that day.`,
    subline: null,
    facts: [punchTimesFact(checkins)],
    timeline,
  };
}
```

- [ ] **Step 4: Run the tests — the two OFF_SHIFT_PUNCH tests should now pass**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)

Expected: the two `OFF_SHIFT_PUNCH` tests pass. `NON_PRIMARY_SITE_PUNCH states WHERE, drops the timeline entirely, and never names a device` still FAILs — its `case` in the dispatcher is still the Task 1 stub.

- [ ] **Step 5: Implement the NON_PRIMARY_SITE_PUNCH branch**

In `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts`, add this helper next to `buildOffShiftPunchNarrative`, then add a `case "NON_PRIMARY_SITE_PUNCH":` arm to the `flagNarrative()` switch, above `default:`, calling `buildNonPrimarySitePunchNarrative(flag, day, dateKey)`:

```ts
/**
 * NON_PRIMARY_SITE_PUNCH's own evidence (_non_primary_site_punch_flag,
 * closeout.py:413-436, shared verbatim by intraday.py:126-141) plus
 * checkins_count from whichever producer's shared per-employee-day dict it
 * rode in on.
 */
type NonPrimarySitePunchEvidence = {
  employee_branch?: string | null;
  non_primary_checkins?: number;
  checkins_count?: number;
};

/**
 * No timeline. The finding here is WHERE the punches landed, not WHEN — a
 * timeline would render an evenly-spaced set of marks and say nothing about
 * location (design rule 5: categorical findings — which branch, which
 * device, which day type — earn no timeline).
 *
 * Deliberately never reads evidence.device_sn: on the closeout producer it
 * is inherited from the shared per-employee-day dict (closeout.py:514,
 * merged in at :692) and names whichever device triggered THAT closeout
 * job, not the device that recorded the off-site punch — and the intraday
 * producer (intraday.py:106-114) never writes device_sn at all. There is no
 * device↔branch registry to resolve either case correctly (constraint 8),
 * so no device is named in either producer's rendering.
 */
function buildNonPrimarySitePunchNarrative(
  flag: Flag,
  _day: NarrativeDay,
  _dateKey: string
): FlagNarrative {
  const evidence = (parseFlagEvidence(flag.evidence) ?? {}) as NonPrimarySitePunchEvidence;
  const nonPrimary = evidence.non_primary_checkins ?? 0;
  const total = evidence.checkins_count ?? nonPrimary;
  const branch = formatBranchLabel(evidence.employee_branch) ?? "their home branch";

  return {
    headline: `${nonPrimary} of ${total} punches today were at a site other than ${branch}, this employee's home branch.`,
    subline: null,
    facts: [
      { label: "Home branch", value: branch },
      { label: "Punches elsewhere", value: `${nonPrimary} of ${total}` },
    ],
    timeline: null,
  };
}
```

- [ ] **Step 6: Run the full suite and confirm the test count rose**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)

Expected: PASS, all three new tests green. `test:web` prints a `# tests N` summary line at the end — confirm `N` is 3 higher than it was before Step 1 (per Global Constraint 13, the exit code alone is not evidence a non-recursive glob actually picked up the new tests).

- [ ] **Step 7: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts
git commit -m "$(cat <<'EOF'
feat(hr-attendance): narrate OFF_SHIFT_PUNCH and NON_PRIMARY_SITE_PUNCH

Gives holiday_has_checkins and off_shift_has_checkins their own headlines
and promotes the holiday name out of the disclosure-only evidence blob
into a first-class fact (it was previously unreachable — formatEvidenceValue
returns null for object values). NON_PRIMARY_SITE_PUNCH's timeline is
dropped entirely: the finding is which branch, not when, and a clock face
has nothing to say about that.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Record-issue flags

`ATTENDANCE_ISSUE`'s four reasons — `single_checkin`, `unpaired_punch`,
`unknown_device_branch`, `delivery_failed` — plus the no-detector fallback for
`MISSING_IN_OR_OUT` / `NO_CHECKIN_YET` / `MISSING_LUNCH` and any unrecognised code.

`single_checkin` is the case that triggered the redesign: the spec's opening screenshot is
this exact flag rendered as thirteen equal rows, seven of them grace values, with the
finding buried at row thirteen. It gets **one** fact here, deliberately.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts` — add the record-issue
  builders and the no-detector builder, then replace the two stub branches in
  `flagNarrative()`'s dispatch
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts` — created by Task 1;
  this task appends to it

All commands below run from `dewey_time/frontend/hr_attendance`.

**Interfaces:**

- Consumes (from Task 1, `src/lib/flagNarrative.ts`):
  - `export type FlagFact = { label: string; value: string };`
  - `export type Minute = number;`
  - `export type TimelineSpan = { startMin: Minute; endMin: Minute; tone: "worked" | "gap" };`
  - `export type TimelineMark = { atMin: Minute; tone: "normal" | "alert"; label?: string };`
  - `export type FlagTimelineSpec = { window: { startMin: Minute; endMin: Minute }; band: { startMin: Minute; endMin: Minute } | null; lunch: { startMin: Minute; endMin: Minute } | null; threshold: Minute | null; spans: TimelineSpan[]; marks: TimelineMark[] };`
  - `export type FlagNarrative = { headline: string; subline: string | null; facts: FlagFact[]; timeline: FlagTimelineSpec | null };`
  - `export type NarrativeDay = { checkins: Checkin[]; shift?: ShiftContext | null; holiday?: HolidayContext | null; observedLunch?: ObservedLunch | null };`
  - `export function flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative;`
  - `export const NO_DETECTOR_CODES: readonly string[];`
  - `export function isEmittedCode(flagCode: string): boolean;`
- Consumes (existing library helpers — do **not** write second copies):
  - `@/lib/attendanceTime`: `clamp`, `formatBranchLabel`, `formatCheckinTime`,
    `formatMinuteOnDay`, `minutesFromDateTime`, `parseDateTimeLocal`, `parseTimeToMinutes`
  - `@/lib/attendancePunches`: `classifyUnpairedPresentations`, `computeDayTimeWindow`,
    `deriveSegments`, `hasPunchBranch`, `sortCheckinsByTime`
  - `@/lib/flagLabels`: `formatFlagLabel`, `parseFlagEvidence`
- Produces: no new module exports. After this task `flagNarrative()` returns real narratives
  for `flag_code === "ATTENDANCE_ISSUE"` (all four reasons plus an unrecognised-reason
  fallback) and for every code `isEmittedCode()` rejects. Task 6 renders
  `FlagNarrative.timeline`; Task 7 renders the whole `FlagNarrative`. Neither needs a new
  symbol from here.

**Evidence this task reads** (from `dewey_time/attendance_engine/record_issue_flags.py:24-81`,
merged onto the shared per-employee-day dict at `closeout.py:505-516` / `:692`):

| reason | keys written by the detector | keys inherited from the shared dict |
|---|---|---|
| `single_checkin` | `reason`, `checkins_count`, `punch_time` | everything, incl. all seven grace keys |
| `unpaired_punch` | `reason`, `punch_time`, `custom_device_branch` | same |
| `unknown_device_branch` | `reason`, `unknown_branch_checkins` (a **count**, no punch list) | same |
| `delivery_failed` | `reason`, `undelivered` (`{pin, frappe_employee_id, …}`) | same, incl. `device_sn` |

---

- [ ] **Step 1: Write the failing test**

Append to `src/lib/flagNarrative.test.ts`. Task 1's version of that file already imports
`node:test`, `node:assert/strict` and symbols from `@/lib/flagNarrative` — **merge** the
import lines below into those existing statements rather than adding a second `import` for
the same module (a duplicate binding is a SyntaxError, not a warning). Everything from
`const RECORD_ISSUE_SHIFT` onward appends verbatim at the end of the file.

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { flagNarrative, type FlagNarrative, type NarrativeDay } from "@/lib/flagNarrative";
import type { Checkin, Flag, ShiftContext } from "@/types/calendar";

const RECORD_ISSUE_SHIFT: ShiftContext = {
  shift_assigned: true,
  shift_type: "Day Shift",
  start_time: "08:00:00",
  end_time: "17:00:00",
  grace_minutes: 10,
  lunch_start: "12:00:00",
  lunch_end: "12:30:00",
};

/**
 * The thirteen-row blob from the spec's opening screenshot, verbatim: every key
 * `_generate_for_employee_date` stamps onto the shared evidence dict
 * (closeout.py:505-516, :606-611, :662-663) and then merges into EVERY flag it
 * inserts for that employee-day. A record-issue flag never asked for any of it.
 */
const SHARED_CLOSEOUT_EVIDENCE = {
  employee: "HR-EMP-00001",
  date: "2026-08-03",
  on_shift: true,
  shift_type: "Day Shift",
  employee_branch: "BRANCH-Downtown",
  checkins_count: 1,
  first_in: "2026-08-03T14:23:00",
  last_out: "2026-08-03T14:23:00",
  device_sn: "ZK-A4-014",
  holiday: null,
  shift_start: "2026-08-03T08:00:00",
  late_threshold: "2026-08-03T08:10:00",
  shift_end: "2026-08-03T17:00:00",
  early_threshold: "2026-08-03T16:50:00",
  grace_minutes: 10,
  effective_start_grace_minutes: 10,
  effective_end_grace_minutes: 10,
  effective_lunch_return_grace_minutes: 10,
  custom_grace_minutes: 10,
  late_entry_grace_period: 10,
  early_exit_grace_period: 10,
};

function recordIssueFlag(over: Partial<Flag> & { evidence: unknown }): Flag {
  return {
    name: "AF-record-issue-1",
    flag_code: "ATTENDANCE_ISSUE",
    severity: "WARNING",
    status: "OPEN",
    source: "AUTO",
    day_closed: 1,
    ...over,
  } as Flag;
}

function punch(time: string, branch: string | null = "BRANCH-Downtown"): Checkin {
  return { name: `EC-${time}`, time: `2026-08-03 ${time}:00`, custom_device_branch: branch };
}

function recordIssueDay(over: Partial<NarrativeDay> = {}): NarrativeDay {
  return { checkins: [], shift: RECORD_ISSUE_SHIFT, holiday: null, observedLunch: null, ...over };
}

/**
 * Everything a human actually reads, and nothing else. Asserting on
 * JSON.stringify(narrative) would be useless here: FlagTimelineSpec has a key
 * literally named `threshold`, so /threshold/ matches the serialised shape of a
 * narrative that shows no threshold at all.
 */
function visibleCopy(narrative: FlagNarrative): string {
  return [
    narrative.headline,
    narrative.subline ?? "",
    ...narrative.facts.flatMap((fact) => [fact.label, fact.value]),
    ...(narrative.timeline?.marks ?? []).map((mark) => mark.label ?? ""),
  ].join(" | ");
}

const SINGLE_CHECKIN = recordIssueFlag({
  evidence: {
    ...SHARED_CLOSEOUT_EVIDENCE,
    reason: "single_checkin",
    checkins_count: 1,
    punch_time: "2026-08-03T14:23:00",
  },
});

test("single_checkin headline states the finding, not the fields", () => {
  const narrative = flagNarrative(
    SINGLE_CHECKIN,
    recordIssueDay({ checkins: [punch("14:23")] }),
    "2026-08-03",
  );

  assert.equal(narrative.headline, "Punched once at 2:23 PM, then never again that day.");
});

// THE regression test for this whole redesign. The live panel renders thirteen
// rows for this exact flag; seven are grace values that have nothing to do with
// whether there was one punch or two. One fact, and no grace string anywhere.
test("single_checkin renders exactly one fact and no grace, threshold or shift-start copy", () => {
  const narrative = flagNarrative(
    SINGLE_CHECKIN,
    recordIssueDay({ checkins: [punch("14:23")] }),
    "2026-08-03",
  );

  assert.deepEqual(narrative.facts, [{ label: "Only punch", value: "2:23 PM" }]);

  const copy = visibleCopy(narrative);
  assert.doesNotMatch(copy, /grace/i);
  assert.doesNotMatch(copy, /10m/);
  assert.doesNotMatch(copy, /threshold/i);
  assert.doesNotMatch(copy, /8:00 AM/);
  assert.doesNotMatch(copy, /8:10 AM/);
  assert.doesNotMatch(copy, /4:50 PM/);
  // "First check-in 2:23 PM / Last check-out 2:23 PM / Punch time 2:23 PM" is one
  // timestamp under three labels; only one of them survives, and it is not these.
  assert.doesNotMatch(copy, /First check-in/i);
  assert.doesNotMatch(copy, /Last check-out/i);
  assert.doesNotMatch(copy, /Punch time/i);
  assert.doesNotMatch(copy, /Shift start/i);
});

test("single_checkin draws a lone alert mark in an otherwise empty shift band", () => {
  const narrative = flagNarrative(
    SINGLE_CHECKIN,
    recordIssueDay({ checkins: [punch("14:23")] }),
    "2026-08-03",
  );

  const timeline = narrative.timeline;
  assert.ok(timeline);
  assert.deepEqual(timeline.window, { startMin: 480, endMin: 1020 });
  assert.deepEqual(timeline.band, { startMin: 480, endMin: 1020 });
  // Only the boundary the flag is about: no lunch band, no late threshold.
  assert.equal(timeline.lunch, null);
  assert.equal(timeline.threshold, null);
  // "Otherwise empty" is the point — one punch pairs with nothing.
  assert.deepEqual(timeline.spans, []);
  assert.equal(timeline.marks.length, 1);
  assert.equal(timeline.marks[0].atMin, 863);
  assert.equal(timeline.marks[0].tone, "alert");
});

// A rogue punch: no device branch, so it is its own run and pairs with nothing,
// sitting between two healthy paired spans.
const ROGUE_DAY_CHECKINS = [
  punch("08:00"),
  punch("12:00"),
  punch("13:07", null),
  punch("13:30"),
  punch("17:00"),
];

const UNPAIRED_ROGUE = recordIssueFlag({
  evidence: {
    ...SHARED_CLOSEOUT_EVIDENCE,
    checkins_count: 5,
    reason: "unpaired_punch",
    punch_time: "2026-08-03T13:07:00",
    custom_device_branch: null,
  },
});

test("unpaired_punch headline names the punch and says the rest of the day paired up", () => {
  const narrative = flagNarrative(
    UNPAIRED_ROGUE,
    recordIssueDay({ checkins: ROGUE_DAY_CHECKINS }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "Punched at 1:07 PM, but it never got matched to a clock-out — the day's other punches paired up fine.",
  );
});

test("unpaired_punch omits the From fact when the odd punch carried no device branch", () => {
  const narrative = flagNarrative(
    UNPAIRED_ROGUE,
    recordIssueDay({ checkins: ROGUE_DAY_CHECKINS }),
    "2026-08-03",
  );

  assert.deepEqual(narrative.facts, [{ label: "Odd punch", value: "1:07 PM" }]);
  assert.doesNotMatch(visibleCopy(narrative), /\bFrom\b/);
});

test("unpaired_punch marks the rogue tick between the day's two healthy spans", () => {
  const narrative = flagNarrative(
    UNPAIRED_ROGUE,
    recordIssueDay({ checkins: ROGUE_DAY_CHECKINS }),
    "2026-08-03",
  );

  const timeline = narrative.timeline;
  assert.ok(timeline);
  assert.deepEqual(timeline.window, { startMin: 450, endMin: 1050 });
  assert.deepEqual(timeline.spans, [
    { startMin: 480, endMin: 720, tone: "worked" },
    { startMin: 810, endMin: 1020, tone: "worked" },
  ]);
  assert.deepEqual(
    timeline.marks.map((mark) => [mark.atMin, mark.tone]),
    [[787, "alert"]],
  );
});

test("unpaired_punch promotes the punch's device branch as From", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: {
        ...SHARED_CLOSEOUT_EVIDENCE,
        checkins_count: 3,
        reason: "unpaired_punch",
        punch_time: "2026-08-03T17:00:00",
        custom_device_branch: "BRANCH-Downtown",
      },
    }),
    recordIssueDay({ checkins: [punch("08:00"), punch("12:00"), punch("17:00")] }),
    "2026-08-03",
  );

  assert.deepEqual(narrative.facts, [
    { label: "Odd punch", value: "5:00 PM" },
    { label: "From", value: "Downtown" },
  ]);
  const timeline = narrative.timeline;
  assert.ok(timeline);
  assert.deepEqual(
    timeline.marks.map((mark) => [mark.atMin, mark.tone]),
    [[1020, "alert"]],
  );
});

const UNKNOWN_BRANCH_CHECKINS = [
  punch("08:00"),
  punch("12:03", null),
  punch("12:35", null),
  punch("17:00"),
];

const UNKNOWN_BRANCH = recordIssueFlag({
  evidence: {
    ...SHARED_CLOSEOUT_EVIDENCE,
    checkins_count: 4,
    reason: "unknown_device_branch",
    unknown_branch_checkins: 2,
  },
});

test("unknown_device_branch counts the punches and says whose problem it is", () => {
  const narrative = flagNarrative(
    UNKNOWN_BRANCH,
    recordIssueDay({ checkins: UNKNOWN_BRANCH_CHECKINS }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "2 punches today came from a device that didn't report which site it's at.",
  );
  assert.equal(
    narrative.subline,
    "This is a device or config problem, not necessarily an employee problem.",
  );
  assert.deepEqual(narrative.facts, [{ label: "Unlabelled punches", value: "2 punches" }]);
});

// Evidence carries only a count, so WHICH punches were unlabelled can come from
// exactly one place: the day's checkin list.
test("unknown_device_branch marks the unlabelled punches from the day's checkin list", () => {
  const narrative = flagNarrative(
    UNKNOWN_BRANCH,
    recordIssueDay({ checkins: UNKNOWN_BRANCH_CHECKINS }),
    "2026-08-03",
  );

  const timeline = narrative.timeline;
  assert.ok(timeline);
  assert.deepEqual(timeline.window, { startMin: 450, endMin: 1050 });
  assert.deepEqual(timeline.spans, []);
  assert.deepEqual(
    timeline.marks.map((mark) => [mark.atMin, mark.tone]),
    [
      [480, "normal"],
      [723, "alert"],
      [755, "alert"],
      [1020, "normal"],
    ],
  );
});

test("unknown_device_branch says '1 punch' for a single unlabelled punch", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: {
        ...SHARED_CLOSEOUT_EVIDENCE,
        checkins_count: 2,
        reason: "unknown_device_branch",
        unknown_branch_checkins: 1,
      },
    }),
    recordIssueDay({ checkins: [punch("08:00"), punch("17:00", null)] }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "1 punch today came from a device that didn't report which site it's at.",
  );
  assert.deepEqual(narrative.facts, [{ label: "Unlabelled punches", value: "1 punch" }]);
});

const DELIVERY_FAILED = recordIssueFlag({
  evidence: {
    ...SHARED_CLOSEOUT_EVIDENCE,
    checkins_count: 0,
    reason: "delivery_failed",
    undelivered: { pin: "42", frappe_employee_id: "HR-EMP-00001" },
  },
});

test("delivery_failed promotes the device serial and badge, and draws no timeline", () => {
  const narrative = flagNarrative(DELIVERY_FAILED, recordIssueDay(), "2026-08-03");

  assert.equal(
    narrative.headline,
    "Device ZK-A4-014 recorded a punch that never reached HR's records.",
  );
  assert.deepEqual(narrative.facts, [
    { label: "Reported by", value: "ZK-A4-014" },
    { label: "Badge", value: "42" },
  ]);
  // There is no trustworthy timestamp for this punch — that IS the finding.
  assert.equal(narrative.timeline, null);
});

// The most important copy in the redesign: this is a data-integrity flag that
// currently wears the same clothes as a behaviour flag.
test("delivery_failed says a lost record is not the employee's fault", () => {
  const narrative = flagNarrative(DELIVERY_FAILED, recordIssueDay(), "2026-08-03");

  assert.equal(
    narrative.subline,
    "A lost record, not a missed check-in — nothing to hold against the employee.",
  );
});

test("delivery_failed degrades when the producer passed no device serial", () => {
  // The company-fallback producer never has a device_sn (it is a keyword arg that
  // defaults to None), so the headline must not read "Device null ...".
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: {
        ...SHARED_CLOSEOUT_EVIDENCE,
        device_sn: null,
        reason: "delivery_failed",
        undelivered: { pin: "42" },
      },
    }),
    recordIssueDay(),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "A punch was recorded on a device but never reached HR's records.",
  );
  assert.deepEqual(narrative.facts, [{ label: "Badge", value: "42" }]);
});

test("an ATTENDANCE_ISSUE with an unrecognised reason echoes it verbatim and draws nothing", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      evidence: { ...SHARED_CLOSEOUT_EVIDENCE, reason: "missing_lunch_pair" },
    }),
    recordIssueDay({ checkins: [punch("08:00"), punch("17:00")] }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    "This day's punch data could not be reconciled into complete in/out pairs.",
  );
  assert.deepEqual(narrative.facts, [{ label: "Recorded reason", value: "missing_lunch_pair" }]);
  assert.equal(narrative.timeline, null);
  assert.doesNotMatch(visibleCopy(narrative), /grace/i);
});

test("a no-detector code renders the generic treatment and never promotes shift_start", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      name: "AF-manual-1",
      flag_code: "MISSING_IN_OR_OUT",
      source: "HR",
      // A hand-created row whose evidence happens to use the name `shift_start`.
      // Running an unknown code's keys through the shared TIME_EVIDENCE_KEYS map
      // would silently format and promote it as a cause of the flag.
      evidence: { shift_start: "2026-08-03T08:00:00", reason: "spot_check" },
    }),
    recordIssueDay({ checkins: [punch("08:04")] }),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    '"Missing in or out" isn\'t a rule this engine currently checks automatically.',
  );
  assert.deepEqual(narrative.facts, [
    { label: "Raised by", value: "HR, by hand" },
    { label: "Recorded reason", value: "spot_check" },
  ]);
  assert.equal(narrative.timeline, null);

  const copy = visibleCopy(narrative);
  assert.doesNotMatch(copy, /Shift start/i);
  assert.doesNotMatch(copy, /8:00 AM/);
});

test("an entirely unrecognised flag code falls back to formatFlagLabel's own label", () => {
  const narrative = flagNarrative(
    recordIssueFlag({
      name: "AF-manual-2",
      flag_code: "SOME_MANUAL_CODE",
      source: undefined,
      evidence: {},
    }),
    recordIssueDay(),
    "2026-08-03",
  );

  assert.equal(
    narrative.headline,
    '"some manual code" isn\'t a rule this engine currently checks automatically.',
  );
  assert.deepEqual(narrative.facts, []);
  assert.equal(narrative.timeline, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)

Expected: FAIL. All **16** new tests fail against Task 1's per-code stubs. Every test leads
with a positive assertion (an exact `headline` string or a `deepEqual` on `facts`), so none
of them can pass vacuously against a stub that returns an empty narrative.

The first failure reads:

```
✖ single_checkin headline states the finding, not the fields
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  - 'Punched once at 2:23 PM, then never again that day.'
```

with `+ actual` showing whatever Task 1's `ATTENDANCE_ISSUE` stub returns. Read the summary
lines, not the exit code (Global Constraint 13): `# tests` must have risen by 16 and
`# fail` must be 16. **If any of the 16 passes, stop** — the stub is producing real copy and
you are about to write code that is never exercised.

- [ ] **Step 3: Add the imports and shared record-issue helpers**

Add to `src/lib/flagNarrative.ts`.

> **Before pasting:** Tasks 2–4 landed in this same file first. If any helper below already
> exists there with identical behaviour (`narrativeShiftBand`, `narrativeWindow`,
> `readEvidence`, `evString`, `evNumber`, `evidenceMinute`, `evidenceClock`, `punchHelpers`
> are the likely collisions), delete the duplicate from this block and call the existing one.
> Duplicate top-level `function` declarations are an early error in an ES module, so Step 8
> surfaces anything you miss. Likewise merge the import lines into the existing import block
> rather than adding a second `import` from the same module.

```ts
import {
  classifyUnpairedPresentations,
  computeDayTimeWindow,
  deriveSegments,
  hasPunchBranch,
  sortCheckinsByTime,
} from "@/lib/attendancePunches";
import {
  clamp,
  formatBranchLabel,
  formatCheckinTime,
  formatMinuteOnDay,
  minutesFromDateTime,
  parseDateTimeLocal,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";
import { formatFlagLabel, parseFlagEvidence } from "@/lib/flagLabels";
import type { Checkin, Flag } from "@/types/calendar";

/**
 * Evidence is a Record, not the narrow FlagEvidence type: the four record-issue
 * reasons write keys (`punch_time`, `unknown_branch_checkins`, `undelivered`)
 * that flagLabels.ts:27-33 never declared. parseFlagEvidence already try/catches
 * a malformed JSON string and returns null (flagLabels.ts:43-56), which is rule
 * 12's degradation — reuse it rather than re-implementing the guard.
 */
function readEvidence(flag: Flag): Record<string, unknown> {
  return (parseFlagEvidence(flag.evidence) ?? {}) as unknown as Record<string, unknown>;
}

function evString(ev: Record<string, unknown>, key: string): string | null {
  const value = ev[key];
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function evNumber(ev: Record<string, unknown>, key: string): number | null {
  const value = ev[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Evidence timestamps are python `.isoformat()`; parseDateTimeLocal handles the
 *  "T" separator (attendanceTime.ts:14-19). */
function evidenceMinute(ev: Record<string, unknown>, key: string): Minute | null {
  const raw = evString(ev, key);
  return raw == null ? null : minutesFromDateTime(raw);
}

/** Guarded because date-fns' format() throws RangeError on an invalid date, and
 *  formatCheckinTime calls straight into it (attendanceTime.ts:60-63). */
function evidenceClock(ev: Record<string, unknown>, key: string): string | null {
  const raw = evString(ev, key);
  if (raw == null) return null;
  if (!Number.isFinite(parseDateTimeLocal(raw).getTime())) return null;
  return formatCheckinTime(raw);
}

function narrativeShiftBand(day: NarrativeDay): { startMin: Minute; endMin: Minute } | null {
  const shift = day.shift;
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  const endMin = parseTimeToMinutes(shift.end_time ?? null);
  if (startMin == null || endMin == null || endMin <= startMin) return null;
  return { startMin, endMin };
}

/**
 * Axis bounds. Returns null when nothing positions an axis, and the caller then
 * draws no timeline at all — rule 6 forbids falling back to a blank 24-hour
 * axis. computeDayTimeWindow already applies its own 30-minute margin.
 */
function narrativeWindow(
  day: NarrativeDay,
  band: { startMin: Minute; endMin: Minute } | null,
  anchors: Minute[],
): { startMin: Minute; endMin: Minute } | null {
  const lows: Minute[] = [];
  const highs: Minute[] = [];

  if (band) {
    lows.push(band.startMin);
    highs.push(band.endMin);
  }

  const punchWindow = computeDayTimeWindow(day.checkins ?? [], minutesFromDateTime);
  if (punchWindow) {
    lows.push(punchWindow.startMin);
    highs.push(punchWindow.endMin);
  }

  for (const anchor of anchors) {
    lows.push(anchor - 30);
    highs.push(anchor + 30);
  }

  if (!lows.length) return null;

  const startMin = clamp(Math.min(...lows), 0, 24 * 60);
  const endMin = clamp(Math.max(...highs), 0, 24 * 60);
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

const punchHelpers = {
  parseTime: parseDateTimeLocal,
  minutesFromDateTime,
  clamp,
};

function workedSpans(checkins: Checkin[]): TimelineSpan[] {
  return deriveSegments(checkins, punchHelpers)
    .filter((segment) => segment.startMin != null && segment.endMin != null)
    .map((segment) => ({
      startMin: segment.startMin as Minute,
      endMin: segment.endMin as Minute,
      tone: "worked" as const,
    }));
}

/**
 * One mark per punch, toned by the caller. A non-null atMin already proves the
 * timestamp parsed (minutesFromDateTime returns null on an invalid Date), so
 * formatCheckinTime below cannot hit date-fns' RangeError.
 */
function punchMarks(
  checkins: Checkin[],
  toneFor: (checkin: Checkin) => "normal" | "alert",
): TimelineMark[] {
  const marks: TimelineMark[] = [];
  for (const checkin of sortCheckinsByTime(checkins, parseDateTimeLocal)) {
    const atMin = minutesFromDateTime(checkin.time);
    if (atMin == null) continue;
    marks.push({ atMin, tone: toneFor(checkin), label: formatCheckinTime(checkin.time) });
  }
  return marks;
}
```

- [ ] **Step 4: Implement `single_checkin` and `unpaired_punch`**

Add to `src/lib/flagNarrative.ts`, below the helpers from Step 3.

```ts
function singleCheckinNarrative(ev: Record<string, unknown>, day: NarrativeDay): FlagNarrative {
  const punchMin = evidenceMinute(ev, "punch_time");
  const punchClock = evidenceClock(ev, "punch_time");

  // ONE fact, deliberately. The engine writes exactly three keys for this reason
  // (record_issue_flags.py:24-34) and inherits twenty more; the punch time IS the
  // finding, and "First check-in 2:23 PM / Last check-out 2:23 PM / Punch time
  // 2:23 PM" is one timestamp under three labels, none of which says "and then
  // they never punched again".
  const facts: FlagFact[] = punchClock ? [{ label: "Only punch", value: punchClock }] : [];

  const band = narrativeShiftBand(day);
  const window = narrativeWindow(day, band, punchMin == null ? [] : [punchMin]);

  return {
    headline: punchClock
      ? `Punched once at ${punchClock}, then never again that day.`
      : "Punched once, then never again that day.",
    subline: "There is no matching clock-out, so no hours could be counted for this day.",
    facts,
    timeline:
      window == null || punchMin == null
        ? null
        : {
            window,
            band,
            // Rule 5's corollary: draw only the boundary the flag is about. The
            // lunch band and the late threshold belong to other flags.
            lunch: null,
            threshold: null,
            // A single punch pairs with nothing, so the band is empty by
            // construction — that emptiness is the picture.
            spans: [],
            marks: [{ atMin: punchMin, tone: "alert", label: punchClock ?? undefined }],
          },
  };
}

/**
 * The rogue tick, borrowed rather than reinvented. DayTimeline.tsx:190-193 draws
 * exactly the `rogue` + `unpairedError` presentations as error punches, so
 * routing the panel through the same classifier keeps the two surfaces from
 * disagreeing about which punch is the odd one. The evidence punch is added even
 * when the live day no longer classifies it as unpaired: rule 9 says the panel
 * reports the frozen finding and does not arbitrate against a re-derived calendar.
 */
function unpairedAlertMarks(
  day: NarrativeDay,
  dateKey: string,
  punchMin: Minute | null,
): TimelineMark[] {
  const band = narrativeShiftBand(day);
  const presentations = classifyUnpairedPresentations(day.checkins ?? [], {
    dateKey,
    shiftEndMin: band?.endMin ?? null,
    shiftAssigned: day.shift?.shift_assigned === true,
  });

  const mins = new Set<Minute>();
  for (const row of presentations) {
    if (row.kind === "rogue" || row.kind === "unpairedError") mins.add(row.startMin);
  }
  if (punchMin != null) mins.add(punchMin);

  return [...mins]
    .sort((a, b) => a - b)
    .map((atMin) => ({ atMin, tone: "alert" as const, label: formatMinuteOnDay(dateKey, atMin) }));
}

function unpairedPunchNarrative(
  ev: Record<string, unknown>,
  day: NarrativeDay,
  dateKey: string,
): FlagNarrative {
  const punchMin = evidenceMinute(ev, "punch_time");
  const punchClock = evidenceClock(ev, "punch_time");
  const branch = formatBranchLabel(evString(ev, "custom_device_branch"));

  const facts: FlagFact[] = [];
  if (punchClock) facts.push({ label: "Odd punch", value: punchClock });
  // A rogue punch has no device branch at all — record_issue_flags.py:47 copies
  // whatever the punch carried, which is None for a device that reports no site.
  // An empty "From —" row is exactly the padding this redesign removes.
  if (branch) facts.push({ label: "From", value: branch });

  const band = narrativeShiftBand(day);
  const window = narrativeWindow(day, band, punchMin == null ? [] : [punchMin]);
  const marks = unpairedAlertMarks(day, dateKey, punchMin);

  return {
    headline: punchClock
      ? `Punched at ${punchClock}, but it never got matched to a clock-out — the day's other punches paired up fine.`
      : "A punch never got matched to a clock-out — the day's other punches paired up fine.",
    subline: null,
    facts,
    timeline:
      window == null || !marks.length
        ? null
        : {
            window,
            band,
            lunch: null,
            threshold: null,
            // The healthy spans are the context that makes the lone tick read as
            // an anomaly rather than as the whole day.
            spans: workedSpans(day.checkins ?? []),
            marks,
          },
  };
}
```

- [ ] **Step 5: Implement `unknown_device_branch`, `delivery_failed` and the unrecognised-reason fallback**

Add to `src/lib/flagNarrative.ts`, below Step 4's builders.

```ts
function unknownDeviceBranchNarrative(
  ev: Record<string, unknown>,
  day: NarrativeDay,
): FlagNarrative {
  const count = evNumber(ev, "unknown_branch_checkins");

  const headline =
    count == null
      ? "Punches today came from a device that didn't report which site it's at."
      : count === 1
        ? "1 punch today came from a device that didn't report which site it's at."
        : `${count} punches today came from a device that didn't report which site it's at.`;

  const facts: FlagFact[] =
    count == null
      ? []
      : [{ label: "Unlabelled punches", value: count === 1 ? "1 punch" : `${count} punches` }];

  // Rule 5's second corollary: the evidence carries a COUNT and nothing else
  // (record_issue_flags.py:52-62), so WHICH punches were unlabelled can only come
  // from the day's checkin list. With no checkin list there is nothing to point
  // at, and a bare count on an axis would be a chart of one number.
  const checkins = day.checkins ?? [];
  const band = narrativeShiftBand(day);
  const window = checkins.length ? narrativeWindow(day, band, []) : null;
  const marks = punchMarks(checkins, (checkin) => (hasPunchBranch(checkin) ? "normal" : "alert"));

  return {
    headline,
    subline: "This is a device or config problem, not necessarily an employee problem.",
    facts,
    timeline:
      window == null || !marks.length
        ? null
        : {
            window,
            band,
            lunch: null,
            threshold: null,
            // The finding is about the punches themselves, not about worked time.
            spans: [],
            marks,
          },
  };
}

/**
 * Badge = the device-side user id. Mirrors the nested-then-top-level lookup in
 * attendance_flag.py:90-103 and flag_identity.py:115-127: Bridge sends the item
 * under `undelivered`, but the identity code still reads the same keys flat, so
 * rows written either way must both resolve here.
 */
function undeliveredBadge(ev: Record<string, unknown>): string | null {
  const sources: Record<string, unknown>[] = [];
  const nested = ev.undelivered;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    sources.push(nested as Record<string, unknown>);
  }
  sources.push(ev);

  for (const source of sources) {
    for (const key of ["pin", "user_id"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  return null;
}

function deliveryFailedNarrative(ev: Record<string, unknown>): FlagNarrative {
  const deviceSn = evString(ev, "device_sn");
  const badge = undeliveredBadge(ev);

  const facts: FlagFact[] = [];
  // Rule 1: device_sn is buried provenance on `single_checkin` and a first-class
  // fact here — same code, opposite treatment. Rule 8 bans naming a serial in
  // user-facing copy everywhere EXCEPT this row, because it is the only handle HR
  // has on which box lost the punch.
  if (deviceSn) facts.push({ label: "Reported by", value: deviceSn });
  if (badge) facts.push({ label: "Badge", value: badge });

  return {
    headline: deviceSn
      ? `Device ${deviceSn} recorded a punch that never reached HR's records.`
      : "A punch was recorded on a device but never reached HR's records.",
    subline: "A lost record, not a missed check-in — nothing to hold against the employee.",
    facts,
    // Rule 5: no trustworthy timestamp exists for this punch — that IS the
    // finding — so there is nothing to place on an axis. This is a data-integrity
    // flag that currently wears the same clothes as a behaviour flag.
    timeline: null,
  };
}

/** An ATTENDANCE_ISSUE whose reason this build does not recognise. The reason is
 *  echoed verbatim and unmapped: an unrecognised value has no trustworthy
 *  translation, and inventing one would assert a finding the engine never made. */
function unreconciledNarrative(ev: Record<string, unknown>): FlagNarrative {
  const reason = evString(ev, "reason");
  return {
    headline: "This day's punch data could not be reconciled into complete in/out pairs.",
    subline: reason ? null : "No reason was recorded on this flag.",
    facts: reason ? [{ label: "Recorded reason", value: reason }] : [],
    timeline: null,
  };
}

function attendanceIssueNarrative(
  ev: Record<string, unknown>,
  day: NarrativeDay,
  dateKey: string,
): FlagNarrative {
  // Rule 1: relevance is scoped to (flag_code, reason), not flag_code. All four
  // reasons come out of record_issue_flags.py:24-81 and are merged onto the same
  // shared per-employee-day evidence dict (closeout.py:692), which is why every
  // one of them arrives carrying shift_start and seven grace keys that had
  // nothing to do with the finding.
  switch (evString(ev, "reason")) {
    case "single_checkin":
      return singleCheckinNarrative(ev, day);
    case "unpaired_punch":
      return unpairedPunchNarrative(ev, day, dateKey);
    case "unknown_device_branch":
      return unknownDeviceBranchNarrative(ev, day);
    case "delivery_failed":
      return deliveryFailedNarrative(ev);
    default:
      return unreconciledNarrative(ev);
  }
}
```

- [ ] **Step 6: Implement the no-detector fallback**

Add to `src/lib/flagNarrative.ts`, below Step 5's builders.

```ts
const FLAG_SOURCE_LABELS: Record<string, string> = {
  AUTO: "The flag engine",
  EMPLOYEE: "The employee",
  HR: "HR, by hand",
};

/**
 * Rule 11. Covers the three declared-but-undetected codes in NO_DETECTOR_CODES
 * and any code this build has never heard of. flagSummary()/flagHrGuidance()
 * still assert confident findings for these (flagDetails.ts:52-56, :157-161);
 * this narrative is the panel's half of that correction.
 */
function noDetectorNarrative(flag: Flag, ev: Record<string, unknown>): FlagNarrative {
  // Evidence is deliberately NOT passed to formatFlagLabel. Its maps are keyed by
  // string name across every code, so a hand-created row is one lucky key name
  // away from being formatted and promoted as if a detector had produced it.
  const label = formatFlagLabel(flag.flag_code, null);

  const facts: FlagFact[] = [];

  // Read off the record, not out of evidence, so it survives the empty-evidence
  // case rule 12 covers.
  const source = (flag.source ?? "").trim();
  if (source) facts.push({ label: "Raised by", value: FLAG_SOURCE_LABELS[source] ?? source });

  // Verbatim and unmapped — the only other self-describing field here.
  const reason = evString(ev, "reason");
  if (reason) facts.push({ label: "Recorded reason", value: reason });

  return {
    headline: `"${label}" isn't a rule this engine currently checks automatically.`,
    subline: "No detector produces this code, so nothing here has been machine-verified.",
    facts,
    timeline: null,
  };
}
```

- [ ] **Step 7: Wire both into `flagNarrative()`'s dispatch**

Two edits in `src/lib/flagNarrative.ts`, both inside `flagNarrative()`.

**a. Add the `ATTENDANCE_ISSUE` arm** to the switch Task 2 introduced, above `default:`.

**b. Repoint the no-detector guard** at the richer `noDetectorNarrative(flag, ev)` this task
wrote in Step 6, which *replaces* Task 1's placeholder of the same name (Task 1's took a
`NarrativeInput`; delete that version — do not leave two functions with this name in the
module). The guard is the only call site.

Keep every other `case` exactly as Tasks 2–4 left it, and **leave `default:` alone**:

```ts
export function flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative {
  const evidence = readEvidence(flag);
  const input: NarrativeInput = {
    flag,
    evidence,
    reason: evidenceReason(evidence),
    day,
    dateKey,
  };

  // Checked before the switch: a detector-less code must never reach a per-code
  // branch that would assert a confident finding.
  if (!isEmittedCode(flag.flag_code)) return noDetectorNarrative(flag, evidence);

  switch (flag.flag_code) {
    // …LATE_START / LEFT_EARLY / LATE_FROM_LUNCH (Task 2), MISSING_TIME /
    // UNNOTIFIED_ABSENCE (Task 3), OFF_SHIFT_PUNCH / NON_PRIMARY_SITE_PUNCH
    // (Task 4) stay exactly as they are…
    case "ATTENDANCE_ISSUE":
      return attendanceIssueNarrative(evidence, day, dateKey);
    default:
      // UNCHANGED from Task 1, and it must stay `emittedFallbackNarrative`.
      // `default:` is reached by emitted codes with no arm of their own —
      // `DELIVERY_FAILED` is the live example, written by the delivery path.
      // Routing it to `noDetectorNarrative` would tell HR that a code the
      // engine really does emit "isn't a rule this engine currently checks
      // automatically" — false, and it fails Task 1's test asserting exactly
      // that no emitted code ever renders that sentence.
      return emittedFallbackNarrative(input);
  }
}
```

`readEvidence` therefore already exists at the top of `flagNarrative()` from Task 1 — reuse
that variable rather than adding a second parse, and drop `readEvidence` from Step 3 if you
added it there.

- [ ] **Step 8: Run the suite and confirm the new tests run and pass**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)

Expected: PASS. `# fail 0`, and the `# tests` total is 16 higher than the number Step 2
printed. Per Global Constraint 13, `test:web` is a non-recursive per-directory glob and
`src/lib/*.test.ts` is in it — a rising count is the only proof the new tests ran. A count
that did not move means the appended block landed in a file the glob does not reach.

- [ ] **Step 9: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/lib/flagNarrative.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagNarrative.test.ts
git commit -m "feat(hr-attendance): narrate ATTENDANCE_ISSUE's four reasons and the no-detector fallback" \
           -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The timeline component

**Files:**
- Create: `src/ui/FlagEvidenceTimeline.tsx`
- Test: `src/ui/flagEvidenceTimeline.test.tsx`

**Interfaces:**
- Consumes (binding contract, `src/lib/flagNarrative.ts`, built by Task 1):
  ```ts
  export type Minute = number;
  export type TimelineSpan = { startMin: Minute; endMin: Minute; tone: "worked" | "gap" };
  export type TimelineMark = { atMin: Minute; tone: "normal" | "alert"; label?: string };
  export type FlagTimelineSpec = {
    window: { startMin: Minute; endMin: Minute };
    band: { startMin: Minute; endMin: Minute } | null;
    lunch: { startMin: Minute; endMin: Minute } | null;
    threshold: Minute | null;
    spans: TimelineSpan[];
    marks: TimelineMark[];
  };
  ```
  Also consumes pre-existing pure helpers from `src/lib/timelineAxis.ts` — `hourTicks(startMin, endMin)`, `hourLabel(min)`, `pctOfWindow(min, window)` — reused rather than re-derived so the tick math and hour-label format match `TimelineAxis.tsx` exactly (rule: match the existing visual language, don't invent a second one).
- Produces (binding contract, consumed by Task 7's panel wiring):
  ```tsx
  export function FlagEvidenceTimeline(props: { spec: FlagTimelineSpec; ariaLabel: string }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// src/ui/flagEvidenceTimeline.test.tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FlagEvidenceTimeline } from "@/ui/FlagEvidenceTimeline";
import type { FlagTimelineSpec } from "@/lib/flagNarrative";

// This component is deliberately flag-blind — every fixture below is a bare
// FlagTimelineSpec, never a Flag or a Day, which is the whole point of the
// split (spine.md: "That separation is what lets tasks 2-5 be pure and
// testable without React").

test("a gap span renders the hatch texture; a worked span never does", () => {
  const base: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 }, // 8:00 AM - 10:00 AM
    band: null,
    lunch: null,
    threshold: null,
    spans: [{ startMin: 500, endMin: 520, tone: "gap" }],
    marks: [],
  };
  const gapHtml = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={base} ariaLabel="Gone from 8:20 AM to 8:40 AM" />
  );
  assert.match(gapHtml, /repeating-linear-gradient/, "a gap span must render the hatch");

  const workedHtml = renderToStaticMarkup(
    <FlagEvidenceTimeline
      spec={{ ...base, spans: [{ startMin: 500, endMin: 520, tone: "worked" }] }}
      ariaLabel="Worked from 8:20 AM to 8:40 AM"
    />
  );
  // The defect this whole redesign fixes is undifferentiated rows; a worked
  // span painted with the same hatch as a gap would recreate that ambiguity
  // on the one surface meant to resolve it — so assert absence too.
  assert.doesNotMatch(
    workedHtml,
    /repeating-linear-gradient/,
    "a worked span must not carry the hatch"
  );
});

test("the shift band renders only when the spec provides one", () => {
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: null,
    lunch: null,
    threshold: null,
    spans: [{ startMin: 480, endMin: 540, tone: "worked" }],
    marks: [],
  };
  const withoutBand = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Worked 8 to 9, no shift on record" />
  );
  assert.doesNotMatch(
    withoutBand,
    /border-2 border-dashed border-muted-foreground\/80/,
    "band is null, so no band chrome should render at all"
  );

  const withBand = renderToStaticMarkup(
    <FlagEvidenceTimeline
      spec={{ ...spec, band: { startMin: 480, endMin: 600 } }}
      ariaLabel="Worked 8 to 9 against an 8 to 10 shift"
    />
  );
  assert.match(
    withBand,
    /border-2 border-dashed border-muted-foreground\/80/,
    "matches DayTimeline.tsx:44-45's scheduledBandClass so the two surfaces read as one visual language"
  );
});

test("the lunch window renders only when the spec provides one", () => {
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: null,
    lunch: null,
    threshold: null,
    spans: [],
    marks: [],
  };
  const withoutLunch = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="No lunch relevant to this flag" />
  );
  assert.doesNotMatch(
    withoutLunch,
    /border-muted-foreground\/45/,
    "this flag is not about lunch, so no lunch band should render (rule 10: draw only the boundary the flag is about)"
  );

  const withLunch = renderToStaticMarkup(
    <FlagEvidenceTimeline
      spec={{ ...spec, lunch: { startMin: 540, endMin: 570 } }}
      ariaLabel="Scheduled lunch 9:00 AM to 9:30 AM"
    />
  );
  assert.match(
    withLunch,
    /border-muted-foreground\/45/,
    "matches DayTimeline.tsx:474's scheduled-lunch band treatment"
  );
});

test("marks sit at the exact percentage of the window their minute implies", () => {
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 }, // a clean 120-minute span
    band: null,
    lunch: null,
    threshold: null,
    spans: [],
    marks: [{ atMin: 540, tone: "alert" }], // 9:00 AM — the window's exact midpoint
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Punched once at 9:00 AM, then never again" />
  );
  assert.match(
    html,
    /left:50%/,
    "9:00 AM is the midpoint of an 8:00 AM-10:00 AM window, so the mark must sit at 50%"
  );
});

test("marks paint after spans and bands, so DOM order puts them on top", () => {
  // TimelineAxis.tsx's HourGrid carries the same convention this component
  // reuses: nothing here sets a z-index, so stacking is purely DOM order — a
  // mark inserted before its band would be painted underneath it, silently.
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: { startMin: 480, endMin: 600 },
    lunch: null,
    threshold: null,
    spans: [{ startMin: 480, endMin: 540, tone: "worked" }],
    marks: [{ atMin: 570, tone: "alert" }],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Band, a worked span, and a mark" />
  );
  const bandIdx = html.indexOf("border-2 border-dashed border-muted-foreground/80");
  const spanIdx = html.indexOf("bg-primary");
  const markIdx = html.lastIndexOf("bg-destructive");
  assert.ok(
    bandIdx !== -1 && spanIdx !== -1 && markIdx !== -1,
    "fixture must render all three, or this test proves nothing"
  );
  assert.ok(markIdx > bandIdx && markIdx > spanIdx, "the mark must be the last of the three in DOM order");
});

test("the container carries one label; the graphic itself is hidden from assistive tech", () => {
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: { startMin: 480, endMin: 600 },
    lunch: null,
    threshold: null,
    spans: [{ startMin: 480, endMin: 540, tone: "worked" }],
    marks: [{ atMin: 540, tone: "alert" }],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Clocked in at 9:00 AM, 12 minutes late" />
  );
  const rootTag = html.slice(0, html.indexOf(">") + 1);
  assert.match(rootTag, /role="img"/);
  assert.match(rootTag, /aria-label="Clocked in at 9:00 AM, 12 minutes late"/);
  // The headline already states the finding in words — the root carries the
  // one label that matters and must not also be hidden from the tree that
  // reads it.
  assert.doesNotMatch(rootTag, /aria-hidden/);
  // Everything drawn inside the root is decorative reinforcement of that
  // headline, so it must be hidden rather than announced div-by-div.
  assert.match(html, /aria-hidden="true"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)
Expected: FAIL before any assertion runs. `src/ui/FlagEvidenceTimeline.tsx` does not exist yet, so the import in `flagEvidenceTimeline.test.tsx` cannot resolve — `tsx --test` reports that file as failed with a module-resolution error, e.g. `Cannot find module '.../src/ui/FlagEvidenceTimeline' imported from .../src/ui/flagEvidenceTimeline.test.tsx` (Node's `ERR_MODULE_NOT_FOUND`, surfaced through the `@/*` → `src/*` alias `tsx` resolves from `tsconfig.json`). The other test files in the glob still run; this one contributes zero passing tests and a top-level failure.

- [ ] **Step 3: Implement `FlagEvidenceTimeline.tsx`**

```tsx
// src/ui/FlagEvidenceTimeline.tsx
import { hourLabel, hourTicks, pctOfWindow } from "@/lib/timelineAxis";
import { cn } from "@/lib/utils";
import type { FlagTimelineSpec } from "@/lib/flagNarrative";

/**
 * Draws a FlagTimelineSpec — the compact strip embedded directly in the flag
 * panel (design doc "Cross-cutting rule 8": embedded, not linked, because
 * requiring navigation to see the finding was the complaint this whole
 * design exists to fix).
 *
 * Deliberately flag-blind: every value drawn here (band, lunch, spans,
 * threshold, marks) already arrives pre-computed on the spec. That is what
 * lets `flagNarrative.test.ts` (tasks 2-5) cover the per-scenario logic with
 * plain objects and no React, and lets this file be tested the same way in
 * reverse — a spec in, HTML out, no Flag or Day fixture ever constructed.
 *
 * Visual language matches DayTimeline.tsx / TimelineAxis.tsx (same band and
 * gap treatments, same hour-tick math) rather than inventing a second style
 * — just laid out horizontally instead of vertically, and roughly 30px tall
 * so it reads as reinforcement of the headline, not a second calendar.
 */
export function FlagEvidenceTimeline(props: { spec: FlagTimelineSpec; ariaLabel: string }) {
  const { spec } = props;
  const ticks = hourTicks(spec.window.startMin, spec.window.endMin);
  const pct = (min: number) => pctOfWindow(min, spec.window);

  return (
    // One label for the whole graphic. The headline already states the
    // finding in words (see flagNarrative.ts) — a screen reader walking a
    // dozen positioned divs on top of that would be pure noise, so every
    // child below is aria-hidden and only this root carries a name.
    <div role="img" aria-label={props.ariaLabel} className="w-full">
      <div
        className="relative h-[30px] w-full overflow-hidden rounded-sm bg-muted/25"
        aria-hidden="true"
      >
        {/* Hour grid first — TimelineAxis.tsx's HourGrid comment states the
            rule this file also follows: nothing here sets a z-index, so
            stacking is DOM order, and this must be the first child or it
            paints over everything inserted after it. */}
        {ticks.map((m) => (
          <div
            key={`tick-${m}`}
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: `${pct(m)}%` }}
          />
        ))}

        {spec.band ? (
          // Same treatment as DayTimeline.tsx:44-45's scheduledBandClass.
          <div
            className="absolute inset-y-0.5 rounded-sm border-2 border-dashed border-muted-foreground/80 bg-muted/50"
            style={{
              left: `${pct(spec.band.startMin)}%`,
              width: `${Math.max(0, pct(spec.band.endMin) - pct(spec.band.startMin))}%`,
            }}
          />
        ) : null}

        {spec.lunch ? (
          // Same treatment as DayTimeline.tsx:474's isScheduledLunch band.
          <div
            className="absolute inset-y-1.5 rounded-sm border border-muted-foreground/45 bg-muted/35"
            style={{
              left: `${pct(spec.lunch.startMin)}%`,
              width: `${Math.max(0, pct(spec.lunch.endMin) - pct(spec.lunch.startMin))}%`,
            }}
          />
        ) : null}

        {spec.spans.map((s, idx) => {
          const left = pct(s.startMin);
          const width = pct(s.endMin) - left;
          if (width <= 0) return null;
          const worked = s.tone === "worked";
          return (
            <div
              key={`span-${idx}`}
              className={cn(
                "absolute inset-y-0 rounded-sm",
                worked
                  ? "bg-primary shadow-sm ring-1 ring-foreground/10"
                  : "border border-dashed border-destructive/75 bg-destructive/5"
              )}
              style={
                worked
                  ? { left: `${left}%`, width: `${width}%` }
                  : {
                      left: `${left}%`,
                      width: `${width}%`,
                      // The fill/border above matches DayTimeline.tsx:444's
                      // "missing expected" gap language — same family. The
                      // hatch layered on top is what marks THIS interval as
                      // the specific gap the flag is about, as opposed to
                      // an ordinary unaccounted-for span; without it a
                      // MISSING_TIME gap and a routine schedule gap would be
                      // visually identical again, just in a smaller box.
                      backgroundImage:
                        "repeating-linear-gradient(135deg, var(--destructive) 0 3px, transparent 3px 8px)",
                    }
              }
            />
          );
        })}

        {spec.threshold != null ? (
          <div
            className="absolute inset-y-0 w-px bg-destructive/70"
            style={{ left: `${pct(spec.threshold)}%` }}
          />
        ) : null}

        {spec.marks.map((mark, idx) => (
          // mark.label is never rendered here — the container's aria-label
          // already states the finding in words, so a visible caption on a
          // 30px strip would just repeat it while spending the only space
          // budget this compact treatment has. It exists on the type for
          // whatever eventually reads FlagTimelineSpec off-panel.
          <div
            key={`mark-${idx}`}
            className={cn(
              "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background shadow-sm",
              mark.tone === "alert" ? "bg-destructive" : "bg-primary"
            )}
            style={{ left: `${pct(mark.atMin)}%` }}
          />
        ))}
      </div>

      {ticks.length > 0 ? (
        // Same label row as TimelineAxis.tsx's HourGutter, laid out under
        // the strip instead of beside it — this timeline is horizontal.
        <div className="relative mt-0.5 h-3 w-full" aria-hidden="true">
          {ticks.map((m) => (
            <div
              key={`label-${m}`}
              className="absolute -translate-x-1/2 text-[10px] font-medium tabular-nums text-muted-foreground/70"
              style={{ left: `${pct(m)}%` }}
            >
              {hourLabel(m)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)
Expected: PASS. All 6 tests in `src/ui/flagEvidenceTimeline.test.tsx` succeed and the run's `# tests N` count rises by 6 over Step 2's run — the exit code alone is not evidence, per the global `test:web` glob rule; confirm the printed count moved.

- [ ] **Step 5: Commit**

```bash
git add src/ui/FlagEvidenceTimeline.tsx src/ui/flagEvidenceTimeline.test.tsx
git commit -m "$(cat <<'EOF'
feat(hr-attendance): flag-blind timeline component for the evidence panel

FlagEvidenceTimeline draws a FlagTimelineSpec — shift band, lunch window,
worked/gap spans, threshold line, marks — with no knowledge of flag codes
or reasons, so it stays testable with plain spec fixtures independent of
the per-scenario logic in flagNarrative.ts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire both panels

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagDecisionPanel.tsx:1-34` (imports + new module-scope adapter), `:133-241` (the `FlagCard` function)
- Modify: `dewey_time/frontend/hr_attendance/src/ui/DayInspectorSheet.tsx:1-38` (imports), `:43` (insert point), `:61-89` (component body), `:156-167` (the `FlagDetailPanel` call)
- Test: `dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.test.tsx` (extend existing)
- Test: `dewey_time/frontend/hr_attendance/src/ui/DayInspectorSheet.test.tsx` (create)
- Test: `dewey_time/frontend/hr_attendance/src/ui/FlagDecisionPanel.test.tsx` (create)
- Modify (generated, committed as-is): `dewey_time/public/hr_attendance/**`, `dewey_time/www/hr-attendance.html`, `dewey_time/www/hr-schedule.html`, `dewey_time/www/hr-flags.html`

**Interfaces:**
- Consumes:
  - `flagNarrative(flag: Flag, day: NarrativeDay, dateKey: string): FlagNarrative` — `src/lib/flagNarrative.ts` (Task 1; per-scenario logic from Tasks 2–5)
  - `type NarrativeDay = { checkins: Checkin[]; shift?: ShiftContext | null; holiday?: HolidayContext | null; observedLunch?: ObservedLunch | null }` — `src/lib/flagNarrative.ts` (Task 1)
  - `type FlagNarrative = { headline: string; subline: string | null; facts: FlagFact[]; timeline: FlagTimelineSpec | null }` — `src/lib/flagNarrative.ts` (Task 1)
  - `FlagEvidenceTimeline(props: { spec: FlagTimelineSpec; ariaLabel: string }): JSX.Element` — `src/ui/FlagEvidenceTimeline.tsx` (Task 6)
  - `formatFlagEvidenceDetails(evidence: unknown, dateKey?: string): { rows: EvidenceDetailRow[]; fallbackJson: string | null }` — `src/lib/flagDetails.ts` (pre-existing, unchanged by this plan; File Structure: "stays, now feeding only the disclosure")
- Produces (this is the plan's terminal task — nothing downstream in this plan consumes these, but they are the shipped contract):
  - `FlagDetailPanelProps` gains a required `day: NarrativeDay` field and loses `onViewTimeline?: () => void`.
  - `export function narrativeDayFrom(day: Day | undefined): NarrativeDay` — new named export on `src/ui/DayInspectorSheet.tsx`, the `Day → NarrativeDay` adapter.
  - The rebuilt `dewey_time/public/hr_attendance/**` bundle and `dewey_time/www/hr-*.html` — the actual deployed artifact (Global Constraint 14).

---

#### Where each panel's day data comes from (read before writing code)

**FlagDetailPanel** is only ever rendered by `DayInspectorSheet.tsx:156-167`, which already holds `props.inspectingDay: Day | undefined` — the same `Day` (`types/calendar.ts`) that backs the sheet's Segments/Punches/Flags tabs. `Day` already carries `checkins`, `shift`, `holiday` and `observed_lunch` — everything `NarrativeDay` needs, one field renamed (`observed_lunch` → `observedLunch`). So `FlagDetailPanel` gets a new **required** `day: NarrativeDay` prop, and `DayInspectorSheet` threads it from `props.inspectingDay` through a small adapter, `narrativeDayFrom`, computed once per inspected day via `useMemo` alongside the sheet's existing `segments`/`segmentInspectorItems` memos.

**FlagDecisionPanel**'s `FlagCard` is reached through `FlagQueuePage.tsx:314-326` → `useFlagQueue` → `getFlagQueue` → `flag_queue_api.get_flag_queue` (confirmed by reading `dewey_time/attendance_engine/flag_queue_api.py`: it returns `QueuePayload` — `entries`/`counts`/`orphans`/`alerts`/`truncated`/`start_date`/`end_date`, no checkins/shift/holiday/observed_lunch anywhere). The one thing `FlagQueuePage`'s own caller supplies is `HrAccessOutletContext` (`src/lib/hrAccess.ts`): `{ hrStaff: boolean; sessionLoading: boolean }` — nothing else. There is no caller anywhere in this surface's chain holding real day data to thread. Extending the queue API to return calendar context is a backend change and a new fetch path, well outside "wire both panels" (and outside the plan's stated architecture — "One new pure module... rendering change only"). So `FlagCard` calls `flagNarrative` with a module-scope constant, `EMPTY_NARRATIVE_DAY = { checkins: [] }`. The headline and facts (evidence-derived) render exactly as designed; any scenario whose timeline depends on `day.checkins`/`day.shift` degrades to whatever `flagNarrative`'s own null-when-not-earned rule decides for zero checkins — it does not crash, because `NarrativeDay.checkins` is always a real (empty) array, never `undefined`. This is documented in a `WHY` comment at both the constant and the `flagOutToFlag` adapter below, not silently absorbed.

`FlagOut` (`types/flags.ts`, what `get_flag_queue` returns) and `Flag` (`types/calendar.ts`, what `flagNarrative` takes) are two different read paths over the same `Attendance Flag` rows: `FlagOut` has `flag_identity` where `Flag` has `name`, and carries no `source` field at all. `FlagCard` adapts with a small `flagOutToFlag` function; on this surface, design rule 11's no-detector fallback (which reads `flag.source` to survive empty evidence) always sees `source: undefined` — a documented, harmless gap, not a defect this task owes a fix for.

#### The "View punches & timeline" button

Design rule 8 names this exact button (`FlagDetailPanel.tsx:126-128` pre-change) as "the complaint this design exists to fix": it navigated away to see the timeline instead of showing it. With `FlagEvidenceTimeline` now embedded directly in the panel for every scenario where a timeline earns its place (rule 5), the button's original job is done without a click. For the categorical scenarios where no timeline is drawn (`NON_PRIMARY_SITE_PUNCH`, `delivery_failed`, the no-detector fallback), the design's replacement content is the headline + facts, not a punch-by-punch dump — there is no rule asking this task to keep a side door to that view. Nothing becomes unreachable in the sense Global Constraint 3 means (evidence keys): the Segments/Punches/Flags tabs the button used to jump to are still one manual "Back to flags" + tab click away inside `DayInspectorSheet`, just no longer auto-selected. This task removes `onViewTimeline` from `FlagDetailPanelProps` and its call site in `DayInspectorSheet`.

---

- [ ] **Step 1: Write the failing tests**

Extend the existing `FlagDetailPanel.test.tsx` (add the required `day` prop to the two existing tests so they keep passing once `flagNarrative` is wired in, then add two new tests):

```tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { flagNarrative, type NarrativeDay } from "@/lib/flagNarrative";
import type { Flag } from "@/types/calendar";
import { FlagDetailPanel } from "@/ui/FlagDetailPanel";

const FLAG: Flag = {
  name: "FLAG-0001",
  flag_code: "LATE_START",
  status: "OPEN",
  severity: "WARNING",
  day_closed: 1,
  is_provisional: false,
  evidence: {},
};

// The day prop is required (FlagDetailPanelProps), but these two tests only
// exercise the Desk-link behaviour, not the narrative — an empty day is
// enough to keep flagNarrative() from throwing on `day.checkins`.
const EMPTY_DAY: NarrativeDay = { checkins: [] };

// /hr-flags is now where HR decides; Desk is a fallback record view, not the
// primary action. "Review in Desk" — a primary Button, the panel's only call to
// action — used to be what sent HR back to Desk out of habit. It must now read
// as a secondary link labelled "Open record".
test("FlagDetailPanel demotes the Desk link to a secondary 'Open record' action", () => {
  const html = renderToStaticMarkup(
    <FlagDetailPanel
      flag={FLAG}
      date="2026-08-04"
      employeeLabel="Jane Doe"
      employeeId="EMP-0001"
      day={EMPTY_DAY}
    />
  );
  assert.doesNotMatch(html, /Review in Desk/, "old primary-button label should be gone");
  assert.match(html, /Open record/, "expected the new secondary label");

  const linkStart = html.indexOf("Open record");
  const tagStart = html.lastIndexOf("<a", linkStart);
  const tagEnd = html.indexOf(">", tagStart);
  const anchorHtml = html.slice(tagStart, tagEnd);
  // dewey-ui's Button stamps data-variant on the rendered element even when
  // `asChild` hands it off to a plain <a> (dewey-ui button.tsx:62-67) — "link" is
  // its lowest-emphasis style; "default" (the prior implicit value) is the
  // filled, primary one.
  assert.match(
    anchorHtml,
    /data-variant="link"/,
    "expected the low-emphasis link variant, not a primary button"
  );
});

test("showDeskReview=false still hides the record link entirely (prop contract preserved)", () => {
  const html = renderToStaticMarkup(
    <FlagDetailPanel
      flag={FLAG}
      date="2026-08-04"
      employeeLabel="Jane Doe"
      employeeId="EMP-0001"
      showDeskReview={false}
      day={EMPTY_DAY}
    />
  );
  assert.doesNotMatch(html, /Open record/);
  assert.doesNotMatch(html, /Review in Desk/);
});

// The screenshot in docs/superpowers/specs/2026-08-06-flag-evidence-panel-design.md
// is this exact evidence shape: seven grace values and three duplicate
// timestamps dumped as first-class rows, with the actual finding (reason)
// buried at row thirteen. This proves the panel now calls flagNarrative()
// and renders its headline as the primary content instead of handing
// formatFlagEvidenceDetails's rows straight to the reader.
const SINGLE_CHECKIN_FLAG: Flag = {
  name: "FLAG-0002",
  flag_code: "ATTENDANCE_ISSUE",
  status: "OPEN",
  severity: "WARNING",
  day_closed: 0,
  is_provisional: true,
  evidence: {
    reason: "single_checkin",
    checkins_count: 1,
    punch_time: "2026-08-04 14:23:00",
    first_in: "2026-08-04 14:23:00",
    last_out: "2026-08-04 14:23:00",
    shift_start: "2026-08-04 08:00:00",
    late_threshold: "2026-08-04 08:10:00",
    grace_minutes: 10,
    effective_start_grace_minutes: 10,
    effective_end_grace_minutes: 10,
    effective_lunch_return_grace_minutes: 10,
    custom_grace_minutes: 10,
    late_entry_grace_period: 10,
    early_exit_grace_period: 10,
  },
};

const SINGLE_CHECKIN_DAY: NarrativeDay = {
  checkins: [{ time: "2026-08-04 14:23:00", log_type: null, device_id: "DEV-1" }],
  shift: {
    shift_assigned: true,
    shift_type: "General",
    start_time: "08:00:00",
    end_time: "17:00:00",
    grace_minutes: 10,
  },
  holiday: null,
  observedLunch: null,
};

test("FlagDetailPanel renders the flagNarrative headline as primary content, confining raw evidence to the disclosure", () => {
  const expected = flagNarrative(SINGLE_CHECKIN_FLAG, SINGLE_CHECKIN_DAY, "2026-08-04");

  const html = renderToStaticMarkup(
    <FlagDetailPanel
      flag={SINGLE_CHECKIN_FLAG}
      date="2026-08-04"
      employeeLabel="Jane Doe"
      employeeId="EMP-0002"
      day={SINGLE_CHECKIN_DAY}
    />
  );

  assert.ok(html.includes(expected.headline), "expected the computed headline to render");

  const detailsStart = html.indexOf("<details");
  assert.notEqual(detailsStart, -1, "expected a collapsed disclosure for the full evidence blob");
  const primaryRegion = html.slice(0, detailsStart);
  const disclosureRegion = html.slice(detailsStart);

  // The defect this task fixes: for single_checkin, none of the seven grace
  // values or the shift-boundary timestamps are relevant to "one punch, then
  // nothing" — the design's Testing section: "a single_checkin render must
  // contain no grace string at all".
  assert.doesNotMatch(primaryRegion, /grace/i, "no grace string should reach the primary region");
  assert.doesNotMatch(primaryRegion, /Shift start/, "categorical evidence labels stay in the disclosure");
  assert.doesNotMatch(primaryRegion, /Late threshold/, "categorical evidence labels stay in the disclosure");

  // Only the narrative's own curated facts (design caps this at four) reach
  // the primary region — pin this by counting <dt> rows, since the raw
  // evidence fixture above has 13 keys and the facts list must not be that.
  const primaryFactCount = (primaryRegion.match(/<dt/g) ?? []).length;
  assert.equal(primaryFactCount, expected.facts.length);
  assert.ok(primaryFactCount <= 4, "design caps the fact list at four rows");

  // Global Constraint 3: nothing removed from the fact list becomes
  // unreachable — the same rows formatFlagEvidenceDetails always produced
  // are still present, just moved behind the disclosure summary.
  assert.match(disclosureRegion, /Full evidence/);
  assert.match(disclosureRegion, /Effective grace/);
  assert.match(disclosureRegion, /Shift start/);
  assert.match(disclosureRegion, /Late threshold/);

  // The embedded timeline (design rule 8) replaces the old click-through —
  // its aria-label is wired to the computed headline, which also proves
  // FlagEvidenceTimeline actually received the narrative's spec.
  if (expected.timeline) {
    assert.ok(
      primaryRegion.includes(`${expected.headline} timeline`),
      "expected the embedded timeline's aria-label in the primary region"
    );
  }
});

// Resolve from this file, never the CWD — src/components/ui/notice.test.tsx's
// existing pattern for a source-level assertion. A render-based check would
// be a false negative here: this test's own fixtures never pass
// onViewTimeline, so the pre-change button already renders nothing for them.
const SRC = fileURLToPath(new URL("../", import.meta.url));

test("FlagDetailPanel drops the onViewTimeline escape hatch now the timeline is embedded (design rule 8)", () => {
  const source = readFileSync(SRC + "ui/FlagDetailPanel.tsx", "utf8");
  assert.doesNotMatch(
    source,
    /onViewTimeline/,
    "the click-through to see the timeline should be gone now flagNarrative()'s timeline is embedded"
  );
});
```

Create `DayInspectorSheet.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";

import { narrativeDayFrom } from "@/ui/DayInspectorSheet";
import type { Day } from "@/types/calendar";

const FULL_DAY: Day = {
  date: "2026-08-04",
  shift: {
    shift_assigned: true,
    shift_type: "General",
    start_time: "08:00:00",
    end_time: "17:00:00",
    grace_minutes: 10,
  },
  holiday: { description: "Founders' Day", weekly_off: false },
  checkins: [{ time: "2026-08-04 08:07:00", log_type: "IN", device_id: "DEV-1" }],
  observed_lunch: {
    lunch_out: "2026-08-04 12:00:00",
    lunch_in: "2026-08-04 13:05:00",
    minutes: 65,
    lunch_start: "12:00:00",
    lunch_end: "13:00:00",
    return_threshold: "13:00:00",
    late_return: true,
  },
};

// The one field flagNarrative()'s NarrativeDay and hr_calendar.py's Day
// disagree on by name: observed_lunch (Day) vs observedLunch (NarrativeDay).
// Everything else threads straight through.
test("narrativeDayFrom maps a loaded Day into a NarrativeDay, including the snake_case->camelCase lunch field", () => {
  const result = narrativeDayFrom(FULL_DAY);
  assert.deepEqual(result, {
    checkins: FULL_DAY.checkins,
    shift: FULL_DAY.shift,
    holiday: FULL_DAY.holiday,
    observedLunch: FULL_DAY.observed_lunch,
  });
});

// inspectingDay is undefined for the gap between a date being picked and its
// week's calendar payload landing — flagNarrative() still needs *a*
// NarrativeDay in that gap, not a crash.
test("narrativeDayFrom returns a safe empty NarrativeDay when no calendar day has loaded yet", () => {
  const result = narrativeDayFrom(undefined);
  assert.deepEqual(result, { checkins: [], shift: null, holiday: null, observedLunch: null });
});
```

Create `FlagDecisionPanel.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { PendingDecision } from "@/lib/flagDecisionState";
import { flagNarrative, type NarrativeDay } from "@/lib/flagNarrative";
import type { Flag } from "@/types/calendar";
import type { FlagOut, QueueEntry } from "@/types/flags";
import { FlagDecisionPanel, type FlagDecisionPanelProps } from "@/ui/FlagDecisionPanel";

// Mirrors the design doc's opening screenshot evidence shape: seven grace
// values, three duplicate timestamps, and the actual finding (reason) at the
// end. record_issue_flags.py:24-34 writes reason/checkins_count/punch_time
// for single_checkin; closeout.py:606-611 merges the shared shift/grace keys
// into every flag for the employee-day (see the design doc's "Why the
// irrelevant keys are there").
const SINGLE_CHECKIN_EVIDENCE = {
  reason: "single_checkin",
  checkins_count: 1,
  punch_time: "2026-08-04 14:23:00",
  first_in: "2026-08-04 14:23:00",
  last_out: "2026-08-04 14:23:00",
  shift_start: "2026-08-04 08:00:00",
  late_threshold: "2026-08-04 08:10:00",
  grace_minutes: 10,
  effective_start_grace_minutes: 10,
  effective_end_grace_minutes: 10,
  effective_lunch_return_grace_minutes: 10,
  custom_grace_minutes: 10,
  late_entry_grace_period: 10,
  early_exit_grace_period: 10,
};

const FLAG_OUT: FlagOut = {
  flag_identity: "FLAG-0002::2026-08-04",
  flag_code: "ATTENDANCE_ISSUE",
  severity: "WARNING",
  day_closed: 0,
  evidence: SINGLE_CHECKIN_EVIDENCE,
  rank: 140,
  tier: "act",
  decision_state: "undecided",
  decision: null,
};

const ENTRY: QueueEntry = {
  kind: "person",
  employee: "EMP-0002",
  employee_name: "Jane Doe",
  employee_branch: null,
  attendance_date: "2026-08-04",
  rank: 140,
  tier: "act",
  flags: [FLAG_OUT],
  undecided_count: 1,
};

// Mirrors the flagOutToFlag() adapter FlagDecisionPanel.tsx builds internally
// (flag_identity -> name; FlagOut carries no `source` at all). And
// EMPTY_NARRATIVE_DAY: get_flag_queue (attendance_engine/flag_queue_api.py)
// never returns checkins/shift/holiday/observed_lunch, and
// HrAccessOutletContext (lib/hrAccess.ts) — the only thing FlagQueuePage's
// caller supplies — carries just hrStaff/sessionLoading. There is nowhere in
// this surface's chain to thread real day data from, so this is the exact
// NarrativeDay the card computes against.
const FLAG_AS_CALENDAR_SHAPE: Flag = {
  name: FLAG_OUT.flag_identity,
  flag_code: FLAG_OUT.flag_code,
  severity: FLAG_OUT.severity as Flag["severity"],
  day_closed: FLAG_OUT.day_closed as 0 | 1,
  evidence: FLAG_OUT.evidence,
};
const EMPTY_DAY: NarrativeDay = { checkins: [] };

function baseProps(): FlagDecisionPanelProps {
  const draft: PendingDecision = { outcome: "EXCUSED", reason: "APPROVED_LEAVE", note: "" };
  return {
    entry: ENTRY,
    draft,
    onDraftChange: () => {},
    activeIdentity: null,
    onOpenFlag: () => {},
    lastDecision: null,
    onSubmit: () => {},
    excluded: new Set<string>(),
    onToggleMember: () => {},
    onDecideOneByOne: () => {},
  };
}

test("FlagDecisionPanel's flag card renders the flagNarrative headline as primary content, not the raw evidence dump", () => {
  const expected = flagNarrative(FLAG_AS_CALENDAR_SHAPE, EMPTY_DAY, "2026-08-04");

  const html = renderToStaticMarkup(<FlagDecisionPanel {...baseProps()} />);

  assert.ok(html.includes(expected.headline), "expected the computed headline to render on the card");

  const detailsStart = html.indexOf("<details");
  assert.notEqual(detailsStart, -1, "expected a collapsed disclosure for the full evidence blob");
  const primaryRegion = html.slice(0, detailsStart);
  const disclosureRegion = html.slice(detailsStart);

  // Same absence rule as FlagDetailPanel.test.tsx — the design's Testing
  // section: "a single_checkin render must contain no grace string at all".
  assert.doesNotMatch(primaryRegion, /grace/i, "no grace string should reach the primary region");
  assert.doesNotMatch(primaryRegion, /Shift start/, "categorical evidence labels stay in the disclosure");

  assert.match(disclosureRegion, /Full evidence/);
  assert.match(disclosureRegion, /Effective grace/);
});

test("FlagDecisionPanel's flag card shows only the narrative's curated facts before the disclosure, not the full evidence dump", () => {
  const expected = flagNarrative(FLAG_AS_CALENDAR_SHAPE, EMPTY_DAY, "2026-08-04");
  const html = renderToStaticMarkup(<FlagDecisionPanel {...baseProps()} />);
  const detailsStart = html.indexOf("<details");
  const primaryRegion = html.slice(0, detailsStart);
  const primaryFactCount = (primaryRegion.match(/<dt/g) ?? []).length;

  assert.equal(
    primaryFactCount,
    expected.facts.length,
    `expected exactly the narrative's ${expected.facts.length} fact(s) before the disclosure`
  );
  // The fixture's raw evidence has 13 keys (seven grace values, three
  // duplicate timestamps, reason, checkins_count) — pin that the primary
  // region is materially smaller than that, the whole point of the redesign.
  assert.ok(primaryFactCount < 13, "primary region must not be the raw evidence dump");
});

// formatFlagEvidenceDetails().fallbackJson existed before this task, but this
// card only ever read `.rows` (FlagDecisionPanel.tsx:146 pre-change) — a flag
// with a leftover, unmapped evidence key had no way to reach HR here. This
// evidence has one (`diagnostic_note`, not in any of flagDetails.ts's key
// maps), proving it now surfaces inside the disclosure and nowhere else.
test("FlagDecisionPanel's flag card surfaces leftover evidence keys inside the disclosure", () => {
  const flagWithLeftover: FlagOut = {
    ...FLAG_OUT,
    evidence: { ...SINGLE_CHECKIN_EVIDENCE, diagnostic_note: "bridge retry #3" },
  };
  const entry: QueueEntry = { ...ENTRY, flags: [flagWithLeftover] };

  const html = renderToStaticMarkup(<FlagDecisionPanel {...baseProps()} entry={entry} />);
  const detailsStart = html.indexOf("<details");
  assert.notEqual(detailsStart, -1, "expected a collapsed disclosure for the full evidence blob");
  const primaryRegion = html.slice(0, detailsStart);
  const disclosureRegion = html.slice(detailsStart);

  assert.doesNotMatch(primaryRegion, /bridge retry/, "leftover evidence must not reach the primary region");
  assert.match(disclosureRegion, /bridge retry #3/, "leftover evidence must still be reachable in the disclosure");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)

Expected: FAIL, for three distinct reasons — note the total `# tests N` line this run prints once it finishes (or the last count before `DayInspectorSheet.test.tsx` aborts the file); that is this task's baseline, established by Tasks 1–6.

- `FlagDetailPanel.test.tsx`'s new headline test fails with `AssertionError [ERR_ASSERTION]: expected the computed headline to render` — the old component never calls `flagNarrative`, so `expected.headline` (a full sentence) never appears; it also fails a step earlier in practice on `assert.notEqual(detailsStart, -1, ...)`, since the old component only wraps `fallbackJson` in `<details>` and this fixture's evidence has no leftover keys, so no `<details>` renders at all pre-change. The `onViewTimeline` source test fails with `AssertionError [ERR_ASSERTION]: the click-through to see the timeline should be gone now flagNarrative()'s timeline is embedded` — the string `onViewTimeline` is still in the file (props type, JSDoc, and the button). The two pre-existing Desk-link tests still pass unchanged.
- `DayInspectorSheet.test.tsx` fails to load at all: `SyntaxError: The requested module '../ui/DayInspectorSheet.tsx' does not provide an export named 'narrativeDayFrom'` — the export doesn't exist yet.
- `FlagDecisionPanel.test.tsx`'s three new tests fail the same way as `FlagDetailPanel.test.tsx`'s: `assert.notEqual(detailsStart, -1, ...)` fails first, because the current `FlagCard` renders `evidence.rows` in a bare `dl` with no `<details>` at all, and never reads `.fallbackJson`.

- [ ] **Step 3: Implement `FlagDetailPanel.tsx`**

Replace the whole file:

```tsx
import { ExternalLinkIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  flagDeskUrl,
  flagDialogTitle,
  flagFinalizationLabel,
  flagHrGuidance,
  flagIsProvisional,
  flagSummary,
  formatFlagContextDate,
  formatFlagEvidenceDetails,
  formatFlagStatusLabel,
  formatSeverityLabel,
} from "@/lib/flagDetails";
import { flagNarrative, type NarrativeDay } from "@/lib/flagNarrative";
import { cn } from "@/lib/utils";
import type { Flag } from "@/types/calendar";
import { FlagEvidenceTimeline } from "@/ui/FlagEvidenceTimeline";

export type FlagDetailPanelProps = {
  flag: Flag;
  date: string;
  employeeLabel: string | null;
  employeeId: string | null;
  /**
   * The day's checkins/shift/holiday/lunch context, for flagNarrative()'s
   * timeline (design rule 11: fed from the day's real checkin list, never
   * the evidence blob). DayInspectorSheet.tsx builds this from the same
   * `Day` it already has in scope, via narrativeDayFrom(). Required, not
   * optional — a caller that forgets it gets a compile error, not a
   * silently timeline-less card.
   */
  day: NarrativeDay;
  showDeskReview?: boolean;
};

export function FlagDetailPanel(props: FlagDetailPanelProps) {
  const { flag, date } = props;
  const evidence = formatFlagEvidenceDetails(flag.evidence, date);
  const narrative = flagNarrative(flag, props.day, date);
  const finalization = flagFinalizationLabel(flag);
  const provisional = flagIsProvisional(flag);
  const guidance = flagHrGuidance(flag);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <div className="text-base font-semibold tracking-tight">{flagDialogTitle(flag)}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {props.employeeLabel ?? "Employee"}
            {props.employeeId && props.employeeLabel !== props.employeeId ? (
              <span className="text-muted-foreground/80"> · {props.employeeId}</span>
            ) : null}
          </div>
          <div className="text-sm text-muted-foreground">{formatFlagContextDate(date)}</div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="rounded-md text-[11px]">
            {formatFlagStatusLabel(flag.status)}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "rounded-md text-[11px]",
              flag.severity === "CRITICAL" &&
                "border-destructive/40 bg-destructive/10 text-destructive",
              flag.severity === "WARNING" &&
                "border-brand-accent/40 bg-brand-accent/10 text-brand-accent",
              flag.severity === "INFO" && "border-border bg-muted/40 text-foreground"
            )}
          >
            {formatSeverityLabel(flag.severity)}
          </Badge>
          {finalization ? (
            <Badge
              variant="outline"
              className="rounded-md text-[11px] border-dashed border-border bg-muted/30 text-muted-foreground"
            >
              {finalization}
            </Badge>
          ) : null}
        </div>
      </div>

      <section className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3">
        <div className="text-xs font-medium text-muted-foreground">Summary</div>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{flagSummary(flag.flag_code)}</p>
      </section>

      {/* The verdict, not the fields (Headline voice rule 1): flagNarrative()
          replaces the unfiltered dump of every evidence key as the first
          thing HR reads. The same dump still renders below, collapsed —
          Global Constraint 3, nothing becomes unreachable, it just stops
          being first. See
          docs/superpowers/specs/2026-08-06-flag-evidence-panel-design.md. */}
      <section className="space-y-3">
        <div>
          <div className="text-base font-semibold tracking-tight text-foreground">
            {narrative.headline}
          </div>
          {narrative.subline ? (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {narrative.subline}
            </p>
          ) : null}
        </div>

        {narrative.timeline ? (
          <FlagEvidenceTimeline
            spec={narrative.timeline}
            ariaLabel={`${narrative.headline} timeline`}
          />
        ) : null}

        {narrative.facts.length > 0 ? (
          <dl className="space-y-2 rounded-xl border border-border/60 bg-card px-3 py-2.5">
            {narrative.facts.map((fact) => (
              <div key={fact.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 text-xs">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="font-medium text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {evidence.rows.length > 0 || evidence.fallbackJson ? (
          <details className="rounded-xl border border-border/60 bg-muted/10 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Full evidence
            </summary>
            <div className="mt-2 space-y-3">
              {evidence.rows.length > 0 ? (
                <dl className="space-y-2 rounded-lg border border-border/60 bg-card px-3 py-2.5">
                  {evidence.rows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 text-xs">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-medium text-foreground">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {evidence.fallbackJson ? (
                <pre className="max-h-40 overflow-auto text-[11px] leading-relaxed text-muted-foreground">
                  {evidence.fallbackJson}
                </pre>
              ) : null}
            </div>
          </details>
        ) : null}
      </section>

      <section className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-3">
        <div className="text-xs font-medium text-primary/80">Recommended for HR</div>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">{guidance}</p>
      </section>

      <Separator />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {props.showDeskReview !== false ? (
          <Button variant="link" size="sm" className="gap-1.5 px-0" asChild>
            <a href={flagDeskUrl(flag.name)} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              Open record
            </a>
          </Button>
        ) : null}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Record ID: <span className="font-mono">{flag.name}</span>
        {" · "}
        Code: <span className="font-mono">{flag.flag_code}</span>
      </p>
    </div>
  );
}
```

(`provisional` is computed but was already unread by the pre-change render — left as-is; not introduced by this task and not worth a behavior change here.)

- [ ] **Step 4: Implement `DayInspectorSheet.tsx`**

Three edits to the same file.

Replace the import line for `flagDetails` (around line 34) with these three lines — inserting the new type import between it and the existing `cn` import:

```ts
import { flagDialogTitle, formatFlagContextDate, formatFlagStatusLabel, flagIsProvisional } from "@/lib/flagDetails";
import type { NarrativeDay } from "@/lib/flagNarrative";
import { cn } from "@/lib/utils";
```

Insert this new exported function immediately after `const SEVERITY_ORDER: Severity[] = ["CRITICAL", "WARNING", "INFO"];` and before `export type DayInspectorSheetProps`:

```ts
/**
 * Day (types/calendar.ts, from hr_calendar.py's get_my_week) already carries
 * everything flagNarrative() needs — checkins, shift, holiday, and the
 * punch-derived lunch pair — just under a different field name for the one
 * that doesn't match: observed_lunch here, observedLunch on NarrativeDay.
 * `day` is undefined for the gap between a date being picked and its week's
 * calendar payload landing, so this always returns a valid NarrativeDay
 * rather than making FlagDetailPanel handle that gap itself.
 */
export function narrativeDayFrom(day: Day | undefined): NarrativeDay {
  return {
    checkins: day?.checkins ?? [],
    shift: day?.shift ?? null,
    holiday: day?.holiday ?? null,
    observedLunch: day?.observed_lunch ?? null,
  };
}
```

Inside `DayInspectorSheet`, insert a new `useMemo` between the closing `);` of the existing `segmentInspectorItems` memo and `const punches = sortCheckinsByTime(...)`:

```ts
  );

  // flagNarrative()'s day-context argument — built once per inspected day,
  // not per flag, since HR can open several flags on the same day without
  // the checkins/shift/holiday/lunch underneath it changing.
  const narrativeDay = useMemo(
    () => narrativeDayFrom(props.inspectingDay),
    [props.inspectingDay]
  );

  const punches = sortCheckinsByTime(props.inspectingDay?.checkins ?? []);
```

Replace the `<FlagDetailPanel ... />` call (currently lines 157–167):

```tsx
          {props.reviewingFlag && props.inspectingDate ? (
            <FlagDetailPanel
              flag={props.reviewingFlag}
              date={props.inspectingDate}
              employeeLabel={props.employeeLabel}
              employeeId={props.employeeId}
              showDeskReview={props.showDeskReview !== false}
              day={narrativeDay}
            />
          ) : (
```

- [ ] **Step 5: Run the tests to verify `FlagDetailPanel` and `DayInspectorSheet` are green**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)
Expected: every test in `FlagDetailPanel.test.tsx` and `DayInspectorSheet.test.tsx` passes. `FlagDecisionPanel.test.tsx`'s three new tests still FAIL exactly as in Step 2 — `FlagCard` hasn't changed yet.

- [ ] **Step 6: Implement `FlagDecisionPanel.tsx`**

Replace the import block (lines 1–34) and insert the new module-scope constant and adapter directly after it, before `type GroupEntry`:

```tsx
import { EmptyState } from "@lolbikb/dewey-ui";
import { FlagIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  decisionIsComplete,
  flagIdentities,
  groupPayload,
  remainingIdentities,
  type PendingDecision,
} from "@/lib/flagDecisionState";
import { flagSummary, formatFlagContextDate, formatFlagEvidenceDetails } from "@/lib/flagDetails";
import { flagNarrative, type NarrativeDay } from "@/lib/flagNarrative";
import { formatFlagLabel, parseFlagEvidence } from "@/lib/flagLabels";
import {
  DECIDE_AGAIN_LABEL,
  DECIDE_ONE_BY_ONE_LABEL,
  OUTCOME_OPTIONS,
  REASON_OPTIONS,
  SAME_REASON_LABEL,
  appliedDecisionLabel,
  applyToRemainingLabel,
  decisionStateLabel,
  groupHeadline,
  outcomeActionLabel,
  outcomeLabel,
  personHeadline,
  priorDecisionLabel,
  reasonLabel,
} from "@/lib/flagQueueLabels";
import { cn } from "@/lib/utils";
import type { Flag } from "@/types/calendar";
import type { FlagOut, QueueEntry, QueuePerson, Reason } from "@/types/flags";
import { FlagEvidenceTimeline } from "@/ui/FlagEvidenceTimeline";

type GroupEntry = Extract<QueueEntry, { kind: "group" }>;

/**
 * flag_queue_api.get_flag_queue (attendance_engine/flag_queue_api.py) never
 * returns checkins, shift, holiday or observed_lunch — it is a flat queue
 * payload, not a calendar day — and FlagQueuePage's only caller-supplied
 * context, HrAccessOutletContext (lib/hrAccess.ts), carries just
 * hrStaff/sessionLoading. Unlike FlagDetailPanel's DayInspectorSheet, there
 * is no caller anywhere in this surface's chain to thread real day data
 * from. flagNarrative() still needs *a* NarrativeDay — this is the honest
 * empty one, so timelines on this card degrade to whatever flagNarrative()
 * decides for zero checkins rather than crashing.
 */
const EMPTY_NARRATIVE_DAY: NarrativeDay = { checkins: [] };

/**
 * flagNarrative()'s signature takes Flag (types/calendar.ts, the shape
 * hr_calendar.py's get_my_week returns), not FlagOut (types/flags.ts, what
 * this queue payload returns): flag_identity where Flag has name, and no
 * `source` field at all. Design rule 11's no-detector fallback reads
 * flag.source to survive empty evidence; on this surface it is always
 * undefined — a documented, harmless gap, since the fallback still shows its
 * label and reason, just without a source line.
 */
function flagOutToFlag(flag: FlagOut): Flag {
  return {
    name: flag.flag_identity,
    flag_code: flag.flag_code,
    severity: flag.severity as Flag["severity"],
    day_closed: flag.day_closed as 0 | 1,
    evidence: flag.evidence,
  };
}
```

Replace the whole `FlagCard` function (lines 133–241):

```tsx
function FlagCard(props: {
  flag: FlagOut;
  dateKey: string;
  open: boolean;
  draft: PendingDecision;
  onDraftChange: (draft: PendingDecision) => void;
  onOpen: () => void;
  onClose: () => void;
  lastDecision: PendingDecision | null;
  onSubmit: (identities: string[], decision: PendingDecision) => void;
  submitting?: boolean;
}) {
  const { flag } = props;
  const evidence = formatFlagEvidenceDetails(flag.evidence, props.dateKey);
  const narrative = flagNarrative(flagOutToFlag(flag), EMPTY_NARRATIVE_DAY, props.dateKey);
  const decided = flag.decision_state === "matched";

  return (
    <section className="space-y-2.5 rounded-xl border border-border/60 bg-card px-3 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {formatFlagLabel(flag.flag_code, parseFlagEvidence(flag.evidence))}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {flagSummary(flag.flag_code)}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-md text-[11px]",
            flag.decision_state === "needs_re_review" &&
              "border-brand-accent/40 bg-brand-accent/10 text-brand-accent",
          )}
        >
          {decisionStateLabel(flag.decision_state)}
        </Badge>
      </div>

      {/* The verdict, not the fields — same flagNarrative() idiom as
          FlagDetailPanel.tsx, so a change there lands here too (was: same
          dl/dt/dd idiom for the raw evidence.rows, unfiltered). This card
          always computes against EMPTY_NARRATIVE_DAY (see above) — this
          surface has no live calendar day. */}
      <div className="space-y-1">
        <p className="text-xs font-medium leading-relaxed text-foreground">{narrative.headline}</p>
        {narrative.subline ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">{narrative.subline}</p>
        ) : null}
      </div>

      {narrative.timeline ? (
        <FlagEvidenceTimeline
          spec={narrative.timeline}
          ariaLabel={`${narrative.headline} timeline`}
        />
      ) : null}

      {narrative.facts.length > 0 ? (
        <dl className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
          {narrative.facts.map((fact) => (
            <div key={fact.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 text-xs">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="font-medium text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* Same dl/dt/dd shape as FlagDetailPanel.tsx's disclosure — one
          evidence idiom across both surfaces, so a change to
          formatFlagEvidenceDetails lands in both without a second layout to
          keep in step. Both `.rows` AND `.fallbackJson` now live behind this
          <details>; before this task `.fallbackJson` was read nowhere on
          this card (only `.rows` was, rendered uncollapsed), so a flag with
          leftover keys had no way to reach HR here at all. */}
      {evidence.rows.length > 0 || evidence.fallbackJson ? (
        <details className="rounded-lg border border-border/60 bg-muted/10 px-2.5 py-1.5">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
            Full evidence
          </summary>
          <div className="mt-2 space-y-2">
            {evidence.rows.length > 0 ? (
              <dl className="space-y-1.5 rounded-lg border border-border/60 bg-card px-2.5 py-2">
                {evidence.rows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 text-xs">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="font-medium text-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {evidence.fallbackJson ? (
              <pre className="max-h-40 overflow-auto text-[11px] leading-relaxed text-muted-foreground">
                {evidence.fallbackJson}
              </pre>
            ) : null}
          </div>
        </details>
      ) : null}

      {/* CONTEXT, not an outcome. The evidence fingerprint moved under this
          decision, so the backend deliberately did not apply it and put the flag
          back in the queue. Styling it like a live decision would tell HR the day
          is handled when it is not. */}
      {flag.decision && flag.decision_state === "needs_re_review" ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {priorDecisionLabel(flag.decision)}
        </p>
      ) : null}

      {/* The decision in force, kept on screen while the form below is open —
          this is what HR is replacing, and they should be able to read it while
          they type the reason they are replacing it. */}
      {flag.decision && decided ? (
        <p className="text-xs text-muted-foreground">{appliedDecisionLabel(flag.decision)}</p>
      ) : null}

      {/* A decided flag is decidable AGAIN, through this same form. That is the
          only way HR can correct a decision they got wrong: the write is an
          ordinary decide_flags call on the same flag_identity, which the backend
          records as a new row superseding the old one — nothing is edited and
          nothing is deleted. */}
      {props.open ? (
        <DecisionForm
          draft={props.draft}
          onChange={props.onDraftChange}
          submitLabel={outcomeActionLabel(props.draft.outcome)}
          onSubmit={() => props.onSubmit(flagIdentities(flag), props.draft)}
          onCancel={props.onClose}
          submitting={props.submitting}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={decided ? "outline" : "default"} onClick={props.onOpen}>
            {decided ? DECIDE_AGAIN_LABEL : "Decide"}
          </Button>
          {/* Only for flags still awaiting one: repeating the day's decision onto
              a flag that already has one would be a supersession nobody asked
              for, recorded under HR's name. */}
          {!decided && props.lastDecision ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={props.submitting}
              onClick={() =>
                props.onSubmit(flagIdentities(flag), props.lastDecision as PendingDecision)
              }
            >
              {SAME_REASON_LABEL}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
```

Everything after this in the file (`GroupDecision`, `DecisionForm`) is unchanged.

- [ ] **Step 7: Run the full suite and confirm it's green**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance`)
Expected: PASS — the whole suite, including the 7 tests this task added (2 new in `FlagDetailPanel.test.tsx`, 2 new in `DayInspectorSheet.test.tsx`, 3 new in `FlagDecisionPanel.test.tsx`) and everything Tasks 1–6 already had green. Compare the `# tests N` line against the baseline captured in Step 2 — it must read exactly 7 higher. Report both numbers (before/after) in the task's completion notes; the exit code alone is not evidence (Global Constraint 13).

- [ ] **Step 8: Build and verify the asset-size guard**

Run: `npm run build` (from `dewey_time/frontend/hr_attendance`)
Expected: exits 0. Then check the built stylesheet size:

```bash
# from the repo root of whatever checkout you are working in
ls -la dewey_time/public/hr_attendance/assets/index.css
```

Expected: **~172 kB, not ~90 kB** (Global Constraint 15). `scripts/copy-html-entry.mjs` already hard-fails the build under a 150,000-byte floor, so a 0 exit code already implies this — but confirm the actual byte count rather than trusting the exit code alone, per Global Constraint 13's "the exit code is not evidence" standard applied here too. If the build fails on this floor, the cause is almost always a missing `node_modules` at `dewey_time/frontend/hr_attendance/` in this worktree — symlink it in rather than removing the guard (Global Constraint 15).

- [ ] **Step 9: Commit**

```bash
git add \
  dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.tsx \
  dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.test.tsx \
  dewey_time/frontend/hr_attendance/src/ui/FlagDecisionPanel.tsx \
  dewey_time/frontend/hr_attendance/src/ui/FlagDecisionPanel.test.tsx \
  dewey_time/frontend/hr_attendance/src/ui/DayInspectorSheet.tsx \
  dewey_time/frontend/hr_attendance/src/ui/DayInspectorSheet.test.tsx \
  dewey_time/public/hr_attendance \
  dewey_time/www/hr-attendance.html \
  dewey_time/www/hr-schedule.html \
  dewey_time/www/hr-flags.html
git commit -m "$(cat <<'EOF'
feat(hr-flags): wire the flag narrative into both review panels

FlagDetailPanel and FlagDecisionPanel's flag cards now render
flagNarrative()'s headline/subline/timeline/facts as the primary content,
with the full evidence blob (formatFlagEvidenceDetails, unchanged) collapsed
behind a single disclosure instead of dumped as first-class rows. Drops the
now-redundant "View punches & timeline" click-through now the timeline is
embedded. The flag queue surface has no live calendar day available
anywhere in its call chain, so its card computes the narrative against an
explicit empty NarrativeDay rather than crashing or fetching one.

Rebuilds and commits the deployed SPA bundle — Frappe Cloud never builds
this app from source.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

