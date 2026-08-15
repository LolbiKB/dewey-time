# Telegram Employee Layer — Design

**Date:** 2026-08-15
**Status:** approved, ready to plan
**Surfaces:** new Telegram bot + Mini App. No change to `/hr-attendance`, `/hr-schedule`, `/hr-flags`.

## Goal

Give an individual employee three things, delivered through Telegram:

1. A live notification when they check in or out.
2. A day/week timeline of their own attendance.
3. Their assigned weekly shift schedule.

## Why Telegram, and why not a browser SPA

Dewey Time has no employee-facing surface at all. `/hr-attendance`,
`/hr-schedule` and `/hr-flags` are HR consoles behind `HrAppShell`.

The obvious route — a PWA authenticated by the company Google Workspace — is
ruled out by a fact about the workforce: **30–40% of employees have no company
account.** That is not an onboarding gap a good flow closes. It is a coverage
ceiling, and it cuts the wrong way, because the people without accounts are
branch and floor staff — exactly the population whose attendance this system
flags. An SSO-gated surface would serve the office and exclude the people who
most need to see their own record.

Telegram inverts it. The chat binding *is* the authentication: once bound,
every subsequent message is authenticated by Telegram, with no password, no
SSO, no session, and no account to provision.

The second reason is timing. These employees are already being asked to accept
a new attendance regime that judges their behaviour. Adding "install an app,
get an account, remember a login" stacks a technology change on top of a policy
change, and if the technology stalls people conclude the policy does not work
either. Telegram is already open on their phone.

## Approach

Two halves, both built on machinery that already exists.

**Outbound** — a queued job hanging off the existing `Employee Checkin`
`after_insert` hook sends a short Telegram message. Gated by rollout phase, so
a single branch can pilot it.

**Inbound** — a Telegram **Mini App**: a webview, launched from the bot, that
renders the existing timeline components against one narrowed read endpoint.
The Mini App is the read surface; bot text commands are deliberately not built
(see *Out of scope*).

## Identity: no Frappe Users are created

This is the load-bearing decision, and it was made deliberately after
considering the alternative.

**No `User` record is created for any employee.** Identity is a Telegram
binding and nothing else.

The reason is reversibility. A binding is a row — delete it and you are exactly
where you started. A Frappe `User` becomes `owner` on documents, appears in link
fields, and accumulates references; it can be disabled but never cleanly
removed. Provisioning is a one-way door and binding is a two-way door, and this
is the first version of a delivery channel for a workforce that is new to the
whole system. Choosing no-users also preserves the other option: lazy
provisioning remains available later, whereas un-provisioning hundreds of
accounts that already own documents does not.

It also models the truth. These people are not users of Frappe. Creating logins
nobody signs into asserts a relationship that does not exist, and that mismatch
resurfaces in every user list and access audit afterwards.

### What this costs, accepted knowingly

- **One authorization gate that inverts the codebase's safe-by-default
  pattern.** Every existing gate derives scope from `frappe.session.user`. This
  one derives it from a binding lookup. That is legitimate, but it is precisely
  where a subtle error serves one employee another's record.
- **A second answer to "who is this?"**, maintained permanently alongside
  Frappe's.
- **No session to build on** if a plain browser SPA for employees is ever
  wanted instead of a Mini App.

### The LOA argument, and why it does not override this

A Frappe `Workflow` transition is performed by a `User` holding the transition's
role, so an accountless employee cannot be the actor on a workflow transition.
That sounds decisive for the leave module and is not: an employee's *submission*
is document creation, not a governed transition, and `Leave Application.employee`
identifies the applicant regardless of who owns the record. The transitions the
workflow actually governs are **manager approval and HR approval**, performed by
office staff who already hold accounts. The audit trail stays honest where it
matters, with the Telegram-verified identity recorded on the request itself.

## Linking

A **single-use, expiring, signed token** delivered as a deep link or QR:

```
https://t.me/<bot>?start=<token>
```

Telegram's `start` payload permits 64 characters of `[A-Za-z0-9_-]`; a 32-byte
random token base64url-encodes to 43, so it fits.

The employee taps the link (or scans the QR). The bot receives `/start <token>`,
and the system reads the Telegram user id **off the authenticated update** —
nobody transcribes anything. HR never types a chat id; the employee never keys a
code.

This is chosen over the two alternatives:

