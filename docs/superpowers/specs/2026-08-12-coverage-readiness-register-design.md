# Coverage readiness register — design

**Status:** approved 2026-08-12
**Replaces:** `/hr-schedule/coverage` (Needs a schedule · Weekly hours) and
`/hr-schedule/coverage/biometrics`

## Why

The coverage surfaces read as less crafted than the rest of the app, and the
cause is structural rather than cosmetic.

`BiometricEnrollmentPage` is the only routed page in the app that does not use
dewey-ui's `<Page>`. It hand-rolls `px-4 pt-4` against `Page`'s
`px-5 sm:px-8`, so the shared `CoverageViewNav` **shifts 16px sideways when you
switch tabs** — you click a pill and the pill moves. It also has no
`PageHeader`, so its `h3` group headings sit under no higher heading.

That was able to happen because the surface sits outside every mechanism the app
uses to stay consistent:

- `e2e/page-insets.spec.ts` measures header/page gutter alignment in a real
  browser "on every route the shell wraps" — written after a regression that
  reached 312px at 1920. Its route list omits `/hr-schedule/coverage/biometrics`,
  and **could not include it**: the helper throws when there is no
  `[data-slot="page"]`, which that page never renders.
- No e2e spec visits the biometrics route at all.
- `chromeMigration.test.tsx` asserts `<Page>` usage for `WeeklySchedulePage`
  specifically, not for routed pages as a class.
- The app's convention is that presentation logic lives in `src/lib/` as pure
  tested functions (`flagQueueLabels`, `flagNarrative`, `dayCellLabel`,
  `importProblems`…). Coverage's header is a bare template literal with no
  derivation, no pluralisation and no empty state.

Beyond consistency, the current design inverts urgency and affordance.
`LEAVER_STILL_ENROLLED` — a person who has left the company whose biometric
template still opens the door — is styled destructive and offers **nothing to
click**. Meanwhile "needs a schedule", routine admin, has a button on every row.

## What this builds

One page: a **readiness register**. One row per employee, one column per
readiness fact. It replaces all three current views — "needs a schedule" becomes
a filter, the hours buckets become a sortable column, the biometric buckets
become a filter. `CoverageViewNav`, the two-tab split and the Needs/Hours
switcher are deleted; `/hr-schedule/coverage/biometrics` redirects to the
register.

Deleting the second page removes the 16px jump, the duplicated nav and the
chrome divergence outright, rather than fixing them.

### Character of the page

An **audit and status surface**, not a worklist. It opens unfiltered — the whole
roster — and states facts. A single alert affordance points at trouble; until
it is used, the register does not decide what the reader should care about.

## The alert dot

A minimal indicator beside the page title. Not a filter control — it sits with
the title, not in the filter toolbar.

| State | Appearance | Meaning |
|---|---|---|
| Problems | filled red disc | `n` employees are not ready |
| All clear | hollow green ring | every employee is ready |
| Feed degraded | filled amber disc | partial count; some data unavailable |

Rules:

- **Colour never carries meaning alone.** Filled versus hollow is a shape
  difference, so the states survive red-green colour blindness. The count and
  the words live in the accessible name (`"8 need attention — show them"`).
- **It never disappears.** An absent indicator cannot distinguish "nothing is
  wrong" from "the page failed to load". The all-clear state is rendered, not
  omitted.
- **It never over-reassures.** When a feed is down the count covers only what is
  knowable and says so: *"3 need attention, biometrics unavailable"*.
- **Clicking sets `readiness: "not-ready"`; clicking again clears it.** The
  count then appears in the filter chip and a `Showing 8 of 241` line, where it
  describes something, instead of sitting in the header all day.

Derived by one pure function:

```ts
registerAlert(rows: RegisterRow[], feeds: FeedHealth):
  { tone: "problem" | "clear" | "degraded"; count: number; knowable: boolean }
```

## Columns

| Column | Type | Filter | Source |
|---|---|---|---|
| Employee (name + ID) | text | global search (name, employee ID) | both |
| Branch | enum | multi-select | coverage *(after the one-line addition below)* |
| Department | enum | multi-select | coverage |
| Status | enum `Active` / `Left` | select, **no default** | enrollment only — see below |
| Schedule | enum `Assigned` / `Missing` | select | coverage |
| Hrs/wk | number | sort only | coverage |
| Biometric | enum `Enrolled` / `None` / `Still enrolled` | select | enrollment |
| Prints | number (fingerprints) | sort only | enrollment |
| Action | conditional | — | derived |

