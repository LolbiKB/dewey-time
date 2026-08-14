import type { Page } from "@playwright/test";

import type { CalendarSession } from "@/hooks/useCalendarSession";
import type { EnrollmentPayload } from "@/lib/enrollmentReport";
import type { ScheduleCoveragePayload } from "@/lib/scheduleCoverage";
import type { CalendarEmployee, CalendarPayload, Day } from "@/types/calendar";
import type { QueuePayload } from "@/types/flags";
import {
  WEEKDAYS,
  type ApplyScheduleResult,
  type ResolvePlan,
  type ScheduleContext,
} from "@/types/schedule";

/**
 * Network stubs for the HR Attendance SPA.
 *
 * The app reads the logged-in user from `frappe.auth.get_logged_user`, then loads
 * data from the other `/api/method/...` endpoints. We fulfil every API method with
 * canned data so the E2E tests need no Frappe backend. The session cookies are
 * seeded too even though nothing in `src/` reads them: they are what keeps
 * signed-out.spec.ts discriminating, since a regression to cookie-derived auth
 * would show a signed-in user there instead of the sign-in card. Calendar days
 * are generated for whatever date range the app requests, so tests are independent
 * of "today".
 *
 * Every payload below carries a `satisfies` clause naming the type the real
 * endpoint is declared to return (issue #133). `message` is deliberately
 * `unknown` — it has to be, since one handler serves nine differently shaped
 * endpoints — so without those clauses nothing checks these literals against
 * anything, and a backend contract change surfaces as a blank page rather than
 * as a type error. See the header of flags.spec.ts for the full story.
 */

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDays(start: string, end: string) {
  const days: Day[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    const date = ymd(cur);
    days.push({
      date,
      shift: {
        shift_assigned: true,
        shift_type: "FT_0800_1700",
        start_time: "08:00:00",
        end_time: "17:00:00",
        grace_minutes: 0,
        lunch_start: "12:00:00",
        lunch_end: "13:00:00",
      },
      holiday: null,
      leave: { on_leave: false },
      checkins: [
        { time: `${date} 08:11:00`, log_type: "IN", device_id: "DEV-01", custom_device_branch: "BRANCH-A" },
        { time: `${date} 17:05:00`, log_type: "OUT", device_id: "DEV-01", custom_device_branch: "BRANCH-A" },
      ],
      first_in: `${date} 08:11:00`,
      last_out: `${date} 17:05:00`,
      gross_minutes: 534,
      observed_lunch: null,
      flags: [
        {
          name: `AUTO-EMP-001-${date}-LATE_START`,
          flag_code: "LATE_START",
          severity: "WARNING",
          source: "AUTO",
          status: "OPEN",
          day_closed: 1,
          is_provisional: false,
          rule_version: "v0",
          evidence: { late_threshold: `${date}T08:00:00` },
        },
      ],
    } satisfies Day);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Khmer names across the fixtures, in four deliberate shapes.
 *
 * Neither ERPNext field is required and neither is populated for everyone, so
 * all four are real: the longest pair anyone measured, a typical pair, one
 * field only, and nobody at all. They are keyed by employee id and spread into
 * every feed that carries the two raw columns, so one person reads the same way
 * on the register, in a picker and in the flag queue — the drift this whole
 * change exists to remove would otherwise be reintroduced by the fixtures.
 *
 * The fifth entry is not a fifth shape but a fifth SOURCE; see it below.
 *
 * Deliberately un-annotated, so the keys stay literal: `KHMER["EMP-XXX"]` for
 * an employee who is not in here is then a type error rather than an undefined
 * spread that silently drops the Khmer name from one feed.
 */
const KHMER = {
  // Longest pair measured — 194px on one line at 14px semibold, the case every
  // threshold was set from.
  "EMP-002": { custom_khmer_last_name: "ហេង", custom_khmer_first_name: "សុវណ្ណារី" },
  // Typical pair.
  "EMP-001": { custom_khmer_last_name: "ចាន់", custom_khmer_first_name: "សុភា" },
  // One field only — rare, but neither field is required.
  "EMP-104": { custom_khmer_last_name: "លី", custom_khmer_first_name: null },
  // None at all — the handful. Must not look broken.
  "EMP-005": { custom_khmer_last_name: null, custom_khmer_first_name: null },
  // The leaver, who exists in the enrolment feed alone. Coverage returns Active
  // employees only, so this is the one row whose Khmer name can only have come
  // from the second feed — the join branch nothing in a browser had exercised.
  "EMP-900": { custom_khmer_last_name: "សុខ", custom_khmer_first_name: "ដារា" },
} satisfies Record<string, { custom_khmer_last_name: string | null; custom_khmer_first_name: string | null }>;

const EMPLOYEE = {
  id: "EMP-001",
  label: "EMP-001 · Jane Doe",
  employee_name: "Jane Doe",
  ...KHMER["EMP-001"],
  title: "Cashier",
  department: "Retail",
  branch: "BRANCH-A",
  company: "DIS",
  employment_type: "Full-time",
  is_full_time: true,
  has_shift_assignment: true,
  has_shift_schedule_assignment: true,
  shift_schedule_assignment: "HR-SHSA-1",
  schedule_min_date: "2026-01-01",
  schedule_max_date: "2026-12-31",
  first_checkin_date: "2026-01-01",
} satisfies CalendarEmployee;

// Schedule-coverage payload: a few employees with no shift assignment, plus assigned
// employees spread across weekly-hours buckets (incl. one unresolvable 0-minute row).
const COVERAGE = {
  unassigned: [
    { id: "EMP-104", employee_name: "Marco Diaz", ...KHMER["EMP-104"], department: "Warehouse", employment_type: "Full-time", title: "Picker", image: null },
    { id: "EMP-118", employee_name: "Priya Nair", department: "Retail", employment_type: "Part-time Fixed", title: "Cashier", image: null },
    { id: "EMP-131", employee_name: "Tom O'Brien", department: "Retail", employment_type: "", title: "Sales Associate", image: null },
  ],
  assigned: [
    { id: "EMP-001", employee_name: "Jane Doe", ...KHMER["EMP-001"], department: "Retail", employment_type: "Full-time", title: "Cashier", image: null, weekly_minutes: 2400 },
    { id: "EMP-002", employee_name: "Aaron Wells", ...KHMER["EMP-002"], department: "Retail", employment_type: "Full-time", title: "Cashier", image: null, weekly_minutes: 2400 },
    { id: "EMP-003", employee_name: "Bianca Cruz", department: "Warehouse", employment_type: "Full-time", title: "Lead", image: null, weekly_minutes: 2400 },
    { id: "EMP-005", employee_name: "Derek Hale", ...KHMER["EMP-005"], department: "Warehouse", employment_type: "Full-time", title: "Picker", image: null, weekly_minutes: 2400 },
    { id: "EMP-007", employee_name: "Elena Park", department: "Retail", employment_type: "Full-time", title: "Supervisor", image: null, weekly_minutes: 2250 },
    { id: "EMP-009", employee_name: "Farid Khan", department: "Retail", employment_type: "Full-time", title: "Cashier", image: null, weekly_minutes: 2250 },
    { id: "EMP-011", employee_name: "Grace Lin", department: "Retail", employment_type: "Part-time Fixed", title: "Cashier", image: null, weekly_minutes: 1200 },
    { id: "EMP-013", employee_name: "Hugo Mendes", department: "Warehouse", employment_type: "Part-time Fixed", title: "Picker", image: null, weekly_minutes: 1200 },
    { id: "EMP-015", employee_name: "Ivy Chen", department: "Retail", employment_type: "Intern", title: "Trainee", image: null, weekly_minutes: 1200 },
    { id: "EMP-017", employee_name: "Jonas Berg", department: "Warehouse", employment_type: "Full-time", title: "Picker", image: null, weekly_minutes: 0 },
  ],
  counts: { active: 13, unassigned: 3, assigned: 10, truncated: false },
} satisfies ScheduleCoveragePayload;

/**
 * Biometric-enrollment payload — the register's second feed.
 *
 * Needed even by tests that never look at a biometric column. Without a stub
 * the route handler falls through to `message = {}`, and `{}` is not merely
 * "feed unavailable": it is a payload whose required `counts` is missing, which
 * is the partial-body case `registerFeedState` guards with `data?.counts?.…`.
 *
 * One row per bucket, plus a leaver who is absent from COVERAGE entirely —
 * coverage returns Active employees only, so a leaver still holding a template
 * exists in this feed alone, and that row is the security finding the register
 * exists to surface. Employee ids match COVERAGE so the two feeds join.
 */
function enrollmentPayload(): EnrollmentPayload {
  return {
    rows: [
      { id: "EMP-001", employee_name: "Jane Doe", ...KHMER["EMP-001"], branch: "BRANCH-A", department: "Retail", status: "Active", bucket: "OK", is_registered: true, fingerprint_count: 2, face_count: 0, days_since_relieving: null },
      { id: "EMP-002", employee_name: "Aaron Wells", ...KHMER["EMP-002"], branch: "BRANCH-A", department: "Retail", status: "Active", bucket: "ENROLLED_NOT_PUNCHING", is_registered: true, fingerprint_count: 1, face_count: 0, days_since_relieving: null },
      { id: "EMP-104", employee_name: "Marco Diaz", ...KHMER["EMP-104"], branch: "BRANCH-A", department: "Warehouse", status: "Active", bucket: "NEEDS_ENROLLMENT", is_registered: false, fingerprint_count: 0, face_count: 0, days_since_relieving: null },
      { id: "EMP-900", employee_name: "Nora Vance", ...KHMER["EMP-900"], branch: "BRANCH-B", department: "Retail", status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true, fingerprint_count: 2, face_count: 0, days_since_relieving: 42 },
    ],
    counts: {
      reported: 4, needs_enrollment: 1, enrolled_not_punching: 1, ok: 1,
      leaver_still_enrolled: 1, excluded_status: 0, truncated: false,
    },
    // Freshly stamped, in the site-local frame `parseFrappeDatetime` reads it
    // back in. A fixed literal would age past STALE_AFTER_MINUTES (24h) and
    // silently move every test onto the degraded path, where the biometric
    // columns are suppressed — so the healthy path would stop being covered
    // without a single assertion changing.
    last_snapshot_at: frappeDatetime(new Date(Date.now() - 30 * 60_000)),
    window_days: 30,
  };
}

/** `back` days before today, as the "YYYY-MM-DD" key every payload uses. */
function daysAgo(back: number): string {
  const now = new Date();
  return ymd(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - back)));
}

