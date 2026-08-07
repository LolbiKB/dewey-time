import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { PendingDecision } from "@/lib/flagDecisionState";
import { formatFlagContextDate } from "@/lib/flagDetails";
import {
  DECIDE_AGAIN_LABEL,
  SAME_REASON_LABEL,
  SHOWING_DECIDED_MESSAGE,
  appliedDecisionLabel,
  applyToRemainingLabel,
  decisionStateLabel,
  outcomeActionLabel,
  partialFailureMessage,
  reasonLabel,
  tierLabel,
} from "@/lib/flagQueueLabels";
import type { DecisionState, FlagDecision, FlagOut, QueueEntry, QueuePerson, Tier } from "@/types/flags";

import { SHOW_AS_GROUP_LABEL } from "@/lib/flagQueueLabels";

import { FlagDecisionPanel, type FlagDecisionPanelProps } from "./FlagDecisionPanel";
import { FlagQueueList, entryKey } from "./FlagQueueList";
import {
  FlagQueueView,
  decideEffect,
  type DecideArgs,
  type DecideEffect,
  type FlagQueueViewProps,
} from "./FlagQueuePage";

const DATE = "2026-08-03";

type GroupEntry = Extract<QueueEntry, { kind: "group" }>;
type PersonEntry = Extract<QueueEntry, { kind: "person" }>;

function makeFlag(args: {
  identity: string;
  code: string;
  rank: number;
  tier: Tier;
  /** A flag carries its own day: an entry can now span several of them. */
  date?: string;
  state?: DecisionState;
  decision?: FlagDecision | null;
  evidence?: Record<string, unknown>;
}): FlagOut {
  return {
    flag_identity: args.identity,
    flag_code: args.code,
    attendance_date: args.date ?? DATE,
    severity: "WARNING",
    day_closed: 1,
    evidence: args.evidence ?? {},
    rank: args.rank,
    tier: args.tier,
    decision_state: args.state ?? "undecided",
    decision: args.decision ?? null,
  };
}

// rank/tier are passed in rather than derived: build_queue computes them
// server-side from the person's UNDECIDED flags, and a fixture that recomputes
// them here would be testing the fixture, not the component.
//
// `dates`, `attendance_date` and `entry_key` ARE derived, because each is a
// mechanical restatement of the flags this entry holds and _person() derives
// them the same way — `dates` is every date in the entry, the headline day is
// the worst unresolved flag's (they arrive worst-first), and a lone row's key
// is `p:<employee>`. Group members are stamped with the group's key instead.
function makePerson(args: {
  employee: string;
  name: string;
  rank: number;
  tier: Tier;
  flags: FlagOut[];
  entryKey?: string;
  /** Employee.image, or absent for the many employees who have no photo. */
  image?: string | null;
  alsoCount?: number;
  alsoOutlierCount?: number;
}): QueuePerson {
  const unresolved = args.flags.filter((f) => f.decision_state !== "matched");
  const top = unresolved[0] ?? args.flags[0];
  return {
    entry_key: args.entryKey ?? `p:${args.employee}`,
    employee: args.employee,
    employee_name: args.name,
    employee_branch: "Phnom Penh HQ",
    employee_image: args.image ?? null,
    attendance_date: top?.attendance_date ?? DATE,
    dates: [...new Set(args.flags.map((f) => f.attendance_date))].sort(),
    rank: args.rank,
    tier: args.tier,
    flags: args.flags,
    undecided_count: unresolved.length,
    also_count: args.alsoCount ?? 0,
    also_outlier_count: args.alsoOutlierCount ?? 0,
  };
}

/**
 * The queried fortnight, and no device outages in it. Every list render needs
 * both: the strip's window is cut from the range's recent end, and its grey
 * cells come from the outage set.
 */
function listProps() {
  return {
    range: { startDate: "2026-07-25", endDate: "2026-08-07" },
    outage: new Set<string>(),
    selectedKey: null,
    expandedGroupKey: null,
    onSelect: () => {},
  };
}

const PATTERN_KEY = "REPEAT_PATTERN:LATE_START";
const PATTERN_DATES = ["2026-08-03", "2026-08-04", "2026-08-05"];

/** One member of the repeatedly-late group: the same code, three mornings. */
function patternMember(args: {
  employee: string;
  name: string;
  image?: string | null;
  alsoCount?: number;
  alsoOutlierCount?: number;
}): QueuePerson {
  return makePerson({
    employee: args.employee,
    name: args.name,
    rank: 20,
    tier: "routine",
    entryKey: `${PATTERN_KEY}|p:${args.employee}`,
    image: args.image,
    alsoCount: args.alsoCount,
    alsoOutlierCount: args.alsoOutlierCount,
    flags: PATTERN_DATES.map((date, i) =>
      makeFlag({
        identity: `id-late-${args.employee}-${i}`,
        code: "LATE_START",
        date,
        rank: 20,
        tier: "routine",
        evidence: { minutes: 12 + i },
      })
    ),
  });
}

// Ada is in two entries at once — the per-flag invariant's whole point. Her
// three late mornings are a pattern; her three-hour gap is not, so it stayed a
// row of its own. also_count/also_outlier_count are stamped exactly as
// _stamp_cross_references does it: from inside the group her other entry is a
// lone row (an outlier), from the lone row her other entry is a group.
function patternGroupEntry(): GroupEntry {
  return {
    kind: "group",
    group_type: "REPEAT_PATTERN",
    group_key: PATTERN_KEY,
    branch: null,
    flag_code: "LATE_START",
    // A pattern spans dates by definition, so the backend sends no single one.
    attendance_date: null,
    rank: 20,
    tier: "routine",
    // Both members have a photo: a group header answers "who is in here?" with
    // faces, so a fixture with none could not tell a working header from an
    // empty one.
    members: [
      patternMember({
        employee: "HR-EMP-00001",
        name: "Ada Lovelace",
        image: "/files/ada.jpg",
        alsoCount: 1,
        alsoOutlierCount: 1,
      }),
      patternMember({
        employee: "HR-EMP-00002",
        name: "Grace Hopper",
        image: "/files/grace.jpg",
      }),
    ],
  };
}

