# Biometric Enrollment Register

**Asked for:** 2026-08-11 — "HR ability to see/get report on employee's checkin
biometric registration, with per branch, dep, or other meaningful filter,
grouping logic."

**Scope decision:** a standalone mechanism with an integration seam, not a
checklist framework. The user's words: *"we can build it a separate mechanics
that could work on its own separately with future being integrated into the
onboarding, offboarding."*

## The problem

An employee whose fingerprint was never enrolled on a device produces no
check-ins, ever. In `/hr-attendance` that person is **pixel-identical** to an
employee who was present and punctual: no flags, no alerts, nothing. The system
cannot flag what it never saw.

HR has no surface anywhere that answers "who can't clock in?" The ADMS bridge
dashboard has a per-employee registration view, but it is device-admin
territory, it is not organised by branch or department, and HR does not go
there.

There is a second, sharper case in the other direction. When someone leaves,
their fingerprint stays on the device until a human removes it. Nothing in
Frappe or the HR UI says so. **A live template belonging to someone who left is
a security finding, not a to-do**, and today nobody would ever learn of it.

### Ticked items versus observed items

The eventual onboarding/offboarding checklist will mix two kinds of item:

- **Ticked** — a human does the thing and says so ("signed the contract",
  "handed back the laptop"). Frappe HR's `Employee Boarding Activity` already
  models this. We are not rebuilding it.
