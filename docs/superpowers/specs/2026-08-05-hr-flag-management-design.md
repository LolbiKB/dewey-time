# HR Flag Management — Design (Spec 1 of 3)

**Date:** 2026-08-05
**Status:** approved for planning

## Goal

Give HR a page inside the SPA where they triage `Attendance Flag` records across all
employees and record a durable, auditable decision on each — replacing today's bounce
out to the Frappe Desk list view.

This is the P1 deferred in `docs/FRAPPE_ATTENDANCE_RULES.md:212`:
*"Approve / reject / employee explain in SPA: P1 (Desk remains system of record)."*

## Sequencing — this is Spec 1 of 3

| Spec | Contents | Status |
|---|---|---|
| **1 (this doc)** | Decision record, cross-employee read API, HR triage page, additive triage ranking | designing |
| 2 | Employee explanation surface (`employee_note`, attachment, `EXPLAINED`) | not started |
| 3 | Whatever remains after 1 and 2 ship | not started |

Spec 2 depends entirely on Spec 1's decision record existing, so the order is forced,
not preferential.

## Prerequisite — a separate engine fix lands first

**`intraday.py:214` must be fixed before this plan is written.** It deletes every AUTO flag
for an employee/date on a checkin edit but regenerates only `MISSING_TIME` and
`NON_PRIMARY_SITE_PUNCH`, and only as provisional — so on an already-closed past date every
other flag is destroyed permanently (details under *Background*). Correcting a punch is the
most common HR action while triaging, so shipping the queue on top of this bug would
manufacture `orphaned_flag_gone` decisions during ordinary use and make the page look broken
when the engine is at fault.

Scope of that fix: on a date that has already closed out, either restrict the deletion to
what the intraday pass will actually regenerate, or re-run full closeout generation instead
of the intraday subset. Self-contained, testable on its own, and **not** part of this plan —
it gets its own branch and review.

## Background — why a new record is required

`Attendance Flag` already carries a full review workflow in its schema (`status`,
`hr_note`, `hr_user`, `hr_decided_at`, `status_changed_by/at`). None of it can be used,
because **AUTO flag rows are deleted and rebuilt constantly**:

| Site | Deletes |
|---|---|
| `intraday.py:78` | `day_closed=0` rows, scoped to `INTRADAY_FLAG_CODES` |
| `intraday.py:214` | **all** AUTO rows for that employee/date — fires on every checkin insert *and* update |
| `closeout.py:295` | `day_closed=1` rows |
| `closeout.py:473` | `day_closed=0` rows |
| `closeout.py:476` | `day_closed=1` rows |
| `closeout.py:696` | the shared helper all of the above call |
| `schedule_resolver.py:1240` | **not the engine**, and **not scoped to `source = "AUTO"`** — `clear_employee_schedule` deletes that employee's flags, including any HR- or EMPLOYEE-sourced rows, when HR clears their schedule |
| `schedule_resolver.py:1299-1348` | `clear_all_employee_schedules` — the site-wide wipe |

The intraday engine runs every 30 minutes and on every punch. Deletion is a raw
`frappe.db.delete()` that bypasses document hooks and permissions
(`closeout.py:712`, `schedule_resolver.py:1240`). Anything written onto an AUTO flag row is
therefore destroyed without trace by the next engine run — or by an unrelated HR action on
the schedule wizard, which is the case most likely to surprise someone.

Note also that the deterministic name is itself **unstable across the provisional→final
transition** (the `-prov` marker, `attendance_flag.py:53-71`), so even setting deletion
aside, `Attendance Flag.name` could not serve as a foreign key.

### This failure is already live

The SPA currently tells HR to go and decide in Desk — `flagDetails.ts:126-163` renders
guidance like *"approve or reject the flag there"* — and `Attendance Flag` already carries
`status`, `hr_note`, `hr_user`, `hr_decided_at`. Every decision HR has made that way is
subject to the deletion table above. This spec is not preventing a hypothetical problem;
it is closing one that is running today, unmonitored.

### A worse, adjacent bug this spec does not fix

