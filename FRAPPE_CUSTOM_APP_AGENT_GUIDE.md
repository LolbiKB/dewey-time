# Frappe attendance engine — agent guide (custom app)

This document is the **single source of truth** for any AI agent working on the Frappe-side attendance engine for this project.

It captures: the **domain model**, the **MVP architecture**, the **Bridge → Frappe contract**, and the **non-negotiable constraints** discovered during implementation on Frappe Cloud / Frappe v16 Server Script sandbox.

## Scope

- **In scope**: Frappe HRMS/ERPNext design for attendance processing, flags, employee transparency UI, closeout generation.
- **Out of scope**: ZKTeco device protocol implementation (bridge already owns that), payroll integration, leave policy automation (planned later).

## Current versions (site)

- Frappe 16.x, ERPNext 16.x, HRMS 16.x

## High-level goal (MVP)

Employees should see a **weekly calendar** (Desk) showing:

- punches and computed minutes (computed on read)
- flags (provisional intraday + final at closeout)
- ability to attach explanation/proof to a flag

HR should have an **inbox** (Desk list/filter) of open flags to approve/reject.

## Core architecture decisions (MVP)

### 1) Source of truth = `Employee Checkin`

`Employee Checkin` rows are the **immutable punch ledger** written by the bridge.

Bridge sets:

- `skip_auto_attendance = 1` on device punches to prevent ERP auto-attendance from creating `Attendance`.
- `custom_supabase_log_id` unique for idempotency.

### 2) Persisted output = `Attendance Flag`

`Attendance Flag` is the persisted **workflow object** (issue + explanation + HR decision). One row per issue.

No “Attendance Day” projection DocType in MVP. Minutes/timeline are computed on read.

### 3) AUTO flags timing = intraday provisional + closeout final

AUTO flags use **`day_closed`**:

- **Provisional (`day_closed=0`):** intraday refresh for today — `MISSING_TIME`, `NON_PRIMARY_SITE_PUNCH` only.
- **Final (`day_closed=1`):** device closeout / company fallback — all other AUTO flags. Closeout deletes provisional AUTO flags for that employee/date before writing finals.

Reason: provisional flags give HR early signal without finalizing lateness/absence before the day is closed.

### 4) Device → Branch is IT-owned in Supabase, delivered by bridge

Supabase `devices.location` is treated as the canonical **Frappe `Branch.name`**.

- The dashboard device editor already fetches Branch options from Frappe and stores the selected value into `devices.location`.
- Bridge enriches each `Employee Checkin` insert with `custom_device_branch = devices.location`.

HR never maintains a Frappe-side device registry.

## Frappe domain model (must understand)

### Shifts (HRMS 16)

- `Shift Type` (`FT_0800_1700`): start/end + custom lunch/grace fields.
- `Shift Schedule` (`PAT_*`): pattern (days/frequency) referencing a Shift Type (submitted).
- `Shift Schedule Assignment`: employee → schedule; generates dated `Shift Assignment` rows.
- `Shift Assignment`: employee + date → expected shift context.

### Employee primary Branch

Use built-in `Employee.branch` as the employee’s primary branch.

### Attendance punch ledger

`Employee Checkin` important fields used by the engine:

- `employee` (Employee name/id)
- `time` (Datetime)
- `device_id` (device serial)
- `custom_device_branch` (Link → Branch) **bridge-derived**
- `custom_supabase_log_id` (Unique idempotency key)
- `skip_auto_attendance = 1`
- `custom_verify_type`, `custom_bridge_env` (ops/debug)

## Bridge → Frappe contract

**Bridge / device engineers:** full handoff (checkin delivery, closeout, intraday sync watermark) — [`docs/BRIDGE_AGENT_HANDOFF.md`](docs/BRIDGE_AGENT_HANDOFF.md).

### Employee Checkin

POST to Frappe resource API for `Employee Checkin`.

Canonical payload fields (MVP):

- `employee`
- `time`
- `device_id` (= device serial)
- `log_type` (MVP may be always `IN`)
- `skip_auto_attendance` (= 1)
- `custom_supabase_log_id` (unique)
- `custom_verify_type`
- `custom_bridge_env`
- `custom_device_branch` (= Supabase `devices.location`, expected to match `Branch.name`)

## Attendance rules (policy source of truth)

All policy/rule definitions live in:

- `docs/FRAPPE_ATTENDANCE_RULES.md`

Agents must treat that file as the **source of truth** for:

