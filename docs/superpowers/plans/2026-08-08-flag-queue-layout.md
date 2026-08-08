# Flag Queue Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the flag queue back the 45% of viewport height and 20% of width it spends on chrome, and stop it mixing device-outage acknowledgements with judgments about people.

**Architecture:** Everything is client-side. `get_flag_queue` already returns `group_type` on every group entry, so lifting `BRANCH_NO_DEVICE_DATA` out of the list is a pure partition of data already on the wire — no Python changes anywhere in this plan. A new pure module (`lib/flagQueuePartition.ts`) does the split and the arithmetic; a new component (`ui/OutageBand.tsx`) renders the result; `FlagQueuePage.tsx` wires them together and loses its chrome; `FlagDecisionPanel.tsx` splits into a scrolling body and a pinned footer.

**Tech Stack:** React 19, TypeScript, Vite, TailwindCSS v4, `@lolbikb/dewey-ui`, `@tanstack/react-query`, `node:test` + `renderToStaticMarkup` for unit tests, Playwright for e2e.

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-08-08-flag-queue-layout-design.md`. Every task's requirements implicitly include these.

1. **No backend change.** All 606 Python tests must stay green and untouched. `get_flag_queue` already returns `group_type`; this is a client-side partition.
2. **All user-facing copy lives in `src/lib/flagQueueLabels.ts`.** That module's own docstring: *"`ui/FlagQueuePage.tsx`, `ui/FlagQueueList.tsx` and `ui/FlagDecisionPanel.tsx` hold no copy of their own — every string they render is imported from here."* New components follow the same rule. **This includes control labels** — button captions, `<option>` text, inline affordances. They read as markup, which is exactly why they are the strings that leak; a pre-flight scan of this plan's first draft found five. Any string a user can read is copy. Reviewers should reject inline literals even when they are a single word.
3. **Never name a device.** Branch is the finest granularity the data supports. No copy may imply otherwise. The outage band must carry the ceiling note verbatim: `Branch and days only — nothing here maps a device to a branch.`
4. **Bulk writes go through `groupPayload(members, excluded)` from `lib/flagDecisionState.ts`.** Never hand-roll an identities array. Any count shown beside a write action reads `coveredEmployeeCount`, never `employeeCount` and never `undecided_count` — a member whose only unresolved flag is `needs_re_review` is checked but writes nothing.
5. **Device-health link target is `/hr-attendance`.** `main.tsx` has exactly five routes (`/hr-attendance`, `/hr-schedule`, `/hr-schedule/import`, `/hr-schedule/coverage`, `/hr-flags`). This plan adds none.
6. **`decide_flags` is called with `groupKey: null`.** The server mints a fresh `AFD-<hash>` per call. Passing an entry's `group_key` makes `reverse_decision_group` undo every decision ever made under that key.
7. **The unit suite is `renderToStaticMarkup` + regex.** It has no accessibility tree, no focus, no key events. Anything involving focus, keyboard, scroll position or sheets is proven in Playwright or not at all.
8. **`npm run test:web` is a non-recursive per-directory glob** in `package.json`. A new test file in a directory not already listed will silently never run. Currently globbed: `src/lib/*.test.ts`, `src/brand/*`, `src/pwa/*`, `src/components/*.test.tsx`, `src/components/ui/*.test.tsx`, `src/ui/*.test.tsx`.
9. **Built assets are the deployed artifact and must be committed.** Frappe Cloud never builds this SPA. Run `npm run build` and commit `dewey_time/public/` in the final task of each phase.
10. **Every Playwright payload literal carries a `satisfies` clause** naming its contract type (`satisfies QueuePayload`, `satisfies QueueEntry`). Without it the literal is inferred, not checked, and `tsc` catches nothing — this is how five person fields came to be missing from the fixtures while the unit suite stayed green.

## Commands

All run from `dewey_time/frontend/hr_attendance`:

| | |
|---|---|
| Unit | `npm run test:web` |
| One unit file | `npx tsx --test src/lib/flagQueuePartition.test.ts` |
| Types | `npm run typecheck` |
| e2e | `npm run test:e2e` |
| One e2e test | `npx playwright test e2e/flags.spec.ts -g "the outage band"` |
| Build | `npm run build` |

Python, from the repo root, only to confirm nothing broke: `python3.13 -m unittest discover -s dewey_time/tests -t .` (**`python3` is 3.9.6 and cannot import these modules**).

## File Structure

| File | Responsibility |
|---|---|
| **Create** `src/lib/flagQueuePartition.ts` | Pure. Splits `QueueEntry[]` into outage groups and everything else; computes the band's write payload and the header's two counts. No React. |
| **Create** `src/lib/flagQueuePartition.test.ts` | Unit tests for the above. |
| **Create** `src/ui/OutageBand.tsx` | Presentational. Renders the band: disclosure, per-branch checkboxes, day strip, submit. Owns no state. |
| **Create** `src/ui/outageBand.test.tsx` | Unit tests for the above. |
| **Modify** `src/lib/flagQueueLabels.ts` | New copy for the band, the header description, and the capped-queue control. |
| **Modify** `src/ui/FlagQueuePage.tsx` | Band wiring and its exclusion state; toolbar rebuild; `max-w-none`; skeleton loading; mobile sheet. |
| **Modify** `src/ui/FlagQueueList.tsx` | Nothing structural — it receives the already-partitioned array. Only the empty-state copy changes. |
| **Modify** `src/ui/FlagDecisionPanel.tsx` | Split into scrolling body + pinned footer; worst flag full, rest as one-liners. |
| **Modify** `src/ui/flagQueuePage.test.tsx` | Extend existing fixtures; assert the new header and panel shapes. |
| **Modify** `e2e/flags.spec.ts` | Band behaviour, pinned footer, mobile sheet, and re-proving the keyboard model survives. |

---

# Phase 1 — chrome, width, outage band

## Task 1: The partition and its arithmetic

**Files:**
- Create: `src/lib/flagQueuePartition.ts`
- Test: `src/lib/flagQueuePartition.test.ts`

**Interfaces:**
- Consumes: `QueueEntry`, `QueuePerson` from `@/types/flags`; `groupPayload` from `@/lib/flagDecisionState`.
- Produces:
  - `isOutageGroup(entry: QueueEntry): entry is OutageGroup`
  - `partitionQueue(entries: QueueEntry[]): { outages: OutageGroup[]; queue: QueueEntry[] }`
  - `outageWrite(outages: OutageGroup[], excludedBranches: ReadonlySet<string>): { identities: string[]; branchCount: number; coveredEmployeeCount: number }`
  - `queuePeopleCount(entries: QueueEntry[]): number`
  - `type OutageGroup = Extract<QueueEntry, { kind: "group" }> & { group_type: "BRANCH_NO_DEVICE_DATA" }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/flagQueuePartition.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  isOutageGroup,
  outageWrite,
  partitionQueue,
  queuePeopleCount,
  type OutageGroup,
} from "@/lib/flagQueuePartition";
import type { DecisionState, FlagOut, QueueEntry, QueuePerson } from "@/types/flags";

function flag(identity: string, state: DecisionState = "undecided"): FlagOut {
  return {
    flag_identity: identity,
    flag_code: "MISSING_TIME",
    attendance_date: "2026-08-03",
    day_closed: 1,
    evidence: {},
    rank: 134,
    tier: "act",
    decision_state: state,
    decision: null,
  };
}

function person(employee: string, flags: FlagOut[]): QueuePerson {
  return {
    entry_key: `p:${employee}`,
    employee,
    employee_name: employee,
    employee_branch: "DIS Iconic",
    employee_image: null,
    attendance_date: "2026-08-03",
    dates: ["2026-08-03"],
    rank: 134,
    tier: "act",
    flags,
    undecided_count: flags.length,
    also_count: 0,
    also_outlier_count: 0,
  };
}

function outage(branch: string, members: QueuePerson[]): OutageGroup {
  return {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: `BRANCH_NO_DEVICE_DATA:${branch}`,
    branch,
    flag_code: null,
    attendance_date: null,
    dates: ["2026-08-03"],
    day_count: 1,
    rank: 134,
    tier: "act",
    members,
  };
}

function pattern(members: QueuePerson[]): OutageGroup {
  return {
    kind: "group",
    group_type: "REPEAT_PATTERN",
    group_key: "REPEAT_PATTERN:LATE_START",
    branch: null,
    flag_code: "LATE_START",
    attendance_date: null,
    dates: ["2026-08-03"],
    day_count: 1,
    rank: 120,
    tier: "review",
    members,
  };
}

const LONE: QueueEntry = { kind: "person", ...person("DI-0197", [flag("f-lone")]) };

test("only BRANCH_NO_DEVICE_DATA leaves the queue", () => {
  const outageGroup = outage("DIS Iconic", [person("DI-1", [flag("f-1")])]);
  const patternGroup = pattern([person("DI-2", [flag("f-2")])]);

  const { outages, queue } = partitionQueue([outageGroup, LONE, patternGroup]);

  assert.deepEqual(
    outages.map((g) => g.group_key),
    ["BRANCH_NO_DEVICE_DATA:DIS Iconic"],
  );
  assert.equal(queue.length, 2, "the lone person and the pattern group both stay");
  assert.ok(queue.includes(LONE));
  assert.ok(queue.includes(patternGroup));
});

test("a branchless person row is NOT mistaken for an outage", () => {
  // Today's real payload: all 133 person rows have employee_branch null, and
  // they are in the same situation as the grouped 256. They are still
  // judgments as far as this partition is concerned — only group_type decides.
  const branchless: QueueEntry = {
    kind: "person",
    ...person("DI-0197", [flag("f-b")]),
    employee_branch: null,
  };
  const { outages, queue } = partitionQueue([branchless]);
  assert.equal(outages.length, 0);
  assert.deepEqual(queue, [branchless]);
});

test("isOutageGroup is false for a person entry", () => {
  assert.equal(isOutageGroup(LONE), false);
});

test("the write covers every undecided flag of every included branch", () => {
  const groups = [
    outage("A", [person("DI-1", [flag("a1"), flag("a2")]), person("DI-2", [flag("a3")])]),
    outage("B", [person("DI-3", [flag("b1")])]),
  ];

  const write = outageWrite(groups, new Set());

  assert.deepEqual(write.identities, ["a1", "a2", "a3", "b1"]);
  assert.equal(write.branchCount, 2);
  assert.equal(write.coveredEmployeeCount, 3);
});

test("excluding a branch removes its people and all of their flags", () => {
  const groups = [
    outage("A", [person("DI-1", [flag("a1"), flag("a2")])]),
    outage("B", [person("DI-3", [flag("b1")])]),
  ];

  const write = outageWrite(groups, new Set(["BRANCH_NO_DEVICE_DATA:A"]));

  assert.deepEqual(write.identities, ["b1"]);
  assert.equal(write.branchCount, 1);
  assert.equal(write.coveredEmployeeCount, 1);
});

test("a decided or needs_re_review flag is never swept into the write", () => {
  const groups = [
    outage("A", [
      person("DI-1", [flag("keep"), flag("done", "matched"), flag("stale", "needs_re_review")]),
    ]),
  ];

  const write = outageWrite(groups, new Set());

  assert.deepEqual(write.identities, ["keep"]);
});

test("a member who contributes no identity is not counted as covered", () => {
  // groupPayload's own rule: checked, so it counts in employeeCount, but it
  // writes nothing — so a label reading from this must not promise it.
  const groups = [
    outage("A", [person("DI-1", [flag("keep")]), person("DI-2", [flag("stale", "needs_re_review")])]),
  ];

  const write = outageWrite(groups, new Set());

  assert.equal(write.coveredEmployeeCount, 1, "only DI-1 writes anything");
  assert.deepEqual(write.identities, ["keep"]);
});

test("a pattern group handed to outageWrite yields nothing", () => {
  // The type forbids it, but types are erased. If this ever returned identities
  // the band's "Excuse all" would mass-excuse genuine judgments — the worst
  // thing this page can do. Cast through unknown to reach past the guard.
  const patternGroup = pattern([person("DI-2", [flag("p1")])]) as unknown as OutageGroup;
  assert.deepEqual(outageWrite([patternGroup], new Set()).identities, []);
});

test("empty inputs return empty results rather than throwing", () => {
  assert.deepEqual(partitionQueue([]), { outages: [], queue: [] });
  assert.deepEqual(outageWrite([], new Set()), {
    identities: [],
    branchCount: 0,
    coveredEmployeeCount: 0,
  });
  assert.equal(queuePeopleCount([]), 0);
});

test("an exclusion key matching no branch changes nothing", () => {
  const groups = [outage("A", [person("DI-1", [flag("a1")])])];
  const write = outageWrite(groups, new Set(["BRANCH_NO_DEVICE_DATA:Nowhere"]));
  assert.deepEqual(write.identities, ["a1"]);
  assert.equal(write.branchCount, 1);
});

test("neither function mutates what it was given", () => {
  // The sibling suite pins exactly this for the tier filter (commit aff38433),
  // because a filter that sorted in place corrupted the caller's array.
  const groups = [outage("A", [person("DI-1", [flag("a1")])])];
  const entries: QueueEntry[] = [groups[0], LONE];
  const snapshot = JSON.stringify(entries);

  partitionQueue(entries);
  outageWrite(groups, new Set());
  queuePeopleCount(entries);

  assert.equal(JSON.stringify(entries), snapshot);
  assert.equal(entries.length, 2, "the input array kept its length");
});

test("queuePeopleCount counts distinct employees, not rows", () => {
  const shared = person("DI-9", [flag("s1")]);
  const entries: QueueEntry[] = [
    { kind: "person", ...shared },
    pattern([shared, person("DI-8", [flag("s2")])]),
  ];

  assert.equal(queuePeopleCount(entries), 2, "DI-9 appears twice, counts once");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/flagQueuePartition.test.ts`
Expected: FAIL — `Cannot find module '@/lib/flagQueuePartition'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/flagQueuePartition.ts`:

```ts
/**
 * Splits the queue payload into the two things it actually contains.
 *
 * `flag_grouping.py` already draws this line and then loses it: "A device
 * outage claims the whole day, before anything else looks at it." An outage is
 * a PRECONDITION — there is no evidence to weigh and nobody is being judged —
 * while every other entry asks a question about a person. Rendering both in
 * one ranked list made the queue report 147 rows when it held 3 decisions and
 * 144 acknowledgements, and pushed the one row genuinely needing review below
 * fourteen infrastructure rows.
 *
 * Pure, and deliberately outside any component: the unit suite renders with
 * renderToStaticMarkup and has no react-query harness, so arithmetic left
 * inside FlagQueuePage is arithmetic nothing can test.
 */