`intraday.py:214` deletes **every** AUTO flag — any code, provisional and final — for an
employee/date whenever an `Employee Checkin`'s time or employee is edited (`:196-201`). The
regeneration it triggers rewrites **only** `MISSING_TIME` and `NON_PRIMARY_SITE_PUNCH`, and
only as `day_closed=0`. On an already-closed past date every other AUTO flag is therefore
deleted and **nothing ever regenerates it** — the only recovery is the dev-only, 31-day-capped
`run_engine_for_employee` (`dev_tools.py:27-60`).

This matters here because correcting a punch is the single most likely thing HR does while
working a flag. Under this bug, correcting a punch can silently destroy the other flags on
that day. Spec 1 does not fix it — the fix belongs in the engine and needs its own task —
but the queue must not pretend the flags are still there, and this is called out in Open
risks.

**Decision: store HR judgments in a separate doctype the engine never reads or writes.**
The engine's delete-everything-and-reinsert-truth invariant is left completely
untouched — no guard clauses in `closeout.py` or `intraday.py`, no changes to the most
heavily tested code in the app (`test_closeout.py` patches the delete helper ~20 times).

## Verified constraints

Every item below was checked against the code. Path:line is the evidence.

### Must not do

1. **Do not use `Attendance Flag.name` as a foreign key.** Rows are hard-deleted, and the
   name itself differs between provisional and final (`-prov` marker,
   `attendance_flag.py:53-71`).
2. **Do not derive `flag_identity` by stripping `-prov` off `name`.** `attendance_flag.py:71`
   truncates with `key[:140]` *after* appending the marker, so on a long name the marker is
   sliced off and the string-surgery approach yields two different identities for one flag.
   The two evidence-derived suffixes are capped at 80 (`:110`, `:118`) but
   `_delivery_failed_key` is uncapped (`:98`, `:102`), so a ~91-char
   `custom_supabase_log_id` reaches the window. Latent today with standard `HR-EMP-00001`
   ids; still must not be relied on.
3. **Do not use `Attendance Flag.linked_checkin`.** It is a dead field — declared on the
   doctype, never written by any AUTO-flag insert path.
4. **Do not mutate `severity` or `FLAG_SEVERITY` to carry magnitude.** It is stamped at
   insert and never recomputed, so a change needs a data-migration patch (precedent:
   `patches/non_primary_site_punch_severity_to_info.py`). The map is duplicated in
   `attendance_flag.py` and `closeout.py` and pinned equal by
   `test_the_two_severity_maps_agree`. The TS `Severity` union is closed and
   `WeekFlagSummary` assumes exactly three buckets.
5. **Do not build the cross-employee query by looping `get_employee_calendar`.** Both
   existing read paths already fan out per-day (`hr_calendar.py:619-623`,
   `api.py:78-82,109-112`); ×500 employees is thousands of queries for one week.
6. **Do not name a device serial in cause-grouping copy.** No device↔branch registry
   exists; `Device Sync Status` and `Device Closeout Alert` are daily transactional rows.
   `custom_device_serial_number` on `Employee Checkin` is unused — `device_id` is the real
   field.

### Must reuse

7. **Permission gate:** import `hr_calendar._require_hr_role()` exactly as `schedule_api.py`
   and `dev_tools.py` do. It treats `HR User` and `HR Manager` as equally authorized.
   Note it throws `frappe.ValidationError` (417), not `PermissionError` (403), unlike its
   neighbours — match that for consistency and state it in the plan so nobody "fixes" it by
   accident.
8. **Write endpoints:** `@frappe.whitelist(methods=["POST"])`, called from the SPA via
   `frappeCall(method, params, { method: "POST" })` as `services/schedule.ts` does.
9. **Bulk partial failure:** copy `schedule_resolver.clear_employee_schedule`'s per-row
   `try/except` + errors-list pattern (`schedule_resolver.py:1203-1254`). One stale row must
   never block the other 38 in a bulk decision.