- how to determine expected shift for a date
- how to select checkins for a date in company timezone
- how to compute `first_in` / `last_out` / minutes (MVP heuristic)
- flag definitions (`LATE_START`, `MISSING_*`, `OFF_SHIFT_PUNCH`, lunch rules)
- what is explicitly deferred

This agent guide only summarizes the key rule outputs and how they map to doctypes/workflow.

### Intraday + closeout (MVP)

AUTO flags are split by **`day_closed`**:

- **Intraday provisional (`day_closed=0`):** `MISSING_TIME`, `NON_PRIMARY_SITE_PUNCH` only (skips holidays). Refreshed during business hours for today.
- **Closeout final (`day_closed=1`):** all other AUTO flags (`LATE_START`, `UNNOTIFIED_ABSENCE`, lunch, record issues, etc.). Closeout deletes provisional AUTO flags for that employee/date before writing finals.

Never mutate historical **Employee Checkin** rows.

## Rules / flags (MVP — implemented)

**Grace:** `shift_grace.py` — effective start/end = `max(custom_grace_minutes, HRMS grace fields)`.

**Holiday wins:** `holidays.py` — company Holiday List dates suppress on-shift flags; punches on holiday → `OFF_SHIFT_PUNCH` only.

**Closeout flags (examples):**

- `UNNOTIFIED_ABSENCE`: on-shift, zero checkins at closeout / fallback
- `LATE_START`: closeout only; **≥2 checkins**; first in after start + effective start grace
- `LEFT_EARLY`, `MISSING_IN_OR_OUT`, `ATTENDANCE_ISSUE`, `DELIVERY_FAILED`, `UNKNOWN_DEVICE_BRANCH`
- `OFF_SHIFT_PUNCH`: off-shift or holiday with checkins
- `LATE_FROM_LUNCH`: valid observed lunch return late (full-day shifts)

**Intraday provisional:** `MISSING_TIME`, `NON_PRIMARY_SITE_PUNCH`.

**Not emitted:** `MISSING_LUNCH` (suppressed); `NO_CHECKIN_YET` (doctype only).

**HR UI (`/hr-attendance`):** read-only flag review panel in day inspector; approve/reject in Desk (P1 for SPA actions).

## Closeout generator (what to build first)

Build a job: `generate_auto_flags_for_date(D)`

Inputs:

- Employee list (active employees, or employees with shift assignments in range)
- Expected shift for (employee, D) from `Shift Assignment` + Holiday List
- Checkins for (employee, D) in company timezone

Outputs:

- Insert `Attendance Flag` rows with:
  - `source = AUTO`
  - `status = OPEN`
  - `day_closed = 1`
  - `rule_version = v0` (or similar)
  - `evidence` JSON with the computed times/thresholds used

Idempotency:

- Only manage `source = AUTO` rows for (employee, D).
- Do not delete/overwrite `source = HR` or `source = EMPLOYEE`.
- If re-running, either:
  - delete AUTO flags for (employee, D) then insert again, OR
  - upsert by a stable key (employee + date + flag_code) (more work).

## Desk UI (MVP)

1) HR inbox

- Saved filter/list for `Attendance Flag` where `status = OPEN`
- Common filters: date range, flag_code, branch

2) Employee “My Week”

Expose a whitelisted method (or Query Report backend) to return, for date range:

- shift context
- checkins
- computed minutes (first/last/net)
- flags for each date

No stored day projection is required for MVP.

## Frappe Cloud sandbox constraints (critical)

### Server Script / System Console limitations encountered

- `import` may be blocked (`ImportError: __import__ not found`).
- `.format()` often blocked (`format is an unsafe attribute`).
- `hasattr` / `getattr` can be blocked (`NameError`).
- Calling one user-defined `def` from another can fail (`NameError` for helper functions).

Implication:

- Complex logic belongs in a **custom app** (Python module), not Server Scripts.
- If Server Scripts are used, keep them minimal and “flat”.

## Security note (Supabase)

Supabase advisor reported **RLS disabled** on `public.user_operation_locks` and `public.enrollment_sessions` (critical). Do not “auto-fix” without policies; coordinate with IT.

## Repository docs to read first

- Shift setup: `docs/FRAPPE_SHIFT_SETUP.md`
- Checkin ingestion: `docs/FRAPPE_EMPLOYEE_CHECKIN.md`
- Rules: `docs/FRAPPE_ATTENDANCE_RULES.md`
- Engine plan: `docs/FRAPPE_ATTENDANCE_ENGINE_PLAN.md`
- MVP test steps: `docs/MVP_ATTENDANCE_ENGINE_TEST_GUIDE.md`