/** One act-tier gap on one day — the row that has a day worth naming. */
function missingTimePerson(): PersonEntry {
  return {
    kind: "person",
    ...makePerson({
      employee: "HR-EMP-00011",
      name: "Sokheng Hon",
      image: "/files/sokheng.jpg",
      rank: 132,
      tier: "act",
      flags: [
        makeFlag({
          identity: "id-gap-sokheng",
          code: "MISSING_TIME",
          date: "2026-08-06",
          rank: 132,
          tier: "act",
          evidence: { minutes: 192 },
        }),
      ],
    }),
  };
}

/** Four late mornings that formed no group — and no photo on file. */
function repeatPerson(): PersonEntry {
  return {
    kind: "person",
    ...makePerson({
      employee: "HR-EMP-00012",
      name: "Vichea Lim",
      rank: 20,
      tier: "routine",
      flags: [31, 12, 9, 15].map((minutes, i) =>
        makeFlag({
          identity: `id-late-vichea-${i}`,
          code: "LATE_START",
          date: `2026-08-0${3 + i}`,
          rank: 20,
          tier: "routine",
          evidence: { minutes },
        })
      ),
    }),
  };
}

function outlierPersonEntry(): PersonEntry {
  return {
    kind: "person",
    ...makePerson({
      employee: "HR-EMP-00001",
      name: "Ada Lovelace",
      rank: 132,
      tier: "act",
      alsoCount: 1,
      alsoOutlierCount: 0,
      flags: [
        makeFlag({
          identity: "id-missing",
          code: "MISSING_TIME",
          rank: 132,
          tier: "act",
          evidence: { minutes: 180 },
        }),
      ],
    }),
  };
}

/** The same pattern member, opened in the panel: three mornings, three cards. */
function spanPersonEntry(): PersonEntry {
  return {
    kind: "person",
    ...patternMember({
      employee: "HR-EMP-00001",
      name: "Ada Lovelace",
      alsoCount: 1,
      alsoOutlierCount: 1,
    }),
  };
}

/** Everything FlagQueueView needs except `counts`, which each test supplies. */
function viewProps(): Omit<FlagQueueViewProps, "counts"> {
  return {
    isLoading: false,
    error: null,
    onRetry: () => {},
    bulkFailure: null,
    list: <div />,
    panel: <div />,
  };
}

/** The panel's header, up to the first flag card — where the day is named. */
function panelHeader(html: string): string {
  return html.slice(0, html.indexOf("<section"));
}

// Whole-markup matching cannot tell a title from a subline, or one person's
// row from another's — "Repeatedly late" being present somewhere does not make
// it the row's headline, and two correctly worded badges could both be on the
// same row. Everything below slices first and asserts inside one slot.

/** Each row button's markup, in render order. */
function rowButtons(html: string): string[] {
  return html
    .split("<button")
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("</button>")));
}

/**
 * The one row button containing every one of `texts`. It takes several because
 * one fragment is not always enough to name a row: the same person can hold two
 * rows, and two people can share a headline.
 */
function rowWith(html: string, ...texts: string[]): string {
  const matches = rowButtons(html).filter((row) => texts.every((text) => row.includes(text)));
  assert.equal(matches.length, 1, `expected exactly one row containing ${JSON.stringify(texts)}`);
  return matches[0];
}

/** The `<li>`s of the group panel's "Who this covers" list, in render order. */
function memberListItems(html: string): string[] {
  const list = html.slice(html.indexOf("<ul"), html.indexOf("</ul>"));
  return list.split("<li").slice(1);
}

/**
 * The text of the first element whose class attribute contains `marker` — the
 * slot, not the string. Asserting a slot is what makes it possible to fail when
 * the title and the subline are rendered into each other's places.
 */
function slotText(html: string, marker: string): string {
  const at = html.indexOf(marker);
  assert.notEqual(at, -1, `no element carrying the class fragment ${JSON.stringify(marker)}`);
  const open = html.indexOf(">", at) + 1;
  return html.slice(open, html.indexOf("<", open));
}

/** The two slots of a list row: the bold headline and the line under it. */
const TITLE_SLOT = "text-sm font-medium text-foreground";
const SUBLINE_SLOT = "text-xs text-muted-foreground tabular-nums";

function panelProps(overrides: Partial<FlagDecisionPanelProps> = {}): FlagDecisionPanelProps {
  return {
    entry: null,
    draft: { outcome: "EXCUSED", reason: "APPROVED_LEAVE", note: "" },
    onDraftChange: () => {},
    activeIdentity: null,
    onOpenFlag: () => {},
    lastDecision: null,
    onSubmit: () => {},
    excluded: new Set<string>(),
    onToggleMember: () => {},
    onDecideOneByOne: () => {},
    ...overrides,
  };
}

