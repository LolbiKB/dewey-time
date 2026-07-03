# Pre-Rollout Audit (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the three-track audit from the approved spec (`docs/superpowers/specs/2026-07-03-pre-rollout-readiness-design.md`) and produce the triaged `docs/ROLLOUT_PUNCH_LIST.md` that gates rollout.

**Architecture:** Track 1 reuses the existing Playwright network-stub harness (`e2e/fixtures.ts`) with new "awkward state" scenario overrides and a screenshot-walk spec gated behind `AUDIT=1`. Track 2 runs the flag engine inside the frappe-sandbox Docker bench seeded from an anonymized prod backup and hand-verifies a ~100-employee-day sample. Track 3 is code tracing plus live permission probes against the sandbox bench. All findings land in one punch list with three buckets.

**Tech Stack:** Playwright (`@playwright/test`, existing desktop/mobile projects), frappe-sandbox harness (`dev/sandbox/frappe-sandbox`), Frappe bench console (Python), curl.

## Global Constraints

- **Never commit PII or prod backups.** `dev/sandbox/_backup/`, `*.sql.gz`, `*-files.tar` must stay untracked; verify before every commit. Committed audit notes may reference anonymized employee IDs only (backup is anonymized by the seed step).
- **Credentials are user-run only.** `fetch_backup.py` needs `FC_API_KEY`/`FC_API_SECRET`; the user runs that command themselves (suggest `! <command>` in the prompt). Never read or echo those env vars.
- **The audit spec must not run in CI.** Gate with `test.skip(!process.env.AUDIT, ...)` — CI's `npm run test:e2e` must stay green and fast.
- **Punch list lives at `docs/ROLLOUT_PUNCH_LIST.md`** with exactly three buckets: Must fix / Should fix / Can wait. Every entry carries evidence (screenshot path or reproduction note).
- **This is an audit: find, don't fix.** Code changes in this plan are limited to audit tooling (fixtures, spec, gitignore). Product fixes are Phase 3, each its own PR.
- **Branch:** all work commits to `docs/pre-rollout-readiness-spec` (already checked out); a single PR at the end (Task 14).
- **Sample floor (from spec):** ≥5 employees per branch, 2 full real weeks, all 8 emitted flag codes covered where prod data allows.
- Screenshots go to `dewey_time/frontend/hr_attendance/e2e/.audit-shots/` (gitignored). Frontend commands run from `dewey_time/frontend/hr_attendance/`; sandbox commands from `dev/sandbox/`.

**Sequencing note:** Task 5's backup fetch is user-run and slow. Ask the user to start it (Task 5, Step 2) as soon as Task 1 is committed, then continue Tasks 2–4 while it downloads.

---

### Task 1: Punch list scaffold (+ seed known findings)

**Files:**
- Create: `docs/ROLLOUT_PUNCH_LIST.md`

**Interfaces:**
- Produces: the punch-list file and entry format every later task appends to.

- [ ] **Step 1: Create the punch list**

```markdown
# Rollout Punch List

Single source of truth for pre-rollout readiness. Spec:
`docs/superpowers/specs/2026-07-03-pre-rollout-readiness-design.md`.

Rollout is ready when **Must fix** is empty, every **Should fix** has a recorded
decision, and the launch checklist (spec Phase 4) has passed once against prod.

**Entry format:**
`- [ ] **[T<track>-<n>]** <title> — <evidence: screenshot path or repro note> (found <date>; PR —)`

Tracks: T1 = UI walk, T2 = data trust, T3 = failure/permissions/deploy.

## Must fix

_(pending triage — see Untriaged)_

## Should fix

_(pending triage — see Untriaged)_

## Can wait

_(pending triage — see Untriaged)_

## Untriaged

- [ ] **[T2-1]** ADMS Bridge service account appears in HR employee pickers —
  selectable in `/hr-attendance` and `/hr-schedule` pickers; search fix (#57)
  stopped it polluting results but it is still listed. Decide API-level
  exclusion in `hr_calendar.py`. (found 2026-07-02; PR —)
- [ ] **[T2-2]** Fresh prod import problems CSV not yet verified — expect only
  the ~4 known bad-badge `EMPLOYEE_NOT_FOUND` rows. **Blocked on user** re-running
  the prod import and sharing the CSV. (found 2026-07-02; PR —)
- [ ] **[T3-1]** ~10 stray screenshot PNGs untracked at repo root (`di-home*.png`,
  `mine-final*.png`, `render-*.png`, …) — delete or gitignore; risk of an
  accidental commit. (found 2026-07-03; PR —)

## Triage decisions log

_(user decisions recorded here: entry id → bucket, date, rationale)_

## Launch checklist record

_(completed once, per spec Phase 4)_
```

- [ ] **Step 2: Commit**