/**
 * The flag queue, holding exactly one thing to decide.
 *
 * There was no `get_flag_queue` branch here at all until now, so the endpoint
 * fell through to `message = {}` and every spec that opened /hr-flags without
 * bringing its own payload got "Nothing needs a decision" — the queue's rows
 * had never been rendered, let alone measured, by anything outside flags.spec.
 *
 * Dates are relative to today for the same reason `buildDays` generates the
 * calendar: `FlagQueuePage` asks for the last 14 days and the strip's window is
 * cut from the payload's own range, so a fixed literal would age out of the
 * fortnight the page requested and stop being a queue row at all.
 *
 * One person, one MISSING_TIME flag of 192 minutes, dated seven days back —
 * `personSubline` renders that as "Missing 3h 12m · <that weekday>", which is
 * the row's whole reason for existing and the first fact `EmployeeIdentity`'s
 * tail ladder can hide.
 */
function flagQueuePayload(): QueuePayload {
  const flagged = daysAgo(7);
  return {
    entries: [
      {
        kind: "person",
        entry_key: "p:EMP-002",
        employee: "EMP-002",
        employee_name: "Aaron Wells",
        employee_branch: "BRANCH-A",
        employee_image: null,
        // The longest measured pair, on the surface with the least room for
        // it: a queue row spends its line on an avatar, the person, and — when
        // `also_count` is non-zero, which it is not here — a cross-reference
        // badge taking a quarter of what is left.
        ...KHMER["EMP-002"],
        attendance_date: flagged,
        dates: [flagged],
        rank: 120,
        tier: "act",
        flags: [
          {
            flag_identity: `AUTO-EMP-002-${flagged}-missing_time`,
            flag_code: "MISSING_TIME",
            attendance_date: flagged,
            severity: "CRITICAL",
            day_closed: 1,
            evidence: { minutes: 192 },
            rank: 120,
            tier: "act",
            decision_state: "undecided",
            decision: null,
          },
        ],
        undecided_count: 1,
        also_count: 0,
        also_outlier_count: 0,
      },
    ],
    counts: { open: 1, needs_re_review: 0, decided: 0, people: 1, rows: 1, open_capped: false },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    outage_dates: [],
    // No pilot windows configured, so the banner stays silent and the one flag
    // above is live work rather than a testing-phase rehearsal.
    rollout: {
      phases_configured: false,
      range_phase: "LIVE",
      testing_flag_count: 0,
      total_flag_count: 1,
      windows: [],
    },
    truncated: false,
    start_date: daysAgo(13),
    end_date: daysAgo(0),
  } satisfies QueuePayload;
}