import { groupPayload } from "@/lib/flagDecisionState";
import type { QueueEntry } from "@/types/flags";

/**
 * An outage group specifically — NOT any group.
 *
 * `QueueEntry` is discriminated on `kind` alone; `group_type` is an ordinary
 * field holding a three-way union, so a bare
 * `Extract<QueueEntry, { kind: "group" }>` admits REPEAT_PATTERN and
 * ROUTINE_CODE too. Handing either to `outageWrite` would return the undecided
 * identities of genuine judgments as an "Excuse all" payload — a mass excuse
 * over real findings, the highest-blast-radius mistake this page can make.
 *
 * Intersection, not a filtered `Extract`: `Extract<…, { group_type: "…" }>`
 * yields `never` here, because the arm's `group_type` union is not assignable
 * to a single-member object type.
 */
export type OutageGroup = Extract<QueueEntry, { kind: "group" }> & {
  group_type: "BRANCH_NO_DEVICE_DATA";
};

/** No exclusions — the band excludes whole branches, never individuals. */
const NO_EXCLUSIONS: ReadonlySet<string> = new Set<string>();

/** A type predicate, so `partitionQueue` narrows instead of casting — a cast
 *  here would keep the alias above unenforced and invisible to tsc. */
export function isOutageGroup(entry: QueueEntry): entry is OutageGroup {
  return entry.kind === "group" && entry.group_type === "BRANCH_NO_DEVICE_DATA";
}

export function partitionQueue(entries: QueueEntry[]): {
  outages: OutageGroup[];
  queue: QueueEntry[];
} {
  const outages: OutageGroup[] = [];
  const queue: QueueEntry[] = [];
  for (const entry of entries) {
    if (isOutageGroup(entry)) outages.push(entry);
    else queue.push(entry);
  }
  return { outages, queue };
}

/**
 * What "Excuse all" would actually write, for the branches still checked.
 *
 * Built from `groupPayload` rather than by hand so the two filters it owns
 * apply here too: only strictly `undecided` flags are ever included, and
 * `coveredEmployeeCount` counts only members who contribute an identity. A
 * member whose sole unresolved flag is `needs_re_review` is checked but writes
 * nothing, so a count of merely-checked members would promise a write that does
 * not happen for them. The returned field is named `coveredEmployeeCount` to
 * match `groupPayload`'s own vocabulary exactly — an `employeeCount` here would
 * mean the opposite of what that name means one module over, which is the same
 * shape of trap as the `undecided`/`unresolved` collision that module documents
 * at length.
 *
 * `branchCount` answers "branches still checked", NOT "branches that will be
 * written": a branch whose flags are all already decided still increments it
 * while contributing no identities. Copy built on it must not promise a write.
 *
 * No dedupe: the per-flag invariant puts each flag in exactly one entry, so two
 * outage groups cannot both carry the same identity.
 */
export function outageWrite(
  outages: OutageGroup[],
  excludedBranches: ReadonlySet<string>,
): { identities: string[]; branchCount: number; coveredEmployeeCount: number } {
  const identities: string[] = [];
  let branchCount = 0;
  let coveredEmployeeCount = 0;

  for (const group of outages) {
    if (excludedBranches.has(group.group_key)) continue;
    branchCount += 1;
    const payload = groupPayload(group.members, NO_EXCLUSIONS);
    identities.push(...payload.identities);
    coveredEmployeeCount += payload.coveredEmployeeCount;
  }

  return { identities, branchCount, coveredEmployeeCount };
}

/**
 * Distinct employees across the judgment queue. `counts.people` from the
 * payload counts the whole thing including outage members, so it cannot answer
 * "how many people are actually waiting on a decision" once the band exists.
 */
export function queuePeopleCount(entries: QueueEntry[]): number {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "person") seen.add(entry.employee);
    else for (const member of entry.members) seen.add(member.employee);
  }
  return seen.size;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/flagQueuePartition.test.ts`
Expected: PASS, 12 tests (one gains a negative control).

- [ ] **Step 5: Confirm the new file is actually globbed**

Run: `npm run test:web 2>&1 | tail -5`
Expected: the total test count rises by 12. `src/lib/*.test.ts` is already in the glob, so no `package.json` change is needed — but **verify the count moved**, because a file in an unglobbed directory fails silently by simply never running.

- [ ] **Step 6: Mutation-test the partition**

Two mutations, both reverted after:

1. Change `isOutageGroup` to `entry.kind === "group"` (dropping the `group_type` check).
   Expected: FAIL on "only BRANCH_NO_DEVICE_DATA leaves the queue" **and** on "a pattern group handed to outageWrite yields nothing".
2. Widen `OutageGroup` back to a bare `Extract<QueueEntry, { kind: "group" }>`.
   Expected: `npm run typecheck` stays clean — proving the type alone never guarded this, which is why the runtime test in step 1 exists.

Run: `npx tsx --test src/lib/flagQueuePartition.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/lib/flagQueuePartition.ts src/lib/flagQueuePartition.test.ts
git commit -m "feat(flag-queue): split the payload into judgments and acknowledgements"
```

---

## Task 2: Band copy

**Files:**
- Modify: `src/lib/flagQueueLabels.ts` (append after `queueHeaderDescription`, around line 282)
- Test: `src/lib/flagQueueLabels.test.ts` (existing file — append)

**Interfaces:**
- Consumes: `dateSpanLabel` and `formatBranchLabel`, already in `flagQueueLabels.ts` / `attendanceTime.ts`.
- Produces:
  - `outageBandHeadline(outageBranchCount: number, affectedPeopleCount: number): string`
  - `outageBandSubline(dates: string[], flagCount: number): string`
  - `outageBranchDays(dayCount: number): string`
  - `outageBranchSummary(affectedPeopleCount: number, flagCount: number): string`
  - `outageExcuseLabel(coveredPeopleCount: number, flagCount: number, selectedBranchCount: number): string`
  - `outageReviewLabel(outageBranchCount: number): string`
  - `queueSplitDescription(queuePeople: number, queueRows: number, outagePeople: number): string`
  - `OUTAGE_CEILING_NOTE: string`
  - `DEVICE_HEALTH_LABEL: string`
  - `OUTAGE_NOT_A_JUDGMENT: string`
  - `TIER_FILTER_ALL_LABEL: string`
  - `DECIDED_TOGGLE_LABEL: string`
  - `DECIDE_ONE_LABEL: string`
  - `DECIDING_PREFIX: string`
  - `narrowRangeLabel(days: number): string`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/flagQueueLabels.test.ts`:

```ts
test("the outage band headline names branches and people, never a device", () => {
  const headline = outageBandHeadline(13, 256);
  assert.equal(headline, "13 branches had no device data · 256 people affected");
  assert.ok(!/serial|device [A-Z]{2}-/i.test(headline));
});

test("a single branch and a single person read in the singular", () => {
  assert.equal(outageBandHeadline(1, 1), "1 branch had no device data · 1 person affected");
});

test("the headline says AFFECTED, so it can differ from what the button excuses", () => {
  // The button reads coveredEmployeeCount, which is smaller. Without "affected"
  // an HR reader sees 256 then 157 and concludes the button is broken.
  assert.match(outageBandHeadline(13, 256), /256 people affected$/);
  assert.equal(outageExcuseLabel(157, 2287, 13), "Excuse 157 people · 2,287 flags");
});

test("the band subline carries the range, the flag count, and the disclaimer", () => {
  const subline = outageBandSubline(["2026-07-30", "2026-08-08"], 3277);
  assert.match(subline, /30 Jul/);
  assert.match(subline, /8 Aug/);
  assert.match(subline, /3,277 flags/);
  assert.match(subline, /nobody is being judged here/);
});

test("the excuse label states both dimensions of the write", () => {
  assert.equal(outageExcuseLabel(1, 1, 1), "Excuse 1 person · 1 flag");
});

test("nothing SELECTED and nothing LEFT are different sentences", () => {
  // "Left" is a completion word. Saying it over an empty selection tells the
  // user the outage is handled when they have merely unchecked everything.
  assert.equal(outageExcuseLabel(0, 0, 0), "Select a branch to excuse");
  assert.equal(outageExcuseLabel(0, 0, 3), "Nothing left to excuse");
});

test("the ceiling note refuses to promise device granularity", () => {
  assert.equal(
    OUTAGE_CEILING_NOTE,
    "Branch and days only — nothing here maps a device to a branch.",
  );
});

test("the header splits waiting-on-you from waiting-on-a-device, and keeps rows", () => {
  // `rows` was added in 20c016fc and fixed for tier filters in 38fbea19,
  // because one row can stand for several people. Dropping it here would
  // silently undo both.
  assert.equal(
    queueSplitDescription(134, 92, 256),
    "134 people need a decision · 92 rows · 256 waiting on a device fault",
  );
});

test("the header says nothing about device faults when there are none", () => {
  assert.equal(queueSplitDescription(37, 21, 0), "37 people need a decision · 21 rows");
});

test("one person left does not read as \"1 need a decision\"", () => {
  // The most common end state of a session, in the page's primary header.
  assert.equal(queueSplitDescription(1, 1, 0), "1 person needs a decision · 1 row");
});

test("a queue with nothing waiting still reads as a sentence", () => {
  assert.equal(queueSplitDescription(0, 0, 0), "Nothing needs a decision");
  assert.equal(
    queueSplitDescription(0, 0, 256),
    "Nothing needs a decision · 256 waiting on a device fault",
  );
});

test("four-figure counts are grouped everywhere, not only in the band", () => {
  assert.match(queueSplitDescription(1234, 900, 0), /1,234 people need/);
});

test("the narrow-range levers name the window they set", () => {
  assert.equal(narrowRangeLabel(7), "Last 7 days");
  assert.equal(narrowRangeLabel(3), "Last 3 days");
  assert.equal(narrowRangeLabel(1), "Last 1 day");
});

test("control labels live here, not inline in the components", () => {
  // Global Constraint 2. These are the ones that leak, because they read as
  // markup rather than as copy.
  assert.equal(TIER_FILTER_ALL_LABEL, "Any consequence");
  assert.equal(DECIDED_TOGGLE_LABEL, "Decided");
  assert.equal(DECIDE_ONE_LABEL, "decide");
  assert.equal(DECIDING_PREFIX, "Deciding");
  assert.equal(DEVICE_HEALTH_LABEL, "Device health");
});

test("every branch-row string is pinned, not just the ones a component happens to use", () => {
  assert.equal(outageBranchDays(10), "10 days with no sync row");
  assert.equal(outageBranchDays(1), "1 day with no sync row");
  assert.equal(outageBranchSummary(99, 990), "99 people · 990 flags");
  assert.equal(outageReviewLabel(13), "Review 13 branches");
  assert.equal(outageReviewLabel(1), "Review 1 branch");
  assert.equal(OUTAGE_NOT_A_JUDGMENT, "the machines didn't record — nobody is being judged here");
});

test("an empty date span leaves no dangling separator", () => {
  assert.match(outageBandSubline([], 5), /^5 flags · /);
});
```

Add the new names to that file's existing import from `@/lib/flagQueueLabels`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/flagQueueLabels.test.ts`
Expected: FAIL — the imported names do not exist.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/flagQueueLabels.ts`:

```ts
/**
 * Copy for the device-outage band.
 *
 * The band exists because a device outage is not a judgment about anybody, and
 * its wording has to keep saying so — an amber strip carrying 256 people's
 * names reads as an accusation unless it states otherwise in words.
 *
 * Every string here observes this module's device rule: branch is the finest
 * granularity the data supports (`_outage_branch_dates`: "nothing in this app
 * maps a device to a branch"), so none of these functions takes a parameter a
 * serial could arrive through.
 */