```bash
git add docs/ROLLOUT_PUNCH_LIST.md
git commit -m "docs(audit): scaffold rollout punch list with seeded known findings"
```

---

### Task 2: Awkward-state scenario fixtures

**Files:**
- Create: `dewey_time/frontend/hr_attendance/e2e/audit-fixtures.ts`
- Modify: `.gitignore` (repo root — add the shots dir)
- Test: smoke-run via the Task 3 spec's baseline case (Step 4 below runs one scenario headlessly)

**Interfaces:**
- Consumes: `stubFrappe(page)` from `e2e/fixtures.ts` (registers a catch-all
  `**/api/method/**` route with canned happy-path data).
- Produces: `AUDIT_SCENARIOS: readonly string[]` and
  `stubAuditScenario(page: Page, scenario: AuditScenario): Promise<void>` —
  Playwright registers route handlers LIFO, so scenario overrides are added
  *after* `stubFrappe` and use `route.fallback()` for everything they don't
  override.

- [ ] **Step 1: Write `e2e/audit-fixtures.ts`**

```ts
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
      await new Promise((r) => setTimeout(r, 5000));
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
          day.flags = i % FLAG_CODES.length === 0 ? [flag(date, code), flag(date, "NON_PRIMARY_SITE_PUNCH")] : [flag(date, code)];
        })
      );
    }

    if (scenario === "crowded-list" && p.includes("list_calendar_employees")) {
      return json({ employees: crowdedEmployees(), current_user_employee: "DI-0100" });
    }

    return route.fallback();
  });
}
```

- [ ] **Step 2: Gitignore the shots dir**

Append to the repo-root `.gitignore`:

```gitignore

# Pre-rollout audit screenshots (local artifacts, never committed)
dewey_time/frontend/hr_attendance/e2e/.audit-shots/
```

- [ ] **Step 3: Type-check**

```bash
cd dewey_time/frontend/hr_attendance && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke-verify fixtures compile under Playwright**

The walk spec doesn't exist yet, so verify import-ability with the existing suite untouched:

```bash
cd dewey_time/frontend/hr_attendance && npx playwright test --list 2>&1 | tail -3
```

Expected: existing tests listed, no compile errors. (The fixtures file is only imported by Task 3's spec; this step just proves the harness still compiles.)

- [ ] **Step 5: Commit**

```bash
git add dewey_time/frontend/hr_attendance/e2e/audit-fixtures.ts .gitignore
git commit -m "test(audit): awkward-state scenario fixtures for the UI walk"
```

---

### Task 3: UI walk — /hr-attendance (laptop + phone)

**Files:**
- Create: `dewey_time/frontend/hr_attendance/e2e/audit-walk.spec.ts`
- Artifacts: `dewey_time/frontend/hr_attendance/e2e/.audit-shots/*.png` (local only)
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (append findings)

**Interfaces:**
- Consumes: `AUDIT_SCENARIOS`, `stubAuditScenario` from `e2e/audit-fixtures.ts`.
- Produces: the `audit-walk.spec.ts` file that Task 4 extends with `/hr-schedule` cases; screenshot naming convention `<viewport>-<route>-<scenario>[-<interaction>].png`.

- [ ] **Step 1: Write the walk spec (attendance cases)**

```ts
import { test } from "@playwright/test";

import { AUDIT_SCENARIOS, stubAuditScenario } from "./audit-fixtures";

/**
 * Pre-rollout screenshot walk. NOT a CI test: it asserts nothing and exists to
 * produce e2e/.audit-shots/ for human review. Run with:
 *   AUDIT=1 npx playwright test e2e/audit-walk.spec.ts --project=desktop
 */
test.skip(!process.env.AUDIT, "audit walk runs only with AUDIT=1");