- **Contact share** (Telegram's `request_contact` returns a verified phone plus
  user id) is smoother in the ideal case but reintroduces the exact failure it
  is meant to prevent: a shared or misrecorded number matches the wrong
  Employee, unverifiably. It would also bet the identity substrate on
  `Employee.cell_number`, a column nothing in dewey_time has ever read.
- **HR manual entry** — today's process — is retained only as break-glass with
  an audit trail, never the primary path. A Telegram chat id is an opaque
  number with no checksum and no name echoed back; HR cannot detect a
  transposed digit, and a wrong-but-valid id belongs to somebody else who then
  silently receives an employee's attendance.

### Distribution

A per-employee QR on an onboarding slip, and a per-person link in the planned
org-wide statement. Same operational cost as asking people to send HR their chat
id, with a verified result instead of a transcribed one.

### The existing `custom_telegram_chat_id` values are NOT imported

`Employee.custom_telegram_chat_id` exists on production with partial, manually
entered data (it is scrubbed as PII at `utils/anonymize.py:60`, guarded by
`tests/test_anonymize.py`). It is **not** declared in `setup/custom_fields.py`,
so it was added to prod outside the app.

Those values are exactly the hand-transcribed ids this design exists to stop
trusting. They are not imported and not read. Employees re-link through the
token flow. The field is left in place, untouched, for HR's reference during the
transition.

### Doctype

A new `Telegram Link` doctype owns the binding:

| Field | Purpose |
|---|---|
| `employee` | Link to Employee |
| `telegram_user_id` | Data, **unique** — the authenticated identity |
| `chat_id` | Data — the private chat to deliver to |
| `linked_at`, `linked_via` | Audit (`token` or `hr_manual`) |
| `enabled` | Unlink without destroying the audit record |

Uniqueness on `telegram_user_id` is what prevents one Telegram account being
bound to two employees.

## Authorization

Two independent checks, neither of which trusts a caller-supplied parameter.

**Mini App requests** validate Telegram's `initData`: the secret key is derived
by HMAC-SHA256'ing the bot token under the literal string `WebAppData`; that key
signs the sorted data-check-string; the result is compared to the supplied
`hash` in constant time, with an `auth_date` freshness window. The verified
Telegram user id then resolves through `Telegram Link` to an employee. **The
employee is never read from a request parameter.**

**Webhook requests** are authenticated by Telegram's
`X-Telegram-Bot-Api-Secret-Token` header, compared in constant time. This
mirrors the established pattern in this codebase: `notify_device_sync_status`,
`notify_device_closeout_status` and `notify_enrollment_snapshot` are all
`allow_guest=True` POST endpoints authenticated by shared secret through
`bridge_auth.validate_bridge_request()`.

Long-polling is ruled out — Frappe has nowhere to run a persistent poller.

**Both of these are written in the main session, not delegated to a subagent**,
per the standing rule about isolation predicates in `CLAUDE.md`.

### Verified on a real bench, 2026-08-15

The no-users design rests on an assumption nothing in this codebase had ever
exercised: with no Frappe `User`, the Mini App endpoint runs as **Guest**, and
all three existing `allow_guest` endpoints *write* — none reads employee data.

Probed on `frappe-sandbox` (`test_site`, frappe/erpnext/hrms `version-16`), with
a seeded Employee and Checkin so that row counts distinguish "permission
bypassed" from "silently filtered to empty":

| Check as `Guest` | Result |
|---|---|
| `frappe.get_all("Employee")` | returns the row |
| `frappe.get_all("Employee Checkin")` | returns the row |
| `frappe.db.get_value("Employee", …, "company")` | returns real data |
| `frappe.get_list("Employee")` | **PermissionError** |
| `_require_calendar_access(emp)` | **PermissionError** |

Three conclusions:

1. **The design works as specified.** A Guest-context request can read
   attendance data, so no service account is required. The one-shared-service-user
   fallback considered during design is unnecessary and is not built.
2. The `get_all` / `get_list` split is genuine here, not an artefact — `get_list`
   refuses the same read that `get_all` serves.
3. The existing gate refuses Guest exactly as it should, which confirms the
   builder extraction below is mandatory rather than a matter of taste.