export const OUTAGE_NOT_A_JUDGMENT = "the machines didn't record — nobody is being judged here";

export const OUTAGE_CEILING_NOTE =
  "Branch and days only — nothing here maps a device to a branch.";

export const DEVICE_HEALTH_LABEL = "Device health";

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/**
 * @param outageBranchCount EVERY branch in the outage — never a filtered or
 *   still-checked subset. This sentence states what happened; it must not move
 *   when the user unchecks a box, or the page reports "1 branch had no device
 *   data" when thirteen did.
 * @param affectedPeopleCount everyone the outage touched. Deliberately NOT the
 *   count the excuse button shows: that one is `coveredEmployeeCount`, which is
 *   smaller. "affected" is what makes the two numbers legible side by side.
 */
export function outageBandHeadline(
  outageBranchCount: number,
  affectedPeopleCount: number,
): string {
  const branches = plural(outageBranchCount, "branch", "branches");
  return `${branches} had no device data · ${plural(affectedPeopleCount, "person", "people")} affected`;
}

export function outageBandSubline(dates: string[], flagCount: number): string {
  // dateSpanLabel returns "" for an empty array, which would leave a dangling
  // " · " at the head of the line. personSubline has a dedicated test for this
  // same failure; the guard is one line.
  const span = dateSpanLabel(dates);
  const head = span ? `${span} · ` : "";
  return `${head}${plural(flagCount, "flag", "flags")} · ${OUTAGE_NOT_A_JUDGMENT}`;
}

export function outageBranchDays(dayCount: number): string {
  return `${plural(dayCount, "day", "days")} with no sync row`;
}

export function outageBranchSummary(affectedPeopleCount: number, flagCount: number): string {
  return `${plural(affectedPeopleCount, "person", "people")} · ${plural(flagCount, "flag", "flags")}`;
}

/** @param outageBranchCount every branch, not the checked subset — "Review 13"
 *  must not become "Review 4" as boxes are unchecked. */
export function outageReviewLabel(outageBranchCount: number): string {
  return `Review ${plural(outageBranchCount, "branch", "branches")}`;
}

/**
 * The band's write action.
 *
 * Three states, not two. Zero-with-nothing-selected and zero-with-nothing-left
 * are different facts and must not share words: "Nothing LEFT to excuse" over an
 * empty selection reads as "this outage has already been handled", when the user
 * has merely unchecked everything to start again. "Left" is a completion word.
 *
 * @param coveredPeopleCount MUST be `outageWrite(...).coveredEmployeeCount` —
 *   Global Constraint 4. Never `branchCount`, never a raw member count.
 * @param flagCount MUST be `outageWrite(...).identities.length`.
 * @param selectedBranchCount how many branches are still checked.
 */
export function outageExcuseLabel(
  coveredPeopleCount: number,
  flagCount: number,
  selectedBranchCount: number,
): string {
  if (selectedBranchCount === 0) return "Select a branch to excuse";
  if (flagCount === 0) return "Nothing left to excuse";
  return `Excuse ${plural(coveredPeopleCount, "person", "people")} · ${plural(flagCount, "flag", "flags")}`;
}

/**
 * Replaces `queueHeaderDescription` on this page.
 *
 * "389 people · 147 rows" counted the outage members among the people waiting on
 * HR, which is the specific lie the band exists to end: 256 of those 389 are
 * waiting on a machine, and no amount of HR attention moves them.
 *
 * `rows` survives the rewrite. It was added deliberately in 20c016fc and fixed
 * for tier filters in 38fbea19, and `queueHeaderDescription`'s own docstring
 * explains why people-only counting misleads above a list that can hold one row
 * for several people. Dropping it here would silently undo both commits.
 */
export function queueSplitDescription(
  queuePeople: number,
  queueRows: number,
  outagePeople: number,
): string {
  const head =
    queuePeople === 0
      ? "Nothing needs a decision"
      : `${plural(queuePeople, "person needs", "people need")} a decision · ${plural(queueRows, "row", "rows")}`;
  if (outagePeople === 0) return head;
  return `${head} · ${outagePeople.toLocaleString("en-US")} waiting on a device fault`;
}

/** A filter's no-filter option. "All consequences" reads as an inclusion
 *  criterion — "only flags that carry a consequence" — which is the opposite. */
export const TIER_FILTER_ALL_LABEL = "Any consequence";

export const DECIDED_TOGGLE_LABEL = "Decided";

/** The affordance on a compressed flag one-liner. Lowercase: it sits inline at
 *  the end of a row of data, not as a button caption. */
export const DECIDE_ONE_LABEL = "decide";

/** Names the pinned footer's target, so a control that never moves is never
 *  ambiguous about what it is about to write. */
export const DECIDING_PREFIX = "Deciding";

export function narrowRangeLabel(days: number): string {
  return `Last ${plural(days, "day", "days")}`;
}
```

`dateSpanLabel` already exists in this module (used by `groupSubline`); if it is not exported, export it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/flagQueueLabels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/flagQueueLabels.ts src/lib/flagQueueLabels.test.ts
git commit -m "feat(flag-queue): copy for the device-outage band"
```

---

## Task 3: The OutageBand component

**Files:**
- Create: `src/ui/OutageBand.tsx`
- Test: `src/ui/outageBand.test.tsx`

**Interfaces:**
- Consumes: `OutageGroup`, `outageWrite` (Task 1); all label functions (Task 2); `AttentionStrip` is **not** used — see note below.
- Produces:
  ```ts
  export type OutageBandProps = {
    outages: OutageGroup[];
    excludedBranches: ReadonlySet<string>;
    onToggleBranch: (groupKey: string) => void;
    onExcuse: (identities: string[]) => void;
    submitting?: boolean;
    defaultOpen?: boolean;
  };
  export function OutageBand(props: OutageBandProps): JSX.Element | null;
  ```

**Why not `AttentionStrip`:** its `detail` slot makes the whole header row the `<summary>`, so the two action buttons inside it would toggle the disclosure on click. The band needs a header row with independent controls. It borrows the amber tone classes verbatim (`border-amber-500/25 bg-amber-500/[0.06]`) so it stays visually in the notice family.

- [ ] **Step 0: Add the four exports the band needs but the earlier modules lack**

Found by the Task 3 review. Three of them are Constraint 2 violations that were inline in this task's own component code; the fourth is a count that does not exist yet.

In `src/lib/flagQueuePartition.ts`:

```ts
/**
 * Every flag the outage produced, decided or not.
 *
 * NOT `outageWrite(...).identities.length`, which counts only undecided flags
 * and therefore shrinks as decisions land. The band's subline is a statement of
 * what happened — "30 Jul – 8 Aug · 3,277 flags" — and a historical fact that
 * falls to zero after the excuse is a false one.
 */
export function outageFlagCount(outages: OutageGroup[]): number {
  let total = 0;
  for (const group of outages) {
    for (const member of group.members) total += member.flags.length;
  }
  return total;
}
```

with tests beside the existing ones:

```ts
test("outageFlagCount counts every flag, not just the writable ones", () => {
  const groups = [
    outage("A", [person("DI-1", [flag("a1"), flag("done", "matched")])]),
    outage("B", [person("DI-2", [flag("b1", "needs_re_review")])]),
  ];
  assert.equal(outageFlagCount(groups), 3);
  assert.equal(outageWrite(groups, new Set()).identities.length, 1, "the write is smaller, on purpose");
});

test("outageFlagCount of nothing is zero", () => {
  assert.equal(outageFlagCount([]), 0);
});
```

In `src/lib/flagQueueLabels.ts`:

```ts
/** The band's accessible name — the only thing a screen-reader user hears on
 *  entering the landmark, so it is copy like any other string here. */
export const OUTAGE_BAND_LABEL = "Device outages";

/** Unreachable against build_queue's output, which always sets `branch` for a
 *  BRANCH_NO_DEVICE_DATA group, but the contract types it nullable. */
export const UNKNOWN_BRANCH_LABEL = "Unknown branch";

/** The checkbox's only accessible name. Without it the control is unnamed. */
export function outageBranchCheckboxLabel(branch: string): string {
  return `Include ${branch}`;
}

/** Shown while the write is in flight. A greyed button still reading "Excuse
 *  157 people" gives no sign that anything is happening during a multi-second
 *  write over thousands of flags. */
export const OUTAGE_EXCUSING_LABEL = "Excusing…";
```

with tests appended to `src/lib/flagQueueLabels.test.ts`:

```ts
test("the band's own accessible names are copy, not markup", () => {
  assert.equal(OUTAGE_BAND_LABEL, "Device outages");
  assert.equal(UNKNOWN_BRANCH_LABEL, "Unknown branch");
  assert.equal(outageBranchCheckboxLabel("DIS Iconic"), "Include DIS Iconic");
  assert.equal(OUTAGE_EXCUSING_LABEL, "Excusing…");
});
```

Run `npm run test:web` after this step and before writing the component; expect the total up by 3.

- [ ] **Step 1: Write the failing test**