const SHOTS = "e2e/.audit-shots";
const VIEWPORTS = [
  { tag: "laptop", width: 1440, height: 900 },
  { tag: "phone", width: 375, height: 812 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(vp.tag, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const scenario of AUDIT_SCENARIOS) {
      test(`attendance ${scenario}`, async ({ page }) => {
        await stubAuditScenario(page, scenario);
        await page.goto("/hr-attendance");
        if (scenario === "slow-load") {
          // capture the in-flight loading state, then the settled state
          await page.waitForTimeout(1500);
          await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-slow-load-loading.png`, fullPage: true });
          await page.waitForTimeout(6000);
        } else {
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.waitForTimeout(500);
        }
        await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-${scenario}.png`, fullPage: true });
      });
    }

    test("attendance interactions (baseline + crowded-list)", async ({ page }) => {
      // employee picker open + no-match search, on the crowded list
      await stubAuditScenario(page, "crowded-list");
      await page.goto("/hr-attendance");
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.getByRole("combobox").first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-picker-open.png`, fullPage: true });
      await page.getByPlaceholder(/Search by name/).fill("zzzz");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-picker-no-match.png`, fullPage: true });
      await page.keyboard.press("Escape");

      // weekly schedule sheet
      await page.getByRole("button", { name: "View weekly schedule" }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-schedule-sheet.png`, fullPage: true });
      await page.keyboard.press("Escape");
    });

    test("attendance flag detail (all-flags)", async ({ page }) => {
      await stubAuditScenario(page, "all-flags");
      await page.goto("/hr-attendance");
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(500);
      // open the first visible flag; adjust the locator during execution if the
      // grid renders flags differently (chips vs badges) — goal is the detail panel
      const flagChip = page.getByText("LATE_START", { exact: false }).first();
      if (await flagChip.isVisible().catch(() => false)) {
        await flagChip.click();
        await page.waitForTimeout(400);
      }
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-flag-detail.png`, fullPage: true });
    });
  });
}
```

- [ ] **Step 2: Run the attendance walk**

```bash
cd dewey_time/frontend/hr_attendance && AUDIT=1 npx playwright test e2e/audit-walk.spec.ts --project=desktop
```

Expected: all audit tests pass (they assert nothing); `e2e/.audit-shots/` contains ~20 PNGs (7 scenarios + interactions × 2 viewports).

- [ ] **Step 3: Confirm CI-safety**

```bash
cd dewey_time/frontend/hr_attendance && npx playwright test e2e/audit-walk.spec.ts --project=desktop 2>&1 | tail -3
```

Expected: every audit test reports **skipped** (no `AUDIT` env).

- [ ] **Step 4: Review every screenshot and record findings**

Read each PNG (Read tool renders images). For every issue — broken layout, overflow, missing/ugly empty state, unstyled error, jarring loading state, phone-width breakage — append an Untriaged entry to `docs/ROLLOUT_PUNCH_LIST.md`:

```markdown
- [ ] **[T1-<n>]** <what is wrong, one sentence> — `e2e/.audit-shots/<file>.png`,
  scenario `<scenario>`, <viewport>. (found 2026-07-03; PR —)
```

Judge against: does the state tell the user what is happening and what to do next? Would a stakeholder screenshot this and complain?

- [ ] **Step 5: Commit**

```bash
git add dewey_time/frontend/hr_attendance/e2e/audit-walk.spec.ts docs/ROLLOUT_PUNCH_LIST.md
git commit -m "test(audit): attendance UI walk + findings from screenshot review"
```

---

### Task 4: UI walk — /hr-schedule (wizard + coverage)

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/e2e/audit-walk.spec.ts` (append schedule cases)
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (append findings)

**Interfaces:**
- Consumes: same fixtures; `apply_weekly_schedule` stub already returns `needs_confirm: true` with a full `reconcile` payload, so the confirm modal renders without a backend.

- [ ] **Step 1: Append schedule cases inside the same `for (const vp of VIEWPORTS)` describe**

