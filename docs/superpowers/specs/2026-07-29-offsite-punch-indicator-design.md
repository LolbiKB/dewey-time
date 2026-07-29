# Off-site punch indicator — design

**Date:** 2026-07-29
**Status:** approved, ready for planning

## Goal

HR can see at a glance which worked time happened somewhere other than the employee's
primary site — as a quiet note, not an alarm. The employee may well have a good reason;
the UI should say "this happened", not "this is wrong".

## Background: what already exists

Detection is **already implemented and working**. This spec adds no new detection.

| Piece | Where | State |
|---|---|---|
| Employee's primary site | `Employee.branch` (stock HRMS Link → Branch) | exists |
| Where a punch happened | `Employee Checkin.custom_device_branch` (custom Link → Branch, read-only) | exists, `setup/custom_fields.py:20` |
| Detection | `closeout.py:395` `_non_primary_site_punch_flag`, `intraday.py:113` | exists |
| Flag code | `NON_PRIMARY_SITE_PUNCH`, evidence carries `employee_branch` + `non_primary_checkins` | exists |

What is weak is **legibility**. Today the only visible difference between a home-site day and
an off-site day is the branch letter changing (`A` → `B`) in 10px type at 85% opacity —
and that label is hidden entirely on blocks under 24% height (`DayTimeline.tsx:561`).

Two facts discovered while designing this, both load-bearing:

1. **`employee_branch` is computed but never returned.** `hr_calendar.py:480` resolves it for
   closeout-alert and sync-status purposes, but the `get_employee_calendar` payload
   (`hr_calendar.py:643`) omits it. **The frontend therefore cannot currently tell which
   segment is off-site at all.** Nothing else in this spec works until this is fixed.
2. **`FLAG_SEVERITY` is duplicated** in `closeout.py:61` and
   `dewey_time/doctype/attendance_flag/attendance_flag.py:6`, with identical contents.
   Changing one silently diverges them.

## Explicitly out of scope

The `Attendance Flag` doctype already models a **complete** justification workflow —
`employee_note`, `employee_attachment`, `employee_submitted_at`, `hr_note`, `hr_user`,
`hr_decided_at`, and a `status` of `OPEN → EXPLAINED → APPROVED / REJECTED / CLOSED`.

**None of it is wired up.** The calendar API returns 9 flag fields (`hr_calendar.py:540`) and
no note field is among them; `FlagDetailPanel.tsx:53` only displays the status label.

Surfacing that workflow is a separate feature: it applies to all 13 flag codes, and needs
write APIs, employee-vs-HR permission separation, and attachment upload. It gets its own spec.
This one ships the indicator only.

## Design

### 1. Expose the primary branch — `hr_calendar.py:643`

Add one key to the `get_employee_calendar` return dict:

```python
    return {
        "employee": employee,
        "start_date": str(start),
        "end_date": str(end),
        "days": days,
        "device_alerts": device_alerts,
        "device_sync": device_sync,
        "employee_branch": employee_branch,   # NEW
        **_employee_nav_meta(employee),
    }
```

`employee_branch` is already resolved at line 480, so this adds no query. It may be `None`.

The frontend type in `types/calendar.ts` gains `employee_branch?: string | null`.

Deriving off-site from the *flag* instead was considered and rejected: flags only exist after
the engine has run, the evidence is a JSON string, and the flag is per-day while the indicator
is per-segment. Comparing branches directly works intraday and needs no parsing.

### 2. Reclassify the flag

`NON_PRIMARY_SITE_PUNCH`: `WARNING` → `INFO`, in **both** maps:

- `dewey_time/attendance_engine/closeout.py:61`
- `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.py:6`

Detection logic is untouched. `INFO` already exists as a tier in the doctype's severity
options, so no schema change.

### 3. Backfill existing rows — new patch

Severity is stamped at insert (`attendance_flag.py` `before_insert`), so existing rows keep
`WARNING` and would disagree with newly generated ones, leaving historical weeks with an
inflated warning count.

A patch under `dewey_time/patches/` updates existing rows:

```python
frappe.db.sql("""
    UPDATE `tabAttendance Flag`
    SET severity = 'INFO'
    WHERE flag_code = 'NON_PRIMARY_SITE_PUNCH' AND severity != 'INFO'
""")
```