Create `src/ui/outageBand.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { OUTAGE_CEILING_NOTE } from "@/lib/flagQueueLabels";
import type { OutageGroup } from "@/lib/flagQueuePartition";
import type { DecisionState, FlagOut, QueuePerson } from "@/types/flags";
import { MemoryRouter } from "react-router-dom";

import { OutageBand, type OutageBandProps } from "@/ui/OutageBand";

function flag(identity: string, state: DecisionState = "undecided"): FlagOut {
  return {
    flag_identity: identity,
    flag_code: "MISSING_TIME",
    attendance_date: "2026-08-03",
    day_closed: 1,
    evidence: {},
    rank: 134,
    tier: "act",
    decision_state: state,
    decision: null,
  };
}

function member(employee: string, flags: FlagOut[]): QueuePerson {
  return {
    entry_key: `p:${employee}`,
    employee,
    employee_name: employee,
    employee_branch: "DIS Iconic",
    employee_image: null,
    attendance_date: "2026-08-03",
    dates: ["2026-08-03"],
    rank: 134,
    tier: "act",
    flags,
    undecided_count: flags.length,
    also_count: 0,
    also_outlier_count: 0,
  };
}

function group(branch: string, members: QueuePerson[], dates = ["2026-08-03"]): OutageGroup {
  return {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: `BRANCH_NO_DEVICE_DATA:${branch}`,
    branch,
    flag_code: null,
    attendance_date: null,
    dates,
    day_count: dates.length,
    rank: 134,
    tier: "act",
    members,
  };
}

// MemoryRouter because the ceiling note renders a <Link>, which throws outside
// a router. It still emits href="/hr-attendance", so the assertion is unchanged.
function render(overrides: Partial<OutageBandProps> = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
    <OutageBand
      outages={[
        group("DIS Iconic", [member("DI-1", [flag("a")]), member("DI-2", [flag("b")])]),
        group("ISBB", [member("DI-3", [flag("c")])]),
      ]}
      excludedBranches={new Set()}
      onToggleBranch={() => {}}
      onExcuse={() => {}}
      {...overrides}
    />
    </MemoryRouter>,
  );
}

test("no outages renders nothing at all, not an empty container", () => {
  const html = renderToStaticMarkup(
    <OutageBand
      outages={[]}
      excludedBranches={new Set()}
      onToggleBranch={() => {}}
      onExcuse={() => {}}
    />,
  );
  assert.equal(html, "");
});

test("the collapsed band states branches, people and that nobody is judged", () => {
  const html = render();
  assert.match(html, /2 branches had no device data/);
  assert.match(html, /3 people/);
  assert.match(html, /nobody is being judged here/);
});

test("the action counts flags, not just people", () => {
  assert.match(render(), /Excuse 3 people · 3 flags/);
});

test("excluding a branch drops its people and flags from the action", () => {
  const html = render({ excludedBranches: new Set(["BRANCH_NO_DEVICE_DATA:DIS Iconic"]) });
  assert.match(html, /Excuse 1 person · 1 flag/);
});

test("an in-flight write disables the action and says so", () => {
  // The only double-submit guard on the largest write on the page. Without this
  // test, deleting `|| props.submitting` leaves all other tests green while a
  // hurried double-click fires two writes over thousands of flags.
  const html = render({ submitting: true });
  assert.match(html, /Excusing…/);
  // `disabled=""`, NOT a bare /disabled/. Button's class list always contains
  // the literal "disabled:pointer-events-none disabled:opacity-50", so
  // /<button[^>]+disabled/ matches the CLASS whether or not the attribute is
  // there — a re-review mutation-tested this exact regex and found the suite
  // stayed green with `|| props.submitting` deleted.
  assert.match(html, /<button[^>]*\sdisabled=""[^>]*>[^<]*Excusing…/);
  // Negative control: the same button, not submitting, must NOT be disabled.
  assert.doesNotMatch(render(), /<button[^>]*\sdisabled=""[^>]*>[^<]*Excuse /);
});

test("excluding every branch disables the action rather than offering zero", () => {
  const html = render({
    excludedBranches: new Set([
      "BRANCH_NO_DEVICE_DATA:DIS Iconic",
      "BRANCH_NO_DEVICE_DATA:ISBB",
    ]),
  });
  // Anchored to the excuse button specifically: a bare /disabled/ match would
  // pass if the disclosure were disabled and the write button left live.
  assert.match(html, /Select a branch to excuse/);
  assert.match(html, /<button[^>]*\sdisabled=""[^>]*>[^<]*Select a branch to excuse/);
});

test("a decided flag is not counted in the action", () => {
  const html = render({
    outages: [group("DIS Iconic", [member("DI-1", [flag("a"), flag("done", "matched")])])],
  });
  assert.match(html, /Excuse 1 person · 1 flag/);
});

test("the band is collapsed on arrival", () => {
  // Thirteen branches expanded on load would be the same displacement the band
  // exists to end.
  const html = render();
  assert.ok(!html.includes(OUTAGE_CEILING_NOTE), "the expanded footer is absent");
  assert.match(html, /aria-expanded="false"/);
});

test("each branch row names its branch, its days and its size", () => {
  const html = render({
    defaultOpen: true,
    outages: [
      group("DIS Iconic", [member("DI-1", [flag("a")])], ["2026-08-03", "2026-08-04"]),
    ],
  });
  assert.match(html, /DIS Iconic/);
  assert.match(html, /2 days with no sync row/);
  assert.match(html, /1 person · 1 flag/);
});

test("the band states its own ceiling and links to device health", () => {
  const html = render({ defaultOpen: true });
  assert.ok(html.includes(OUTAGE_CEILING_NOTE));
  assert.match(html, /href="\/hr-attendance"/);
});

test("the band never names a device serial, collapsed or expanded", () => {
  assert.ok(!/serial/i.test(render()));
  assert.ok(!/serial/i.test(render({ defaultOpen: true })));
});

test("the expanded list is bounded so it cannot push the queue off screen", () => {
  // Thirteen branches is today's real count. Without a cap the band grows
  // without limit and displaces the very queue it exists to protect.
  const html = render({ defaultOpen: true });
  assert.match(html, /max-h-\[/);
  assert.match(html, /overflow-y-auto/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/ui/outageBand.test.tsx`
Expected: FAIL — `Cannot find module '@/ui/OutageBand'`

- [ ] **Step 3: Write the implementation**

Create `src/ui/OutageBand.tsx`:

```tsx
/**
 * Device outages, lifted out of the judgment queue.
 *
 * These entries answer a different question from every other row in the queue:
 * not "was this absence acceptable" but "acknowledge that the machine was
 * down". There is no evidence to weigh — `flag_grouping.py` says as much ("A
 * device outage claims the whole day, before anything else looks at it") — so
 * ranking them against a person's four-hour gap forced a comparison with no
 * answer, and made a 147-row queue out of 3 decisions.
 *
 * NOT an `AttentionStrip`: that component turns its whole header row into a
 * `<summary>` when `detail` is present, so the two buttons here would toggle
 * the disclosure instead of firing. The amber tone classes are borrowed
 * verbatim from it so the band still reads as part of the notice family.
 */
import { useState } from "react";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DEVICE_HEALTH_LABEL,
  OUTAGE_BAND_LABEL,
  OUTAGE_CEILING_NOTE,
  OUTAGE_EXCUSING_LABEL,
  UNKNOWN_BRANCH_LABEL,
  outageBranchCheckboxLabel,
  outageBandHeadline,
  outageBandSubline,
  outageBranchDays,
  outageBranchSummary,
  outageExcuseLabel,
  outageReviewLabel,
} from "@/lib/flagQueueLabels";
import {
  outageFlagCount,
  outageWrite,
  queuePeopleCount,
  type OutageGroup,
} from "@/lib/flagQueuePartition";
import { cn } from "@/lib/utils";

export type OutageBandProps = {
  outages: OutageGroup[];
  /** Keyed by `group_key`. Whole branches only — never individual people. */
  excludedBranches: ReadonlySet<string>;
  onToggleBranch: (groupKey: string) => void;
  onExcuse: (identities: string[]) => void;
  submitting?: boolean;
};

/** Every date any outage covers, ascending — the band's own range line. */
function spanOf(outages: OutageGroup[]): string[] {
  const dates = new Set<string>();
  for (const group of outages) for (const date of group.dates) dates.add(date);
  return [...dates].sort();
}

export function OutageBand(props: OutageBandProps) {
  // Collapsed by default. Thirteen branches expanded on arrival would displace
  // the queue exactly as the interleaved rows did. `defaultOpen` is a test seam:
  // renderToStaticMarkup cannot click, so the expanded assertions have no other
  // route to this state.
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  // Rendered only when there is an outage. On a healthy day the band is absent
  // entirely rather than present-and-empty, which is the whole reason this is a
  // band and not a nav item.
  if (props.outages.length === 0) return null;

  // Only the filtered write is needed. The unfiltered pass this used to keep
  // fed the headline and subline, and both now read queuePeopleCount /
  // outageFlagCount instead — running groupPayload over every branch for a
  // discarded result is pure cost.
  const write = outageWrite(props.outages, props.excludedBranches);
  const nothingToWrite = write.identities.length === 0;

  return (
    <section
      aria-label={OUTAGE_BAND_LABEL}
      className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] text-sm animate-in fade-in"
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <TriangleAlertIcon className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">
            {/* queuePeopleCount, NOT coveredEmployeeCount. This parameter is
                "everyone the outage touched" and its docstring forbids the
                covered count by name: covered counts only members with an
                undecided flag, so it equals the button's number on load (making
                the word "affected" do nothing) and falls to "0 people affected"
                once the outage is excused — a false statement of history. */}
            {outageBandHeadline(props.outages.length, queuePeopleCount(props.outages))}
          </div>
          <div className="text-xs text-muted-foreground">
            {outageBandSubline(spanOf(props.outages), outageFlagCount(props.outages))}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          // aria-expanded only. aria-controls must reference an element that
          // EXISTS, and this panel is conditionally rendered — pointing at an
          // absent id is what automated a11y audits flag, and it buys nothing
          // over aria-expanded, which already announces the state. Keeping the
          // panel permanently mounted just to satisfy the attribute would put
          // thirteen branch rows in the accessibility tree at all times.
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {outageReviewLabel(props.outages.length)}
          <ChevronRightIcon
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
        </Button>
        <Button
          size="sm"
          className="shrink-0"
          disabled={nothingToWrite || props.submitting}
          onClick={() => props.onExcuse(write.identities)}
        >
          {props.submitting
            ? OUTAGE_EXCUSING_LABEL
            : outageExcuseLabel(
                write.coveredEmployeeCount,
                write.identities.length,
                write.branchCount,
              )}
        </Button>
      </div>

      {open ? (
        <div className="border-t border-amber-500/25 px-3 py-2">
          {/* Bounded on purpose. Thirteen branches is today's real count, and an
              unbounded list would push the queue below the fold — the exact
              failure this band exists to prevent. */}
          <ul className="max-h-[13rem] space-y-0.5 overflow-y-auto overscroll-contain">
            {props.outages.map((group) => {
              const included = !props.excludedBranches.has(group.group_key);
              const branch = group.branch ?? UNKNOWN_BRANCH_LABEL;
              const size = outageWrite([group], new Set<string>());
              return (
                <li key={group.group_key}>
                  {/* The whole row is the hit target. A bare size-4 checkbox is
                      16px, under WCAG 2.2 SC 2.5.8's 24px floor, and thirteen of
                      them in a scroller is the strongest mis-click surface here
                      — a missed toggle silently changes what the button above
                      writes, with no second confirmation inside this component. */}
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 hover:bg-amber-500/10",
                      !included && "opacity-50",
                    )}
                  >
                    <Checkbox
                      checked={included}
                      onCheckedChange={() => props.onToggleBranch(group.group_key)}
                      aria-label={outageBranchCheckboxLabel(branch)}
                    />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    {branch}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {outageBranchDays(group.day_count)}
                  </span>
                  <span className="w-40 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {outageBranchSummary(queuePeopleCount([group]), outageFlagCount([group]))}
                  </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 border-t border-amber-500/25 pt-2 text-[11px] text-muted-foreground">
            {OUTAGE_CEILING_NOTE}{" "}
            {/* <Link>, not <a>: /hr-attendance is a client route (main.tsx:27),
                and a bare anchor forces a full document reload that throws away
                the queue's in-flight state. HrAppShell.test.tsx pins this same
                rule after the identical mistake was removed there. It still
                renders href="/hr-attendance", so the assertion is unchanged —
                but the test now needs a MemoryRouter wrapper, because <Link>
                throws outside a router. */}
            <Link to="/hr-attendance" className="font-medium text-primary underline-offset-2 hover:underline">
              {DEVICE_HEALTH_LABEL}
            </Link>
          </p>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/ui/outageBand.test.tsx`
Expected: PASS, 15 tests.

- [ ] **Step 5: Run the full unit suite and typecheck**

Run: `npm run test:web && npm run typecheck`
Expected: both clean; total test count up by 12 for this file, plus the 3 from Step 0.

- [ ] **Step 6: Commit**

```bash
git add src/ui/OutageBand.tsx src/ui/outageBand.test.tsx
git commit -m "feat(flag-queue): a band for the outages, so the queue holds judgments"
```

---

## Task 4: Wire the band into the page

