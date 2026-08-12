import type { Page } from "@playwright/test";

import type { CalendarSession } from "@/hooks/useCalendarSession";
import type { EnrollmentPayload } from "@/lib/enrollmentReport";
import type { ScheduleCoveragePayload } from "@/lib/scheduleCoverage";
import type { CalendarEmployee, CalendarPayload, Day } from "@/types/calendar";
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

const EMPLOYEE = {
  id: "EMP-001",
  label: "EMP-001 · Jane Doe",
  employee_name: "Jane Doe",
  title: "Cashier",
  department: "Retail",
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
    { id: "EMP-104", employee_name: "Marco Diaz", department: "Warehouse", employment_type: "Full-time", title: "Picker", image: null },
    { id: "EMP-118", employee_name: "Priya Nair", department: "Retail", employment_type: "Part-time Fixed", title: "Cashier", image: null },
    { id: "EMP-131", employee_name: "Tom O'Brien", department: "Retail", employment_type: "", title: "Sales Associate", image: null },
  ],
  assigned: [
    { id: "EMP-001", employee_name: "Jane Doe", department: "Retail", employment_type: "Full-time", title: "Cashier", image: null, weekly_minutes: 2400 },
    { id: "EMP-002", employee_name: "Aaron Wells", department: "Retail", employment_type: "Full-time", title: "Cashier", image: null, weekly_minutes: 2400 },
    { id: "EMP-003", employee_name: "Bianca Cruz", department: "Warehouse", employment_type: "Full-time", title: "Lead", image: null, weekly_minutes: 2400 },
    { id: "EMP-005", employee_name: "Derek Hale", department: "Warehouse", employment_type: "Full-time", title: "Picker", image: null, weekly_minutes: 2400 },
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
      { id: "EMP-001", employee_name: "Jane Doe", branch: "BRANCH-A", department: "Retail", status: "Active", bucket: "OK", is_registered: true, fingerprint_count: 2, face_count: 0, days_since_relieving: null },
      { id: "EMP-002", employee_name: "Aaron Wells", branch: "BRANCH-A", department: "Retail", status: "Active", bucket: "ENROLLED_NOT_PUNCHING", is_registered: true, fingerprint_count: 1, face_count: 0, days_since_relieving: null },
      { id: "EMP-104", employee_name: "Marco Diaz", branch: "BRANCH-A", department: "Warehouse", status: "Active", bucket: "NEEDS_ENROLLMENT", is_registered: false, fingerprint_count: 0, face_count: 0, days_since_relieving: null },
      { id: "EMP-900", employee_name: "Nora Vance", branch: "BRANCH-B", department: "Retail", status: "Left", bucket: "LEAVER_STILL_ENROLLED", is_registered: true, fingerprint_count: 2, face_count: 0, days_since_relieving: 42 },
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

/** "YYYY-MM-DD HH:MM:SS", local — the frame Frappe sends and the app parses. */
function frappeDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export async function stubFrappe(page: Page): Promise<void> {
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
      // No `satisfies` here: this envelope's type is inline and unexported at
      // services/calendar.ts's `listCalendarEmployees`. `EMPLOYEE` — the part
      // that actually drifts — is checked at its declaration above.
      message = { employees: [EMPLOYEE], current_user_employee: "EMP-001" };
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
      message = COVERAGE;
    } else if (p.includes("get_enrollment_report")) {
      message = enrollmentPayload();
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