// build_queue assigns each FLAG to exactly one entry, and Ada's routine
// LATE_START went with her act-tier day rather than into the routine group —
// so the list must render her once, where the backend put her. (A person can
// now legitimately hold two entries; when that happens they arrive as two, and
// the cross-reference badge below is what ties them together.)
test("a person with a routine flag and an act flag appears once, under Act", () => {
  const ada = makePerson({
    employee: "HR-EMP-00001",
    name: "Ada Lovelace",
    rank: 150,
    tier: "act",
    flags: [
      makeFlag({ identity: "id-absence", code: "UNNOTIFIED_ABSENCE", rank: 150, tier: "act" }),
      makeFlag({
        identity: "id-late",
        code: "LATE_START",
        rank: 20,
        tier: "routine",
        evidence: { minutes: 12 },
      }),
    ],
  });

  const routineGroup: QueueEntry = {
    kind: "group",
    group_type: "ROUTINE_CODE",
    group_key: "ROUTINE_CODE:LATE_START:2026-08-03",
    branch: null,
    flag_code: "LATE_START",
    attendance_date: DATE,
    rank: 20,
    tier: "routine",
    members: [
      makePerson({
        employee: "HR-EMP-00002",
        name: "Grace Hopper",
        rank: 20,
        tier: "routine",
        flags: [
          makeFlag({
            identity: "id-late-2",
            code: "LATE_START",
            rank: 20,
            tier: "routine",
            evidence: { minutes: 9 },
          }),
        ],
      }),
    ],
  };

  const html = renderToStaticMarkup(
    <FlagQueueList entries={[routineGroup, { kind: "person", ...ada }]} {...listProps()} />
  );

  assert.equal(
    html.split("Ada Lovelace").length - 1,
    1,
    "Ada must appear in exactly one row, not once as a person and once in the routine group"
  );

  const actAt = html.indexOf(tierLabel("act"));
  const routineAt = html.indexOf(tierLabel("routine"));
  const adaAt = html.indexOf("Ada Lovelace");
  assert.ok(actAt >= 0, "the Act tier heading is rendered");
  assert.ok(routineAt >= 0, "the Routine tier heading is rendered");
  // Interleaved by rank (150 before 20), so Ada sits above the routine group.
  assert.ok(actAt < adaAt && adaAt < routineAt, "Ada is listed under Act, above the routine group");
});

// Per-member exclusion is the safety valve on bulk decisions: one genuine
// no-show hidden among 41 device-fault rows must not be silently excused. If the
// header count ever stops tracking the checkboxes, that protection is gone while
// still looking present.
test("the group action count drops when members are excluded", () => {
  const members = Array.from({ length: 41 }, (_, i) =>
    makePerson({
      employee: `HR-EMP-${String(i + 1).padStart(5, "0")}`,
      name: `Employee ${i + 1}`,
      rank: 150,
      tier: "act",
      flags: [
        makeFlag({ identity: `id-${i}`, code: "UNNOTIFIED_ABSENCE", rank: 150, tier: "act" }),
      ],
    })
  );

  const group: QueueEntry = {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ:2026-08-03",
    branch: "Phnom Penh HQ",
    flag_code: null,
    attendance_date: DATE,
    rank: 150,
    tier: "act",
    members,
  };

  const all = renderToStaticMarkup(<FlagDecisionPanel {...panelProps({ entry: group })} />);
  assert.ok(all.includes(`${outcomeActionLabel("EXCUSED")} 41`), "all 41 members are included by default");

  const partial = renderToStaticMarkup(
    <FlagDecisionPanel
      {...panelProps({ entry: group, excluded: new Set(["HR-EMP-00007", "HR-EMP-00019"]) })}
    />
  );
  assert.ok(partial.includes(`${outcomeActionLabel("EXCUSED")} 39`), "two exclusions drop the count to 39");
  assert.ok(
    !partial.includes(`${outcomeActionLabel("EXCUSED")} 41`),
    "the stale 41 must not survive anywhere in the panel"
  );
});

const PRIOR: FlagDecision = {
  name: "afd00000001",
  outcome: "EXCUSED",
  reason: "DEVICE_OR_DATA_FAULT",
  note: "Device was offline for the whole morning.",
  decided_by: "hr@dewey.test",
  decided_at: "2026-08-04 09:12:00",
  group_key: "grp-1",
};

// The staleness guard: the evidence changed under this decision, so it is
// deliberately NOT applied and the flag is back in the queue. Rendering it as an
// applied outcome would tell HR the day is handled when it is not.
test("a needs_re_review flag shows its prior decision as context, not as an applied outcome", () => {
  const person = makePerson({
    employee: "HR-EMP-00001",
    name: "Ada Lovelace",
    rank: 132,
    tier: "act",
    flags: [
      makeFlag({
        identity: "id-missing",
        code: "MISSING_TIME",
        rank: 132,
        tier: "act",
        evidence: { minutes: 180, interval_start: "2026-08-03 10:00:00" },
        state: "needs_re_review",
        decision: PRIOR,
      }),
    ],
  });

  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: { kind: "person", ...person } })} />
  );

  assert.ok(
    html.includes(reasonLabel("DEVICE_OR_DATA_FAULT")),
    "the prior decision's reason is shown as context"
  );
  assert.ok(html.includes(decisionStateLabel("needs_re_review")), "the state badge says re-review");
  assert.ok(
    !html.includes(decisionStateLabel("matched")),
    "it must not read as decided — the decision is retained but not applied"
  );
  assert.ok(html.includes(">Decide<"), "the flag is still decidable");
});

// "Nothing is ever auto-closed": the one-click repeat only exists once HR has
// actually made a decision on this person, and it still requires a click.
test('"Same reason applies" appears only once a decision exists on the person', () => {
  const person = makePerson({
    employee: "HR-EMP-00001",
    name: "Ada Lovelace",
    rank: 140,
    tier: "act",
    flags: [
      makeFlag({
        identity: "id-issue",
        code: "ATTENDANCE_ISSUE",
        rank: 140,
        tier: "act",
        evidence: { reason: "single_checkin" },
        state: "matched",
        decision: PRIOR,
      }),
      makeFlag({
        identity: "id-late",
        code: "LATE_START",
        rank: 20,
        tier: "routine",
        evidence: { minutes: 12 },
      }),
      makeFlag({ identity: "id-left", code: "LEFT_EARLY", rank: 25, tier: "routine", evidence: { minutes: 20 } }),
    ],
  });
  const entry: QueueEntry = { kind: "person", ...person };

  const fresh = renderToStaticMarkup(<FlagDecisionPanel {...panelProps({ entry })} />);
  assert.ok(!fresh.includes(SAME_REASON_LABEL), "no repeat affordance before a first decision");

  const repeat: PendingDecision = { outcome: "EXCUSED", reason: "DEVICE_OR_DATA_FAULT", note: "" };
  const after = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry, lastDecision: repeat })} />
  );
  assert.ok(after.includes(SAME_REASON_LABEL), "each remaining flag offers the repeat");
  assert.ok(
    after.includes(applyToRemainingLabel(2)),
    "and the person-level bulk repeat counts only the two undecided flags"
  );
});