/** "YYYY-MM-DD HH:MM:SS", local — the frame Frappe sends and the app parses. */
function frappeDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Coverage with nobody left to schedule — every active employee assigned.
 *
 * A VARIANT rather than an edit to COVERAGE: the default payload's three
 * unassigned employees are what keeps the healthy-but-imperfect path (the one
 * every other spec loads) exercised, and quietly clearing them would move the
 * whole suite onto a roster with no findings in it. Paired with
 * `readyEnrollmentPayload` this is the only combination that reaches the alert
 * dot's `clear` tone, which needs `isNotReady` to be false on every row.
 */
export function readyCoveragePayload(): ScheduleCoveragePayload {
  return {
    unassigned: [],
    assigned: COVERAGE.assigned,
    counts: { active: 10, unassigned: 0, assigned: 10, truncated: false },
  } satisfies ScheduleCoveragePayload;
}

/**
 * The residual the 200px threshold narrows but cannot rule out.
 *
 * `EmployeeIdentity`'s threshold is ONE global worst case, not a per-name
 * calculation: the longest pair anyone measured needs 194px, so the Khmer name
 * switches on at 200. A pair longer than that, in a container barely past 200,
 * therefore turns the Khmer name on and then meets line one's `truncate` — and
 * Khmer has no inter-word spaces, so the ellipsis lands mid-cluster. The
 * component's docstring admits this; nothing had ever measured it.
 *
 * A VARIANT rather than an edit to COVERAGE, for the same reason
 * `readyCoveragePayload` is one: every other spec's no-clipping guarantee is
 * about names inside the measured range, and putting this person on the shared
 * roster would quietly turn that guarantee into "except this one".
 */