10. **Branch/device evidence:** `Device Closeout Alert` and `Device Sync Status` both carry a
    `branch` column, already queried by branch at `hr_calendar.py:487-519`, and
    `has_open_device_closeout_alert(branch, local_date)` already exists and is used at
    `hr_calendar.py:114`. Cause-grouping reuses these, batched across employees.

## Data model

### New doctype: `Attendance Flag Decision`

| Field | Type | Notes |
|---|---|---|
| `flag_identity` | Data, reqd, `search_index: 1` | computed key, see below |
| `employee` | Link Employee, reqd | denormalised for querying |
| `attendance_date` | Date, reqd, `search_index: 1` | denormalised |
| `flag_code` | Select, reqd | same options as `Attendance Flag` |
| `employee_branch` | Data | denormalised at write time for cause grouping without a join |
| `outcome` | Select, reqd | `EXCUSED` \| `UPHELD` |
| `reason` | Select, reqd | closed list, see below |
| `note` | Text | **required** when `reason = OTHER` or `outcome = UPHELD` |
| `evidence_fingerprint` | Data | staleness guard, see below |
| `group_key` | Data | batch id; identical across every row written by one bulk action |
| `decided_by` | Link User, read_only | server-set, never from the client |
| `decided_at` | Datetime, read_only | server-set |
| `supersedes` | Link Attendance Flag Decision, read_only | the row this one replaces |
| `superseded` | Check, read_only, default 0 | flipped to 1 on the older row |

`autoname`: hash. Permissions: `HR User` create+write (no delete); `HR Manager` and
`System Manager` create+write+delete. The doctype does **not** inherit `Attendance Flag`'s
permission block — it needs its own.

### `reason` vocabulary (closed)

`APPROVED_LEAVE` · `DEVICE_OR_DATA_FAULT` · `MANAGER_APPROVED` · `SCHEDULE_WRONG` ·
`COVERING_OTHER_SITE` · `GENUINE_VIOLATION` · `OTHER`

Labels: "Approved leave or holiday", "Device or data fault", "Manager pre-approved",
"Schedule was wrong", "Covering another site", "Genuine violation", "Other".

### `flag_identity` — computed from components, never parsed from a name

```
flag_identity = "AUTO-{scrub(employee)}-{attendance_date}-{suffix}"
```

where `suffix` is built by the *same* rules as `attendance_flag.py:44-58`, with two
deliberate differences:

- **`day_closed` is excluded.** A provisional flag and the final flag that replaces it at
  closeout therefore share one identity, so a decision made before closeout is still
  attached after it. This is the point of the scheme.
- **The `DELIVERY_FAILED` key is capped at 80** to match its two siblings, closing the
  truncation window described in constraint 2.

No `[:140]` truncation is applied — `flag_identity` is its own column, not a Frappe
docname, and is not subject to the name-length limit.

The suffix rules, restated so an implementer needs no other file:

| `flag_code` | `suffix` |
|---|---|
| `DELIVERY_FAILED` | `delivery-failed-{scrub(pin\|user_id\|supabase_log_id\|custom_supabase_log_id)[:80]}` |
| `MISSING_TIME` | `missing-time-{scrub(evidence.interval_start)[:80]}` |
| `ATTENDANCE_ISSUE` | `attendance-issue-{scrub(evidence.reason + "-" + evidence.punch_time)[:80]}` |
| anything else | `scrub(flag_code)` |

When the evidence key is absent, fall back to `scrub(flag_code)` — same as the controller.

### `evidence_fingerprint` — the staleness guard

Identity deliberately ignores magnitude, which creates one hazard: `LATE_START`'s suffix is
just `late_start`, so excusing someone 6 minutes late would silently carry that excuse onto
a corrected 90-minute lateness.

```
evidence_fingerprint = sha256(json.dumps(
    {"minutes": evidence.get("minutes"), "reason": evidence.get("reason")},
    sort_keys=True, separators=(",", ":")
)).hexdigest()[:32]
```