// `undecided_count` comes from the backend's UNRESOLVED_STATES, which INCLUDES
// needs_re_review; the payload builders filter to the strict `undecided` state,
// because a stale decision needs a human to look again, not a bulk repeat of the
// old verdict. Label a button from the former and it promises writes the request
// will not make — "Apply to remaining 3" that writes 2. Every fixture above
// happens to make the two numbers agree, so only this one can catch it.
test("bulk labels count what will actually be written, not undecided_count", () => {
  const stale = makeFlag({
    identity: "id-stale",
    code: "MISSING_TIME",
    rank: 132,
    tier: "act",
    evidence: { minutes: 180 },
    state: "needs_re_review",
    decision: PRIOR,
  });
  const person = makePerson({
    employee: "HR-EMP-00001",
    name: "Ada Lovelace",
    rank: 150,
    tier: "act",
    flags: [
      makeFlag({ identity: "id-absence", code: "UNNOTIFIED_ABSENCE", rank: 150, tier: "act" }),
      makeFlag({
        identity: "id-late",
        code: "LATE_START",
        rank: 20,
        tier: "routine",
        evidence: { minutes: 12 },
      }),
      stale,
    ],
  });
  assert.equal(person.undecided_count, 3, "the backend counts the stale flag as unresolved");

  const repeat: PendingDecision = { outcome: "EXCUSED", reason: "DEVICE_OR_DATA_FAULT", note: "" };
  const html = renderToStaticMarkup(
    <FlagDecisionPanel
      {...panelProps({ entry: { kind: "person", ...person }, lastDecision: repeat })}
    />
  );
  assert.ok(html.includes(applyToRemainingLabel(2)), "only the two undecided flags get written");
  assert.ok(!html.includes(applyToRemainingLabel(3)), "never the backend's unresolved count");

  // Same rule one level up: a group member whose only unresolved flag is
  // needs_re_review stays checked, but contributes no identity to the write, so
  // the action must not count them.
  const group: QueueEntry = {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ:2026-08-03",
    branch: "Phnom Penh HQ",
    flag_code: null,
    attendance_date: DATE,
    rank: 150,
    tier: "act",
    members: [
      makePerson({
        employee: "HR-EMP-00002",
        name: "Grace Hopper",
        rank: 150,
        tier: "act",
        flags: [makeFlag({ identity: "id-a", code: "UNNOTIFIED_ABSENCE", rank: 150, tier: "act" })],
      }),
      makePerson({
        employee: "HR-EMP-00003",
        name: "Katherine Johnson",
        rank: 132,
        tier: "act",
        flags: [stale],
      }),
    ],
  };

  const groupHtml = renderToStaticMarkup(<FlagDecisionPanel {...panelProps({ entry: group })} />);
  assert.ok(
    groupHtml.includes(`${outcomeActionLabel("EXCUSED")} 1`),
    "one of the two members has anything to write"
  );
  assert.ok(
    !groupHtml.includes(`${outcomeActionLabel("EXCUSED")} 2`),
    "the checked-but-unwritable member must not be promised"
  );
});

// The user's answer to "how does HR fix a decision they got wrong" is
// supersession, and deciding an already-decided flag is how it is invoked. With
// the card rendering nothing for a `matched` flag, that answer did not exist in
// the product: the backend supported it and no button reached it.
test("a decided flag can be decided again, with the decision it replaces in view", () => {
  const settled = makeFlag({
    identity: "id-late",
    code: "LATE_START",
    rank: 20,
    tier: "routine",
    evidence: { minutes: 12 },
    state: "matched",
    decision: PRIOR,
  });
  const person = makePerson({
    employee: "HR-EMP-00001",
    name: "Ada Lovelace",
    rank: 0,
    tier: "routine",
    flags: [settled],
  });
  const entry: QueueEntry = { kind: "person", ...person };

  const closed = renderToStaticMarkup(<FlagDecisionPanel {...panelProps({ entry })} />);
  assert.ok(closed.includes(DECIDE_AGAIN_LABEL), "the settled flag offers a way to decide again");
  assert.ok(
    closed.includes(appliedDecisionLabel(PRIOR)),
    "…and says what the decision in force actually is"
  );
  assert.ok(
    !closed.includes(SAME_REASON_LABEL),
    "the day-repeat is for flags still awaiting a decision, not for re-deciding a settled one"
  );

  // The SAME form, reopened — not a second one. The submit verb comes from the
  // draft outcome, exactly as it does on a first decision.
  const open = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry, activeIdentity: "id-late" })} />
  );
  assert.ok(open.includes(`>${outcomeActionLabel("EXCUSED")}<`), "the decision form is open");
  assert.ok(open.includes('aria-label="Outcome"'), "with the same outcome/reason/note controls");
  assert.ok(
    open.includes(appliedDecisionLabel(PRIOR)),
    "the decision being replaced stays readable while the replacement is typed"
  );
});

test("the Decided count doubles as the control that surfaces decided people", () => {
  const counts = { open: 12, needs_re_review: 5, decided: 88, people: 40, rows: 12 };

  const off = renderToStaticMarkup(
    <FlagQueueView
      counts={counts}
      includeDecided={false}
      onToggleDecided={() => {}}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div />}
      panel={<div />}
    />
  );
  assert.match(off, /aria-pressed="false"[^>]*>Decided/, "the chip is an off toggle, not a label");
  assert.ok(!off.includes(SHOWING_DECIDED_MESSAGE), "nothing extra is in the list yet");

  const on = renderToStaticMarkup(
    <FlagQueueView
      counts={counts}
      includeDecided
      onToggleDecided={() => {}}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div />}
      panel={<div />}
    />
  );
  assert.match(on, /aria-pressed="true"[^>]*>Decided/, "pressed when it is on");
  // Rows with nothing left to do, in a queue that promises otherwise, read as a
  // bug unless the page says what it is doing.
  assert.ok(on.includes(SHOWING_DECIDED_MESSAGE), "and the list says it is showing more than open work");

  // Open and Needs re-review must NOT become filters: a queue whose counts can
  // hide work is worse than no queue.
  assert.equal((on.match(/aria-pressed=/g) ?? []).length, 1);
});