**No `Punches 30d` column.** The mockups showed one; the payload does not carry
it. `enrollment_api` computes `checkin_count` to classify the bucket and then
discards it (`enrollment_api.py:163-180` returns no punch field). Surfacing it
would need a second backend change, and it would restate what the Biometric
column already says: `Enrolled, not punching` *is* "zero punches in the window",
and `Enrolled` is "more than zero". The magnitude adds nothing to the readiness
question, so the column is dropped rather than the endpoint extended.

**Status has no default filter, deliberately.** Defaulting to Active would hide
every `Still enrolled` row — those employees are `Left` — so the page would
suppress its most severe finding while the alert dot still counted it, pointing
at rows the reader cannot see. The population is already bounded server-side:
`REPORTED_STATUSES = ("Active", "Left")`, and a cleanly-offboarded leaver
(status `Left`, not registered) is classified `None` and never enters the
payload. So the unfiltered register is exactly "active employees, plus leavers
who still have a live template" — which is the correct default view.

**Search covers name and employee ID, not PIN.** `_register_rows` selects only
`employee, is_registered, fingerprint_count, face_count`; the PIN is stored on
the register but not returned by the read API. Adding it is a one-field change
to that query, but backend changes are out of scope here — if PIN search is
wanted, it is a deliberate addition, not an assumption.

**Prints** is `fingerprint_count`. `face_count` is carried in the payload and
remains unsurfaced — no device in this fleet enrols faces today (all 238
templates are fingerprints).

### Where Branch and Status actually come from

The first draft of this spec sourced both from the coverage payload. Neither is
there: `coverage_api.py:33` copies
`("id", "employee_name", "department", "employment_type", "title", "image")`
from calendar employee rows, and the upstream query
(`hr_calendar.py:345`) selects no `branch` and no `status`.

**Branch: add it.** Two lines — `branch` into `_list_calendar_employee_rows`'s
`fields` list and into `_EMPLOYEE_FIELDS`. This is the one backend change this
plan makes, and it earns its place: branch is an attribute of an active
employee, entirely orthogonal to biometrics, so sourcing it from the schedule
feed is what lets site filtering survive a biometric outage. Without it the
"feeds fail independently" property that justifies the client-side join does not
hold.

**Status: do not add it.** `hr_calendar.py:349` filters `{"status": "Active"}`,
so every coverage row is Active by construction — the field would be a constant,
not information, and leavers never enter that payload at all. Status therefore
comes from the enrollment feed, and the consequence is stated plainly rather
than engineered around:

> **When the biometric feed is down, leavers are invisible.**
> "Left but still enrolled" is a biometric fact with no second source. A Status
> column reading `Active` for all 241 would assert something the data cannot
> support — worse than showing nothing. The feed-down notice must say that
> leaver detection is unavailable, not merely that enrolment counts are.

The action column is **empty unless the row has a problem** — "Add schedule" for
a missing assignment, "Open" for anything else. A button on every row is noise,
and is how the current Needs list reads as a to-do list.

A leaver still enrolled shows its age inline (*"Still enrolled · 12d"*): for the
one security-relevant row, how long it has been true is the point.

No derived "Readiness" column. The dot does that job; a column would restate
what Schedule and Biometric already say.

### Sorting

Unfiltered, the register sorts by employee name. **With the alert filter on, it
sorts by severity** — leaver-still-enrolled, then cannot-clock-in, then
no-schedule. A flat filter cannot group the way a modal would; this recovers
most of it.

## Architecture

Built on **`GenericDataTable`** from dewey-ui, following
`adms/src/components/users/data-table.tsx` — the same problem in a sibling app,
whose `UserFilters` already carries `registration_status` / `has_fingerprint` /
`has_face`. Reuse that vocabulary rather than inventing one.