**Files:**
- Modify: `src/ui/FlagQueuePage.tsx`
- Modify: `src/ui/flagQueuePage.test.tsx`

**Interfaces:**
- Consumes: `OutageBand` (Task 3), `partitionQueue` / `queuePeopleCount` / `outageWrite` (Task 1), `queueSplitDescription` (Task 2).
- Produces: `FlagQueueViewProps` gains `outages: OutageGroup[]`, `excludedBranches: ReadonlySet<string>`, `onToggleBranch: (groupKey: string) => void`, `onExcuseOutages: (identities: string[]) => void`, and `queuePeople: number`. `counts` stays for `truncated` and `decided`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/flagQueuePage.test.tsx`:

```tsx
test("an outage group is rendered as the band, not as a queue row", () => {
  const outageGroup: GroupEntry = {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: "BRANCH_NO_DEVICE_DATA:DIS Iconic",
    branch: "DIS Iconic",
    flag_code: null,
    attendance_date: null,
    dates: [DATE],
    day_count: 1,
    rank: 134,
    tier: "act",
    members: [patternMember({ employee: "DI-1", name: "Ada Lovelace" })],
  };
  const person = missingTimePerson();

  const { outages, queue } = partitionQueue([outageGroup, person]);

  assert.equal(outages.length, 1);
  assert.deepEqual(queue, [person]);

  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      counts={{ open: 5, needs_re_review: 0, decided: 0, people: 2, rows: 2, open_capped: false }}
      outages={outages}
      queuePeople={1}
      queueRows={1}
      excludedBranches={new Set()}
      onToggleBranch={() => {}}
      onExcuseOutages={() => {}}
      list={<FlagQueueList {...listProps()} entries={queue} />}
    />,
  );

  assert.match(html, /had no device data/, "the band states the outage");
  assert.equal(
    rowButtons(html).filter((row) => /had no device data/.test(row)).length,
    0,
    "and no queue row does",
  );
});

test("the header separates people waiting on HR from people waiting on a device", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      counts={{ open: 9, needs_re_review: 0, decided: 0, people: 5, rows: 2, open_capped: false }}
      outages={[]}
      queuePeople={5}
      queueRows={2}
      excludedBranches={new Set()}
      onToggleBranch={() => {}}
      onExcuseOutages={() => {}}
    />,
  );
  assert.match(html, /5 people need a decision/);
  assert.ok(!/waiting on a device fault/.test(html), "no outages, no device line");
});
```

Add `partitionQueue` to the test file's imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/ui/flagQueuePage.test.tsx`
Expected: FAIL — `FlagQueueView` has no `outages` prop.

- [ ] **Step 3: Add the state and partition to `FlagQueuePage`**

In `FlagQueuePage`, after the `useFlagQueue` call (currently around line 235):

```tsx
  // The queue holds judgments; outages are a precondition and live in a band.
  // Partitioned here rather than in the list so the header can count the two
  // populations separately — "389 people" counted 256 who are waiting on a
  // machine, not on HR.
  const { outages, queue } = useMemo(() => partitionQueue(entries), [entries]);
  const queuePeople = useMemo(() => queuePeopleCount(queue), [queue]);

  const [excludedBranches, setExcludedBranches] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const handleToggleBranch = useCallback((groupKey: string) => {
    setExcludedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  // groupKey: null — the server mints a fresh AFD-<hash> per call. Passing the
  // band's own key would make reverse_decision_group undo every device-fault
  // decision ever recorded for those branches.
  const handleExcuseOutages = useCallback(
    (identities: string[]) => {
      if (identities.length === 0) return;
      decide.mutate({
        identities,
        decision: { outcome: "EXCUSED", reason: "DEVICE_OR_DATA_FAULT", note: "" },
        groupKey: null,
      });
    },
    [decide],
  );
```

`handleExcuseOutages` must be declared **after** the `decide` mutation. Move it below if the ordering complains.

- [ ] **Step 4: Pass the band through to the view**

Replace `entries={entries}` in the `FlagQueueList` element with `entries={queue}`, and add to the `FlagQueueView` element:

```tsx
        outages={outages}
        queuePeople={queuePeople}
        queueRows={queue.length}
        excludedBranches={excludedBranches}
        onToggleBranch={handleToggleBranch}
        onExcuseOutages={handleExcuseOutages}
```

- [ ] **Step 5: Render the band in `FlagQueueView`**

Add to `FlagQueueViewProps`:

```tsx
  /** Device outages, partitioned out of the queue. Empty on a healthy day. */
  outages: OutageGroup[];
  /** Distinct people in the judgment queue — NOT `counts.people`, which includes outage members. */
  queuePeople: number;
  /** Top-level rows in the judgment queue — NOT `counts.rows`, which counts the
   *  outage groups too. This is `partitionQueue(...).queue.length`. */
  queueRows: number;
  excludedBranches: ReadonlySet<string>;
  onToggleBranch: (groupKey: string) => void;
  onExcuseOutages: (identities: string[]) => void;
```

Change the `PageHeader` description to:

```tsx
        description={counts ? queueSplitDescription(props.queuePeople, props.queueRows, outagePeople) : "Loading…"}
```

with, above the `return`:

```tsx
  // Read from the band's own arithmetic rather than counts.people, which counts
  // both populations together and so cannot answer either question.
  const outagePeople = outageWrite(props.outages, new Set<string>()).coveredEmployeeCount;
```

Then render the band immediately after `</PageHeader>`, before the `writeFailure` strip:

```tsx
      <OutageBand
        outages={props.outages}
        excludedBranches={props.excludedBranches}
        onToggleBranch={props.onToggleBranch}
        onExcuse={props.onExcuseOutages}
      />
```

- [ ] **Step 6: Run tests**

Run: `npx tsx --test src/ui/flagQueuePage.test.tsx && npm run typecheck`
Expected: PASS. Existing tests that pass no `outages` prop will fail to typecheck — give every existing `FlagQueueView` call site in the test file the five new props via a shared helper, extending the existing `viewProps()` function rather than editing each call.

- [ ] **Step 7: Mutation-test the partition wiring**

Temporarily change `entries={queue}` back to `entries={entries}`. Run `npx tsx --test src/ui/flagQueuePage.test.tsx`.
Expected: FAIL on "an outage group is rendered as the band, not as a queue row". Revert.

- [ ] **Step 8: Commit**

```bash
git add src/ui/FlagQueuePage.tsx src/ui/flagQueuePage.test.tsx
git commit -m "feat(flag-queue): the queue stops carrying acknowledgements"
```

---

## Task 5: The chrome — one toolbar row, and the width

**Files:**
- Modify: `src/ui/FlagQueuePage.tsx` (the `PageHeader` block, currently lines 654–755)
- Modify: `src/ui/flagQueuePage.test.tsx`

**Interfaces:**
- Consumes: `queueSplitDescription` (Task 2), the band props (Task 4).
- Produces: `CountChip` is deleted. `openCountLabel` / `openCountAria` keep their exports (still used by the capped control in Task 6).

Target: 297px → ~120px. Removes the title/description band's second line, the stacked control labels, the permanent capped strip, and the three count chips.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/flagQueuePage.test.tsx`:

```tsx
test("the page gives up the reading-width cap — it is a list, not prose", () => {
  const html = renderToStaticMarkup(<FlagQueueView {...viewProps()} counts={null} />);
  assert.match(html, /max-w-none/, "1216px of 1512 was 296px thrown away");
});

test("the two permanently-zero counts are gone from the toolbar", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      counts={{ open: 12, needs_re_review: 0, decided: 0, people: 4, rows: 4, open_capped: false }}
    />,
  );
  assert.ok(!/Needs re-review/.test(html), "it reads 0 on every day so far");
  assert.ok(!/Queue counts/.test(html), "the chip group is gone");
});

test("Decided survives the chip cull — it is the only one that ever did anything", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      counts={{ open: 12, needs_re_review: 0, decided: 7, people: 4, rows: 4, open_capped: false }}
    />,
  );
  assert.match(html, /Decided/);
  assert.match(html, /aria-pressed="false"/);
});

test("the date controls carry accessible names without spending a row on labels", () => {
  const html = renderToStaticMarkup(<FlagQueueView {...viewProps()} counts={null} />);
  assert.match(html, /aria-label="From"/);
  assert.match(html, /aria-label="To"/);
  assert.match(html, /aria-label="Consequence"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/ui/flagQueuePage.test.tsx`
Expected: FAIL on all four.

- [ ] **Step 3: Rebuild the header**

Replace the whole `<PageHeader …>…</PageHeader>` block with:

```tsx
      <PageHeader
        title="Flags"
        description={counts ? queueSplitDescription(props.queuePeople, props.queueRows, outagePeople) : "Loading…"}
        actions={
          // One row, inline, no stacked labels. The three controls previously
          // cost 62px because each carried a <Label> above it; the accessible
          // name moves onto the control itself, which is where a screen reader
          // reads it from anyway.
          <div className="flex flex-wrap items-center gap-2">
            <DatePickerInput
              aria-label="From"
              value={props.range.startDate}
              max={parseISO(props.range.endDate)}
              onChange={(value) => props.onRangeChange({ ...props.range, startDate: value })}
              className="w-36"
            />
            <span className="text-muted-foreground" aria-hidden="true">–</span>
            <DatePickerInput
              aria-label="To"
              value={props.range.endDate}
              min={parseISO(props.range.startDate)}
              onChange={(value) => props.onRangeChange({ ...props.range, endDate: value })}
              className="w-36"
            />
            <select
              aria-label="Consequence"
              value={props.tier ?? ""}
              onChange={(event) => props.onTierChange(parseTierParam(event.target.value))}
              className="h-10 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">{TIER_FILTER_ALL_LABEL}</option>
              {TIER_VALUES.map((value) => (
                <option key={value} value={value}>
                  {tierLabel(value)}
                </option>
              ))}
            </select>
            {/* The one count that was ever a control. Open and Needs re-review
                reported the size of the job and could not be pressed; Open has
                moved into the description line and Needs re-review has read 0
                on every day of this queue's life. */}
            <button
              type="button"
              aria-pressed={props.includeDecided ?? false}
              onClick={props.onToggleDecided}
              className={cn(
                "flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors",
                props.includeDecided
                  ? "border-primary/30 bg-primary/5 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {DECIDED_TOGGLE_LABEL}
              <span className="tabular-nums text-foreground">{counts?.decided ?? 0}</span>
            </button>
          </div>
        }
      >
        {props.includeDecided ? (
          <p className="text-xs text-muted-foreground">{SHOWING_DECIDED_MESSAGE}</p>
        ) : null}

        {orphanLines.length > 0 ? (
          <div className="space-y-0.5">
            {orphanLines.map((line) => (
              <p key={line} className="text-xs text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </PageHeader>
```

Delete the `CountChip` function at the bottom of the file, its `openCountLabel` / `openCountAria` imports **only if** nothing else uses them (Task 6 reintroduces one), and the `Label` import if now unused.

- [ ] **Step 4: Drop the width cap**

Change `<Page>` to:

```tsx
    <Page className="max-w-none">
```

with a comment above it:

```tsx
    {/* max-w-none: dewey-ui's Page caps at max-w-7xl so "pages across both apps
        share the same content width", which is right for a form and wrong here.
        At 1512 the cap plus padding threw away 296px; at 1920, 704px — 36.7% of
        the monitor — on the one page where width converts directly into rows
        that stop truncating. cn() is twMerge, so this beats the default. */}
```

- [ ] **Step 5: Teach `DatePickerInput` to carry an invisible name**

It does **not** spread extra props today — it renders `label` into a visible `<Label htmlFor>` and passes nothing else through, so `aria-label` on the JSX would be silently dropped and the three controls would reach a screen reader unnamed. Its trigger is also `h-10`, not `h-9`; match that in the toolbar or the row will be ragged.

Add to `DatePickerInputProps` in `src/components/ui/date-picker-input.tsx`:

```tsx
  /**
   * Accessible name when there is no visible <Label>. The flag queue's toolbar
   * puts three of these on one row and cannot spend 22px of label above each;
   * the name moves onto the control, which is where a screen reader reads it
   * from in either case. Ignored when `label` is set — a visible label already
   * names the control, and two names is worse than one.
   */
  ariaLabel?: string;
```