Two keys only, both known to exist on real payloads — they are declared on the
`FlagEvidence` type in `frontend/hr_attendance/src/lib/flagLabels.ts` and consumed by
`formatFlagLabel` in the same file. Codes carrying neither produce a
constant fingerprint and can never go stale — correct for binary flags like
`UNNOTIFIED_ABSENCE`.

On read, a flag whose current fingerprint differs from its decision's is returned as
**`needs_re_review`**. The decision is *not* applied and *not* deleted; the flag re-enters
the queue with its prior decision shown as context.

### What `flag_identity` does and does not buy — stated plainly

Excluding `day_closed` fixes the provisional→final rename. **It does not make identity
durable, and this spec must not be read as claiming otherwise.** The suffix is
evidence-derived, and the evidence is recomputed from punch times —
`MISSING_TIME`'s `interval_start` in `absence_flags.py:52-66`, `ATTENDANCE_ISSUE`'s
`punch_time` in `record_issue_flags.py:24-50`. Editing a punch changes the identity. Since
editing a punch is the most common HR action while triaging, orphaning is the *expected*
path, not an edge case.

Orphaning is therefore a first-class state on read, with three values:

| State | Meaning |
|---|---|
| `matched` | live flag, fingerprint agrees — decision applies |
| `orphaned_evidence_changed` | same employee/date/code exists, different evidence key — the punch was corrected |
| `orphaned_flag_gone` | no live flag for this identity at all — corrected away, or destroyed by the `intraday.py:214` bug |

Reconciliation is **read-side only**: the queue endpoint diffs live flags against decisions
for the range. A push-side `on_trash` hook cannot work — every deletion path uses raw
`frappe.db.delete()` and fires no document hooks, and the doctype has no `on_trash` today.

Orphaned decisions are retained forever for audit and never shown as applied.

> **Unresolved (Open risk 1):** a coarser key of `(employee, attendance_date, flag_code)`
> would be punch-edit-stable, but collapses multiple same-code flags on one day — which is
> the exact reason the evidence suffix exists. This spec takes the fine-grained key plus
> explicit orphan states; the trade is real and is called out rather than hidden.

### Supersession

Corrections append. Writing a decision for an identity that already has a live one:

1. inserts the new row with `supersedes` pointing at the old one,
2. sets `superseded = 1` on the old row.

Reads filter `superseded = 0`, which keeps "latest wins" a plain indexed filter rather than
a per-identity subquery. The decision *content* is immutable; only the `superseded` pointer
ever changes on an existing row. Reversing a bulk action means superseding every row sharing
its `group_key` — which is what `group_key` exists for.

## Triage ranking — additive, computed on read

`severity` is left exactly as it is. A new `triage_rank` integer is computed on read by the
queue API and never stored.

| Tier | Rank | Members |
|---|---|---|
| **Act** | 150 | `UNNOTIFIED_ABSENCE` |
| | 140 | `ATTENDANCE_ISSUE`, `MISSING_IN_OR_OUT` |
| | `130 + min(minutes // 60, 9)` | `MISSING_TIME` where `minutes >= 120` |
| **Review** | 70 | `LEFT_EARLY` where `minutes >= 60` |
| | 65 | `LATE_START` where `minutes >= 60` |
| | 60 | `MISSING_TIME` where `30 <= minutes < 120` |
| | 55 | `LATE_FROM_LUNCH` where `minutes >= 30` |
| | 50 | `OFF_SHIFT_PUNCH`, `DELIVERY_FAILED`, `UNKNOWN_DEVICE_BRANCH` |
| **Routine** | 25 | `LEFT_EARLY` where `minutes < 60` |
| | 20 | `LATE_START` where `minutes < 60` |
| | 15 | `LATE_FROM_LUNCH` where `minutes < 30` |
| | 10 | `NON_PRIMARY_SITE_PUNCH` |
| | 5 | `MISSING_LUNCH` |

Missing or unparseable `minutes` falls to the lowest band for that code. A person's rank is
the maximum rank among their **undecided** flags; their tier is that rank's tier.

This ordering is intentionally not expressible through `severity` — `LATE_START` and
`OFF_SHIFT_PUNCH` are both `WARNING`, and `DayInspectorSheet`'s alphabetical tie-break
currently ranks them in exactly the wrong order.

