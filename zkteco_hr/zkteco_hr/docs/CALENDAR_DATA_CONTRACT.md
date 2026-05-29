# Calendar data contract

zkteco_hr does **not** submit HRMS shift documents. It **filters** ERPNext/HRMS data using the rules below when building the HR attendance calendar and closeout flags.

## Submission / filter semantics

| Source | Used for | Filter rule |
|--------|----------|-------------|
| **Shift Assignment** | Expected shift per date (`day.shift`), on-shift rules, ghost band | `docstatus == 1` (Submitted), `status == "Active"`, `start_date <= D`, `end_date` null or `>= D`. Draft assignments are ignored. Prefer HRMS `get_shifts_for_date(employee, noon on D)`. |
| **Shift Schedule** (`PAT_*`) | Pattern metadata when resolving SSA | Optional strict: linked schedule `docstatus == 1`; log if draft. |
| **Shift Schedule Assignment** | Picker `has_shift_assignment`, SSA id, date bounds fallback | No docstatus. `enabled == 1`, not expired. Dated calendar still from **Shift Assignment**. |
| **Leave Application** | `day.leave` badge | `docstatus == 1`, `status == "Approved"`, `from_date <= D <= to_date`. Leave does not remove shift ghost if a Shift Assignment exists. |
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
  "leave": { "on_leave": false },
  "checkins": [],
  "flags": []
}
```

Off day (no covering Shift Assignment):

```json
{ "shift": { "shift_assigned": false }, "leave": { "on_leave": false } }
```

Approved leave:

```json
{ "leave": { "on_leave": true, "leave_type": "Annual Leave" } }
```

## Off-shift punches

When `shift_assigned` is false and checkins exist, closeout creates **`OFF_SHIFT_PUNCH`** (day-level Attendance Flag, not per-segment).

Implementation: `attendance_engine/shift_assignment.py`, `attendance_engine/hr_calendar.py`, `attendance_engine/closeout.py`.
