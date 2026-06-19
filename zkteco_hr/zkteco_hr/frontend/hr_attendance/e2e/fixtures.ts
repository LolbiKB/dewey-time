import type { Page } from "@playwright/test";

/**
 * Network stubs for the HR Attendance SPA.
 *
 * The app authenticates through frappe-react-sdk, which reads the logged-in user
 * from the `user_id` cookie (synchronously, no request), then loads data from
 * `/api/method/...` endpoints. We seed the cookie and fulfil every API method with
 * canned data so the E2E tests need no Frappe backend. Calendar days are generated
 * for whatever date range the app requests, so tests are independent of "today".
 */

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDays(start: string, end: string) {
  const days = [];
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
    });
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
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export async function stubFrappe(page: Page): Promise<void> {
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
      message = { hr_staff: true, employee_id: "EMP-001" };
    } else if (p.includes("list_calendar_employees")) {
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
      };
    } else if (p.includes("list_weekly_schedule_templates")) {
      message = { templates: [] };
    } else if (p.includes("get_employee_schedule_context")) {
      message = {
        employee: "EMP-001",
        employee_name: "Jane Doe",
        company: "DIS",
        branch: "BRANCH-A",
        ssas: [],
        enabled_ssa_count: 0,
        can_apply: true,
        assignment_summary: {},
        week_pattern: {
          frequency: "Every Week",
          days: WEEKDAYS.map((w) => ({
            weekday: w,
            works: w !== "Saturday" && w !== "Sunday",
            start_time: "08:00",
            end_time: "17:00",
            lunch_start: "12:00",
            lunch_end: "13:00",
            grace_minutes: 0,
          })),
        },
        default_effective_from: "2026-07-01",
        default_generate_through: "2026-09-29",
      };
    }

    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message }),
    });
  });
}
