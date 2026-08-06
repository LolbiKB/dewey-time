import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { PendingDecision } from "@/lib/flagDecisionState";
import {
  SAME_REASON_LABEL,
  applyToRemainingLabel,
  decisionStateLabel,
  outcomeLabel,
  partialFailureMessage,
  reasonLabel,
  tierLabel,
} from "@/lib/flagQueueLabels";
import type { DecisionState, FlagDecision, FlagOut, QueueEntry, QueuePerson, Tier } from "@/types/flags";

import { FlagDecisionPanel, type FlagDecisionPanelProps } from "./FlagDecisionPanel";
import { FlagQueueList } from "./FlagQueueList";
import { FlagQueueView } from "./FlagQueuePage";

const DATE = "2026-08-03";

function makeFlag(args: {
  identity: string;
  code: string;
  rank: number;
  tier: Tier;
  state?: DecisionState;
  decision?: FlagDecision | null;
  evidence?: Record<string, unknown>;
}): FlagOut {
  return {
    flag_identity: args.identity,
    flag_code: args.code,
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
function makePerson(args: {
  employee: string;
  name: string;
  rank: number;
  tier: Tier;
  flags: FlagOut[];
}): QueuePerson {
  return {
    employee: args.employee,
    employee_name: args.name,
    employee_branch: "Phnom Penh HQ",
    attendance_date: DATE,
    rank: args.rank,
    tier: args.tier,
    flags: args.flags,
    undecided_count: args.flags.filter((f) => f.decision_state !== "matched").length,
  };
}

function panelProps(overrides: Partial<FlagDecisionPanelProps>): FlagDecisionPanelProps {
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

// Person-dedup is the whole point of build_queue's "a person appears in exactly
// one entry" rule, and this is where it becomes visible: Ada has a routine
// LATE_START that would otherwise pull her into the routine group as well.
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
    <FlagQueueList
      entries={[routineGroup, { kind: "person", ...ada }]}
      selectedKey={null}
      expandedGroupKey={null}
      onSelect={() => {}}
    />
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
  assert.ok(all.includes(`${outcomeLabel("EXCUSED")} 41`), "all 41 members are included by default");

  const partial = renderToStaticMarkup(
    <FlagDecisionPanel
      {...panelProps({ entry: group, excluded: new Set(["HR-EMP-00007", "HR-EMP-00019"]) })}
    />
  );
  assert.ok(partial.includes(`${outcomeLabel("EXCUSED")} 39`), "two exclusions drop the count to 39");
  assert.ok(
    !partial.includes(`${outcomeLabel("EXCUSED")} 41`),
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
    groupHtml.includes(`${outcomeLabel("EXCUSED")} 1`),
    "one of the two members has anything to write"
  );
  assert.ok(
    !groupHtml.includes(`${outcomeLabel("EXCUSED")} 2`),
    "the checked-but-unwritable member must not be promised"
  );
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
      counts={{ open: 12, needs_re_review: 5, decided: 88, people: 40 }}
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
      counts={{ open: 12, needs_re_review: 5, decided: 88, people: 40 }}
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
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0 }}
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
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0 }}
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
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0 }}
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

test("no alert cards render when the array is empty", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0 }}
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