and on the trigger `<Button>`:

```tsx
            aria-label={props.label ? undefined : props.ariaLabel}
```

Then in `FlagQueuePage`, use `ariaLabel="From"` / `ariaLabel="To"` rather than `aria-label`, and change the two `className="w-36"` values to `className="w-36 space-y-0"` so the label-less control does not keep the `space-y-1.5` gap meant for a label that is not there.

The existing `label` prop keeps working untouched — `WeeklySchedulePage` and the schedule import page both use it.

Update the Step 1 test to match the real DOM:

```tsx
test("the date controls carry accessible names without spending a row on labels", () => {
  const html = renderToStaticMarkup(<FlagQueueView {...viewProps()} counts={null} />);
  assert.match(html, /aria-label="From"/);
  assert.match(html, /aria-label="To"/);
  assert.match(html, /aria-label="Consequence"/);
  assert.ok(!/class="text-xs"[^>]*>From</.test(html), "no visible label row");
});
```

- [ ] **Step 6: Run tests**

Run: `npm run test:web && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Measure the result**

Run `npm run dev`, open `/hr-flags`, and in the console:

```js
const p = document.querySelector('[data-slot="page"]');
const list = document.querySelector('ul[aria-label="Flag queue"]');
({ chrome: Math.round(list.getBoundingClientRect().top), contentW: Math.round(p.getBoundingClientRect().width) })
```

Expected: `chrome` ≤ 140 (was 297), `contentW` ≈ viewport − 64 (was capped at 1280).
**Record both numbers in the commit message.** If `chrome` is above 140, find the band still costing height before moving on.

- [ ] **Step 8: Commit**

```bash
git add src/ui/FlagQueuePage.tsx src/ui/flagQueuePage.test.tsx
git commit -m "fix(flag-queue): the page stops spending half its height on chrome

Chrome above the first row: 297px -> <measured>px.
Content width: 1216px -> <measured>px."
```

---

## Task 6: The capped notice becomes a control, and loading becomes skeleton rows

**Files:**
- Modify: `src/ui/FlagQueuePage.tsx`
- Modify: `src/lib/flagQueueLabels.ts`
- Modify: `src/ui/flagQueuePage.test.tsx`

**Interfaces:**
- Produces: `cappedHeadline(open: number): string`, `CAPPED_EXPLAINER: string`, `NOTHING_WAITING_TITLE: string`, `nothingWaitingDetail(startDate: string, endDate: string): string`, `showDecidedLabel(count: number): string` in `flagQueueLabels.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/flagQueuePage.test.tsx`:

```tsx
test("the capped notice offers narrower ranges instead of naming levers", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      truncated
      counts={{ open: 5000, needs_re_review: 0, decided: 0, people: 389, rows: 147, open_capped: true }}
    />,
  );
  assert.match(html, /Showing the newest 5,000 flags/);
  assert.match(html, /Last 7 days/);
  assert.match(html, /Last 3 days/);
});

test("an uncapped queue shows no capped notice at all", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      truncated={false}
      counts={{ open: 12, needs_re_review: 0, decided: 0, people: 4, rows: 4, open_capped: false }}
    />,
  );
  assert.ok(!/Showing the newest/.test(html));
});

test("loading renders skeleton rows, so the layout does not jump when data lands", () => {
  const html = renderToStaticMarkup(<FlagQueueView {...viewProps()} isLoading counts={null} />);
  assert.match(html, /animate-pulse/);
  assert.ok(!/Loading flags…/.test(html), "a centred spinner reflows the whole pane");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/ui/flagQueuePage.test.tsx`
Expected: FAIL on all three.

- [ ] **Step 3: Add the copy**

Append to `src/lib/flagQueueLabels.ts`:

```ts
/**
 * The capped notice, as a control rather than a lecture.
 *
 * The old copy named two levers ("narrow the dates, or filter by consequence")
 * and offered neither, in the loudest colour on the page, on a queue where
 * capping is structural and therefore never clears. A permanent unactionable
 * warning teaches people to skip that colour.
 */
export function cappedHeadline(open: number): string {
  return `Showing the newest ${open.toLocaleString("en-US")} flags`;
}

export const CAPPED_EXPLAINER =
  "Older days in this range aren't loaded. Narrow the dates to reach them.";

export const NOTHING_WAITING_TITLE = "Nothing waiting";

export function nothingWaitingDetail(startDate: string, endDate: string): string {
  return `Every flag between ${formatFlagContextDate(startDate)} and ${formatFlagContextDate(endDate)} has a decision.`;
}

export function showDecidedLabel(count: number): string {
  return `Show the ${count} decided`;
}
```

`formatFlagContextDate` lives in `@/lib/flagDetails`; import it at the top of `flagQueueLabels.ts` if it is not already there. If that creates a cycle, inline the same `format(parseDateKey(key), "d MMM")` call this module already uses in `dateSpanLabel`.

- [ ] **Step 4: Replace the truncated strip**

Replace the `props.truncated ? <AttentionStrip …>` block with:

```tsx
      {/* Only when capping is actually reachable by the user. The levers are
          buttons now: the old copy told HR to narrow a range while the strip
          offered no way to do it. */}
      {props.truncated && counts ? (
        <AttentionStrip
          tone="amber"
          icon={<TriangleAlertIcon className="size-4 text-amber-600" aria-hidden="true" />}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{cappedHeadline(counts.open)}</span>{" "}
              <span className="text-muted-foreground">{CAPPED_EXPLAINER}</span>
            </span>
            {[7, 3].map((days) => (
              <Button
                key={days}
                size="sm"
                variant="outline"
                onClick={() => props.onNarrowRange(days)}
              >
                {narrowRangeLabel(days)}
              </Button>
            ))}
          </span>
        </AttentionStrip>
      ) : null}
```

Add `onNarrowRange: (days: number) => void` to `FlagQueueViewProps`, and in `FlagQueuePage`:

```tsx
  // Trims from the START, matching clampRange: the recent end is the work that
  // matters, so a narrower window gives up its oldest days, never today's.
  const handleNarrowRange = useCallback(
    (days: number) => {
      const end = parseISO(requestedRange.endDate);
      setRange({
        startDate: format(subDays(end, days - 1), "yyyy-MM-dd"),
        endDate: requestedRange.endDate,
      });
    },
    [requestedRange.endDate, setRange],
  );
```

- [ ] **Step 5: Replace the loading state**

Replace `<EmptyState icon={Spinner} title="Loading flags…" />` with:

```tsx
          // Skeleton rows at the row's real height, not a centred spinner: the
          // spinner sits in the middle of an empty pane and every row jumps into
          // place when data lands. These hold the layout still.
          <div className="space-y-1" aria-busy="true" aria-label="Loading flags">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="flex animate-pulse items-center gap-2 px-2.5 py-2">
                <div className="size-10 shrink-0 rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3.5 w-1/3 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
                <div className="h-[17px] w-[117px] shrink-0 rounded bg-muted" />
              </div>
            ))}
          </div>
```

- [ ] **Step 6: Update the empty state**

In `FlagQueueList`, replace the `ordered.length === 0` early return's text with the new copy, and have `FlagQueuePage` pass `decided` so it can offer the toggle. Simplest: leave `FlagQueueList`'s fallback as a plain sentence and render the richer empty state in `FlagQueueView` when `props.queuePeople === 0 && props.outages.length === 0 && !props.isLoading && !props.error`:

```tsx
          <EmptyState
            icon={CheckIcon}
            title={NOTHING_WAITING_TITLE}
            description={nothingWaitingDetail(props.range.startDate, props.range.endDate)}
            className="border-none"
          />
```

with a `Show the N decided` button beneath it when `counts?.decided` is non-zero, wired to `props.onToggleDecided`.

- [ ] **Step 7: Run tests**

Run: `npm run test:web && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Build and commit the bundle**

```bash
npm run build
git add src/ui/FlagQueuePage.tsx src/ui/FlagQueueList.tsx src/lib/flagQueueLabels.ts src/ui/flagQueuePage.test.tsx ../../public
git commit -m "fix(flag-queue): the capped notice becomes a control, loading stops reflowing"
```

`npm run build` also runs `check-fonts.mjs`; if it exits non-zero, stop and fix — it means a woff2 referenced by CSS was not emitted.

---

## Task 7: Phase 1 e2e

**Files:**
- Modify: `e2e/flags.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.

- [ ] **Step 1: Write the failing tests**

Append to `e2e/flags.spec.ts`. Build the payload by copying the shape of the existing `queuePayload` literal in the first test (it already carries every required field) and adding a `BRANCH_NO_DEVICE_DATA` group beside a **branchless** person row:

```ts
test("an outage becomes a band, and the queue counts only judgments", async ({ page }) => {
  const queuePayload = {
    entries: [
      {
        kind: "group",
        group_type: "BRANCH_NO_DEVICE_DATA",
        group_key: "BRANCH_NO_DEVICE_DATA:DIS Iconic",
        branch: "DIS Iconic",
        flag_code: null,
        attendance_date: null,
        dates: ["2026-08-03", "2026-08-04"],
        day_count: 2,
        rank: 134,
        tier: "act",
        members: [
          {
            entry_key: "BRANCH_NO_DEVICE_DATA:DIS Iconic|p:DI-1",
            employee: "DI-1",
            employee_name: "Ada Lovelace",
            employee_branch: "DIS Iconic",
            employee_image: null,
            attendance_date: "2026-08-03",
            dates: ["2026-08-03"],
            rank: 134,
            tier: "act",
            flags: [
              {
                flag_identity: "f-outage-1",
                flag_code: "MISSING_TIME",
                attendance_date: "2026-08-03",
                day_closed: 1,
                evidence: { minutes: 240 },
                rank: 134,
                tier: "act",
                decision_state: "undecided",
                decision: null,
              } satisfies FlagOut,
            ],
            undecided_count: 1,
            also_count: 0,
            also_outlier_count: 0,
          } satisfies QueuePerson,
        ],
      },
      {
        kind: "person",
        entry_key: "p:DI-0197",
        employee: "DI-0197",
        employee_name: "Tha Pel",
        // Branchless — today's real shape. Must stay in the queue.
        employee_branch: null,
        employee_image: null,
        attendance_date: "2026-08-03",
        dates: ["2026-08-03"],
        rank: 134,
        tier: "act",
        flags: [
          {
            flag_identity: "f-person-1",
            flag_code: "MISSING_TIME",
            attendance_date: "2026-08-03",
            day_closed: 1,
            evidence: { minutes: 255 },
            rank: 134,
            tier: "act",
            decision_state: "undecided",
            decision: null,
          } satisfies FlagOut,
        ],
        undecided_count: 1,
        also_count: 0,
        also_outlier_count: 0,
      },
    ] satisfies QueueEntry[],
    counts: { open: 2, needs_re_review: 0, decided: 0, people: 2, rows: 2, open_capped: false },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    outage_dates: [
      { branch: "DIS Iconic", date: "2026-08-03" },
      { branch: "DIS Iconic", date: "2026-08-04" },
    ],
    truncated: false,
    start_date: "2026-07-26",
    end_date: "2026-08-08",
  } satisfies QueuePayload;

  await stubFrappe(page, { queue: queuePayload });
  await page.goto("/hr-flags");

  const band = page.getByRole("region", { name: "Device outages" });
  await expect(band).toContainText("1 branch had no device data");
  await expect(band).toContainText("1 person");

  // The branchless person stays in the queue; the outage does not.
  const rows = page.getByRole("list", { name: "Flag queue" }).getByRole("button");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Tha Pel");

  await expect(page.getByText("1 need a decision · 1 waiting on a device fault")).toBeVisible();
});

