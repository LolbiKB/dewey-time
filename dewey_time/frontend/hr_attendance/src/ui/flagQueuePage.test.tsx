import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { PendingDecision } from "@/lib/flagDecisionState";
import { formatFlagContextDate } from "@/lib/flagDetails";
import { outageKey } from "@/lib/flagStrip";
import { outageWrite, partitionQueue, queuePeopleCount } from "@/lib/flagQueuePartition";
import {
  DECIDE_AGAIN_LABEL,
  RANGE_FROM_LABEL,
  RANGE_TO_LABEL,
  SAME_REASON_LABEL,
  SHOWING_DECIDED_MESSAGE,
  TIER_FILTER_LABEL,
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
  clampRange,
  confirmArgs,
  decideEffect,
  parseTierParam,
  stripInputs,
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
    dates: [],
    day_count: 0,
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

/**
 * Everything FlagQueueView needs except `counts`, which each test supplies.
 *
 * The band's props default to a healthy day — no outage, so no band — because
 * that is the state every test here that is not about the band assumes.
 */
function viewProps(): Omit<FlagQueueViewProps, "counts"> {
  return {
    range: { startDate: "2026-07-21", endDate: "2026-08-03" },
    onRangeChange: () => {},
    onNarrowRange: () => {},
    tier: null,
    onTierChange: () => {},
    isLoading: false,
    error: null,
    onRetry: () => {},
    bulkFailure: null,
    outages: [],
    queuePeople: 0,
    queueRows: 0,
    excludedBranches: new Set<string>(),
    onToggleBranch: () => {},
    onExcuseOutages: () => {},
    list: <div />,
    panel: <div />,
  };
}

// The range and tier were a module constant and a hard-coded null, so the page
// told HR to "narrow the dates" while offering nothing that could, and the
// backend's tier filter was never sent. These pin the parsing either side of the
// URL, which is the part that can silently go wrong.
test("an unknown tier param is ignored rather than filtering to nothing", () => {
  // Passing it through would ask the server for a tier it rejects (417), and
  // swallowing the error would render an empty queue that looks like "all clear".
  assert.equal(parseTierParam("urgent"), null);
  assert.equal(parseTierParam(""), null);
  assert.equal(parseTierParam(null), null);
});

test("each real tier round-trips through the URL", () => {
  assert.equal(parseTierParam("act"), "act");
  assert.equal(parseTierParam("review"), "review");
  assert.equal(parseTierParam("routine"), "routine");
});

test("a range longer than the server's cap gives up its OLDEST days", () => {
  // Trimming the recent end would hide today's work — the same defect the flag
  // scan's ordering was fixed for. 2026-01-01..2026-03-01 is 60 days; the cap is 31.
  const range = clampRange("2026-01-01", "2026-03-01");
  assert.equal(range.endDate, "2026-03-01", "the recent end is kept");
  assert.equal(range.startDate, "2026-01-30", "31 days back from the end, inclusive");
});

test("a range inside the cap is left exactly as asked", () => {
  const range = clampRange("2026-08-01", "2026-08-07");
  assert.deepEqual(range, { startDate: "2026-08-01", endDate: "2026-08-07" });
});

test("an inverted or unparseable range falls back rather than throwing", () => {
  // getdate() would 417 on an inverted range and the page would render its
  // failure block — for a URL a user can produce by typing.
  const inverted = clampRange("2026-08-07", "2026-08-01");
  const garbage = clampRange("not-a-date", "2026-08-07");
  for (const range of [inverted, garbage]) {
    assert.match(range.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(range.endDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(range.startDate <= range.endDate);
  }
});

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
/** A person row's sub-line is its own slot — a group's carries `tabular-nums`. */
const PERSON_SUBLINE_SLOT = "block truncate text-xs text-muted-foreground";

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
    dates: [DATE],
    day_count: 1,
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

  // `>Ada Lovelace<` — the name as TEXT, not as any occurrence of the string.
  // A bare substring count also matched the `title` attribute the row carries
  // for long names, so it counted markup rather than rows. This proxy is the
  // stricter of the two: it still fails if the person is rendered twice, and it
  // no longer fails when an attribute happens to repeat the name.
  assert.equal(
    html.split(">Ada Lovelace<").length - 1,
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
    group_key: "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ",
    branch: "Phnom Penh HQ",
    flag_code: null,
    attendance_date: DATE,
    dates: [DATE],
    day_count: 1,
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
    group_key: "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ",
    branch: "Phnom Penh HQ",
    flag_code: null,
    attendance_date: DATE,
    dates: [DATE],
    day_count: 1,
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
  const counts = { open: 12, needs_re_review: 5, open_capped: false, decided: 88, people: 40, rows: 12 };

  const off = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
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
      {...viewProps()}
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
      {...viewProps()}
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
      {...viewProps()}
      counts={{ open: 12, needs_re_review: 5, open_capped: false, decided: 88, people: 40, rows: 12 }}
      // Non-zero: the queue itself must render below the strip, and a queue
      // with nothing in it now renders the "Nothing waiting" empty state
      // instead of `list`/`panel` — the exact swap this test's sentinels
      // exist to catch.
      queuePeople={1}
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

// Open and Needs re-review used to be permanent chips beside Decided; both are
// gone now (Open moved into the header's description line via
// queueSplitDescription, and Needs re-review read 0 on every day the queue has
// ever seen). Decided is the one survivor, and it is the toolbar's only count.
test("the toolbar reports the decided count, and nothing else", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      counts={{ open: 12, needs_re_review: 5, open_capped: false, decided: 88, people: 40, rows: 12 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div />}
      panel={<div />}
    />
  );

  assert.ok(html.includes("Decided"));
  assert.ok(html.includes(">88<"));
  assert.ok(!/Needs re-review/.test(html));
  assert.ok(!/>Open</.test(html));
});

// The alerts array is NOT derived from flags — it is read straight from Device
// Closeout Alert. When a device reports deferred_offline/closure_failed the
// fallback path skips those employees and generates nothing, so a queue built
// only from flag rows shows an empty, reassuring screen during a real outage.
test("device alert cards render from alerts, with no flags present", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      counts={{ open: 0, needs_re_review: 0, open_capped: false, decided: 0, people: 0, rows: 0 }}
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
      {...viewProps()}
      counts={{ open: 0, needs_re_review: 0, open_capped: false, decided: 0, people: 0, rows: 0 }}
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
      {...viewProps()}
      counts={{ open: 0, needs_re_review: 0, open_capped: false, decided: 0, people: 0, rows: 0 }}
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
  source: "panel",
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
      {...viewProps()}
      counts={{ open: 12, needs_re_review: 5, open_capped: false, decided: 88, people: 40, rows: 12 }}
      // Non-zero for the same reason as the bulk-failure test above: an empty
      // queue now renders the "Nothing waiting" state instead of these
      // sentinels.
      queuePeople={1}
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
    dates: [DATE],
    day_count: 1,
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
      {...viewProps()}
      counts={{ open: 0, needs_re_review: 0, open_capped: false, decided: 0, people: 0, rows: 0 }}
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
  const counts = { open: 12, needs_re_review: 5, open_capped: false, decided: 88, people: 40, rows: 12 };

  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
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
  const counts = { open: 12, needs_re_review: 5, open_capped: false, decided: 88, people: 40, rows: 12 };
  const render = (orphans: { orphaned_flag_gone: number; orphaned_evidence_changed: number }) =>
    renderToStaticMarkup(
      <FlagQueueView
        {...viewProps()}
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
      {...viewProps()}
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
      {...viewProps()}
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
  // `>also …<` — the badge as rendered TEXT. A row's aria-label now restates the
  // badge (deliberately: it is the safeguard, so it has to be spoken as well as
  // shown), which means a bare substring count sees each badge twice. Matching
  // the text node counts badges rather than mentions, and stays strict about the
  // thing this test is for: exactly two rows carry one.
  const member = rowWith(html, "Ada Lovelace", "late starts");
  const lone = rowWith(html, "Ada Lovelace", "Missing 3h");
  assert.match(member, />also 1 outlier</, "the group member is badged");
  assert.match(lone, />also 1 elsewhere</, "and so is the lone row");
  // Grace is in one entry only, and a badge on her would be a false alarm.
  assert.doesNotMatch(rowWith(html, "Grace Hopper"), />also /, "nobody else is badged");
  assert.equal(html.split(">also ").length - 1, 2, "…and no badge anywhere else either");
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

test("the header states people and rows — the queue's own, not the payload's", () => {
  // `counts` deliberately disagrees with the queue props here. Both payload
  // numbers still include the outage entries the band now renders, so reading
  // either one would put the band's population back into the sentence that says
  // who is waiting on HR — the exact overcount the band exists to end.
  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      counts={{ open: 9, needs_re_review: 0, open_capped: false, decided: 0, people: 296, rows: 147 }}
      queuePeople={40}
      queueRows={12}
    />
  );
  // Not "40 people with something open": before nesting, the header counted
  // employees while the list showed one row per person-day, so the two numbers
  // described different things and disagreed on screen.
  assert.match(html, /40 people need a decision · 12 rows/);
  assert.doesNotMatch(html, /296/, "counts.people is not the header's people");
  assert.doesNotMatch(html, /147/, "counts.rows is not the header's rows");
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

// ROUTINE_CODE, not BRANCH_NO_DEVICE_DATA: an outage group spans dates now and
// build_queue always sends it a null attendance_date, so pinning the dated-header
// branch on an outage would pin it on a shape the backend can no longer produce.
// ROUTINE_CODE is keyed by code + date and is the group type that still has one.
test("a dated group's panel header still names its day and its size", () => {
  const group: QueueEntry = {
    kind: "group",
    group_type: "ROUTINE_CODE",
    group_key: `ROUTINE_CODE:UNNOTIFIED_ABSENCE:${DATE}`,
    branch: null,
    flag_code: "UNNOTIFIED_ABSENCE",
    attendance_date: DATE,
    dates: [DATE],
    day_count: 1,
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

// Asserted by slot, not by presence: a single-entry render makes every
// whole-markup match trivially true, so "Thu 6 Aug" appearing SOMEWHERE would
// still pass with the date leaked into the title slot beside the name.
test("a person row leads with their photo and states the finding with its day", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList entries={[missingTimePerson()]} {...listProps()} />
  );
  assert.match(html, /<img[^>]+src="\/files\/sokheng\.jpg"/);
  assert.equal(slotText(html, TITLE_SLOT), "Sokheng Hon");
  assert.equal(slotText(html, PERSON_SUBLINE_SLOT), "Missing 3h 12m · Thu 6 Aug");
});

test("a person with several days of one code gets no single date", () => {
  // "4 late starts · worst 31 min" — naming one day would be wrong for the
  // other three.
  const html = renderToStaticMarkup(<FlagQueueList entries={[repeatPerson()]} {...listProps()} />);
  assert.equal(slotText(html, PERSON_SUBLINE_SLOT), "4 late starts · worst 31 min");
  // Nowhere in the row, not merely out of the sub-line: a date pushed into the
  // title slot instead would be just as wrong.
  assert.equal(/· \w{3} \d+ \w{3}/.test(html), false);
});

test("a person with no photo still leads with an avatar, not a gap", () => {
  const html = renderToStaticMarkup(<FlagQueueList entries={[repeatPerson()]} {...listProps()} />);
  assert.match(rowWith(html, "Vichea Lim"), />VL</, "the initials stand in for the photo");
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
  //
  // Asserted as "the cluster opens inside the hidden wrapper and every avatar
  // is within it", not as "the wrapper's immediate child is an avatar" — the
  // cluster is an AvatarGroup now, so the avatars sit one level deeper, and the
  // property that matters is containment rather than adjacency.
  const hidden = html.slice(html.indexOf('aria-hidden="true"><div data-slot="avatar-group"'));
  assert.notEqual(hidden, html, "the avatar cluster opens inside the aria-hidden wrapper");
  const clusterEnd = hidden.indexOf("</span>", hidden.lastIndexOf("size-7"));
  assert.ok(clusterEnd > 0, "the cluster closes");
  // Every size-7 avatar in the document is inside that hidden subtree.
  assert.equal(
    html.split("size-7").length,
    hidden.split("size-7").length,
    "no avatar renders outside the aria-hidden cluster",
  );
});

// GROUP_AVATAR_LIMIT is 4: past that the faces out-argue the row's own headline,
// so the rest become a count. Every other group fixture here has two members, so
// only this one renders the overflow chip at all — without it, the limit and the
// count behind it are both decoration.
test("a group with more faces than fit shows four and counts the rest", () => {
  const group = patternGroupEntry();
  const members = [
    ...group.members,
    ...["Katherine Johnson", "Mary Jackson", "Dorothy Vaughan", "Annie Easley"].map((name, i) =>
      patternMember({ employee: `HR-EMP-0002${i}`, name, image: `/files/member-${i}.jpg` })
    ),
  ];
  assert.equal(members.length, 6, "the fixture is over the limit");

  const html = renderToStaticMarkup(
    <FlagQueueList entries={[{ ...group, members }]} {...listProps()} />
  );
  assert.equal(html.split("<img").length - 1, 4, "four faces, not six");
  assert.match(html, />\+2</, "and the two that did not fit are counted");
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
  // Containment, not adjacency: the avatar's root now leads with
  // `data-slot="avatar"` (so AvatarGroup can style it), which pushed `class`
  // along and broke a pattern that required the two to be neighbours. What the
  // test is actually for — the avatar sits inside the aria-hidden wrapper and
  // no avatar renders outside one — is asserted directly.
  const hidden = row.slice(row.indexOf('aria-hidden="true"'));
  assert.match(hidden, /data-slot="avatar"[^>]*class="[^"]*size-10/);
  assert.equal(
    row.split("size-10").length,
    hidden.split("size-10").length,
    "no avatar renders outside the aria-hidden wrapper",
  );
  // …while the strip keeps its one summary: it carries a fact — how many days
  // of this fortnight are flagged — that appears nowhere else in the row.
  assert.match(row, /aria-label="1 flagged day in the last 14"/);
});

// The one line that feeds real outage data to the strip, and the reason it is
// exported rather than inline: `buildOutageSet(outageDates)` sitting in the
// component body is unreachable from a suite with no react-query harness, so
// replacing it with `buildOutageSet([])` would paint every unmeasured day
// emerald — the exact lie the grey state exists to stop — while `tsc` and every
// other test in this file stayed green.
test("the page hands the list the payload's outages, not an empty set", () => {
  const payload = {
    outageDates: [{ branch: "Phnom Penh HQ", date: "2026-08-04" }],
    range: { startDate: "2026-07-25", endDate: "2026-08-07" },
  };
  const inputs = stripInputs(payload);

  assert.deepEqual(inputs.range, payload.range, "the strip's window comes from the payload");
  assert.equal(inputs.outage.has(outageKey("Phnom Penh HQ", "2026-08-04")), true);
  assert.equal(inputs.outage.has(outageKey("Phnom Penh HQ", "2026-08-05")), false);

  // …and end to end, because a set nobody renders proves nothing: Sokheng's
  // branch is Phnom Penh HQ, so 4 Aug is grey in his row and green without it.
  const withOutage = renderToStaticMarkup(
    <FlagQueueList entries={[missingTimePerson()]} {...listProps()} {...inputs} />
  );
  assert.match(rowWith(withOutage, "Sokheng Hon"), /bg-muted-foreground\/30/);

  const withoutOutage = renderToStaticMarkup(
    <FlagQueueList
      entries={[missingTimePerson()]}
      {...listProps()}
      {...stripInputs({ ...payload, outageDates: [] })}
    />
  );
  assert.doesNotMatch(rowWith(withoutOutage, "Sokheng Hon"), /bg-muted-foreground\/30/);
});

/**
 * One branch that lost its device, with two people behind it — and the second
 * one already decided.
 *
 * That second member is the whole point of the fixture. She is still someone
 * the outage touched, so `queuePeopleCount` counts her (2), but she has nothing
 * left to write, so `outageWrite(...).coveredEmployeeCount` does not (1). With a
 * single undecided member the two numbers are equal and the header could read
 * from either source while every assertion passed — which is the state the Task
 * 4 review found this fixture in, after three earlier rounds had established
 * that only one of the two sources is correct.
 */
function outageBranchEntry(): GroupEntry {
  return {
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
    members: [
      patternMember({ employee: "DI-1", name: "Ada Lovelace" }),
      makePerson({
        employee: "DI-2",
        name: "Grace Hopper",
        rank: 134,
        tier: "act",
        entryKey: "BRANCH_NO_DEVICE_DATA:DIS Iconic|p:DI-2",
        flags: [
          makeFlag({
            identity: "id-outage-DI-2",
            code: "ATTENDANCE_ISSUE",
            rank: 134,
            tier: "act",
            evidence: { reason: "single_checkin" },
            state: "matched",
            decision: PRIOR,
          }),
        ],
      }),
    ],
  };
}

test("an outage group is rendered as the band, not as a queue row", () => {
  const outageGroup = outageBranchEntry();
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

test("a failed load withholds the band, not just the list", () => {
  // react-query keeps the last good `data` when a refetch fails, so `outages`
  // can outlive the payload it came from. Every other stale thing on this page
  // is merely misleading; this one carries the largest write the page can make,
  // and "Excuse 1 person · 3 flags" above "Flags didn't load" is an invitation
  // to decide over data the page has just disowned.
  const outages = partitionQueue([outageBranchEntry()]).outages;
  assert.equal(outages.length, 1, "the fixture is the stale-data case");

  const failed = renderToStaticMarkup(
    <FlagQueueView {...viewProps()} counts={null} error={new Error("Network request failed")} outages={outages} />
  );
  assert.doesNotMatch(failed, /had no device data/, "no band beside a failure");
  assert.doesNotMatch(failed, /Excuse/, "and nothing to press");

  const loading = renderToStaticMarkup(
    <FlagQueueView {...viewProps()} counts={null} isLoading outages={outages} />
  );
  assert.doesNotMatch(loading, /had no device data/, "nor beside a spinner");

  // …and it is back the moment the load succeeds, so this is a guard and not a
  // way of losing the band.
  const loaded = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      counts={{ open: 3, needs_re_review: 0, decided: 0, people: 1, rows: 1, open_capped: false }}
      outages={outages}
    />
  );
  assert.match(loaded, /had no device data/);
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

test("the header's device line counts everyone the outage touched, not just the write", () => {
  // Three rounds of review settled that this number is `queuePeopleCount`, and
  // no test would have failed if it were swapped back to
  // `outageWrite(...).coveredEmployeeCount`. The difference only shows on a
  // fixture where some of the outage's flags are already decided — which is the
  // ordinary state of an outage part-way through being cleared, and the state
  // this line goes wrong in: covered shrinks as decisions land and reaches zero
  // once the excuse is complete, so the header would announce that nobody is
  // waiting on a device fault while the band directly above it still names the
  // branch.
  const outages = partitionQueue([outageBranchEntry()]).outages;
  assert.equal(queuePeopleCount(outages), 2, "two people are behind this outage");
  assert.equal(
    outageWrite(outages, new Set<string>()).coveredEmployeeCount,
    1,
    "…but only one of them still has anything to write",
  );

  const html = renderToStaticMarkup(
    <FlagQueueView
      {...viewProps()}
      counts={{ open: 9, needs_re_review: 0, decided: 0, people: 7, rows: 3, open_capped: false }}
      outages={outages}
      queuePeople={5}
      queueRows={2}
    />
  );

  assert.match(html, /5 people need a decision · 2 rows · 2 waiting on a device fault/);
  assert.doesNotMatch(html, /1 waiting on a device fault/, "not the write's covered count");
});

test("a confirmed re-issue is the same call plus confirm — including its source", () => {
  // decide_flags refuses more than 25 writes without an explicit confirm, so
  // every large write takes this path: the user is shown a blast radius and the
  // identical call is sent again. Any field that changes in between makes the
  // preview they approved a description of a different call. `source` is the one
  // that would do real harm — a band excuse re-issued as "panel" would offer
  // "Excused · Device or data fault" as the selected person's repeat and drag
  // them off their row, which is exactly what the discriminant prevents, and it
  // would do it only on the path the biggest writes always take.
  const band: DecideArgs = {
    identities: ["id-1", "id-2"],
    decision: { outcome: "EXCUSED", reason: "DEVICE_OR_DATA_FAULT", note: "" },
    groupKey: null,
    source: "band",
  };

  assert.deepEqual(confirmArgs(band), { ...band, confirm: true });
  assert.equal(confirmArgs(band).source, "band", "the surface survives the round trip");
  assert.equal(confirmArgs(ARGS).source, "panel");
  // The original is untouched: it stays in `pendingConfirm` while the modal is
  // open, and the user may yet cancel.
  assert.equal(band.confirm, undefined);
});

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
  // `aria-label` beats name-from-content unconditionally on a <button>, so it
  // would silence the formatted date already inside it, leaving a screen
  // reader hearing a bare "From" with no value — the exact regression a prior
  // review round caught. The name is visually-hidden button CONTENT instead,
  // so it composes with the date rather than replacing it. Matched against the
  // module's own constants, not a hand-typed duplicate of them (Constraint 2 /
  // "violation #6" on this plan).
  assert.match(html, new RegExp(`<span class="sr-only">${RANGE_FROM_LABEL}</span>`));
  assert.match(html, new RegExp(`<span class="sr-only">${RANGE_TO_LABEL}</span>`));
  // The <select> has no visible value distinct from its accessible name the
  // way a date button does — the browser always exposes the selected
  // <option>'s own text as the control's value regardless of `aria-label` — so
  // an attribute is fine here.
  assert.match(html, new RegExp(`aria-label="${TIER_FILTER_LABEL}"`));
  // No visible label row: dewey-ui's `Label` renders a `<label>` element, and
  // the previous version of this assertion (`class="text-xs"`) could never
  // fail — `cn()` merges that class into a long string, so the literal
  // attribute value is never emitted, passing whether or not a visible label
  // rendered. Asserted on the element itself instead.
  assert.ok(!/<label[^>]*>From</.test(html), "no visible label row");
});

// The old strip named two levers ("narrow the dates, or filter by consequence")
// and offered neither. This one has to actually offer them.
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