## Cause grouping — branch level

Evaluated in priority order; a person is placed in the first group that claims them and
appears **exactly once** in the whole queue.

1. **`BRANCH_NO_DEVICE_DATA`** — employees sharing `(Employee.branch, attendance_date)`
   where `has_open_device_closeout_alert(branch, date)` is true, **or** no `Device Sync
   Status` row exists for that branch and date. Copy: *"Phnom Penh HQ had no device data on
   3 Aug"* — never a serial number.
2. **`ROUTINE_CODE`** — tier-Routine flags sharing `(flag_code, attendance_date)`. Copy:
   *"168 late starts, 6–20 min — and nothing else wrong that day"*. Only people whose
   **worst** flag is routine land here, which is what makes bulk-excusing them safe.
3. **Ungrouped** — one row per person, headlined by their worst flag, with a `+N` badge for
   the rest.

### Alert cards (not backed by flags)

When a device self-reports `deferred_offline` or `closure_failed`, the company-fallback path
skips those employees entirely and **no flags are generated at all**. That silence is
invisible to HR today. The queue surfaces open `Device Closeout Alert` rows as their own
cards regardless of whether any flag exists — read straight from the alert doctype,
decoupled from flag rows. These cards are informational; they carry no decide action.

## APIs

### `get_flag_queue(start_date, end_date, tier=None, cursor=None, limit=100)`

Whitelisted read, gated by `_require_hr_role()`. **One batched query** over `Attendance
Flag` for the range, one over `Attendance Flag Decision` (`superseded = 0`) for the same
range, one over `Employee` for branch/name, and one each over `Device Closeout Alert` and
`Device Sync Status` by branch+date. Grouping, ranking, person-dedup and fingerprint
comparison happen in Python over those result sets — never per-employee queries.

**Query budget is a hard constraint, not a goal:** O(1) queries per request regardless of
employee count. Any per-employee or per-day query inside this endpoint is a spec violation.
Never loop `get_employee_calendar` (`hr_calendar.py:603-646`) or reuse `get_my_week`'s
per-day shape (`api.py:78-82,109-112`).

**Bounding follows the existing cross-employee precedent rather than inventing one.**
`coverage_api.get_schedule_coverage` is the established shape for an HR-only page that reads
the whole roster: a hard cap (`COVERAGE_EMPLOYEE_LIMIT = 2000`, `coverage_api.py:29`), a
120-second Redis cache (`:25-26`, `:89-96`), doc-event cache invalidation wired at
`hooks.py:126-132`, and a `truncated` counter (`:65-68`) in place of pagination. Reuse that:
date-range cap + row limit + `truncated` flag + cache invalidated on `Attendance Flag` and
`Attendance Flag Decision` writes. A from-scratch cursor scheme is explicitly *not* required
— there is nothing in the repo to copy for one, and `truncated` is honest about what was
dropped.

**Indexes ship with the feature.** No field of any doctype in this app carries
`search_index` today. Add `"search_index": 1` to:

- `Attendance Flag`: `attendance_date`, `flag_code`, `status`
- `Attendance Flag Decision`: `flag_identity`, `attendance_date`, `superseded`

`attendance_flag.json` also needs its `modified` timestamp bumped, or `bench migrate` skips
the schema reimport entirely and the indexes silently never appear. Alternatively add a
composite index via a patch registered in `dewey_time/patches.txt`.

> Frappe auto-indexes `Link` columns, so `employee` and `company` are already covered. That
> behaviour is documented framework rather than something verifiable in this repo (no bench
> is present here) — confirm on a bench before sizing the query.

### `decide_flags(identities, outcome, reason, note=None, group_key=None)`

Whitelisted POST, gated by `_require_hr_role()`. Accepts 1..N identities so a single-flag
decision and a 39-person bulk action share one code path. Per-row `try/except`; returns
`{"ok": bool, "written": int, "errors": [{"flag_identity": ..., "error": ...}]}`.