export function longKhmerCoveragePayload(): ScheduleCoveragePayload {
  return {
    unassigned: COVERAGE.unassigned,
    assigned: COVERAGE.assigned.map((row) =>
      row.id === "EMP-003"
        ? {
            ...row,
            employee_name: "Chandravaddhana Sovannarith",
            custom_khmer_last_name: "ចន្ទ្រាវឌ្ឍនា",
            custom_khmer_first_name: "សុវណ្ណារិទ្ធិ",
          }
        : row,
    ),
    counts: COVERAGE.counts,
  } satisfies ScheduleCoveragePayload;
}

/**
 * A biometric feed with no findings: no NEEDS_ENROLLMENT, no leaver.
 *
 * Every id here is in `readyCoveragePayload`'s assigned list, so the join adds
 * no rows of its own — a leaver present in this feed alone would come back as
 * `still_enrolled` and put the dot straight back on `problem`.
 */
export function readyEnrollmentPayload(): EnrollmentPayload {
  return {
    rows: [
      { id: "EMP-001", employee_name: "Jane Doe", branch: "BRANCH-A", department: "Retail", status: "Active", bucket: "OK", is_registered: true, fingerprint_count: 2, face_count: 0, days_since_relieving: null },
      { id: "EMP-002", employee_name: "Aaron Wells", branch: "BRANCH-A", department: "Retail", status: "Active", bucket: "ENROLLED_NOT_PUNCHING", is_registered: true, fingerprint_count: 1, face_count: 0, days_since_relieving: null },
    ],
    counts: {
      reported: 2, needs_enrollment: 0, enrolled_not_punching: 1, ok: 1,
      leaver_still_enrolled: 0, excluded_status: 0, truncated: false,
    },
    last_snapshot_at: frappeDatetime(new Date(Date.now() - 30 * 60_000)),
    window_days: 30,
  } satisfies EnrollmentPayload;
}

/**
 * The bridge spoke once and has said nothing since — the degraded feed.
 *
 * Same rows as the healthy payload, stamped three days back. That is past
 * STALE_AFTER_MINUTES (24h) but still a snapshot, so `isFeedConnected` holds
 * and the join runs: it is `feedHealth` that turns the biometric half off, and
 * `suppressUnusableFacts` that blanks the facts the join already merged. A
 * `last_snapshot_at: null` would take a different path (never-reported) and
 * would not exercise the suppression at all.
 */
export function staleEnrollmentPayload(): EnrollmentPayload {
  return {
    ...enrollmentPayload(),
    last_snapshot_at: frappeDatetime(new Date(Date.now() - 3 * 24 * 60 * 60_000)),
  } satisfies EnrollmentPayload;
}

/**
 * Per-test replacements for the two coverage feeds.
 *
 * Only the register's own feeds are overridable, because they are the only
 * ones whose degraded shapes a spec needs to reach. Everything else stays
 * canned: a test that could rewrite any endpoint is a test whose fixtures no
 * longer describe the app.
 */
export type FrappeStubOverrides = {
  coverage?: ScheduleCoveragePayload;
  enrollment?: EnrollmentPayload;
  /**
   * What the ONE calendar employee is called.
   *
   * A name and not a payload, because that is the whole of what varies: the
   * calendar roster is a single person and every other field of theirs is
   * beside the point. It is here because the day inspector's header draws the
   * calendar employee — not a register row — so a long name cannot be put in
   * front of it through either feed above, and that header is the one place on
   * this branch where the length of a name changes the layout of the box
   * around it.
   */
  employeeName?: string;
};

