import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { BiometricEnrollmentView } from "@/ui/BiometricEnrollmentView";
import type { EnrollmentPayload, EnrollmentRow } from "@/lib/enrollmentReport";

const page = readFileSync(
  new URL("./schedule-coverage/BiometricEnrollmentPage.tsx", import.meta.url),
  "utf8",
);

function row(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "E1", employee_name: "Ana Reyes", branch: "ACES", department: "Ops",
    status: "Active", bucket: "NEEDS_ENROLLMENT", is_registered: false,
    fingerprint_count: 0, face_count: 0, days_since_relieving: null, ...over,
  };
}

function payload(over: Partial<EnrollmentPayload> = {}): EnrollmentPayload {
  return {
    rows: [row()],
    counts: { reported: 1, needs_enrollment: 1, enrolled_not_punching: 0, ok: 0,
              leaver_still_enrolled: 0, excluded_status: 0, truncated: false },
    last_snapshot_at: "2026-08-11 09:14:03",
    window_days: 14,
    ...over,
  };
}

const NOW = new Date("2026-08-11T10:00:00").getTime();

function markup(p: EnrollmentPayload | undefined) {
  return renderToStaticMarkup(<BiometricEnrollmentView payload={p} nowMs={NOW} />);
}

test("it refuses to render the list when the feed has never reported", () => {
  // The load-bearing one: otherwise a plumbing failure renders as every
  // employee needing enrolment.
  const html = markup(payload({ last_snapshot_at: null }));
  assert.match(html, /feed is not connected/i);
  assert.doesNotMatch(html, /Ana Reyes/);
});

test("it renders the roster once a snapshot exists", () => {
  const html = markup(payload());
  assert.match(html, /Ana Reyes/);
  assert.doesNotMatch(html, /feed is not connected/i);
});

test("it shows the snapshot age so the list is never read as live", () => {
  assert.match(markup(payload()), /Device data as of/i);
});

test("a stale snapshot gets amber styling, not the fresh accent", () => {
  const html = markup(payload({ last_snapshot_at: "2026-08-09 09:00:00" }));
  assert.match(html, /amber-500/);
});

test("a leaver with a live template gets its own prominence", () => {
  const html = markup(payload({
    rows: [row({ id: "E9", employee_name: "Sam Okafor", status: "Left",
                 bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
                 fingerprint_count: 2, days_since_relieving: 10 })],
  }));
  assert.match(html, /Left — still enrolled/);
  assert.match(html, /10 days/);
});

test("a leaver of exactly one day reads '1 day', not '1 days'", () => {
  const html = markup(payload({
    rows: [row({ id: "E9", employee_name: "Sam Okafor", status: "Left",
                 bucket: "LEAVER_STILL_ENROLLED", is_registered: true,
                 fingerprint_count: 2, days_since_relieving: 1 })],
  }));
  assert.match(html, /1 day</);
  assert.doesNotMatch(html, /1 days/);
});

test("a payload with no rows says so rather than rendering a blank region", () => {
  // The empty state is not only for a filter that matched nothing: a genuinely
  // zero-row payload took the list branch and rendered an empty div, which
  // reads as a broken page. `visible.length === 0` alone covers both, and is
  // the only form a static render (props in, no clicks) can reach at all.
  const html = markup(payload({
    rows: [],
    counts: { reported: 0, needs_enrollment: 0, enrolled_not_punching: 0, ok: 0,
              leaver_still_enrolled: 0, excluded_status: 0, truncated: false },
  }));
  assert.match(html, /No employees match the current filters/i);
});

test("export is disabled while the roster is truncated", () => {
  // A partial CSV that looks complete is worse than no CSV. Assert the actual
  // `disabled` attribute, not the word "disabled" -- buttonVariants'
  // Tailwind base class unconditionally contains `disabled:pointer-events-none
  // disabled:opacity-50`, so a text match on /disabled/ passes even when the
  // button isn't disabled at all.
  const html = markup(payload({
    counts: { reported: 1, needs_enrollment: 1, enrolled_not_punching: 0, ok: 0,
              leaver_still_enrolled: 0, excluded_status: 0, truncated: true },
  }));
  assert.match(html, /<button[^>]*\sdisabled=""/);
});

test("export is enabled when the roster is complete", () => {
  assert.doesNotMatch(markup(payload()), /\sdisabled=""/);
});

test("employees excluded by status are footnoted, not hidden", () => {
  const html = markup(payload({
    counts: { reported: 1, needs_enrollment: 1, enrolled_not_punching: 0, ok: 0,
              leaver_still_enrolled: 0, excluded_status: 3, truncated: false },
  }));
  assert.match(html, /3 employees are not shown/i);
});

test("the page holds no copy or logic of its own", () => {
  // A second formatting site would drift from the tested one in silence. A
  // doesNotMatch on specific copy strings passes trivially on any reworded
  // drift; pin the absence of state/derivation instead, which the page
  // legitimately never has.
  assert.doesNotMatch(page, /useState|useMemo|enrollmentReport|enrollmentCsv/);
  assert.match(page, /BiometricEnrollmentView/);
});

test("the page turns a non-HR visitor away instead of rendering a failure", () => {
  // The shell hides the Coverage tab from non-HR, but the URL is reachable by
  // bookmark. Without the gate the backend's "Not permitted" surfaced as
  // FailureBlock "Could not load the enrollment report" with a Retry button
  // that can never succeed -- an authorisation denial dressed up as a system
  // fault. The page calls the hook, so it cannot be rendered by this suite;
  // the gate is pinned in source, as the four sibling pages' gates would be.
  assert.match(page, /useOutletContext<HrAccessOutletContext>\(\)/);
  // Adjacency matters, not just presence: the redirect has to be the body of
  // the !hrStaff branch. An unconditional <Navigate> would satisfy two
  // separate assertions and lock every visitor out of the page.
  assert.match(
    page,
    /if \(!hrStaff\)\s*\{?\s*return <Navigate to="\/hr-attendance" replace \/>;/,
  );
  assert.match(page, /if \(sessionLoading\)/);
});