test("unchecking a branch takes its people out of the excuse", async ({ page }) => {
  // Same payload as above, with a second branch added.
  // ... (build two BRANCH_NO_DEVICE_DATA groups, one person each)
  await page.getByRole("button", { name: /^Review 2/ }).click();
  await expect(page.getByRole("button", { name: "Excuse 2 people · 2 flags" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Include ISBB" }).click();
  await expect(page.getByRole("button", { name: "Excuse 1 person · 1 flag" })).toBeVisible();
});

test("the keyboard model survives the band", async ({ page }) => {
  // The band adds focusable controls ABOVE the list. The roving tabindex must
  // still put exactly one row in the tab order, and the arrows must still move
  // within the list only.
  // Reuse the two-entry payload from the first test.
  await page.goto("/hr-flags");
  const list = page.getByRole("list", { name: "Flag queue" });
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list.locator("button[tabindex='0']")).toHaveCount(1);
});
```

Check `e2e/fixtures.ts` for `stubFrappe`'s signature before writing these; if it does not accept a `queue` override, add one following the pattern the existing tests use to vary payloads.

The second test's payload is the first test's with one more group. Written out rather than referenced, because tasks are read out of order:

```ts
      {
        kind: "group",
        group_type: "BRANCH_NO_DEVICE_DATA",
        group_key: "BRANCH_NO_DEVICE_DATA:ISBB",
        branch: "ISBB",
        flag_code: null,
        attendance_date: null,
        dates: ["2026-08-03"],
        day_count: 1,
        rank: 134,
        tier: "act",
        members: [
          {
            entry_key: "BRANCH_NO_DEVICE_DATA:ISBB|p:DI-2",
            employee: "DI-2",
            employee_name: "Grace Hopper",
            employee_branch: "ISBB",
            employee_image: null,
            attendance_date: "2026-08-03",
            dates: ["2026-08-03"],
            rank: 134,
            tier: "act",
            flags: [
              {
                flag_identity: "f-outage-2",
                flag_code: "MISSING_TIME",
                attendance_date: "2026-08-03",
                day_closed: 1,
                evidence: { minutes: 210 },
                rank: 134,
                tier: "act",
                decision_state: "undecided",
                decision: null,
              } satisfies FlagOut,
            ],
            undecided_count: 1,
            also_count: 0,
            also_outlier_count: 0,
          } satisfies QueuePerson,
        ],
      },
```

The third test reuses the first test's payload verbatim.

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test e2e/flags.spec.ts -g "outage" --project=desktop`
Expected: FAIL.

- [ ] **Step 3: Fix whatever the tests surface**

No new production code should be needed — these prove Tasks 1–6. If a test fails for a real reason, fix the production code, not the test.

- [ ] **Step 4: Run the whole suite**

Run: `npm run test:e2e && npm run test:web && npm run typecheck`
Expected: all pass. **Record the three counts.**

- [ ] **Step 5: Confirm Python is untouched**

From the repo root: `python3.13 -m unittest discover -s dewey_time/tests -t .`
Expected: 606 tests, all pass.

- [ ] **Step 6: Commit**

```bash
git add e2e/flags.spec.ts
git commit -m "test(e2e): the band excuses by branch, and the keyboard model survives it"
```

---

# Phase 2 — the panel

## Task 8: Worst flag in full, the rest as one-liners

**Files:**
- Modify: `src/ui/FlagDecisionPanel.tsx`
- Modify: `src/ui/flagQueuePage.test.tsx`

**Interfaces:**
- Consumes: `remainingIdentities`, `flagIdentities` from `@/lib/flagDecisionState`.
- Produces: `PersonDecision` renders one `FlagCard` plus a `FlagOneLiner` list. New local component `FlagOneLiner`. `FlagDecisionPanelProps` gains `expandedIdentity: string | null` and `onExpandFlag: (identity: string | null) => void`, both owned by `FlagQueuePage` alongside `activeIdentity`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/flagQueuePage.test.tsx`:

```tsx
function fourteenFlagPerson(): PersonEntry {
  const flags = Array.from({ length: 14 }, (_, index) =>
    makeFlag({
      identity: `f-${index}`,
      code: "MISSING_TIME",
      rank: 134,
      tier: "act",
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      evidence: { minutes: 240 - index * 5 },
    }),
  );
  return {
    kind: "person",
    entry_key: "p:DI-9",
    employee: "DI-9",
    employee_name: "Sreylak Min",
    employee_branch: "Toul Kork",
    employee_image: null,
    attendance_date: "2026-08-01",
    dates: flags.map((f) => f.attendance_date),
    rank: 134,
    tier: "act",
    flags,
    undecided_count: 14,
    also_count: 0,
    also_outlier_count: 0,
  };
}

test("a fourteen-flag person renders ONE full card, not fourteen", () => {
  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: fourteenFlagPerson() })} />,
  );
  // The generic per-code explainer is the tell: it belongs to the code, not the
  // flag, and rendering it fourteen times is most of the 5,069px.
  const explainers = html.split("on-shift gap of at least 30 minutes").length - 1;
  assert.equal(explainers, 1, `the explainer rendered ${explainers} times`);
});

test("the other thirteen are still individually reachable", () => {
  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: fourteenFlagPerson() })} />,
  );
  assert.equal(html.split(">decide<").length - 1, 13);
});

test("expanding a one-liner promotes it to the full card", () => {
  const html = renderToStaticMarkup(
    <FlagDecisionPanel
      {...panelProps({ entry: fourteenFlagPerson() })}
      expandedIdentity="f-5"
    />,
  );
  const explainers = html.split("on-shift gap of at least 30 minutes").length - 1;
  assert.equal(explainers, 2, "the worst one, plus the one asked for");
});

test("a person with a single flag renders no one-liner list", () => {
  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: missingTimePerson() })} />,
  );
  assert.ok(!/>decide</.test(html));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/ui/flagQueuePage.test.tsx`
Expected: FAIL — 14 explainers, 0 `decide` links.

- [ ] **Step 3: Implement**

In `PersonDecision`, replace the `person.flags.map(...)` block with:

```tsx
      {/* The worst flag in full, the rest as one-liners.
          The path through a multi-flag person is: read the worst one, decide it,
          then "same reason applies" to the remainder — which is what
          remainingIdentities and applyToRemainingLabel are already for. Fourteen
          full cards rendered the same per-code explainer fourteen times and
          restated each flag's own numbers twice (prose, then a facts table), for
          5,069px in a 345px pane. Nothing is removed here except repetition:
          every flag is still individually decidable through its one-liner. */}
      <FlagCard
        key={worst.flag_identity}
        flag={worst}
        dateKey={worst.attendance_date}
        open={props.activeIdentity === worst.flag_identity}
        draft={props.draft}
        onDraftChange={props.onDraftChange}
        onOpen={() => props.onOpenFlag(worst.flag_identity)}
        onClose={() => props.onOpenFlag(null)}
        lastDecision={props.lastDecision}
        onSubmit={props.onSubmit}
        submitting={props.submitting}
      />

      {rest.length > 0 ? (
        <section className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            {restHeading(rest)}
          </div>
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {rest.map((flag) =>
              props.expandedIdentity === flag.flag_identity ? (
                <li key={flag.flag_identity} className="p-1.5">
                  <FlagCard
                    flag={flag}
                    dateKey={flag.attendance_date}
                    open={props.activeIdentity === flag.flag_identity}
                    draft={props.draft}
                    onDraftChange={props.onDraftChange}
                    onOpen={() => props.onOpenFlag(flag.flag_identity)}
                    onClose={() => props.onOpenFlag(null)}
                    lastDecision={props.lastDecision}
                    onSubmit={props.onSubmit}
                    submitting={props.submitting}
                  />
                </li>
              ) : (
                <li key={flag.flag_identity}>
                  <FlagOneLiner
                    flag={flag}
                    onExpand={() => props.onExpandFlag(flag.flag_identity)}
                  />
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}
```

with, above the `return`:

```tsx
  const [worst, ...rest] = person.flags;
```

and a new local component plus heading helper:

```tsx
/** One flag, compressed to what distinguishes it from its siblings: the day and
 *  the magnitude. Everything else on a full card is either identical across the
 *  set (the per-code explainer) or a second telling of these same two numbers. */
function FlagOneLiner(props: { flag: FlagOut; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onExpand}
      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/40"
    >
      <span className="w-14 shrink-0 text-muted-foreground tabular-nums">
        {flagDayLabel(props.flag.attendance_date)}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {formatFlagLabel(props.flag.flag_code, parseFlagEvidence(props.flag.evidence))}
      </span>
      {props.flag.decision_state !== "undecided" ? (
        <Badge variant="outline" className="shrink-0 rounded-md text-[10px]">
          {decisionStateLabel(props.flag.decision_state)}
        </Badge>
      ) : null}
      <span className="shrink-0 text-[11px] font-medium text-primary">{DECIDE_ONE_LABEL}</span>
    </button>
  );
}
```

Add `restHeading` to `flagQueueLabels.ts`:

```ts
/** "The other 13 — all missing time", or "— mixed findings" when they differ. */
export function restHeading(rest: FlagOut[]): string {
  const codes = new Set(rest.map((flag) => flag.flag_code));
  const count = `The other ${rest.length}`;
  if (codes.size !== 1) return `${count} — mixed findings`;
  return `${count} — all ${flagSummaryNoun([...codes][0])}`;
}
```

Reuse whatever noun helper `flagSummary` already provides rather than adding a second vocabulary; if none fits, return `${count} — all ${formatFlagLabel([...codes][0], {})}`.

- [ ] **Step 4: Thread the new props**

Add to `FlagDecisionPanelProps`:

```tsx
  /** Which of the compressed flags has been promoted to a full card. */
  expandedIdentity: string | null;
  onExpandFlag: (identity: string | null) => void;
```

In `FlagQueuePage`, add `const [expandedIdentity, setExpandedIdentity] = useState<string | null>(null);`, pass both, and **reset it in `resetRowState`** alongside `activeIdentity` — a promoted flag belonging to the previous person must not survive a selection change. Also reset it in the focus-restore effect, next to `setActiveIdentity(null)`.

- [ ] **Step 5: Run tests**

Run: `npm run test:web && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Prove the reset in e2e, where the state machine is reachable**

`resetRowState` cannot be reached from `renderToStaticMarkup`, so this belongs in Playwright. Extend the **existing** test `"the next row's form is empty after a decide, not pre-filled with the last one's"` in `e2e/flags.spec.ts`: before deciding, promote one of the person's compressed flags, then after the decide lands assert the next person's panel shows no promoted card.

Add to that test, after the row is selected and before the decide is submitted:

```ts
  // Promote a compressed flag, so the reset has something to clear.
  await page.getByRole("button", { name: /decide$/ }).first().click();
  await expect(page.getByRole("group", { name: "Outcome" })).toHaveCount(2);
```

and after the refetch has landed:

```ts
  // One Outcome group again: the promoted flag belonged to the person who just
  // left the queue, and must not arrive open on the next person's panel.
  await expect(page.getByRole("group", { name: "Outcome" })).toHaveCount(1);
```

- [ ] **Step 7: Mutation-test the reset**

Temporarily remove `setExpandedIdentity(null)` from `resetRowState`.

Run: `npx playwright test e2e/flags.spec.ts -g "not pre-filled" --project=desktop`
Expected: FAIL on the final `toHaveCount(1)`.

Restore the line, re-run, and confirm it passes. Then `grep -n "setExpandedIdentity(null)" src/ui/FlagQueuePage.tsx` — expect **two** hits, `resetRowState` and the focus-restore effect.

- [ ] **Step 8: Commit**

```bash
git add src/ui/FlagDecisionPanel.tsx src/ui/FlagQueuePage.tsx src/lib/flagQueueLabels.ts \
        src/ui/flagQueuePage.test.tsx e2e/flags.spec.ts
git commit -m "perf(flag-queue): a 14-flag person stops rendering the same explainer 14 times"
```

---

## Task 9: Pin the decision controls

**Files:**
- Modify: `src/ui/FlagDecisionPanel.tsx`
- Modify: `src/ui/FlagQueuePage.tsx`
- Modify: `src/ui/flagQueuePage.test.tsx`

**Interfaces:**
- Produces: `FlagDecisionPanel` renders a two-part shell — `<div className="flex h-full min-h-0 flex-col">` with a scrolling body and a `shrink-0` footer. The panel's wrapper in `FlagQueueView` drops its own `overflow-y-auto`, since the body now owns scrolling.

- [ ] **Step 1: Write the failing test**

```tsx
test("the panel is a scrolling body above a footer that is not in the scroll", () => {
  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: fourteenFlagPerson() })} />,
  );
  assert.match(html, /flex h-full min-h-0 flex-col/, "the panel is a column shell");
  assert.match(html, /data-slot="decision-footer"[^>]*class="[^"]*shrink-0/);
  assert.match(html, /data-slot="decision-body"[^>]*class="[^"]*overflow-y-auto/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/ui/flagQueuePage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the shell**

Wrap `PersonDecision`'s and `GroupDecision`'s returns in:

```tsx
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-slot="decision-body"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-3"
      >
        {/* header, worst card, one-liners / member list */}
      </div>
      <div
        data-slot="decision-footer"
        className="shrink-0 border-t border-border/60 bg-background pt-2.5"
      >
        {/* DecisionForm + the submit row */}
      </div>
    </div>
```

The `DecisionForm` moves out of `FlagCard` for the **worst** flag only and into the footer; the one-liner-promoted `FlagCard`s keep their inline form, because those are a deliberate detour rather than the main loop.

Add a line above the form naming what is being decided, so the pinned control is never ambiguous about its target:

```tsx
        <div className="mb-1.5 text-xs text-muted-foreground">
          {DECIDING_PREFIX} <span className="font-medium text-foreground">{decidingLabel}</span>
        </div>
```

where `decidingLabel` is `formatFlagLabel(...) + " · " + flagDayLabel(...)` for a person, and `groupSubline(entry)` for a group.

- [ ] **Step 4: Let the panel column fill its height**

In `FlagQueueView`, change the panel wrapper from
`className="lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"`
to
`className="lg:min-h-0 lg:overflow-hidden"`
— the panel owns its own scrolling now, and a second scroller around it would let the footer scroll away.

- [ ] **Step 5: Run tests**

Run: `npm run test:web && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/FlagDecisionPanel.tsx src/ui/FlagQueuePage.tsx src/ui/flagQueuePage.test.tsx
git commit -m "feat(flag-queue): the decision controls stop moving"
```

---

## Task 10: Mobile bottom sheet

**Files:**
- Modify: `src/ui/FlagQueuePage.tsx`
- Modify: `e2e/flags.spec.ts`

**Interfaces:**
- Consumes: `ResponsiveModal` from `@/components/ResponsiveModal`.
- Produces: `useIsBelowLg()` in `src/hooks/useIsMobile.ts`.

**Do not use `useIsMobile` here.** Its breakpoint is **768**, and its own comment says so: *"the data table switches later, at lg/1024"*. The grid splits at `lg`. Wiring the sheet to `useIsMobile` leaves **768–1023px showing neither** — no split (below `lg`) and no sheet (not "mobile") — which is a blank right-hand column and a decision form nothing can open. The spec fixes the split at `lg` deliberately: *"at 768px the panel would be 340px, narrower than the list beside it, and the decision form does not fit that."* So the sheet needs a breakpoint that matches the grid, not the nav shell.

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/flags.spec.ts` (the Playwright config already defines a `mobile` project):

```ts
test("on a phone the decision comes to you, and the list keeps its place", async ({ page }) => {
  // Reuse the two-entry payload from the outage test.
  await page.goto("/hr-flags");

  const list = page.getByRole("list", { name: "Flag queue" });
  await list.getByRole("button").first().click();

  // The form is on screen without scrolling — today it is a sibling AFTER the
  // full list, so on the real queue it sits 9,146px below the tap.
  const form = page.getByRole("dialog");
  await expect(form).toBeVisible();
  await expect(form.getByRole("group", { name: "Outcome" })).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(list.getByRole("button").first()).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test e2e/flags.spec.ts -g "on a phone" --project=mobile`
Expected: FAIL — no dialog.

- [ ] **Step 3: Add the matching breakpoint hook**

Append to `src/hooks/useIsMobile.ts`, reusing the same during-render read so the first paint is already correct (the existing comment explains why dewey-ui's effect-seeded version flashes):

```ts
/**
 * The GRID's breakpoint, not the nav shell's.
 *
 * MOBILE_BREAKPOINT above is 768 and drives the phone-vs-desktop shell. The
 * flag queue's split is `lg:grid` at 1024, because at 768 the panel would be
 * 340px and the decision form does not fit. Anything keyed to the split — the
 * bottom sheet that replaces it — must use this, or 768–1023px gets neither
 * the split nor the sheet.
 */
const LG_BREAKPOINT = 1024;

const readBelowLg = () =>
  typeof window !== "undefined" && window.innerWidth < LG_BREAKPOINT;

export function useIsBelowLg(): boolean {
  const [below, setBelow] = useState(readBelowLg);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${LG_BREAKPOINT - 1}px)`);
    const onChange = () => setBelow(readBelowLg());
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return below;
}
```

- [ ] **Step 4: Implement the sheet**

In `FlagQueueView`:

```tsx
  const belowLg = useIsBelowLg();
```

Below `lg`, render the list alone at full height, and the panel inside a `ResponsiveModal`:

```tsx
      {belowLg ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{props.list}</div>
          {/* The list stays mounted and scrolled where it was, so dismissing
              returns you exactly where you were — the property the desktop
              split has and the old mobile stack lost. */}
          <ResponsiveModal
            open={props.panelOpen}
            onOpenChange={props.onPanelOpenChange}
            title={props.panelTitle}
            size="lg"
          >
            {props.panel}
          </ResponsiveModal>
        </>
      ) : (
        /* the existing lg:grid split, unchanged */
      )}
```

Add `panelOpen: boolean`, `onPanelOpenChange: (open: boolean) => void` and `panelTitle: ReactNode` to `FlagQueueViewProps`.

In `FlagQueuePage`:

```tsx
  // Owned by the page, not the view: the view is the piece that renders under
  // renderToStaticMarkup, and a hook reading window width during render would
  // make every existing view test depend on a jsdom-less global.
  const belowLg = useIsBelowLg();
  const panelOpen = belowLg && selectedEntry != null;

  const handlePanelOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      // Dismissing the sheet is a deselection, so it owes the same per-row reset
      // every other deselection does — otherwise a half-typed note follows the
      // next tap onto somebody else's form.
      setSelectedKey(null);
      resetRowState();
      cancelRestore();
    },
    [resetRowState, cancelRestore],
  );
