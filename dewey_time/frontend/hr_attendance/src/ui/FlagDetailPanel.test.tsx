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
  // Guard against fixture drift: without this, a narrative that stopped
  // returning facts would make the equality below pass as 0 === 0 — the
  // assertion would fail OPEN rather than catching the regression.
  assert.ok(expected.facts.length > 0, "fixture must produce at least one curated fact");
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
  //
  // This is the only coverage anywhere that FlagEvidenceTimeline is rendered
  // by a panel at all, so the fixture must keep earning a timeline: assert it
  // before the branch, or a drifted fixture would skip the check silently
  // instead of failing.
  assert.ok(expected.timeline, "fixture must produce a timeline for this scenario");
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