**The security consequence is the important one.** Because `get_all` bypasses
permissions entirely, there is **no Frappe permission backstop** beneath this
feature. The `initData` HMAC check and the binding lookup are not the first line
of defence — they are the *only* line. A defect in either serves any
unauthenticated caller the whole workforce's attendance. This strengthens the
rule above rather than relaxing it.

## Data: one narrowed endpoint

Everything the three views need is already in one payload.
`get_employee_calendar(employee, start_date, end_date)` returns, per day, the
`shift` window (`shift_type`, `start_time`, `end_time`, `grace_minutes`,
`lunch_start`, `lunch_end`), the `checkins[]`, plus `holiday`, `leave` and
`observed_lunch` — see `dewey_time/docs/CALENDAR_DATA_CONTRACT.md`. It is
already self-access permitted via `_require_calendar_access`
(`hr_calendar.py:540`).

So **no new read logic is needed** — but two things stand in the way, and the
second is a real refactor.

**The payload cannot be served to an employee as-is.** Self-access is not
self-appropriate: that gate was written for self-access and then only ever
called by HR, so nobody has audited what it hands a non-HR caller.

**`get_employee_calendar` has no reusable builder to call.** It spans
`hr_calendar.py:531` to end-of-file — roughly 270 lines — with
`_require_calendar_access(employee)` as its first statement and the entire
payload construction inlined beneath it. There is no
`_build_employee_calendar(employee, start, end)` underneath.

Since this design deliberately creates no Frappe `User`, nothing can ever
satisfy `_require_calendar_access`, so `get_my_calendar` cannot call the
existing function at all. The extraction is mandatory, not cosmetic:

- Split the ~270-line body into an internal builder taking an already-authorized
  employee.
- `get_employee_calendar` keeps its gate and delegates — its behaviour and
  payload must not change, and its existing tests are the guard for that.
- `get_my_calendar` resolves the employee from the Telegram binding, calls the
  same builder, and narrows the result.

This is the largest single piece of backend work in the module and the plan
should treat it as its own task, sequenced before the endpoint that depends on
it.

A new endpoint `get_my_calendar(start_date, end_date)` — **no employee
parameter** — returns a projection with these removed:

- `device_sync[]` entirely — device serial numbers and `last_error`.
- `flags[]` entirely (see below).
- Internal flag identity strings such as
  `AUTO-emp-1-2026-05-29-late-start`.

Every schedule endpoint in `schedule_api.py` is HR-only (`_require_hr_role()` at
`:197`, `:268`, `:303`, `:316`, `:355`) and none is touched — the shift windows
come from the calendar payload instead.

### Flags are not shown in v1

An employee sees their punches, their shift, holidays and approved leave. They
do **not** see attendance flags.

Two reasons. Intraday deletes and re-inserts AUTO flags on **every single
checkin** (`intraday.on_employee_checkin_after_insert`), so provisional flags
appear and vanish through the day — an employee watching that sees noise, not
information. And a flag is an unreviewed internal judgment, not a finding;
surfacing it before HR has decided anything invites disputes about a record that
is still moving.

Showing HR *decisions* is a reasonable later feature. Showing raw flags is not.

## Frontend

The following components were checked and import no `hrAccess`, no `hrStaff`,
and no decision component — they lift out unchanged:

| Component | Lines | Note |
|---|---|---|
| `DayTimeline.tsx` | 567 | **exports `DayCell`**, not a component named `DayTimeline` — the filename misleads |
| `PlannedWeekCanvas.tsx` | 80 | source-agnostic by design: takes normalised `PlannedDay[]`, reached from a calendar week via `plannedDaysFromSchedule` + `resolveWeekTimelineWindow` |
| `PlannedDayColumn.tsx` | 78 | |
| `DayChips.tsx` | 81 | |
| `TimelineAxis.tsx` | 50 | |

**But the reusable surface is roughly 2,900 lines, not 900.** Those five pull in
a transitive set that has to move with them:

| Dependency | Lines |
|---|---|
| `lib/attendancePunches.ts` | 662 |
| `lib/shiftTimeline.ts` | 234 |
| `lib/segmentInspector.ts` | 197 |
| `types/calendar.ts` | 165 |
| `lib/weekSchedule.ts` | 146 |
| `lib/plannedDays.ts` | 140 |
| `lib/attendanceTime.ts` | 122 |
| `ui/WeekCanvasFrame.tsx` | 112 |
| `lib/lunchDetection.ts` | 109 |
| `lib/dayCellLabel.ts` | 50 |
| `lib/timelineAxis.ts` | 46 |
| `ui/AppTooltip.tsx` | 29 |