test("a load failure renders exactly one assertive alert", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={null}
      isLoading={false}
      error={new Error("Network request failed")}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div>LIST-SENTINEL</div>}
      panel={<div>PANEL-SENTINEL</div>}
    />
  );

  const alerts = html.match(/role="alert"/g) ?? [];
  assert.equal(alerts.length, 1, "one failure, announced exactly once");
  assert.ok(html.includes("Retry"), "the failure is recoverable in place");
  // FailureBlock replaces the region the queue would occupy — a page showing
  // both a banner and a replaced region reports one failure twice.
  assert.ok(!html.includes("LIST-SENTINEL"));
  assert.ok(!html.includes("PANEL-SENTINEL"));
});

test("a partial bulk failure is reported politely, with the failures disclosed", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 12, needs_re_review: 5, decided: 88, people: 40, rows: 12 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={{
        saved: 34,
        attempted: 39,
        errors: [
          { flag_identity: "AUTO-hr-emp-00007-2026-08-03-late-start", error: "Flag no longer exists" },
        ],
      }}
      list={<div>LIST-SENTINEL</div>}
      panel={<div>PANEL-SENTINEL</div>}
    />
  );

  assert.ok(html.includes(partialFailureMessage(34, 39)));
  // Role 2, not role 3: 34 decisions did land, so nothing the user asked for is
  // wholly missing and a screen reader must not be interrupted.
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /role="alert"/);
  const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
  assert.ok(!summary.includes("AUTO-hr-emp-00007"), "identities live behind the disclosure");
  assert.ok(html.includes("AUTO-hr-emp-00007"), "…but they are present");
  // The queue itself is still usable while the strip is up.
  assert.ok(html.includes("LIST-SENTINEL"));
});

test("the toolbar reports open, needs re-review and decided counts", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 12, needs_re_review: 5, decided: 88, people: 40, rows: 12 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div />}
      panel={<div />}
    />
  );

  assert.ok(html.includes("Open"));
  assert.ok(html.includes("Needs re-review"));
  assert.ok(html.includes("Decided"));
  assert.ok(html.includes(">12<"));
  assert.ok(html.includes(">5<"));
  assert.ok(html.includes(">88<"));
});

// The alerts array is NOT derived from flags — it is read straight from Device
// Closeout Alert. When a device reports deferred_offline/closure_failed the
// fallback path skips those employees and generates nothing, so a queue built
// only from flag rows shows an empty, reassuring screen during a real outage.
test("device alert cards render from alerts, with no flags present", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0, rows: 0 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      alerts={[
        { branch: "Phnom Penh HQ", local_date: "2026-08-03", status: "deferred_offline" },
      ]}
      list={<div />}
      panel={<div />}
    />
  );

  assert.match(html, /Phnom Penh HQ/);
  assert.match(html, /3 Aug/);
  // Polite, not assertive: an outage is a persistent condition, not a failed
  // request. role="alert" would interrupt a screen reader mid-sentence.
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /role="alert"/);
});

// Constraint 9: no device↔branch registry exists, so a serial number in the copy
// would be a claim the data cannot support. The engine's last_error text can
// contain one, which is exactly why it is not rendered.
test("device alert cards never render a device serial", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0, rows: 0 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      alerts={[
        {
          branch: "Phnom Penh HQ",
          local_date: "2026-08-03",
          status: "closure_failed",
          last_error: "device ZK-A4-014 timed out after 3 retries",
        },
      ]}
      list={<div />}
      panel={<div />}
    />
  );

  assert.doesNotMatch(html, /ZK-A4-014/);
  assert.match(html, /Phnom Penh HQ/);
});

// Informational only. A decide action here would be a lie — there are no flags
// behind these rows to decide on.
test("device alert cards carry no decide action", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0, rows: 0 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      alerts={[
        { branch: "Phnom Penh HQ", local_date: "2026-08-03", status: "deferred_offline" },
      ]}
      list={<div />}
      panel={<div />}
    />
  );

  assert.doesNotMatch(html, />Excuse</);
  assert.doesNotMatch(html, />Uphold</);
});

const DRAFT: PendingDecision = { outcome: "EXCUSED", reason: "DEVICE_OR_DATA_FAULT", note: "" };
const ARGS: DecideArgs = {
  identities: ["id-1", "id-2", "id-3"],
  decision: DRAFT,
  groupKey: null,
};

function settled(effect: DecideEffect) {
  assert.equal(effect.kind, "settled");
  return effect as Extract<DecideEffect, { kind: "settled" }>;
}

// The repeat affordance is armed from the *result*, not from the fact that a
// request completed. A 200 that wrote zero rows still completed.
test("the repeat is armed by what was written, not by the call returning", () => {
  const allFailed = settled(
    decideEffect(
      {
        ok: true,
        written: 0,
        errors: ARGS.identities.map((id) => ({ flag_identity: id, error: "Flag no longer exists" })),
      },
      ARGS
    )
  );
  assert.equal(
    allFailed.lastDecision,
    null,
    "nothing landed, so offering to repeat it would spread a failure across the day"
  );
  assert.deepEqual(
    { saved: allFailed.bulkFailure?.saved, attempted: allFailed.bulkFailure?.attempted },
    { saved: 0, attempted: 3 }
  );

  const partial = settled(
    decideEffect(
      { ok: true, written: 2, errors: [{ flag_identity: "id-3", error: "Flag no longer exists" }] },
      ARGS
    )
  );
  assert.equal(partial.lastDecision, DRAFT, "two rows did land, so the repeat is real");
  assert.deepEqual(
    { saved: partial.bulkFailure?.saved, attempted: partial.bulkFailure?.attempted },
    { saved: 2, attempted: 3 }
  );

  const clean = settled(decideEffect({ ok: true, written: 3, errors: [] }, ARGS));
  assert.equal(clean.lastDecision, DRAFT);
  assert.equal(clean.bulkFailure, null, "nothing failed, so no strip");
});