- **Observed** — the system goes and looks ("has a biometric template", "has a
  schedule assigned", "has ever produced a check-in"). Nobody ticks these.

Biometric enrollment is squarely observed, and so is the existing Schedule
Coverage page. Observed items are strictly better where available: they cannot
be forgotten, cannot be wrong, and self-liquidate as the gap closes. This
design builds an observed-readiness surface that sits *alongside* Frappe's
tick-box onboarding.

## Where the truth lives

Frappe does not hold enrollment state. It lives in Supabase, owned by the ADMS
bridge (`frontend/adms/src/lib/frappe-merge.ts:69-101`): a `users` row per
device user, with `user_biometrics(type, finger_id)` rows where `type` is
`fingerprint` or `face`.

Measured on production Supabase (`attendance_adms`) on 2026-08-11:

| | |
|---|---|
| Bridge users | 237 |
| Linked to a Frappe employee | 236 |
| With a fingerprint | 233 |
| With a face template | **0** |
| **With no biometric at all** | **4** |

Devices, all with `location` populated: `ACES`, `DIS Iconic`, `DIS Ochar`,
`DIU`.

Three consequences:

1. **There is a real target population.** Those 4 are invisible today. The
   larger bucket — active Frappe employees with *no* bridge user at all — is
   not computable from Supabase and is the report's main reason to exist.
2. **Nobody uses face enrollment.** The payload carries `face_count` because
   the merge already computes it, but it gets no column in the UI.
3. **237 users makes a full-roster snapshot trivial.** The all-or-nothing rule
   below is a cheap assertion, not a real constraint.

### Decision: the bridge pushes; Frappe does not pull

Three options were weighed.

**Frappe-only inference** (`attendance_device_id` set, plus check-in activity)
was rejected. It answers "does HR have a badge number on file", not "does a
template exist" — an employee with a PIN and no fingerprint reads as
*registered*, and that person is exactly who the report is built to find. It
also **cannot express the offboarding case at all**: `attendance_device_id`
survives termination, and "no recent check-ins" is precisely what a departed
employee looks like.

**Frappe calling the bridge live** was rejected. It reverses the established
trust direction, requires a bridge credential in Frappe site config, and takes
the report down whenever the bridge is down.

**The bridge pushes into Frappe** is chosen. It matches the existing direction
of trust and is the third instance of a pattern this system already runs twice
— `device_sync.py:153` and `closeout.py:141`, both authenticated by
`validate_bridge_request()`. No new auth surface, no new secret, and the report
still renders (with a staleness age) when the bridge is down.

**Prerequisite:** both existing feeds were dead from 2026-08-01 to 2026-08-11
(`bridge_auth` compared `api_secret` with `check_password`; fixed in #154,
`0fcd7b77`). This feed inherits that auth path, so it cannot work until #154 is
deployed to production **and** a bridge principal is pinned — the `Bridge
Device` role, granted to `Administrator` on 2026-08-11 as a stopgap.

## Architecture

Four parts, each independently testable.

```
device polls (~30s)
  └─ buildTasks()                                    [bridge, poll-maintenance.ts]
       └─ maybeSnapshotEnrollmentOnPoll              (new)
            watermark 15 min · full roster · all-or-nothing
            └─ POST dewey_time.attendance_engine.enrollment.notify_enrollment_snapshot
                 └─ Employee Biometric Enrollment    (one row per employee)
                      └─ enrollment_api.get_enrollment_report()
                           └─ /hr-schedule/coverage/biometrics
                      └─ enrollment_api.enrollment_status(employee)   ← the seam
```

### 1. Ingest — a full snapshot, never a delta

New whitelisted endpoint, mirroring `notify_device_sync_status` exactly: same
`@frappe.whitelist(allow_guest=True, methods=["POST"])`, same
`validate_bridge_request()` as its first statement.

```python
{
  "bridge_env": "prod",
  "scanned_at": "2026-08-11 09:14:03",
  "users": [
    {"pin": "1042", "frappe_employee_id": "HR-EMP-0042",
     "is_registered": true, "fingerprint_count": 2, "face_count": 0},
    ...
  ]
}
```

**A delta cannot express deletion**, and deletion is the offboarding signal. A
snapshot replaces the whole register: any employee absent from `users` is, by
definition, not enrolled.

That semantics carries a hazard, which produces the one rule written in
capitals:

> **NEVER ACCEPT OR SEND A PARTIAL SNAPSHOT.**

A truncated full-snapshot silently asserts that everyone missing is unenrolled.
Guarded on both sides:

- **Bridge:** if the roster read exceeds `ENROLLMENT_SNAPSHOT_MAX_USERS`
  (2000), send nothing and log at error. Never send a prefix.
- **Frappe:** reject the payload when
  `len(users) < 0.5 × previous_snapshot_user_count` and the previous count was
  at least 20, unless the payload sets `allow_shrink: 1`. A halved roster is far
  more likely to be a truncated read than 118 simultaneous departures. The
  escape hatch exists so a genuine mass offboarding is a deliberate act rather
  than a blocked feed.

Paging with a completion marker would also work, but that is machinery for a
problem 237 users do not have.

### 2. The register

`Employee Biometric Enrollment` — one row per employee, `autoname` by the
employee ID so the upsert is `name`-keyed.

| Field | Type | Note |
|---|---|---|
| `employee` | Link → Employee | also the docname |
| `pin` | Data | the device user id |
| `is_registered` | Check | a bridge user row exists |
| `fingerprint_count` | Int | |
| `face_count` | Int | carried, not surfaced |
| `synced_at` | Datetime | from the payload's `scanned_at` |
| `bridge_env` | Data | matches Device Sync Status |

**Branch and department are deliberately not stored.** They are joined from
`Employee` at read time, so a transfer cannot leave the report asserting
something stale. This is the same call `flag_decision_api._branch_by_employee`
makes for the queue.

Plus one site-level field on `Dewey Time Settings`:
`last_enrollment_snapshot_at`. It is separate from the per-row `synced_at`
because a snapshot in which nothing changed still proves the feed is alive.

### 3. The read side

`dewey_time/attendance_engine/enrollment_api.py`, modelled on `coverage_api.py`:
HR role gate via `_require_hr_role()`, a versioned cache prefix
(`enrollment_report:v1`), and a payload of counts plus flat rows plus
`truncated`.

**The API groups nothing.** It returns flat employee rows and lets the client
group, exactly as `coverage_api.py` already does ("for the client to group into
buckets", `coverage_api.py:8`). That is what makes a third grouping axis a
one-line change later instead of a payload redesign.

**Population.** The report covers Employees with `status` in
`("Active", "Left")` only. `Inactive` and `Suspended` are excluded: neither is
a state where "should this person be able to clock in?" has an obvious answer,
and guessing would put rows in front of HR that they cannot action. Excluded
statuses are counted and shown as a footnote, not silently dropped.

**Query budget: three.** One `Employee` scan (capped at
`ENROLLMENT_EMPLOYEE_LIMIT = 2000`, matching `COVERAGE_EMPLOYEE_LIMIT`), one
read of the register, and one `Employee Checkin` aggregate — a single
`GROUP BY employee` over the 14-day window, not a query per employee.

Buckets are derived at read time from a **pure function** over
`(employee_row, enrollment_row, checkin_count, today)`:

| Bucket | Condition | Meaning |
|---|---|---|
| `NEEDS_ENROLLMENT` | Employee active; no register row, or `is_registered = 0` | go enroll them |
| `ENROLLED_NOT_PUNCHING` | `is_registered = 1`; zero check-ins in the window | bad template, or absent |
| `OK` | `is_registered = 1` and punching | nothing to do |
| `LEAVER_STILL_ENROLLED` | `status = "Left"`; `is_registered = 1` | **security finding** |

Two thresholds, both deliberate:

- **`ENROLLED_NOT_PUNCHING` uses a 14-day window**, a module constant with the
  reason in a comment — not a setting. An unused setting is a config surface
  someone must reason about forever. Two weeks clears ordinary leave.
- **`LEAVER_STILL_ENROLLED` has no grace period and no threshold.** It fires
  from the first snapshot after the relieving date and displays *days since*
  instead. The number carries urgency better than an invented boundary, and a
  sync-lag false positive self-resolves on the next snapshot rather than hiding
  for three days. When `relieving_date` is null the row still appears, with the
  day count omitted — never substituted from `modified`, which would present a
  record-keeping artefact as a departure date.

### 4. The seam

```python
def enrollment_status(employee: str) -> dict:
    """Enrollment facts for one employee. The page is one consumer; a future
    onboarding/offboarding checklist is another."""
```

That is the entire integration story. No registry of checks, no plugin system —
a framework built for a population of one is speculative. When a second observed
check arrives, it gets its own module and its own function beside this one.

## The UI surface

**A second view under the existing Coverage tab**, not a fifth top-level tab.

```
/hr-schedule/coverage              Schedule    (exists, untouched)
/hr-schedule/coverage/biometrics   Biometrics  (new)
```

The mobile bar already carries four tabs for HR staff
(`HrAppShell.tsx:72-99`), and Coverage is *already* the observed-readiness
surface — it even uses `UserCheckIcon`. No new `www/` page and no new route
rule are needed: `/hr-schedule/<path:app_path>` already wildcards
(`hooks.py:88`).

This keeps the mechanism standalone — its own API module, DocType, cache key,
and tests. The only shared thing is a sub-nav in the shell; nothing in
`coverage_api.py` or `ScheduleCoveragePage` is refactored.

The accepted tradeoff: the URL says `hr-schedule` for something that is not
scheduling. If the readiness surface later earns a top-level route, both views
move together.

### Grouping and filters

- **Filter** by branch, department, and bucket — multi-select chips, matching
  the flag queue's interaction.
- **Group by** branch *or* department — a toggle, not both. Nested grouping is
  where these pages go to die.

Two axes only, because two are what `Employee` carries and what the rest of the
app already groups by. A third (employment type, designation) is a one-line
addition to an allowed-fields tuple, precisely because the API ships raw rows.

### Staleness, and the refusal to render

Every payload carries `last_enrollment_snapshot_at` and its age, shown as "as
of 14 minutes ago" via `AttentionStrip` — the same component and `role="status"`
the pilot banner uses (#153).

**If no snapshot has ever arrived, the page must refuse to render the list** and
say the feed is not connected. Otherwise every employee reads as
`NEEDS_ENROLLMENT` and HR responds to a plumbing failure as though it were a
data finding. This is the `DRIFT_AUDIT_VACUOUS` rule already in this repo
(`doctype_drift_audit.verdict`): a result with only one possible interpretation
is not information.

Given the feed was dead for eleven days undetected, this is the single most
load-bearing behaviour in the design.

### Export

CSV of exactly what is on screen — same filters, same rows, generated
client-side from the loaded payload. No new endpoint.

Two rules: the snapshot timestamp is a **row in the file**, not only in the
filename; and export is **refused while `truncated` is set**, rather than
handing over a file that looks complete. A CSV outliving its context is the
easiest way to make stale enrollment data look current three weeks later.

## Failure modes

| Condition | Behaviour |
|---|---|
| No snapshot ever received | Page refuses the list, states the feed is unconnected |
| Snapshot older than 24h | List renders behind a prominent staleness strip |
| Payload fails the partial-snapshot check | 400, register untouched, error logged |
| Bridge auth fails | Existing `validate_bridge_request` path; register untouched |
| Employee has a register row but no Employee record | Row ignored at read time (join is from Employee) |
| Employee scan hits `ENROLLMENT_EMPLOYEE_LIMIT` | `truncated` set; export disabled; count shown as partial |
| Snapshot shrinks past the guard without `allow_shrink` | 400, register untouched, previous snapshot remains authoritative |

## Testing

The bucket derivation is a **pure function** — all four states testable with no
database, which is where the logic risk actually is.

- **Ingest:** auth gate, upsert idempotency, snapshot-replaces-absent semantics,
  partial-snapshot rejection.
- **Read API:** HR gate, join correctness for branch/department, cache key
  versioning.
- **Staleness gate:** asserts the page refuses to render a list when no snapshot
  exists. This one matters most — it is the failure that otherwise looks like
  data.
- **Bridge side:** the payload builder is pure and unit-tested; the watermark
  throttle and the all-or-nothing cap each get a test, in the vitest setup the
  two sibling feeds already use.

**Mutation checks are required** on the staleness gate and the truncation guard:
flip each and confirm a named test fails. #154 is the cautionary tale — four
tests patched the function under test to return `True`, and a total production
outage stayed green in CI for eleven days.

## Out of scope

- Any change to Frappe HR's native `Employee Onboarding` / `Employee Separation`.
- A generic readiness-check framework or registry.
- Folding the existing Schedule Coverage view into this one.
- Enrolling or deleting templates from the HR UI — this is a report. Enrollment
  stays in the ADMS bridge.
- Face enrollment as a first-class UI concept (0 users today).
- A monitor/alert on feed health. Genuinely needed — the outage above proves it
  — but it belongs to the bridge feeds generally, not to this feature.

## Delivery

Two PRs, in this order, because the endpoint must exist before the bridge calls
it — and `isFrappeMethodMissing` already makes the gap between them harmless.

1. **dewey_time** — DocType, ingest endpoint, read API, seam, page.
2. **zkteco-adms-bridg** — `maybeSnapshotEnrollmentOnPoll` in `buildTasks()`,
   obeying the four rules `poll-maintenance.ts:1-18` sets out: own watermark,
   bounded per-tick cap, independent failure, 15s ceiling. Not a cron — Cloud
   Run runs at `min-instances=0`, so fire-and-forget after `reply.send()` is
   unreliable and all background work rides the device poll.
