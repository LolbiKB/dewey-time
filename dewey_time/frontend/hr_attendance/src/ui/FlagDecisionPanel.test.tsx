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
  attendance_date: "2026-08-04",
  severity: "WARNING",
  day_closed: 0,
  evidence: SINGLE_CHECKIN_EVIDENCE,
  rank: 140,
  tier: "act",
  decision_state: "undecided",
  decision: null,
};

// Typed as the person variant rather than the whole union: every use below
// spreads it, and spreading a union yields a union of object types that no
// longer narrows back to QueueEntry.
type PersonEntry = Extract<QueueEntry, { kind: "person" }>;

const ENTRY: PersonEntry = {
  kind: "person",
  entry_key: "p:EMP-0002",
  employee: "EMP-0002",
  employee_name: "Jane Doe",
  employee_branch: null,
  employee_image: null,
  attendance_date: "2026-08-04",
  dates: ["2026-08-04"],
  rank: 140,
  tier: "act",
  flags: [FLAG_OUT],
  undecided_count: 1,
  also_count: 0,
  also_outlier_count: 0,
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
    expandedIdentity: null,
    onExpandFlag: () => {},
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
  const entry: PersonEntry = { ...ENTRY, flags: [flagWithLeftover] };

  const html = renderToStaticMarkup(<FlagDecisionPanel {...baseProps()} entry={entry} />);
  const detailsStart = html.indexOf("<details");
  assert.notEqual(detailsStart, -1, "expected a collapsed disclosure for the full evidence blob");
  const primaryRegion = html.slice(0, detailsStart);
  const disclosureRegion = html.slice(detailsStart);

  assert.doesNotMatch(primaryRegion, /bridge retry/, "leftover evidence must not reach the primary region");
  assert.match(disclosureRegion, /bridge retry #3/, "leftover evidence must still be reachable in the disclosure");
});