```

`panelTitle` is `selectedEntry == null ? null : selectedEntry.kind === "group" ? groupHeadline(selectedEntry) : selectedEntry.employee_name`.

Pass `belowLg` to the view too, rather than calling the hook inside `FlagQueueView` — the view must stay renderable under `renderToStaticMarkup`, and every existing test in `flagQueuePage.test.tsx` renders it with no `window`.

- [ ] **Step 5: Check the 768–1023px band by hand**

`npm run dev`, open `/hr-flags`, and resize to 900px wide. Click a row.
Expected: the sheet opens. If you get a blank right-hand column instead, the sheet is wired to `useIsMobile` (768) rather than `useIsBelowLg` (1024) — the exact gap this task exists to avoid.

- [ ] **Step 6: Run the mobile project**

Run: `npx playwright test --project=mobile`
Expected: PASS.

- [ ] **Step 7: Run everything**

Run: `npm run test:e2e && npm run test:web && npm run typecheck`
Expected: all pass. **Record the three counts.**

- [ ] **Step 8: Mutation-test the sheet**

Temporarily set `panelOpen` to a constant `false`. Run `npx playwright test -g "on a phone" --project=mobile`.
Expected: FAIL. Revert.

- [ ] **Step 9: Build and commit**

```bash
npm run build
git add src/ui/FlagQueuePage.tsx src/hooks/useIsMobile.ts e2e/flags.spec.ts ../../public
git commit -m "fix(flag-queue): on a phone the form comes to you, not 9,146px down the page"
```

---

## Task 11: Prove the whole thing, and re-measure production

**Files:** none — verification only.

- [ ] **Step 1: Full suite**

```bash
cd dewey_time/frontend/hr_attendance
npm run typecheck && npm run test:web && npm run test:e2e
cd ../../..
python3.13 -m unittest discover -s dewey_time/tests -t .
```

Expected: `tsc` clean, unit count ≥ 594 + new, Playwright ≥ 58 + new, Python 606.

- [ ] **Step 2: Confirm the bundle is committed**

Run: `git status --short dewey_time/public`
Expected: empty. If not, `npm run build` was not run after the last source change — run it and amend.

- [ ] **Step 3: Measure against the spec's targets**

`npm run dev`, open `/hr-flags`, and run in the console:

```js
const p = document.querySelector('[data-slot="page"]');
const list = document.querySelector('ul[aria-label="Flag queue"]');
const panel = document.querySelector('[data-slot="decision-body"]');
({
  chrome: Math.round(list.getBoundingClientRect().top),
  contentW: Math.round(p.getBoundingClientRect().width),
  rowsVisible: +(list.parentElement.getBoundingClientRect().height / 60).toFixed(1),
  panelBody: panel && Math.round(panel.scrollHeight),
})
```

| Target | From the spec |
|---|---|
| `chrome` | ≤ 140 (was 297) |
| `contentW` | viewport − 64 (was capped at 1280) |
| `rowsVisible` | ≥ 8 at a 662px viewport (was 5.8) |
| `panelBody` on a 14-flag person | ≤ 1200 (was 5,069) |

Record all four in the final commit or the PR body. A miss is not a blocker by itself, but it must be explained rather than passed over.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin <branch>
npx -y gh-axi pr create --title "..." --body-file <path>
```

The PR body must state the four measurements, and must repeat the spec's two out-of-scope findings so they are not read as regressions:

- 4,908 of 5,000 flags are still generated and transmitted; source-side suppression is not in this change.
- 133 employees have `employee_branch: null`, so they cannot be claimed by an outage group and remain individual rows. Setting that field takes the post-partition list from 134 rows to about 1.

---

## Self-review notes

**Spec coverage.** Decision 1 → Tasks 1–4, 7. Decision 2 (split + pinned) → Task 9. Decision 3 (chrome) → Task 5. Decision 4 (width) → Task 5, Step 4. Decision 5 (density) → Task 8. Decision 6 (mobile) → Task 10. Other states → Task 6. Testing section → Tasks 7, 10, 11. Phasing → the Phase 1 / Phase 2 headings.

**Type consistency.** `partitionQueue` → `{ outages, queue }` and `outageWrite` → `{ identities, branchCount, coveredEmployeeCount }` are used under those exact names in Tasks 1, 3, 4 and 6. The band's own prop is `onExcuse`; the view-level prop that feeds it is `onExcuseOutages`, mapped in Task 4, Step 5. `queuePeopleCount` (function) and `queuePeople` (prop) are deliberately different names for the same number at two layers.

**Known soft spots, flagged rather than hidden:**

- **Task 6, Step 6** offers two places to render the empty state and picks the `FlagQueueView` one. If `FlagQueueList`'s existing empty branch turns out to be the only reachable path, use that and delete the other — never render both, or an empty queue reports itself twice.
- **`restHeading`** (Task 8) depends on a noun helper whose exact shape is unverified. The step says to fall back to `formatFlagLabel` rather than invent a second flag vocabulary alongside the one `flagLabels.ts` already owns.
- **Task 5's 297 → ~120px target is a projection, not a measurement.** Step 7 measures it for real and requires the number in the commit message. If it lands above 140px, the remaining band has to be found and named before Task 6 starts.
- **Task 5 adds a prop to a shared component.** `DatePickerInput` is used by `WeeklySchedulePage` and the schedule import page. `ariaLabel` is additive and ignored when `label` is set, so neither changes — but `npm run typecheck` is the gate, and both call sites should be eyeballed once.

**Corrected during self-review, recorded so the reasoning is not lost:**

- `useIsMobile` is **768**, not 1024 — its own comment says the data table "switches later, at lg/1024". The first draft of Task 10 wired the sheet to it, which would have left 768–1023px with neither the split nor the sheet: a blank column and an unopenable form. Task 10 now adds `useIsBelowLg` and Step 5 checks that band by hand.
- `DatePickerInput` does **not** spread unknown props, so the `aria-label` the first draft of Task 5 put on the JSX would have been dropped silently and shipped three unnamed controls. Task 5, Step 5 now modifies the component.
- Its trigger is `h-10`, not the `h-9` the first draft assumed — a 4px ragged toolbar row.