test("an over-threshold decide asks for confirmation and settles nothing", () => {
  const effect = decideEffect({ needs_confirm: true, preview: { count: 39, employees: 39 } }, ARGS);
  assert.equal(effect.kind, "confirm");
  assert.deepEqual(
    effect.kind === "confirm" ? effect.preview : null,
    { count: 39, employees: 39 },
    "the blast radius is shown to the user, not guessed at"
  );

  // The backend has always sent a preview alongside needs_confirm, but the count
  // is what the confirm button promises to write — falling back to the identity
  // count keeps that promise honest rather than rendering "Write 0 decisions".
  const noPreview = decideEffect({ needs_confirm: true }, ARGS);
  assert.deepEqual(noPreview.kind === "confirm" ? noPreview.preview.count : -1, 3);
});

test("a decide that fails outright is reported, politely, without hiding the queue", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 12, needs_re_review: 5, decided: 88, people: 40, rows: 12 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      writeFailure="You do not have permission to decide flags."
      list={<div>LIST-SENTINEL</div>}
      panel={<div>PANEL-SENTINEL</div>}
    />
  );

  assert.ok(
    html.includes("You do not have permission to decide flags."),
    "the server's reason reaches the user rather than dying in the console"
  );
  // Role 2, not role 3: the queue loaded fine and is still fully usable — there
  // is no missing region for FailureBlock to replace.
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /role="alert"/);
  assert.ok(html.includes("LIST-SENTINEL"));
  assert.ok(html.includes("PANEL-SENTINEL"));
});

test("an expanded group can be put back together", () => {
  const group: QueueEntry = {
    kind: "group",
    group_type: "ROUTINE_CODE",
    group_key: "ROUTINE_CODE:LATE_START:2026-08-03",
    branch: null,
    flag_code: "LATE_START",
    attendance_date: DATE,
    rank: 20,
    tier: "routine",
    members: [
      makePerson({
        employee: "HR-EMP-00002",
        name: "Grace Hopper",
        rank: 20,
        tier: "routine",
        flags: [
          makeFlag({
            identity: "id-late-2",
            code: "LATE_START",
            rank: 20,
            tier: "routine",
            evidence: { minutes: 9 },
          }),
        ],
      }),
    ],
  };

  const collapsed = renderToStaticMarkup(<FlagQueueList entries={[group]} {...listProps()} />);
  assert.ok(!collapsed.includes("Grace Hopper"), "members are hidden inside the group row");
  assert.ok(!collapsed.includes(SHOW_AS_GROUP_LABEL), "nothing to collapse yet");

  const expanded = renderToStaticMarkup(
    <FlagQueueList
      entries={[group]}
      {...listProps()}
      expandedGroupKey={group.kind === "group" ? group.group_key : null}
      onCollapseGroup={() => {}}
    />
  );
  assert.ok(expanded.includes("Grace Hopper"), "members take the group's place");
  // Without this, "Decide one by one" is a one-way door: no affordance returns
  // the user to bulk review short of reloading the page.
  assert.ok(expanded.includes(SHOW_AS_GROUP_LABEL), "and there is a way back");
});

test("no alert cards render when the array is empty", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0, rows: 0 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      alerts={[]}
      list={<div />}
      panel={<div />}
    />
  );

  assert.doesNotMatch(html, /no device data/i);
  assert.doesNotMatch(html, /went offline/i);
});

// The identity scheme trades durability for precision: correcting a punch under
// a MISSING_TIME or ATTENDANCE_ISSUE flag changes its identity, so the decision
// attached to it orphans. The design doc parks that trade with "revisit if
// orphan rates in practice turn out to be high" — a plan that only works if the
// rate is on screen. Before this, get_flag_queue computed both counts and
// nothing rendered them.
test("orphaned decisions are reported, so the rate is visible rather than inferred", () => {
  const counts = { open: 12, needs_re_review: 5, decided: 88, people: 40, rows: 12 };

  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={counts}
      orphans={{ orphaned_flag_gone: 3, orphaned_evidence_changed: 1 }}
      includeDecided={false}
      onToggleDecided={() => {}}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div />}
      panel={<div />}
    />
  );

  assert.match(html, /3 decisions no longer have a matching flag/);
  assert.match(html, /1 flag changed since it was decided/);
});

// A healthy queue must stay quiet: "0 decisions no longer have a matching flag"
// is noise on the overwhelmingly common day, and each line is independent —
// one count being zero must not suppress the other.
test("an orphan line appears only when its own count is non-zero", () => {
  const counts = { open: 12, needs_re_review: 5, decided: 88, people: 40, rows: 12 };
  const render = (orphans: { orphaned_flag_gone: number; orphaned_evidence_changed: number }) =>
    renderToStaticMarkup(
      <FlagQueueView
        counts={counts}
        orphans={orphans}
        includeDecided={false}
        onToggleDecided={() => {}}
        isLoading={false}
        error={null}
        onRetry={() => {}}
        bulkFailure={null}
        list={<div />}
        panel={<div />}
      />
    );

  const none = render({ orphaned_flag_gone: 0, orphaned_evidence_changed: 0 });
  assert.doesNotMatch(none, /no longer have a matching flag|changed since/);

  const goneOnly = render({ orphaned_flag_gone: 2, orphaned_evidence_changed: 0 });
  assert.match(goneOnly, /2 decisions no longer have a matching flag/);
  assert.doesNotMatch(goneOnly, /changed since/, "the zero count stays silent");

  const changedOnly = render({ orphaned_flag_gone: 0, orphaned_evidence_changed: 4 });
  assert.match(changedOnly, /4 flags changed since they were decided/);
  assert.doesNotMatch(changedOnly, /no longer have a matching flag/);
});

