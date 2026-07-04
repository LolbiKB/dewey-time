import type { Page } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/**
 * Awkward-state scenarios for the pre-rollout UI walk
 * (docs/superpowers/plans/2026-07-03-pre-rollout-audit.md, Track 1).
 *
 * Each scenario layers overrides on top of stubFrappe's happy path. Playwright
 * dispatches route handlers last-registered-first, so we register overrides
 * after stubFrappe and route.fallback() anything we don't handle.
 */

export const AUDIT_SCENARIOS = [
  "baseline", // stubFrappe happy path, untouched
  "empty-week", // shifts assigned nowhere, no checkins, no flags
  "no-schedule", // employee has no shift assignment at all
  "all-flags", // every emitted flag code visible in one week
  "api-error", // calendar API returns 500
  "slow-load", // calendar API takes 5s — capture the loading state
  "crowded-list", // 40+ employees incl. ADMS Bridge + very long names
  "stale-sync", // device_sync has one row >3h old → staleness banner visible
] as const;

export type AuditScenario = (typeof AUDIT_SCENARIOS)[number];

const FLAG_CODES = [
  "LATE_START",
  "LEFT_EARLY",
  "MISSING_TIME",
  "ATTENDANCE_ISSUE",
  "UNNOTIFIED_ABSENCE",
  "OFF_SHIFT_PUNCH",
  "NON_PRIMARY_SITE_PUNCH",
  "LATE_FROM_LUNCH",
] as const;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Format a Date as "YYYY-MM-DD HH:MM:SS" in LOCAL time.
 * Must match the format the app parses via parseDateTimeLocal (space separator, no timezone).
 */