`decided_by` and `decided_at` are set server-side from `frappe.session.user` and
`now_datetime()` and ignored if supplied by the client. Supersession is handled inside this
call.

**Bulk reversal is gated harder than bulk decision.** Superseding a whole `group_key` — the
undo for a 39-person action — layers an explicit stricter role check on top of
`_require_hr_role()`, following the precedent `dev_tools._require_system_manager_for_clear()`
sets for high-blast-radius operations (`dev_tools.py:132-139`). Deciding is `HR User`;
mass-reversing is not.

`decide_flags` may also adopt the codebase's established preview/confirm two-step
(`{"needs_confirm": True, "preview": ...}` — `schedule_api.py:438`, `dev_tools.py:124-129`)
when a single call would write more than 25 decisions, so a bulk action shows its blast
radius before committing.

### `get_employee_calendar` (existing) — additive change

Gains a `decision` object on each flag it already returns, so the day inspector and week
grid show decisions without a second round trip. No change to any existing field.

## UI

Route `/hr-flags`, added to `main.tsx` alongside the existing four and to `HrAppShell`'s tab
list (HR-only, like Schedule and Coverage). The shell's existing "Flags" header button
(`HrAppShell.tsx:22`, currently `/app/attendance-flag`) is repointed at this route.

Split inbox:

- **Left** — cause groups and person rows in one ranked list, interleaved by consequence, so
  a lone 3-hour gap can outrank a 168-member routine group.
- **Right** — the selected person's whole day: shift, punches, timeline, and every flag they
  have that day worst-first, each individually decidable. A person clears the queue only
  when **all** their flags are decided; partially decided people return headlined by their
  next undecided flag.
- **"Same reason applies"** — after the first decision on a person, each remaining flag
  offers a one-click repeat of that outcome + reason + note, plus "Apply to remaining N".
  Every write still requires an explicit click; nothing is ever auto-closed.
- **Per-member exclusion on group decisions.** Selecting a cause group shows its members
  with checkboxes, all checked by default; unchecking someone removes them from the bulk
  action and leaves their flags undecided in the queue. Without this, one genuine no-show
  hidden among 41 device-fault rows is silently excused — the single most damaging thing
  this page could do. The group header reports the live count ("Excuse 39" when 2 of 41 are
  unchecked), and "Decide one by one" drops the whole group into individual rows when it
  turns out not to be uniform.
- Toolbar counts: Open · Explained · Needs re-review · Decided.

Reuses the existing notice components (`components/ui/notice.tsx` — `AttentionStrip`,
`FailureBlock`) rather than `Alert`, per the three-role notice system merged in 823d43c1.

### Retiring the Desk decision path

This page becomes the only place HR decides. In the same work:

- `flagDetails.ts:126-163` — rewrite `flagHrGuidance` so it no longer instructs HR to
  "approve or reject in Desk". Guidance points at this page instead.
- `FlagDetailPanel.tsx:118-125` — "Review in Desk" demoted from primary action to a
  secondary "Open record" link; the decide actions become primary.
- `Attendance Flag`'s `status`, `hr_note`, `hr_user`, `hr_decided_at` are marked deprecated
  in the doctype (label prefix `(deprecated)`, `read_only: 1`). They are **not** dropped —
  dropping columns would destroy whatever history survived the deletion table.
- A one-off patch, registered in `dewey_time/patches.txt`, best-effort migrates any surviving
  `status != "OPEN"` rows into `Attendance Flag Decision`, mapping `APPROVED → EXCUSED` and
  `REJECTED → UPHELD` with `reason = OTHER`, `note = hr_note`, `decided_by = hr_user`,
  `decided_at = hr_decided_at`. Rows it cannot map are logged, not silently dropped.

The mirror-writes alternative was rejected: writing decisions back into fields that get
deleted couples this feature to the exact failure it exists to escape.

## Error handling

- Load failure → `FailureBlock` in the region the queue would occupy, with Retry.
- Partial bulk failure → the queue refetches and an `AttentionStrip` reports
  *"34 of 39 saved — 5 flags changed while you were deciding"*, with the failures listed in
  its disclosure. Those five re-enter the queue as `needs_re_review`.
