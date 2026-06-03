# Calendar data contract

zkteco_hr does **not** submit HRMS shift documents. It **filters** ERPNext/HRMS data using the rules below when building the HR attendance calendar and closeout flags.

Policy: [`docs/FRAPPE_ATTENDANCE_RULES.md`](../../../docs/FRAPPE_ATTENDANCE_RULES.md)

## Submission / filter semantics

| Source | Used for | Filter rule |
|--------|----------|-------------|
| **Shift Assignment** | Expected shift per date (`day.shift`), on-shift rules, ghost band | `docstatus == 1` (Submitted), in range (`start_date <= D`, `end_date` null or `>= D`). **Live** (`D >= site today`): `status == "Active"`. **Historical** (`D < site today`): Active first, then Inactive if no Active row (`schedule_superseded` on API). Draft assignments ignored. Prefer HRMS `get_shifts_for_date(employee, noon on D)`. |
| **Shift Assignment (bounds)** | Picker `schedule_min/max`, `has_shift_assignment` | Submitted **Active only** (live schedule window — not retired slices). |
| **Shift Schedule** (`PAT_*`) | Pattern metadata when resolving SSA | Optional strict: linked schedule `docstatus == 1`; log if draft. |
| **Shift Schedule Assignment** | Picker `has_shift_assignment`, SSA id, date bounds fallback | No docstatus. `enabled == 1`, not expired. Dated calendar still from **Shift Assignment**. |
| **Leave Application** | `day.leave` badge | `docstatus == 1`, `status == "Approved"`, `from_date <= D <= to_date`. Leave does not remove shift ghost if a Shift Assignment exists. |
| **Holiday List** | `day.holiday`, off-day UI, flag engine holiday wins | Via `Company.default_holiday_list` → `holiday_by_date_for_company`. Flag engine treats holiday as off-shift even if SSA created a Shift Assignment. |
| **Attendance Flag** | Day flags in UI / closeout | Filter by flag `status` / `day_closed`, not ERP docstatus. |
| **Employee Checkin** | Punches, segments | No submit filter (immutable ledger). |

## Whitelisted APIs

### `list_calendar_employees(include_without_shifts=True)`

Returns Active employees sorted with shift coverage first.

```json
{
  "id": "EMP-001",
  "label": "EMP-001 · Jane Doe",
  "employee_name": "Jane Doe",
  "has_shift_assignment": true,
  "has_shift_schedule_assignment": true,
  "shift_schedule_assignment": "HR-SHSA-26-05-00002",
  "schedule_min_date": "2026-05-01",
  "schedule_max_date": "2026-08-31"
}
```

`schedule_max_date` is `null` when any submitted Active assignment has no `end_date` (open-ended).

### `get_employee_calendar(employee, start_date, end_date)`

Per day:

```json
{
  "date": "2026-05-29",
  "shift": {
    "shift_assigned": true,
    "shift_type": "FT_Standard",
    "start_time": "08:00:00",
    "end_time": "17:00:00",
    "grace_minutes": 15,
    "lunch_start": "12:00:00",
    "lunch_end": "13:00:00"
  },
  "holiday": null,
  "leave": { "on_leave": false },
  "checkins": [],
  "flags": [],
  "observed_lunch": null
}
```

`grace_minutes` is **effective start grace** = `max(custom_grace_minutes, late_entry_grace_period)` from Shift Type (see `shift_grace.py`).

Holiday day (flag engine treats as off; UI shows holiday board):

```json
{
  "date": "2026-05-01",
  "shift": { "shift_assigned": true },
  "holiday": {
    "description": "International Workers' Day",
    "weekly_off": false
  },
  "leave": { "on_leave": false },
  "checkins": [],
  "flags": []
}
```

Note: `shift_assigned` may still be `true` from SSA rows; UI and flag engine apply **holiday wins** (timeline off-day, suppress on-shift flags; `OFF_SHIFT_PUNCH` if punches exist).

Off day (no covering Shift Assignment, not a holiday):

```json
{ "shift": { "shift_assigned": false }, "holiday": null, "leave": { "on_leave": false } }
```

Approved leave:

```json
{ "leave": { "on_leave": true, "leave_type": "Annual Leave" } }
```

Flag object (in `day.flags[]`):

```json
{
  "name": "AUTO-emp-1-2026-05-29-late-start",
  "flag_code": "LATE_START",
  "severity": "WARNING",
  "status": "OPEN",
  "source": "AUTO",
  "day_closed": 1,
  "is_provisional": false,
  "evidence": { "first_in": "...", "late_threshold": "..." }
}
```

`is_provisional` is `true` when `day_closed === 0`.

**Device sync** (top-level `device_sync[]`, employee primary branch):

```json
{
  "device_sn": "CK92218010001",
  "branch": "DIS Iconic",
  "local_date": "2026-06-03",
  "last_device_log_at": "2026-06-03 14:02:00",
  "last_delivered_at": "2026-06-03 14:00:00",
  "pending_count": 0,
  "last_error": null
}
```

Written by bridge via `notify_device_sync_status` (one Frappe row per `device_sn` + `local_date`). Calendar returns **at most one** object per device+date (latest `modified`). See [`docs/BRIDGE_AGENT_HANDOFF.md`](../../../docs/BRIDGE_AGENT_HANDOFF.md).

## HR flag review (UI)

Flags are listed in the **day inspector → Flags** tab. Clicking a flag opens an inline **HR review panel** (read-only): summary, supporting details, recommended HR action, **Review in Desk** link. Status `OPEN` is shown as **Awaiting HR review**. Approve/reject remains in Desk (P1 for SPA workflow).

Week header **`OFF_SHIFT`** chip opens the day inspector directly on that flag’s review panel.

## Off-shift / holiday punches

When the day is off (no assignment, or **holiday wins**) and checkins exist, closeout creates **`OFF_SHIFT_PUNCH`** only (day-level Attendance Flag).

**After enabling historical Inactive lookup:** existing `OFF_SHIFT_PUNCH` rows on days that were wrongly treated as off-shift are **not** auto-removed. Re-run closeout for affected dates (or clear flags in Desk) if HR needs flags aligned with restored on-shift rules.

Implementation: `attendance_engine/shift_assignment.py`, `attendance_engine/holidays.py`, `attendance_engine/hr_calendar.py`, `attendance_engine/closeout.py`.