function localDtStr(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${dy} ${h}:${m}:${s}`;
}

function flag(date: string, code: string) {
  return {
    name: `AUTO-EMP-001-${date}-${code}`,
    flag_code: code,
    severity: "WARNING",
    source: "AUTO",
    status: "OPEN",
    day_closed: 1,
    is_provisional: false,
    rule_version: "v0",
    evidence: { audit_scenario: true },
  };
}

/** Day shells for a range; `mutate` customises each day (index = 0-based). */
function buildAuditDays(
  start: string,
  end: string,
  mutate: (day: Record<string, unknown>, index: number, date: string) => void
) {
  const days: Record<string, unknown>[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  let i = 0;
  while (cur <= last) {
    const date = ymd(cur);
    const day: Record<string, unknown> = {
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
      flags: [] as unknown[],
    };
    mutate(day, i, date);
    days.push(day);
    cur.setUTCDate(cur.getUTCDate() + 1);
    i += 1;
  }
  return days;
}

function calendarPayload(url: URL, mutate: Parameters<typeof buildAuditDays>[2], extra: Record<string, unknown> = {}) {
  const start = url.searchParams.get("start_date") ?? "2026-06-01";
  const end = url.searchParams.get("end_date") ?? "2026-06-30";
  return {
    employee: "EMP-001",
    start_date: start,
    end_date: end,
    days: buildAuditDays(start, end, mutate),
    device_alerts: [],
    device_sync: [],
    first_checkin_date: "2026-01-01",
    schedule_max_date: "2026-12-31",
    has_shift_assignment: true,
    ...extra,
  };
}

function crowdedEmployees() {
  const first = ["Srey", "Dara", "Sokha", "Chan", "Vanna", "Rith", "Maly", "Piseth", "Nita", "Kunthea"];
  const last = ["Nita", "Sok", "Chea", "Vong", "Kim", "Heng", "Lim", "Sao"];
  const types = ["Full-time", "Part-time Fixed", "Intern", "Part-time Flexible", ""];
  const employees = [] as Record<string, unknown>[];
  for (let i = 0; i < 40; i += 1) {
    const name = `${first[i % first.length]} ${last[i % last.length]}`;
    employees.push({
      id: `DI-${String(100 + i).padStart(4, "0")}`,
      label: `DI-${String(100 + i).padStart(4, "0")} · ${name}`,
      employee_name: name,
      title: i % 3 === 0 ? "Cashier" : "Housekeeper",
      department: i % 2 === 0 ? "Retail" : "Housekeeping",
      company: "DIS",
      employment_type: types[i % types.length],
      is_full_time: i % types.length === 0,
      has_shift_assignment: i % 4 !== 0,
      has_shift_schedule_assignment: i % 4 !== 0,
      shift_schedule_assignment: i % 4 !== 0 ? `HR-SHSA-${i}` : null,
      schedule_min_date: "2026-01-01",
      schedule_max_date: "2026-12-31",
      first_checkin_date: "2026-01-01",
    });
  }
  employees.push({
    id: "HR-EMP-ADMS",
    label: "HR-EMP-ADMS · ADMS Bridge",
    employee_name: "ADMS Bridge",
    title: null,
    department: null,
    company: "DIS",
    employment_type: "",
    is_full_time: false,
    has_shift_assignment: false,
    has_shift_schedule_assignment: false,
    shift_schedule_assignment: null,
    schedule_min_date: null,
    schedule_max_date: null,
    first_checkin_date: null,
  });
  employees.push({
    id: "DI-0999",
    label: "DI-0999 · Maria Alejandra Fernanda de los Angeles Rodriguez-Villanueva",
    employee_name: "Maria Alejandra Fernanda de los Angeles Rodriguez-Villanueva",
    title: "Senior Front Office Guest Relations Coordinator",
    department: "Front Office and Guest Experience",
    company: "DIS",
    employment_type: "Full-time",
    is_full_time: true,
    has_shift_assignment: true,
    has_shift_schedule_assignment: true,
    shift_schedule_assignment: "HR-SHSA-999",
    schedule_min_date: "2026-01-01",
    schedule_max_date: "2026-12-31",
    first_checkin_date: "2026-01-01",
  });
  return employees;
}

export async function stubAuditScenario(page: Page, scenario: AuditScenario): Promise<void> {
  await stubFrappe(page);
  if (scenario === "baseline") return;

  await page.route("**/api/method/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (message: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message }) });

    if (scenario === "slow-load") {
      if (p.includes("get_employee_calendar")) {
        await new Promise((r) => setTimeout(r, 5000));
      }
      return route.fallback();
    }

    if (scenario === "api-error" && p.includes("get_employee_calendar")) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          exc_type: "ValidationError",
          exception: "frappe.exceptions.ValidationError: audit-staged failure",
          _server_messages: JSON.stringify([JSON.stringify({ message: "Something went wrong (staged for audit)." })]),
        }),
      });
    }

    if (scenario === "empty-week" && p.includes("get_employee_calendar")) {
      return json(
        calendarPayload(url, (day) => {
          day.shift = { shift_assigned: false };
          day.checkins = [];
          day.first_in = null;
          day.last_out = null;
          day.gross_minutes = 0;
        })
      );
    }

    if (scenario === "no-schedule") {
      if (p.includes("list_calendar_employees")) {
        return json({
          employees: [
            {
              id: "EMP-001",
              label: "EMP-001 · Jane Doe",
              employee_name: "Jane Doe",
              title: "Cashier",
              department: "Retail",
              company: "DIS",
              employment_type: "Full-time",
              is_full_time: true,
              has_shift_assignment: false,
              has_shift_schedule_assignment: false,
              shift_schedule_assignment: null,
              schedule_min_date: null,
              schedule_max_date: null,
              first_checkin_date: "2026-01-01",
            },
          ],
          current_user_employee: "EMP-001",
        });
      }
      if (p.includes("get_employee_calendar")) {
        return json(
          calendarPayload(
            url,
            (day) => {
              day.shift = { shift_assigned: false };
              day.checkins = [];
              day.first_in = null;
              day.last_out = null;
              day.gross_minutes = 0;
            },
            { has_shift_assignment: false }
          )
        );
      }
    }

    if (scenario === "all-flags" && p.includes("get_employee_calendar")) {
      return json(
        calendarPayload(url, (day, i, date) => {
          const code = FLAG_CODES[i % FLAG_CODES.length];
          day.flags = i % FLAG_CODES.length === 0 ? [flag(date, code), flag(date, "LATE_FROM_LUNCH")] : [flag(date, code)];
        })
      );
    }

    if (scenario === "crowded-list" && p.includes("list_calendar_employees")) {
      return json({ employees: crowdedEmployees(), current_user_employee: "DI-0100" });
    }

    if (scenario === "stale-sync" && p.includes("get_employee_calendar")) {
      // last_delivered_at is 5 hours ago in local time so the staleness banner shows "5h ago"
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      const start = url.searchParams.get("start_date") ?? ymd(new Date());
      return json(
        calendarPayload(
          url,
          () => {}, // days are the happy-path baseline
          {
            device_sync: [
              {
                device_sn: "DEV-01",
                branch: "BRANCH-A",
                local_date: start,
                last_delivered_at: localDtStr(fiveHoursAgo),
                last_device_log_at: null,
                pending_count: 0,
                last_error: null,
              },
            ],
          }
        )
      );
    }

    return route.fallback();
  });
}