```ts
    for (const scenario of ["baseline", "no-schedule", "api-error", "crowded-list"] as const) {
      test(`schedule ${scenario}`, async ({ page }) => {
        await stubAuditScenario(page, scenario);
        await page.goto("/hr-schedule");
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/${vp.tag}-schedule-${scenario}.png`, fullPage: true });
      });
    }

    test("schedule wizard flow (baseline)", async ({ page }) => {
      await stubAuditScenario(page, "baseline");
      await page.goto("/hr-schedule");
      await page.waitForLoadState("networkidle").catch(() => {});

      // open the employee picker
      await page.getByRole("combobox").first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-schedule-picker-open.png`, fullPage: true });
      await page.getByText("Jane Doe").first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-schedule-wizard-loaded.png`, fullPage: true });

      // walk to the apply/confirm step; locators may need adjusting at execution
      // time — the goal shots are: day editor, review step, confirm modal
      const applyButton = page.getByRole("button", { name: /apply|review|continue/i }).first();
      if (await applyButton.isVisible().catch(() => false)) {
        await applyButton.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/${vp.tag}-schedule-review-step.png`, fullPage: true });
      }
    });
```

- [ ] **Step 2: Run it**

```bash
cd dewey_time/frontend/hr_attendance && AUDIT=1 npx playwright test e2e/audit-walk.spec.ts --project=desktop
```

Expected: pass; `.audit-shots/` now also holds `*-schedule-*.png` for both viewports.

- [ ] **Step 3: Review screenshots, record `[T1-n]` findings** — same format and judgment bar as Task 3 Step 4. Pay extra attention to phone width: the wizard is dense; overflow and unreachable buttons are must-fix material.

- [ ] **Step 4: Commit**

```bash
git add dewey_time/frontend/hr_attendance/e2e/audit-walk.spec.ts docs/ROLLOUT_PUNCH_LIST.md
git commit -m "test(audit): schedule UI walk + findings"
```

---

### Task 5: Sandbox up + anonymized prod seed

**Files:**
- No repo changes (sandbox state only). Backup lands in `dev/sandbox/_backup/` (untracked).

**Interfaces:**
- Produces: a running bench (Docker project `frappe-sandbox-dewey_time`) with site `sandbox` seeded from anonymized prod — consumed by Tasks 6–8, 10, 12.

- [ ] **Step 1: Verify the backup dir cannot be committed**

```bash
git check-ignore -v dev/sandbox/_backup/ || echo "NOT IGNORED — add before proceeding"
```

If not ignored, append `dev/sandbox/_backup/` to `dev/sandbox/.gitignore` (or repo root `.gitignore`), commit that alone.

- [ ] **Step 2: User fetches the prod backup (credentials — user-run)**

`dev/sandbox/_backup/` is currently **empty**. Ask the user to run (they hold `FC_API_KEY`/`FC_API_SECRET`; suggest the `!` prefix so output lands in-session):

```
! cd dev/sandbox && python3 fetch_backup.py
```

Expected: `_backup/<timestamped-dir>/` containing `*.sql.gz` + site config. Do not proceed to Step 4 without it.

- [ ] **Step 3: Bring the bench up (parallel with Step 2)**

```bash
cd dev/sandbox && ./frappe-sandbox up && ./frappe-sandbox doctor
```

Expected: doctor reports the bench healthy. (Python 3.14 pin for version-16 is handled by provisioning — see memory `sandbox-v16-python314` if provisioning fails.)

- [ ] **Step 4: Seed from prod (anonymizes as part of the verb)**

```bash
cd dev/sandbox && ./frappe-sandbox seed --prod _backup/<timestamped-dir>
```

Expected: restore → app-prune → anonymize completes; the verb guarantees anonymize-or-drop.

- [ ] **Step 5: Sanity-check anonymization + invariants**

```bash
cd dev/sandbox && ./frappe-sandbox verify
```

Expected: invariants pass. Then spot-check no real PII survived (bench console, next task, will confirm names look scrubbed).

- [ ] **Step 6: Record completion** — no commit (nothing tracked changed); note the seeded backup timestamp in the punch list's Untriaged section only if seeding surfaced problems (e.g. `[T2-n]` seed/verify failures are findings).

---

### Task 6: /adms entry gate check

**Files:**
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (findings, if any)

**Interfaces:**
- Consumes: running sandbox bench (Task 5); `www/adms.py` (`get_context` redirects Guests), `dashboard_auth.ensure_adms_roles`.

- [ ] **Step 1: Guest gets redirected (prod, read-only)**

```bash
curl -sI https://dewey.frappehr.com/adms | head -8
```

Expected: `30x` with `Location: /login?...`. A `200` for a Guest is a **must-fix finding**.

- [ ] **Step 2: Guest redirect on sandbox too**

Find the mapped HTTP port, then probe:

```bash
cd dev/sandbox && docker compose -p frappe-sandbox-dewey_time ps
curl -sI http://localhost:<mapped-port>/adms | head -8
```

Expected: same redirect behavior as prod.

- [ ] **Step 3: Authorized user reaches the shell**

In the bench console (`docker compose -p frappe-sandbox-dewey_time exec <backend-service> bench --site sandbox console` — take the service name from Step 2's `ps` output):

```python
import frappe
u = frappe.new_doc("User")
u.email = "adms-audit@test.local"
u.first_name = "ADMS Audit"
u.new_password = "audit-test-1234"
u.append("roles", {"role": "ADMS Admin"})
u.flags.no_welcome_mail = True
u.insert(ignore_permissions=True)
frappe.db.commit()
```

Then log in and load the page:

```bash
curl -s -c /tmp/adms.jar -X POST "http://localhost:<mapped-port>/api/method/login" \
  --data-urlencode "usr=adms-audit@test.local" --data-urlencode "pwd=audit-test-1234"
curl -s -b /tmp/adms.jar -o /dev/null -w "%{http_code}\n" "http://localhost:<mapped-port>/adms"
curl -s -b /tmp/adms.jar -X POST "http://localhost:<mapped-port>/api/method/dewey_time.attendance_engine.dashboard_auth.get_dashboard_token"
```

Expected: `/adms` → `200`; `get_dashboard_token` returns a token payload, not `PermissionError`.

- [ ] **Step 4: Record findings + commit** (only if findings)

```bash
git add docs/ROLLOUT_PUNCH_LIST.md && git commit -m "docs(audit): /adms entry gate findings"
```

---

### Task 7: Run the engine over two real weeks + build the sample

**Files:**
- Create: `docs/superpowers/audits/2026-07-flag-verification.md` (sample + run log; verdicts filled in Task 8)

**Interfaces:**
- Consumes: seeded sandbox (Task 5); `./frappe-sandbox exercise` → `dev_tools.run_engine_for_employee(employee, start_date, end_date, mode)`.
- Produces: the audit-notes doc with the chosen window + sample table that Task 8 fills in.

- [ ] **Step 1: Find the two most recent complete weeks of punch data**

Bench console:

```python
import frappe
print(frappe.db.sql("SELECT MIN(DATE(time)), MAX(DATE(time)), COUNT(*) FROM `tabEmployee Checkin`")[0])
```

Pick `start` = the Monday two full weeks before the max date, `end` = the Sunday ending the second week. Record both in the notes doc.

- [ ] **Step 2: Pick ≥5 active employees per branch**

```python
import collections, frappe
rows = frappe.get_all("Employee", filters={"status": "Active"}, fields=["name", "branch", "employment_type"], order_by="branch, name")
by_branch = collections.defaultdict(list)
for r in rows:
    by_branch[r.branch or "NO_BRANCH"].append(r.name)
sample = {b: v[:5] for b, v in by_branch.items()}
for b, ids in sample.items():
    print(b, ids)
```

Exclude the ADMS Bridge service account if it appears. Record the sample table in the notes doc.

- [ ] **Step 3: Run the engine for every sampled employee**

From `dev/sandbox/`, once per sampled employee (with Step 1's window):

```bash
./frappe-sandbox exercise --employee <EMP-ID> --start <start> --end <end> --mode both
```

Expected: each run completes without traceback. Log any failure verbatim into the notes doc — an engine crash on real data is automatically a `[T2-n]` must-fix candidate.

- [ ] **Step 4: Confirm flag-code coverage in the sample**

```python
import frappe
print(frappe.db.sql("""
  SELECT flag_code, COUNT(*) FROM `tabAttendance Flag`
  WHERE attendance_date BETWEEN %s AND %s GROUP BY flag_code
""", ("<start>", "<end>")))
```

If any of the 8 emitted codes is missing from the *sampled employees'* flags but present site-wide, swap in an employee who has it. If a code appears nowhere site-wide in the window, record "not exercisable on this data" in the notes doc.

- [ ] **Step 5: Scaffold the notes doc + commit**

`docs/superpowers/audits/2026-07-flag-verification.md`: the window, the sample table (branch → employee ids), the run log, the coverage counts, and an empty verdict table with columns `employee | date | flags emitted | verdict (correct / spurious / missing:<code>) | note`.

```bash
git add docs/superpowers/audits/2026-07-flag-verification.md
git commit -m "docs(audit): flag-verification sample, engine run log, coverage"
```

---

### Task 8: Hand-verify the sampled employee-days

**Files:**
- Modify: `docs/superpowers/audits/2026-07-flag-verification.md` (verdicts)
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (findings)

**Interfaces:**
- Consumes: the sample + window from Task 7. Authoritative rule thresholds: `FRAPPE_ATTENDANCE_RULES.md` (repo root) — read it before judging.

- [ ] **Step 1: Define the day-report helper (bench console)**

```python
import frappe

def day_report(employee, date):
    ci = frappe.get_all("Employee Checkin",
        filters={"employee": employee, "time": ["between", [f"{date} 00:00:00", f"{date} 23:59:59"]]},
        fields=["time", "log_type", "device_id"], order_by="time")
    fl = frappe.get_all("Attendance Flag",
        filters={"employee": employee, "attendance_date": date},
        fields=["flag_code", "day_closed", "source", "status"])
    sa = frappe.db.sql("""
        SELECT shift_type, start_date, end_date FROM `tabShift Assignment`
        WHERE employee=%s AND docstatus=1 AND start_date<=%s AND (end_date IS NULL OR end_date>=%s)
    """, (employee, date, date), as_dict=True)
    print(f"== {employee} {date}")
    print("  shift:", sa)
    print("  checkins:", [(str(c.time), c.log_type) for c in ci])
    print("  flags:", [(f.flag_code, f.day_closed) for f in fl])

for emp in [<sampled ids>]:
    for d in [<the 14 dates>]:
        day_report(emp, d)
```

- [ ] **Step 2: Judge every employee-day against the rules**

For each day, verify **both directions** — every emitted flag is deserved, and no deserved flag is missing:

| Code | Deserved when (see FRAPPE_ATTENDANCE_RULES.md for exact thresholds) |
|---|---|
| `LATE_START` | first IN after shift start + grace |
| `LEFT_EARLY` | last OUT before shift end − grace |
| `MISSING_TIME` | intra-shift gap ≥ 30 min between punches |
| `ATTENDANCE_ISSUE` | single checkin / missing-lunch / unknown-branch reasons |
| `UNNOTIFIED_ABSENCE` | on-shift with zero checkins (and not on leave/holiday) |
| `OFF_SHIFT_PUNCH` | checkins on a day with no shift or a holiday |
| `NON_PRIMARY_SITE_PUNCH` | checkin device branch ≠ employee branch |
| `LATE_FROM_LUNCH` | return from observed lunch after allowed window |

Fill the verdict table for all sampled days. Any `spurious` or `missing:<code>` verdict → `[T2-n]` punch-list entry with the exact employee-id/date/punches as the repro note.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/audits/2026-07-flag-verification.md docs/ROLLOUT_PUNCH_LIST.md
git commit -m "docs(audit): flag verification verdicts (~100 employee-days) + findings"
```

---

### Task 9: ADMS Bridge exclusion analysis

**Files:**
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (upgrade seeded entry T2-1 with the analysis + proposed fix)

**Interfaces:**
- Consumes: `dewey_time/attendance_engine/hr_calendar.py` (`list_calendar_employees`, whitelist at line ~301) and the seeded sandbox to confirm live behavior.

- [ ] **Step 1: Find why the service account is listed**

Read `hr_calendar.py`'s employee query (filters on `Employee`). In the bench console, identify the service account's Employee record:

```python
import frappe
print(frappe.get_all("Employee", filters={"employee_name": ["like", "%bridge%"]},
      fields=["name", "employee_name", "status", "company", "designation", "user_id"]))
```

- [ ] **Step 2: Write the finding + proposed fix into T2-1**

Update the entry with: the Employee record's identifying fields, which filter would exclude it (e.g. exclude by linked `user_id` being the Bridge API user, or an explicit exclusion list in `Dewey Time Settings`), and the recommendation. The fix itself is Phase 3 — do not implement here.

- [ ] **Step 3: Commit**

```bash
git add docs/ROLLOUT_PUNCH_LIST.md
git commit -m "docs(audit): ADMS Bridge listing root cause + proposed exclusion"
```

---

### Task 10: Import cleanliness check

**Files:**
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (resolve or re-block seeded entry T2-2)

**Interfaces:**
- Consumes: the seeded sandbox (which contains prod's post-import schedule state) and, when the user provides it, the fresh problems CSV.

- [ ] **Step 1: Sandbox-side structural checks (do now)**

Bench console — collapsed names and dangling links would betray a dirty import:

```python
import frappe
# variant suffixes present? (healthy import mints FT_x, FT_x_2, ...)
print(frappe.db.sql("SELECT name FROM `tabShift Type` WHERE name LIKE 'FT\\_%' ORDER BY name"))
# Shift Schedules referencing a missing Shift Type = dangling
print(frappe.db.sql("""
  SELECT ss.name, ss.shift_type FROM `tabShift Schedule` ss
  LEFT JOIN `tabShift Type` st ON st.name = ss.shift_type
  WHERE st.name IS NULL
"""))
```

Expected: variants exist where lunch/grace differ; zero dangling rows. Any anomaly → `[T2-n]` entry with the query output as evidence.

- [ ] **Step 2: CSV check (when the user supplies it)**

When the fresh problems CSV arrives, verify every row is one of the known ~4 bad-badge `EMPLOYEE_NOT_FOUND` cases. If yes: tick T2-2 with a note naming the CSV run-provenance stamp. If no: each unexpected row becomes its own `[T2-n]` entry. If the CSV hasn't arrived by Task 14, leave T2-2 blocked and flag it in triage.

- [ ] **Step 3: Commit**

```bash
git add docs/ROLLOUT_PUNCH_LIST.md
git commit -m "docs(audit): import cleanliness — structural checks + CSV status"
```

---

### Task 11: Silent-failure tracing (does a human find out?)

**Files:**
- Create: `docs/superpowers/audits/2026-07-failure-visibility.md`
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (findings)

**Interfaces:**
- Consumes (read-only): `dewey_time/hooks.py` (scheduler entries), `attendance_engine/device_sync.py` (`notify_device_sync_status`, line ~153), `attendance_engine/closeout.py` (`notify_device_closeout_status` line ~121, `run_company_fallback_closeout`), `dewey_time/dewey_time/doctype/device_closeout_alert/`, `dewey_time/webpush.py`.

- [ ] **Step 1: Trace scenario (a) — Bridge stops delivering punches**

Follow `Device Sync Status` (the freshness watermark): what updates it, and — critically — **what reads it**. Grep for consumers:

```bash
grep -rn "Device Sync Status" dewey_time --include="*.py" | grep -v test
```

Answer in the notes doc: if punches stop at 09:00, when does a human learn, via what surface (SPA banner? push? nothing?), and who.

- [ ] **Step 2: Trace scenario (b) — closeout webhook never arrives**

Follow `run_company_fallback_closeout` (daily scheduler) and `Device Closeout Alert`: does the fallback close the day silently, or alert? Does an alert record reach anyone (email/push/desk notification), or is it only a row a nobody-opens list view?

- [ ] **Step 3: Trace scenario (c) — scheduler itself is dead**

If `*/30` intraday and the `daily` fallback stop firing (worker down, site paused): what breaks visibly, and is there any dead-man signal? (Frappe Cloud monitors workers; note what it does and does not cover for this app.)

- [ ] **Step 4: Write the notes doc + punch entries**

`docs/superpowers/audits/2026-07-failure-visibility.md`: one section per scenario ending in a verdict line — `HUMAN FINDS OUT: yes/no/partially — <how, how fast>`. Every "no/partially" becomes a `[T3-n]` punch entry.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/2026-07-failure-visibility.md docs/ROLLOUT_PUNCH_LIST.md
git commit -m "docs(audit): failure-visibility tracing (punches, closeout, scheduler)"
```

---

### Task 12: Permissions audit (live probes on sandbox)

**Files:**
- Modify: `docs/superpowers/audits/2026-07-failure-visibility.md` (append a Permissions section — same ops-notes doc)
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (findings)

**Interfaces:**
- Consumes: sandbox bench (Task 5). Full endpoint inventory (from `@frappe.whitelist` grep, verify against source at execution):
  - `hr_calendar`: `get_calendar_session`, `list_calendar_employees`, `get_employee_calendar`
  - `schedule_api`: `list_weekly_schedule_templates`, `get_employee_schedule_context`, `get_holiday_preview`, `resolve_weekly_schedule_plan`, `apply_weekly_schedule`
  - `coverage_api`: `get_schedule_coverage`
  - `api`: `get_my_week`
  - `dev_tools` (8, **destructive**): `run_engine_for_employee`, `preview_clear_employee_schedule_api`, `clear_employee_schedule_api`, `preview_clear_all_employee_schedules_api`, `clear_all_employee_schedules_api`, `preview_clear_site_schedule_patterns_api`, `clear_site_patterns_step_api`, + the eighth at `dev_tools.py:27`
  - `webpush` (5): all endpoints in `dewey_time/webpush.py`
  - `dashboard_auth`: `get_dashboard_token`
  - `schedule_import`: the endpoint at `schedule_import.py:1057`
  - Guest-allowed POST: `closeout.notify_device_closeout_status`, `device_sync.notify_device_sync_status` (must be rejected without valid Bridge auth), plus the `www/hr-attendance.py:20` / `www/hr-schedule.py:20` guest POST handlers (inspect what they expose)

- [ ] **Step 1: Create a non-HR user with a linked Employee**

Bench console:

```python
import frappe
u = frappe.new_doc("User")
u.email = "nonhr-audit@test.local"
u.first_name = "NonHR Audit"
u.new_password = "audit-test-1234"
u.flags.no_welcome_mail = True
u.insert(ignore_permissions=True)
emp = frappe.get_all("Employee", filters={"status": "Active"}, fields=["name"], limit=1)[0].name
frappe.db.set_value("Employee", emp, "user_id", "nonhr-audit@test.local")
frappe.db.commit()
print("linked employee:", emp)
```

- [ ] **Step 2: Probe every endpoint as that user**

```bash
PORT=<mapped-port>
curl -s -c /tmp/nonhr.jar -X POST "http://localhost:$PORT/api/method/login" \
  --data-urlencode "usr=nonhr-audit@test.local" --data-urlencode "pwd=audit-test-1234"
probe() { echo "== $1"; curl -s -b /tmp/nonhr.jar -o /dev/null -w "%{http_code}\n" "http://localhost:$PORT/api/method/$1${2:+?$2}"; }

probe dewey_time.attendance_engine.hr_calendar.get_calendar_session
probe dewey_time.attendance_engine.hr_calendar.list_calendar_employees
probe dewey_time.attendance_engine.hr_calendar.get_employee_calendar "employee=<OTHER-EMP-ID>&start_date=2026-06-01&end_date=2026-06-07"
probe dewey_time.attendance_engine.coverage_api.get_schedule_coverage
probe dewey_time.attendance_engine.api.get_my_week
probe dewey_time.attendance_engine.dev_tools.preview_clear_all_employee_schedules_api
probe dewey_time.attendance_engine.dashboard_auth.get_dashboard_token
# ...continue through the full inventory above; use -X POST for POST-only methods.
# NEVER call the non-preview clear_* endpoints with a success expectation — if one
# returns 200 for this user, that alone is the (critical) finding; do not re-run it.
```

Also probe the two Bridge webhooks **unauthenticated** (fresh shell, no cookie jar) and expect 401/403.

- [ ] **Step 3: Judge against the expected matrix**

Expected: non-HR user gets their own data (`get_my_week`, own calendar via session) but **403/PermissionError** on: other employees' calendars, `list_calendar_employees` (or a self-only response — check `get_calendar_session`'s `hr_staff` gating in source), all `schedule_api` writes, all `dev_tools`, `get_dashboard_token` (no ADMS role), `schedule_import`. Record a table `endpoint | status | verdict` in the notes doc. Every unexpected pass → `[T3-n]`; a non-HR-accessible destructive `dev_tools` endpoint is automatically **must-fix**.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audits/2026-07-failure-visibility.md docs/ROLLOUT_PUNCH_LIST.md
git commit -m "docs(audit): permissions probe matrix + findings"
```

---

### Task 13: Deploy / rollback sanity

**Files:**
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (findings)

**Interfaces:**
- Consumes (read-only): `dewey_time/docs/HR_ATTENDANCE_DEPLOY.md`, `.github/workflows/frontend.yml`, `hooks.py` after-migrate handlers.

- [ ] **Step 1: Diff the documented routine against reality**

Read `HR_ATTENDANCE_DEPLOY.md`. Verify it still matches: `npm run build` → commit bundle → merge → Frappe Cloud deploy runs `bench migrate` → after-migrate syncs assets. Note anything stale (the doc predates several of this week's changes).

- [ ] **Step 2: Verify the rollback story exists**

Answer in writing (as a punch entry if missing): "prod is broken after a deploy — what exactly do we do?" Expected answer: revert the merge commit (bundle is committed, so revert restores it) → deploy → migrate. If no doc says this, that's a `[T3-n]` should-fix: add a ROLLBACK section to `HR_ATTENDANCE_DEPLOY.md` in Phase 3.

- [ ] **Step 3: Backup discipline (user-check)**

Ask the user to confirm in the Frappe Cloud dashboard that scheduled offsite backups are enabled and recent for the prod site. Record the answer. (Agent cannot and must not access the FC dashboard.)

- [ ] **Step 4: Commit**

```bash
git add docs/ROLLOUT_PUNCH_LIST.md
git commit -m "docs(audit): deploy/rollback findings"
```

---

### Task 14: Consolidate, propose triage, open the PR

**Files:**
- Modify: `docs/ROLLOUT_PUNCH_LIST.md` (proposed bucket per entry)

**Interfaces:**
- Consumes: every Untriaged entry from Tasks 1–13.
- Produces: the Phase 2 gate — the user's triage session; and the audit PR.

- [ ] **Step 1: Propose a bucket for every Untriaged entry**

Move each entry under Must fix / Should fix / Can wait with a one-line rationale, marked `(proposed)`. Bar for Must fix (from spec): would embarrass, mislead, or break trust on day one — data wrongness, permission holes, invisible failures, broken phone layouts on daily-use screens.

- [ ] **Step 2: Sanity pass**

Every entry has evidence; no entry references a screenshot that doesn't exist locally; T2-2 (import CSV) status is accurate; counts per bucket stated at the top of the file.

- [ ] **Step 3: Commit + push + PR**

```bash
git add docs/ROLLOUT_PUNCH_LIST.md
git commit -m "docs(audit): propose triage buckets for all findings"
git push -u origin docs/pre-rollout-readiness-spec
gh pr create --title "docs: pre-rollout readiness spec, audit plan, punch list + audit harness" \
  --body "$(cat <<'EOF'
Phase 1 of the pre-rollout readiness pass (spec included): audit tooling
(awkward-state fixtures + AUDIT-gated screenshot walk), audit notes, and the
triaged-pending punch list that gates rollout.

No product-code changes — audit only. Fixes land per punch-list item in Phase 3.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Merge when green (established workflow).

- [ ] **Step 4: Present triage to the user (Phase 2 gate)**

Report: bucket counts, every proposed Must fix with its evidence, and the open user-side items (import CSV, FC backup confirmation). The user confirms/moves buckets; record decisions in the Triage decisions log. **Phase 3 fix-wave planning starts only after this.**

---

## Self-Review (performed)

- **Spec coverage:** Track 1 → Tasks 2–4 + 6 (both routes, `/adms` entry, 1440/375, staged awkward states, screenshots). Track 2 → Tasks 5, 7–10 (2 real weeks, ≥5/branch sample, both-directions verification, ADMS Bridge, import CSV). Track 3 → Tasks 11–13 (three failure scenarios, full endpoint inventory incl. guest webhooks and `dev_tools`, deploy/rollback, backups). Punch list + triage → Tasks 1, 14. Phase 4 (launch checklist) is intentionally not in this plan — it runs after Phase 3 fixes.
- **Placeholders:** `<mapped-port>`, `<timestamped-dir>`, `<start>/<end>`, `<sampled ids>` are runtime values produced by earlier steps in the same task chain, each with the exact command that produces them — not unresolved design. Locator-adjustment notes in Tasks 3–4 are explicit contingencies with a stated goal state.
- **Type consistency:** `stubAuditScenario`/`AUDIT_SCENARIOS` names match between Task 2 (definition) and Tasks 3–4 (use); screenshot naming convention consistent; punch-list entry format defined once (Task 1) and referenced verbatim.