None of these is HR-coupled, so it is a move rather than a rewrite — but the
plan must treat it as ~2,900 lines relocating, not five files.

Two facts that make the narrowing safe: `Day.flags` is **optional** in
`types/calendar.ts:89`, so omitting flags from the payload is type-safe and
breaks nothing; and `types/calendar.ts:1` type-imports `RolloutPhase` from
`@/types/flags`, a types-only edge that needs untangling or carrying.

`FlagStrip.tsx` is excluded because flags are out of scope. `App.tsx` (429
lines) is coupled to the HR outlet context and `HrAppShell` is HR chrome;
neither is reused. The Mini App gets its own thin shell.

**Bundle:** the Mini App is a **separate Vite entry**, not a route inside the HR
bundle. Today's bundle is 1.0MB of JS and 181KB of CSS; shipping that to a phone
on a branch connection to display a week of punches is the thing this design is
supposed to avoid.

## Notifications

A queued job triggered from the existing `Employee Checkin` `after_insert` hook.
**Never synchronous inside the doc event** — `webpush.py` already states that
rule for this codebase.

- **Gate:** `rollout.phase_for_employee(employee, attendance_date)`. Notify only
  on `LIVE`. Piloting is done by setting one branch live in
  `Dewey Time Branch Rollout`, which already exists.
- **Also gated on** an enabled `Telegram Link`. An unlinked employee simply
  receives nothing — coverage grows with adoption, and the feature is inherently
  opt-in per person.
- **Content is minimal**: the punch time and the branch. No flags, no lateness,
  no judgment. The notification says what happened, not what it means.
- **Private chats only.** The bot refuses to operate where `chat.type` is not
  `private`, so being added to a group cannot leak one person's attendance to
  their colleagues.
- **Rate limits are real at this headcount.** Telegram permits roughly 30
  messages/second overall and one per second per chat, and a morning rush fires
  hundreds of check-ins in a narrow window. Delivery goes through the queue with
  per-chat pacing.

## Error handling

| Condition | Behaviour |
|---|---|
| Employee not linked | No notification. Silent, not an error. |
| Bot blocked by user (Telegram 403) | Disable the `Telegram Link`; stop retrying. |
| Invalid or stale `initData` | 403 with no detail. |
| Token expired, already used, or unknown | Friendly bot reply directing them to HR. |
| Telegram API unreachable | Job retries with backoff. Notifications are best-effort and must never block or fail a checkin. |
| Webhook secret mismatch | 403, logged, no processing. |

## Privacy

Attendance times, branch, and shift schedules transit Telegram's servers. This
is a deliberate organizational decision, not an implementation detail, and it
should be stated plainly in the org-wide announcement that accompanies the
rollout rather than buried.

Telegram is a **channel, never the record.** Everything it displays is
reconstructible from Frappe, so losing Telegram loses a convenience, not data.

## Testing

**Python unit** — `initData` validation (valid, tampered hash, expired
`auth_date`, missing fields); token redemption (single-use, expiry, unknown
token, already-bound Telegram id); payload narrowing (assert `device_sync`,
`flags` and evidence are absent from `get_my_calendar` output); webhook secret
rejection; notification gating (unlinked, non-LIVE rollout phase).

**Sandbox** — `frappe-sandbox` run against a real bench. Mocked tests are not
sufficient for the binding and gate behaviour.

**Frontend** — the reused components already carry tests; the Mini App shell
needs its own. `initData` is mocked, since Telegram cannot be driven from
Playwright.

## Out of scope

Bot text commands (`/today`, `/week`, `/schedule`) — the Mini App is the read
surface, and `/start` is the only command. Flags in the employee view. Anything
LOA. The manager surface. Server-rendered images. Wiring the existing web-push
layer. Importing `custom_telegram_chat_id` values. Provisioning Frappe Users.

## Follow-ups noted, not built

- `custom_telegram_chat_id` is undeclared in `setup/custom_fields.py`, so a
  fresh site lacks a column production has. Unrelated to this work, but it is a
  known drift.
- The existing web-push layer (`webpush.py`) remains complete and inert. If
  Telegram proves the event→notification wiring, pointing push at the same
  events later is small.