// Same rule the counts already follow: the hook zero-fills before the first
// payload, so a load failure must not render an orphan line built from zeros.
test("orphan lines are withheld while loading and on failure", () => {
  const orphans = { orphaned_flag_gone: 3, orphaned_evidence_changed: 2 };

  const loading = renderToStaticMarkup(
    <FlagQueueView
      counts={null}
      isLoading
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div />}
      panel={<div />}
    />
  );
  assert.doesNotMatch(loading, /no longer have a matching flag|changed since/);

  const failed = renderToStaticMarkup(
    <FlagQueueView
      counts={null}
      error={new Error("boom")}
      isLoading={false}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div />}
      panel={<div />}
    />
  );
  assert.doesNotMatch(failed, /no longer have a matching flag|changed since/);
  void orphans;
});

// The safeguard that makes the per-flag invariant safe in practice. Ada is in
// the repeatedly-late group AND in a row of her own for a three-hour gap;
// excusing the group, believing she is dealt with, and never seeing the gap is
// the exact failure this badge exists to prevent — so it has to be on BOTH of
// her rows, not just the one HR happens to open first.
test("a person in two entries carries the cross-reference badge in both", () => {
  const group = patternGroupEntry();
  const html = renderToStaticMarkup(
    <FlagQueueList
      entries={[group, outlierPersonEntry()]}
      {...listProps()}
      // Expanded on purpose: a collapsed group renders no member rows at all,
      // so the member copy of the badge would have nowhere to appear.
      expandedGroupKey={group.group_key}
    />
  );

  // Worded from each side's own counts, and each on its OWN row — scoped per
  // button, because two correctly worded badges both sitting on the lone row
  // would satisfy a whole-markup count while telling HR nothing about the
  // group. Ada's two rows are told apart by their headlines: three late starts
  // in the group, the unpatterned three-hour gap on her own.
  const member = rowWith(html, "Ada Lovelace", "late starts");
  const lone = rowWith(html, "Ada Lovelace", "Missing 3h");
  assert.match(member, /also 1 outlier/, "the group member is badged");
  assert.match(lone, /also 1 elsewhere/, "and so is the lone row");
  // Grace is in one entry only, and a badge on her would be a false alarm.
  assert.doesNotMatch(rowWith(html, "Grace Hopper"), /also /, "nobody else is badged");
  assert.equal(html.split("also ").length - 1, 2, "…and no badge anywhere else either");
});

// The badge's primary surface, and the one it was missing. "Who this covers" is
// the list HR reads immediately before a bulk excuse — the exact moment the
// safeguard is for. A member only reaches PersonRow after clicking "Decide one
// by one", i.e. after abandoning the bulk path the badge exists to guard.
test("the bulk panel's member list badges a member who is also in another entry", () => {
  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: patternGroupEntry() })} />
  );
  const items = memberListItems(html);
  assert.equal(items.length, 2, "both members are listed");

  const ada = items.find((item) => item.includes("Ada Lovelace"));
  const grace = items.find((item) => item.includes("Grace Hopper"));
  assert.ok(ada && grace, "both members are identifiable");
  assert.match(ada, /also 1 outlier/, "the member with a second entry is badged here too");
  assert.doesNotMatch(grace, /also /, "and the member with only this one is not");

  // Once, on her row — not on the group header, where it would read as a fact
  // about the group rather than about one person in it.
  assert.equal(html.split("also 1 outlier").length - 1, 1);
});

test("a repeat pattern row states its title and its two dimensions", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList entries={[patternGroupEntry()]} {...listProps()} />
  );
  // Asserted by slot, not by presence: rendered into each other's places the
  // row would headline itself "2 people · 6 mornings" and demote the title to
  // the subline, and a pair of whole-markup matches would still pass.
  assert.equal(slotText(html, TITLE_SLOT), "Repeatedly late");
  // Both numbers. "2 people" alone is how the header started disagreeing with
  // the list: six mornings are hiding behind those two members.
  assert.equal(slotText(html, SUBLINE_SLOT), "2 people · 6 mornings");
});

test("the same person in two entries produces two distinct row keys", () => {
  // A collision would make selecting the outlier select the group member: the
  // page holds one string as its selection, and these two rows are the same
  // employee on the same headline day.
  const group = patternGroupEntry();
  const loner = outlierPersonEntry();
  const member = group.members[0];
  assert.equal(member.employee, loner.employee, "the fixture is the collision case");
  assert.equal(member.attendance_date, loner.attendance_date, "…on one headline day");

  assert.notEqual(entryKey(loner), entryKey({ kind: "person", ...member }));
});

test("the header states people and rows", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 9, needs_re_review: 0, decided: 0, people: 40, rows: 12 }}
      {...viewProps()}
    />
  );
  // Not "40 people with something open": before nesting, the header counted
  // employees while the list showed one row per person-day, so the two numbers
  // described different things and disagreed on screen.
  assert.match(html, /40 people · 12 rows/);
});

test("a flag card is dated by its own flag, not by the person's headline day", () => {
  // A pattern member spans dates; dating every card by person.attendance_date
  // would label three different mornings as the same day.
  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: spanPersonEntry() })} />
  );
  assert.match(html, /3 Aug/);
  assert.match(html, /4 Aug/);
  assert.match(html, /5 Aug/);
});

test("a multi-day entry's header names the range, not just the headline day", () => {
  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: spanPersonEntry() })} />
  );
  assert.ok(
    panelHeader(html).includes(
      `${formatFlagContextDate("2026-08-03")} – ${formatFlagContextDate("2026-08-05")}`
    ),
    "the span is stated end to end, so the last two mornings are not mislabelled"
  );
});