- A decision whose flag has vanished entirely (`orphaned_flag_gone`) is retained in the
  database for audit and simply not shown in the queue.

## Testing

**Backend** (`unittest`, run via `bench --site <site> run-tests --app dewey_time`):

- `flag_identity` is byte-identical for a provisional and its final counterpart.
- `flag_identity` for `MISSING_TIME` changes when `interval_start` changes.
- A `DELIVERY_FAILED` key longer than 80 chars is capped and does not collide.
- Fingerprint mismatch yields `needs_re_review` and does **not** apply the decision.
- Supersession: second decision flips `superseded` on the first; read returns only the new.
- `decide_flags` with one bad identity among 39 writes 38 and reports one error.
- `get_flag_queue` issues a bounded number of queries independent of employee count —
  assert with `frappe.db.sql` call counting, not wall-clock.
- Permission: a non-HR session is rejected by both endpoints.

**Frontend** (`node:test` + `renderToStaticMarkup`, via `npm run test:web`):

- Ranking: a 3h `MISSING_TIME` outranks a 35min one; `OFF_SHIFT_PUNCH` outranks
  `LATE_START`.
- Person-dedup: an employee with a routine flag *and* an act-tier flag appears once, in the
  act tier, and not in the routine group.
- "Same reason applies" prefills but does not submit.
- Per-member exclusion: unchecking a group member removes them from the bulk payload, and
  the group header count drops to match.
- `needs_re_review` renders the prior decision as context, not as an applied outcome.

**E2E** (Playwright): the queue renders, a single decision persists across a refetch, and a
bulk decision with one stale row reports partial failure.

> `test:web` is an explicit per-directory glob in `package.json`, **not** recursive. Any new
> test directory must be added to it or the tests silently never run.

## Out of scope for Spec 1

- Employee explanation (`employee_note`, attachment, `EXPLAINED`) — Spec 2.
- Any write-through to ERPNext `Attendance` or payroll. Decisions are recorded for later
  consumption; nothing reads them yet.
- A device↔branch registry. Cause grouping is branch-granularity precisely because that
  registry does not exist.
- Changing `severity`, `FLAG_SEVERITY`, or any existing consumer of them.

## Naming collision to not re-litigate

`frontend/adms/src/components/users/attendance-flag-notice.tsx` and
`user-service.ts:334-354` in the ADMS SPA are **unrelated**. That is a Supabase
`users.attendance_flagged_at` suspicious-punch marker on a device user, cleared through a
bridge REST endpoint. It never touches the Frappe `Attendance Flag` doctype, has no severity
concept, and is not a second writer. Three separate verifiers checked it independently.

## Open risks

1. **`flag_identity` is stable against regeneration, not against punch edits.** The
   fine-grained evidence key orphans a decision whenever HR corrects the punch underneath
   it, which is a common action rather than a rare one. The alternative — keying on
   `(employee, attendance_date, flag_code)` — is punch-stable but cannot distinguish two
   `MISSING_TIME` gaps on one day. Decision taken: fine-grained key plus explicit orphan
   states. Revisit if orphan rates in practice turn out to be high.
2. **Nothing consumes decisions yet.** The value is deferred to a payroll integration that
   does not exist. Accepted deliberately — the audit trail has to exist before anything can
   read it.
2. **Real flag volume is unmeasured.** 500 employees is known; flags-per-week is estimated,
   not counted. The `limit` cap and keyset pagination are sized defensively. Measuring
   against a restored production backup before tuning the tier thresholds is worthwhile but
   not blocking.
3. **`_require_hr_role()` grants `HR User` and `HR Manager` identical power**, so any HR User
   can excuse any flag for any employee. If decisions ever gain payroll consequence, that
   deserves revisiting — noted, not solved here.
4. **The `-prov` truncation bug is left live in the engine.** Spec 1 avoids it rather than
   fixing it, since fixing it changes existing docnames. Worth its own small task later.