**What the primitive does and does not do.** It wires only `getCoreRowModel` and
sets `manualSorting`, `manualFiltering`, `manualPagination`. It renders the
toolbar, column show/hide and header, and emits intent via `onFiltersChange`;
**it performs no filtering, sorting or pagination**. ADMS delegates that to its
server. Here it is ours, as pure functions in `src/lib/` — which is what this app
already does everywhere else.

There is **no grouped row model**, which is why grouping is not part of this
design.

### Data flow

```
useCoverageRegister
  ├─ getScheduleCoverage()      (existing endpoint, unchanged)
  ├─ getEnrollmentReport()      (existing endpoint, unchanged)
  └─ joinRegisterRows(coverage, enrollment)   ← pure, tested
       └─ filterRegisterRows(rows, filters)   ← pure, tested
            └─ sortRegisterRows(rows, sort, filtered)  ← pure, tested
```

Two endpoints, joined **client-side on employee ID**. No backend work. More
importantly the two feeds keep failing independently, which is what makes
per-column suppression possible — a merged endpoint would couple them and a
biometric outage would take schedule data down with it.

At ~241 rows everything is client-side: no pagination, no round-trip per filter.
`GenericDataTable`'s `meta` prop is omitted.

Query keys extend the existing registry:
`queryKeys.coverage.all` and `queryKeys.enrollment.all` are already separate
families, so a write invalidating one does not disturb the other.

## Failure states

The load-bearing part. The underlying rule: **absent data is never rendered as a
fact.**

| Condition | Behaviour |
|---|---|
| Biometric feed never reported, or stale (`> STALE_AFTER_MINUTES`, currently 24h — reuse the existing constant in `enrollmentReport.ts`, do not redefine it) | Biometric, Prints **and Status** columns **removed**; notice states that enrolment *and leaver detection* are unavailable; dot amber with a partial count |
| Schedule fetch fails | Schedule + Hrs/wk removed; same treatment; biometric data still usable |
| Both fail | `FailureBlock` with retry — there is nothing to show |
| Roster truncated | Explicit notice; CSV export disabled (as today) |
| Non-HR reaches the URL | Redirect to `/hr-attendance`, matching the four sibling pages |

Columns are **removed, not blanked**. If the bridge stops reporting, an empty
Biometric column reads as 241 people who cannot clock in — a bridge fault
rendered as a workforce crisis. This is the same refusal the current biometrics
page performs page-wide, made column-level so a biometric outage no longer
hides schedule data.

## Testing

Unit tests, `node:test` + `node:assert/strict` via `tsx --test`, in
`src/lib/*.test.ts`:

- `joinRegisterRows` — employees present in one feed and not the other
- `filterRegisterRows` — each filter, and filters composing
- `sortRegisterRows` — name order; severity order when filtered
- `registerAlert` — problem / clear / degraded, and that a degraded count
  reports itself as partial
- column suppression — each feed's absence removes exactly its own columns

Enforcement, which is what was missing:

- add `/hr-schedule/coverage` to `e2e/page-insets.spec.ts`'s route list
- an `e2e/coverage-register.spec.ts` that visits the route, asserts the dot's
  three states and that clicking filters
- generalise `chromeMigration.test.tsx` from `WeeklySchedulePage` to **every
  routed page uses `<Page>`**, enumerated from the router

New frontend test files must sit in a directory named by `test:web`'s glob in
`package.json` — it is an explicit list, not a recursive scan, and a file
outside it runs locally and never in CI.

## Out of scope

Deferred to a future `/dashboard`, deliberately and not dropped:

- count tiles (not ready / leavers still enrolled / no fingerprint)
- weekly-hours distribution (the current Hours buckets view, as a sparkline)
- per-branch rollups

The register answers "who", the dashboard will answer "how are we doing". Losing
the hours *distribution* is a real cost of this design — **confirmed acceptable
2026-08-12: nobody reads that spread today.** It is deferred rather than dropped
so the dashboard has a starting point.

Also out of scope: row grouping; server-side pagination; any change to
`get_enrollment_report`.

**One backend change is in scope**, and only this one: adding `branch` to
`_list_calendar_employee_rows`'s field list and to `coverage_api._EMPLOYEE_FIELDS`,
for the reason given under "Where Branch and Status actually come from". No
other server behaviour changes.