export async function stubFrappe(page: Page, overrides: FrappeStubOverrides = {}): Promise<void> {
  // Skip the one-shot brand intro overlay so it never covers content under test.
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("dewey-time-intro-played", "1");
    } catch {
      /* private mode — intro will just play */
    }
  });

  await page.context().addCookies([
    { name: "user_id", value: "hr@example.com", domain: "localhost", path: "/" },
    { name: "full_name", value: "HR User", domain: "localhost", path: "/" },
  ]);

  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    let message: unknown = {};

    if (p.includes("get_logged_user")) {
      message = "hr@example.com";
    } else if (p.includes("get_calendar_session")) {
      message = { hr_staff: true, employee_id: "EMP-001" } satisfies CalendarSession;
    } else if (p.includes("list_calendar_employees")) {
      // No `satisfies` on the envelope: its type is inline and unexported at
      // services/calendar.ts's `listCalendarEmployees`. `EMPLOYEE` — the part
      // that actually drifts — is checked at its declaration above, and the
      // renamed copy carries its own clause for the same reason.
      const employee = overrides.employeeName
        ? ({
            ...EMPLOYEE,
            employee_name: overrides.employeeName,
            label: `EMP-001 · ${overrides.employeeName}`,
          } satisfies CalendarEmployee)
        : EMPLOYEE;
      message = { employees: [employee], current_user_employee: "EMP-001" };
    } else if (p.includes("get_employee_calendar")) {
      const start = url.searchParams.get("start_date") ?? "2026-06-01";
      const end = url.searchParams.get("end_date") ?? "2026-06-30";
      message = {
        employee: "EMP-001",
        start_date: start,
        end_date: end,
        days: buildDays(start, end),
        device_alerts: [],
        device_sync: [],
        first_checkin_date: "2026-01-01",
        schedule_max_date: "2026-12-31",
        has_shift_assignment: true,
      } satisfies CalendarPayload;
    } else if (p.includes("get_schedule_coverage")) {
      message = overrides.coverage ?? COVERAGE;
    } else if (p.includes("get_enrollment_report")) {
      message = overrides.enrollment ?? enrollmentPayload();
    } else if (p.includes("get_flag_queue")) {
      message = flagQueuePayload();
    } else if (p.includes("list_weekly_schedule_templates")) {
      // Envelope type is inline and unexported at services/schedule.ts's
      // `listScheduleTemplates`; the list is empty, so there is nothing to drift.
      message = { templates: [] };
    } else if (p.includes("get_employee_schedule_context")) {
      message = {
        employee: "EMP-001",
        employee_name: "Jane Doe",
        company: "DIS",
        branch: "BRANCH-A",
        ssas: [{ name: "HR-SHSA-1", shift_schedule: "PAT_MON-FRI", enabled: 1, repeat_days: WEEKDAYS.slice(0, 5), shift_type: "FT_0900_1700" }],
        enabled_ssa_count: 1,
        can_apply: false,
        assignment_summary: { earliest_start_date: "2026-01-01", latest_end_date: "2026-12-31" },
        week_pattern: {
          frequency: "Every Week",
          days: WEEKDAYS.map((w) => ({
            weekday: w,
            works: w !== "Saturday" && w !== "Sunday",
            start_time: "09:00",
            end_time: "17:00",
            lunch_start: "12:00",
            lunch_end: "13:00",
            grace_minutes: 10,
          })),
        },
        default_effective_from: "2026-07-01",
        default_generate_through: "2026-09-29",
      } satisfies ScheduleContext;
    } else if (p.includes("resolve_weekly_schedule_plan")) {
      message = {
        employee: "EMP-001",
        groups: [],
        warnings: [],
        needs_create: false,
      } satisfies ResolvePlan;
    } else if (p.includes("apply_weekly_schedule")) {
      message = {
        needs_confirm: true,
        plan: { employee: "EMP-001", groups: [], warnings: [], needs_create: false },
        reconcile: {
          effective_from: "2026-07-01",
          disable_ssas: [{ name: "HR-SHSA-1", shift_schedule: "PAT_MON-FRI", shift_type: "FT_0900_1700" }],
          add_identities: ["k-new"],
          unchanged_identities: [],
          add_labels: ["MON-SAT 09–17"],
          leaving_labels: ["MON-FRI 09–17"],
          affected_assignments: [
            { name: "A1", start_date: "2026-07-05", action: "inactivate" },
            { name: "A2", start_date: "2026-06-20", action: "end_before", proposed_end_date: "2026-06-30" },
          ],
        },
      } satisfies ApplyScheduleResult;
    }

    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message }),
    });
  });
}