test("a single-day entry's header still names one day", () => {
  const header = panelHeader(
    renderToStaticMarkup(<FlagDecisionPanel {...panelProps({ entry: outlierPersonEntry() })} />)
  );
  assert.ok(header.includes(formatFlagContextDate(DATE)));
  assert.ok(!header.includes(" – "), "no range where there is only one day");
});

// REPEAT_PATTERN carries attendance_date: null — it spans dates by definition —
// and date-fns throws on an invalid date. Handing that null to a date formatter
// is a crash on the first pattern group HR opens, not a cosmetic wobble, so
// this pins that the header degrades to the span instead.
test("a repeat pattern group's panel header survives its null date", () => {
  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: patternGroupEntry() })} />
  );
  assert.match(html, /Repeatedly late/);
  assert.match(html, /2 people · 6 mornings/);
});

test("a dated group's panel header still names its day and its size", () => {
  const group: QueueEntry = {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ:2026-08-03",
    branch: "Phnom Penh HQ",
    flag_code: null,
    attendance_date: DATE,
    rank: 150,
    tier: "act",
    members: [
      makePerson({
        employee: "HR-EMP-00002",
        name: "Grace Hopper",
        rank: 150,
        tier: "act",
        flags: [makeFlag({ identity: "id-a", code: "UNNOTIFIED_ABSENCE", rank: 150, tier: "act" })],
      }),
      makePerson({
        employee: "HR-EMP-00003",
        name: "Katherine Johnson",
        rank: 150,
        tier: "act",
        flags: [makeFlag({ identity: "id-b", code: "UNNOTIFIED_ABSENCE", rank: 150, tier: "act" })],
      }),
    ],
  };

  const header = panelHeader(renderToStaticMarkup(<FlagDecisionPanel {...panelProps({ entry: group })} />));
  assert.ok(header.includes(formatFlagContextDate(DATE)), "a group with one day still names it");
  assert.match(header, /2 people/);
  assert.doesNotMatch(header, /mornings/, "only a repeat pattern counts occurrences");
});

test("a person row leads with their photo and states the finding with its day", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList entries={[missingTimePerson()]} {...listProps()} />
  );
  assert.match(html, /<img[^>]+src="\/files\/sokheng\.jpg"/);
  assert.match(html, /Sokheng Hon/);
  assert.match(html, /Thu 6 Aug/);
});

test("a person with several days of one code gets no single date", () => {
  // "4 late starts · worst 31 min" — naming one day would be wrong for the
  // other three.
  const html = renderToStaticMarkup(<FlagQueueList entries={[repeatPerson()]} {...listProps()} />);
  assert.match(html, /4 late starts · worst 31 min/);
  assert.equal(/· \w{3} \d+ \w{3}/.test(html), false);
});

test("a person with no photo still leads with an avatar, not a gap", () => {
  const html = renderToStaticMarkup(<FlagQueueList entries={[repeatPerson()]} {...listProps()} />);
  assert.match(html, />VL</);
  assert.equal(html.includes("<img"), false);
});

test("every row's strip has the same cell count, so the column is stable", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList entries={[missingTimePerson(), repeatPerson()]} {...listProps()} />
  );
  const counts = [...html.matchAll(/data-strip-cells="(\d+)"/g)].map((m) => m[1]);
  assert.equal(counts.length, 2);
  assert.equal(new Set(counts).size, 1);
});

test("a group header shows who is in it, not a strip", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList entries={[patternGroupEntry()]} {...listProps()} />
  );
  assert.match(html, /<img/); // member avatars
  assert.equal(html.includes("data-strip-cells"), false);
  // The faces answer "who is in here?" by sight; the sub-line answers it in
  // words. Exposing the cluster as well would read as a stray "+2" after the
  // headline, so it stays out of the accessibility tree whole.
  assert.match(html, /aria-hidden="true"[^>]*><span class="[^"]*size-7/);
});

// The strip is keyed by EMPLOYEE, not by the entry being rendered — that is
// what makes the cross-reference badge visible rather than merely counted.
// Ada's three-hour gap lives in a second entry, and if her member row's strip
// were built from this entry's flags alone it would be four routine cells with
// the act-tier day nowhere on screen: exactly the omission the badge exists to
// prevent.
test("a member's strip shows the flag from their other entry, and only on their row", () => {
  const group = patternGroupEntry();
  const html = renderToStaticMarkup(
    <FlagQueueList
      entries={[group, outlierPersonEntry()]}
      {...listProps()}
      expandedGroupKey={group.group_key}
    />
  );

  const ada = rowWith(html, "Ada Lovelace", "late starts");
  const grace = rowWith(html, "Grace Hopper");
  assert.match(ada, /h-3\.5 bg-destructive/, "her gap shows as an act-tier cell inside the group");
  assert.doesNotMatch(grace, /h-3\.5 bg-destructive/, "and it is on her row, not her colleague's");
});

// EmployeeAvatar's loading ring is a role="status" live region whose delay
// timer starts at MOUNT, not at fetch start — forty rows would queue forty
// "Loading" announcements for a photo that is `alt=""` beside a name already
// rendered as text. The avatar tells a screen reader nothing the row does not
// already say, so it is hidden whole rather than announced forty times.
test("a row's avatar is decoration to a screen reader, ring and all", () => {
  const row = rowWith(
    renderToStaticMarkup(<FlagQueueList entries={[missingTimePerson()]} {...listProps()} />),
    "Sokheng Hon"
  );
  assert.match(row, /aria-hidden="true"[^>]*><span class="[^"]*size-10/);
  // …while the strip keeps its one summary: it carries a fact — how many days
  // of this fortnight are flagged — that appears nowhere else in the row.
  assert.match(row, /aria-label="1 flagged day in the last 14"/);
});