Idempotent by construction — re-running matches nothing. **Must be registered in
`dewey_time/patches.txt`**; a patch file without a manifest entry never runs.

### 4. The hatch — `DayTimeline.tsx`

A worked segment whose branch is non-null and differs from `employee_branch` renders a
diagonal hatch overlay on its fill:

```
repeating-linear-gradient(135deg, rgba(255,255,255,.13) 0 5px, transparent 5px 13px)
```

**Scope of application — all three conditions required:**

- only on the **worked (green) tone** — the `workedTone` branch that `DayTimeline` already
  computes, which covers both scheduled and clock-based days
- **never** on accent/off-shift segments (see rationale below)
- **never** on gap bands (missing-time, away, lunch)

Both `WeekView` and `WeekDayView` inherit it for free — they render the same `DayTimeline`
segments, so no phone-specific work is needed.

#### Why not orange, and why not on accent segments

`brand/tokens.css:14` reserves `--brand-accent: #c2410c` as *"the urgent / attention signal"*.
It is what device alerts and holiday cells already use. Spending it on a minor, justifiable
note would blunt it everywhere else, so the hatch is a white overlay on the existing fill and
introduces no new colour.

Rendering the candidates against the real `WeekView` showed the accent case fails outright: an
employee with no shift assigned already renders salmon with dashed red borders and red date
pills — the `OFF_SHIFT_PUNCH` language. A white hatch is invisible on it, and a dark hatch is
legible but piles a second signal onto a day that is already shouting. If someone is off-shift
*and* off-site, off-shift is the larger story and already owns the cell.

The same exercise confirmed the hatch stays legible on ~60px green blocks, which is where a
corner fold or a badge would have failed.

### 5. Wording

| File | From | To |
|---|---|---|
| `flagLabels.ts:13` | `NON_PRIMARY_SITE_PUNCH: "Wrong site"` | `"Other site"` |
| `flagLabels.ts:72` | `wrongSite: [...]` filter-group key | `otherSite: [...]` |
| `flagDetails.ts:57` | "At least one punch came from a device branch that does not match the employee's assigned branch." | "At least one punch came from a site other than the employee's primary site. This is often expected — cover shifts, deliveries, or multi-site roles." |

The `wrongSite` key rename must be followed to its consumers — the week filter UI reads
`FLAG_FILTER_GROUPS`.

## Testing

**Backend**
- `get_employee_calendar` returns `employee_branch`, including `None` when unset.
- Severity is `INFO` on newly created `NON_PRIMARY_SITE_PUNCH` rows.
- The patch flips existing `WARNING` rows and is safe to run twice.

**Frontend — the off-site predicate**
Pure unit tests on a small helper (`isOffSiteSegment(segmentBranch, employeeBranch)`), covering:

| segment branch | employee branch | off-site? |
|---|---|---|
| `"BRANCH-B"` | `"BRANCH-A"` | yes |
| `"BRANCH-A"` | `"BRANCH-A"` | no |
| `null` | `"BRANCH-A"` | **no** — unknown branch is `ATTENDANCE_ISSUE`'s job |
| `"BRANCH-B"` | `null` | **no** — see below |
| `"BRANCH-B"` | `""` | **no** |

**Frontend — render tests** (`renderToStaticMarkup`, matching the existing
`weekTimelineScroll.test.tsx` idiom):
- a green off-site segment carries the hatch
- a green home-site segment does not
- an accent/off-shift segment does not, even when its branch differs
- gap bands never carry it
- **with `employee_branch` null, nothing on the screen is hatched**

That last case is the one most likely to ship broken: many employees have a blank
`Employee.branch`, and a naive `segment.branch !== employeeBranch` comparison marks *every*
segment off-site for all of them. The backend already guards this (`if not employee_branch:
return None`); the frontend must match.

## Deployment

Runtime frontend code changes, so per `CLAUDE.md` the rebuilt
`dewey_time/public/hr_attendance/**` and `dewey_time/www/hr-{attendance,schedule}.html`
**must be committed in the same PR** — Frappe Cloud never builds this SPA.

The patch requires a `bench migrate` to run.
