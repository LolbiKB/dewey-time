# The Schedule tab becomes Profile

**Date:** 2026-08-17
**Surface:** Telegram Mini App (`dewey_time/frontend/hr_attendance/src/miniapp/`)
**Mockup:** https://claude.ai/code/artifact/c5396f29-c593-4950-a5a6-11c994a41777

## The problem

The Mini App has two tabs. Today answers "what happened to me today"; Schedule
answers "when am I working". Neither answers the questions an employee cannot
resolve any other way:

- **Am I actually set up on the fingerprint devices?** Someone who was never
  enrolled, or whose templates were wiped during a device swap, gets marked
  absent every day and has no way to find out why. The register that knows this
  (`Employee Biometric Enrollment`) is HR-only.
- **Which finger did I enrol?** People fail at the reader repeatedly because
  they are presenting the wrong hand.
- **Does HR have my right phone number?** Every notification this system sends
  goes to whatever is on the Employee record.
- **What does HR's record of me actually say?** Department, employment type,
  who they report to, when they joined.

These are profile facts, not schedule facts, and there is nowhere to put them.

## What this builds

Schedule becomes **Profile**: the same roster, still paging forward, sitting
below the record facts. Five blocks under the existing sticky identity header:

1. **Your record** — employee ID, department, employment type, joined (with
   length of service), reports to
2. **Fingerprint & face** — enrolment state, which fingers, face, main branch,
   when we last checked
3. **Contact HR has for you** — phone and personal email, read-only
4. **{Month} so far** — days worked, hours, flags to check
5. **Your roster** — the existing week view, unchanged, paging intact

## Decisions

### The tab is replaced, not added

Two tabs become two tabs. `MiniTab` changes from `"day" | "schedule"` to
`"day" | "profile"`.

A reader whose last session ended on Schedule has `"schedule"` in CloudStorage.
It needs no migration: `isMiniTab` already rejects an unknown value and the
shell falls back to `"day"`. This is the second time that guard has earned its
place — the same thing happened when Week was removed — and the existing
comment in `MiniAppShell.tsx` should be extended rather than replaced.

### The roster keeps its dated week and its forward paging

The considered alternative was a recurring "usual week" from
`week_pattern_from_ssas(employee)`, which would have made Profile shorter.
Rejected: a pattern is a generalisation that is wrong exactly when being right
matters — a cover shift, a pattern mid-change — and the Schedule tab is the
**only** forward-looking surface in the app. The calendar sheet is
`disabled={{ after: today }}` (`MiniCalendarSheet.tsx:194`) and the Day tab
cannot reach a future date at all. Losing forward paging would remove the
ability to answer "when am I working next week" from the app entirely.

So `MySchedulePage` is mounted inside Profile as-is. The only change to it is
dropping `p-3` from its three wrappers, because Profile now supplies the page
padding. No logic, no query, no test in `miniAppWeek.test.tsx` changes.

### A new endpoint, not a wider calendar payload

`get_my_profile(init_data)` is added to `miniapp_api.py` beside
`get_my_calendar`, rather than folding profile fields into the calendar
response.

`get_my_calendar` is called with a different range for every surface — one day
for Today, a week for the roster, a month for the calendar sheet and the stats
— and each range is cached separately. Bundling profile fields would ship them
on every one of those, and would put two unrelated allowlists in one function
where a future edit widening one silently widens the other.

The new endpoint inherits the two structural properties the module docstring
already claims, and both must be re-asserted for it:

1. **No employee-selecting parameter.** An attacker cannot name a victim
   because there is no field to put one in. The existing signature test is
   extended to cover the new function.
2. **The projection is an allowlist**, pinned by equality tests. A field added
   to Employee for an HR need must stay hidden by default.

`_identity()` is reused unchanged, so name, Khmer name, designation and photo
come from one place on both endpoints.

### `unknown` is a third biometric state

`enrollment_status()` already returns `last_snapshot_at` for precisely this
reason — its own docstring says "without it a caller cannot tell 'this person
is not enrolled' from 'we have never heard from the bridge'".

| `last_snapshot_at` | `is_registered` | state |
|---|---|---|
| `None` | anything | `unknown` |
| set | falsy | `not_enrolled` |
| set | truthy | `enrolled` |

Telling somebody they are not enrolled when the truth is that our snapshot is
missing is the same failure as showing a provisional flag: the app stating
something it does not know. `unknown` says so.

### Finger names: the client is built now, the bridge fills it later

`finger_id` exists in the bridge's Supabase `user_biometrics` table and is
already selected by the ADMS UI (`frappe-direct.ts:62`), but the snapshot
POSTed to `notify_enrollment_snapshot` collapses it to a count
(`frappe-merge.ts:70`). Getting finger names to Frappe needs a change in the
bridge repo, which is out of scope here.

What **is** in scope is everything on this side of that wire, so the day the
bridge sends `finger_ids` nothing else has to change:

- a `finger_ids` field on `Employee Biometric Enrollment`
- `upsert_enrollment_row`, `_aggregate_by_employee` and `_clear_absent_rows`
  all handling it
- a FID → slug table in Python
- the Mini App rendering slugs as translated names

Wiring the **clear** path now is not optional. Without it, a snapshot that
zeroes someone's templates would leave a stale finger list behind, and Profile
would render "Right index, Right thumb" directly beside "Not set up" — the
exact self-contradiction this codebase keeps guarding against. Absence of
`finger_ids` in a snapshot means empty, the same way an absent count means `0`.

### The server maps FIDs, the client names them

ZKTeco numbers fingers 0–9. Frappe turns that integer into one of ten fixed
slugs; the Mini App turns a slug into English or Khmer.

Mapping server-side means a wrong convention is one Python table to correct
rather than a hunt across two languages, and — unlike `"FID 6"` — the ten slugs
are translatable.

```python
FINGER_SLUGS = {
    0: "left_little",  1: "left_ring",   2: "left_middle",
    3: "left_index",   4: "left_thumb",  5: "right_thumb",
    6: "right_index",  7: "right_middle", 8: "right_ring",
    9: "right_little",
}
```

**This convention is unverified against a real device.** It is the widely-used
ZKTeco ordering, but nothing in this repo confirms it and no data exercises it
yet. It must be checked against a live enrolment before the bridge side ships.
An out-of-range or unparseable value maps to `other_finger` rather than being
dropped, so the list can never silently disagree with the count.

### Names are shown only when they account for every template

If `fingers` has two slugs and `fingerprint_count` is 3, the client shows
`"3 recorded"`, not two names. Partial naming would state something false about
the third template.

```
show names   when  fingers.length > 0 && fingers.length === fingerprint_count
show count   otherwise
```

Today `fingers` is always `[]`, so every employee sees the count. That is the
correct behaviour, not a placeholder, and it is what makes the named path
testable before real data exists.

### Last-checked is absolute, not relative

The mockup showed "2 hours ago". Shipping absolute — `17 Aug, 06:00` — instead:
a relative string needs plural rules in two languages and goes stale while
sitting on screen, and `synced_at` is a timestamp, which is what it will be
rendered as.

### Empty fields are omitted, never dashed

A record with no department, no manager and no personal email renders four
rows, not nine rows of "—". A row appears only when its value is non-empty; a
whole block disappears when every row in it would. The one thing that is
*stated* rather than omitted is the enrolment gap, because that one costs the
employee an absence flag.

### What is deliberately not shown

- **Device PIN and device serial.** Infrastructure, and a PIN on screen in a
  shared space is a small avoidable risk. The employee's main branch is the
  only device-adjacent fact worth showing.
- **Leave balance.** Leave is on paper today; a balance read out of HRMS would
  be confidently wrong.
- **Roster coverage** ("scheduled through 30 Sep"). Considered and dropped.
- **Any edit affordance.** Read-only, with one line saying so.

## Architecture

```
Telegram Mini App
  MiniAppShell            tabs: day | profile          (modified)
    MiniIdentity          unchanged, still sticky
    MyProfilePage         new
      MiniProfileRow      new — Card / SectionLabel / Row primitives
      MySchedulePage      existing, padding removed
      useMyProfile        new query hook
      useMiniAppCalendar  existing, current-month range

Frappe
  telegram/miniapp_api.py
    get_my_profile(init_data)                          new whitelisted method
      miniapp_auth.employee_from_init_data             existing, first line
      _identity(employee)                              existing, reused
      enrollment_api.enrollment_status(employee)       existing seam
      finger_slots.slug_for                            new
  attendance_engine/finger_slots.py                    new, frappe-free
  attendance_engine/enrollment.py                      finger_ids through the
                                                       upsert / merge / clear paths
  doctype/employee_biometric_enrollment/*.json         + finger_ids
```

### Data flow

Profile issues two queries on mount:

1. `get_my_profile` — the record facts. Cache key `["mini-profile"]`. No
   polling: none of it changes while somebody is looking at it.
2. `get_my_calendar(startOfMonth, endOfMonth)` — for the stats block. This is
   the **same key** `MiniCalendarSheet` uses for the current month, so it is
   frequently already warm and costs nothing.

`MySchedulePage` continues to issue its own week query, unchanged.

The stats are computed client-side from data already in hand — no new backend:

| stat | derivation |
|---|---|
| days worked | count of days where `dayFacts(...).tone === "worked"` |
| hours | `fmt.worked(totalWorkedMinutes(facts))` |
| to check | sum of `flagCount(day)` over the month |

## The wire

```jsonc
// POST /api/method/dewey_time.telegram.miniapp_api.get_my_profile
// body: { "init_data": "<telegram initData>" }
{
  "employee": "HR-EMP-0042",
  "employee_name": "Sok Dara",
  "khmer_name": "សុខ ដារា",
  "designation": "Cashier",
  "image": "/files/sok-dara.png",

  "department": "Retail",
  "employment_type": "Full-time",
  "date_of_joining": "2024-03-12",
  "branch": "DIS Iconic",
  "reports_to_name": "Chan Sophea",

  "cell_number": "012 345 678",
  "personal_email": "dara.sok@gmail.com",

  "biometric": {
    "state": "enrolled",              // enrolled | not_enrolled | unknown
    "fingers": [],                    // slugs; [] until the bridge sends finger_id
    "fingerprint_count": 2,
    "face": false,
    "checked_at": "2026-08-17 06:00:00"
  }
}
```

Every top-level key is `null` when the underlying field is empty. `biometric`
is always present. `reports_to_name` is the manager's **name**, resolved
server-side — the docname is never sent.

### Allowlists

```python
PROFILE_FIELDS  = ("department", "employment_type", "date_of_joining", "branch")
CONTACT_FIELDS  = ("cell_number", "personal_email")
BIOMETRIC_KEYS  = ("state", "fingers", "fingerprint_count", "face", "checked_at")
```

Each Employee field is filtered through `frappe.db.has_column` before the
select, the way `_identity` already does for the Khmer name pair. A site
mid-migration missing `employment_type` must lose one row, not the whole tab —
`hr_calendar.py:346` guards the same column for the same reason.

`reports_to` is read separately and resolved with a second `get_value`; a
dangling link yields `None` rather than raising.

`enrollment_status` grows one key, `finger_ids: [3, 6]` — parsed to ints by
`finger_slots.ids_from_field`, because the stored `"3,6"` is a storage detail
and every consumer would otherwise re-parse it. `miniapp_api` maps those ints
to slugs with `slug_for`; the ints themselves never reach a phone.

`checked_at` is the row's own `synced_at`, falling back to `last_snapshot_at`
when the row has none — "when did we last hear about *this person*", with "when
did we last hear at all" as the weaker but still true answer.

### Storage

`Employee Biometric Enrollment` gains one field:

```jsonc
{
  "fieldname": "finger_ids",
  "fieldtype": "Small Text",
  "label": "Fingerprint Slots",
  "read_only": 1,
  "description": "Comma-separated ZKTeco finger indexes, e.g. \"3,6\". Written by the bridge snapshot."
}
```

Added to `field_order` after `fingerprint_count`. **The DocType's `modified`
timestamp must be bumped** or `bench migrate` skips the schema reimport
entirely and the column never appears.

## Files

**Create**

| Path | Responsibility |
|---|---|
| `dewey_time/attendance_engine/finger_slots.py` | FID ↔ slug, frappe-free. `slug_for(fid) -> str`, `ids_from_field(value) -> list[int]`, `field_from_ids(ids) -> str` |
| `dewey_time/tests/test_finger_slots.py` | The table, the parser, the fallback |
| `src/miniapp/miniProfile.ts` | `FINGER_TEXT`, `fingerNames`, `biometricStateKey`, `serviceLength`, `monthStats` |
| `src/miniapp/MiniProfileRow.tsx` | `ProfileCard`, `ProfileSection`, `ProfileRow` — omit-when-empty lives here |
| `src/miniapp/MyProfilePage.tsx` | Composition of the five blocks |
| `src/miniapp/miniProfile.test.ts` | Pure logic + cross-language parity |
| `src/miniapp/myProfilePage.test.tsx` | Render states: full, sparse, unknown |

**Modify**

| Path | Change |
|---|---|
| `dewey_time/telegram/miniapp_api.py` | `get_my_profile`, three allowlists, `_profile_fields` helper |
| `dewey_time/attendance_engine/enrollment.py` | `finger_ids` through upsert / aggregate / clear |
| `dewey_time/attendance_engine/enrollment_api.py` | `enrollment_status` returns `finger_ids` (ints) |
| `.../employee_biometric_enrollment.json` | `finger_ids` + `modified` bump |
| `dewey_time/tests/test_telegram_miniapp_api.py` | `TestProfileProjection` |
| `dewey_time/tests/test_enrollment_ingest.py` | finger_ids ingest, merge, clear |
| `src/miniapp/MiniAppShell.tsx` | `MiniTab`, `isMiniTab`, `TABS`, mount `MyProfilePage` |
| `src/miniapp/MySchedulePage.tsx` | Drop `p-3` from three wrappers |
| `src/miniapp/useMiniAppSession.ts` | `useMyProfile`, `MiniProfile` type |
| `src/miniapp/miniStrings.ts` | ~40 keys EN + KM; remove `tabSchedule` |
| `src/miniapp/miniAppShell.test.tsx` | Tab set, stale-key rejection |
| `e2e/miniapp.spec.ts` | Profile tab, sparse record, paging still forward |

## Copy

English is fixed here; the Khmer is authored during implementation, in
`miniStrings.ts`, where `StringKey = keyof typeof EN` makes a forgotten key a
compile error rather than a silent English fallback.

**Every Khmer string needs a native speaker's review before it reaches
employees** — the standing note at the top of `miniStrings.ts` applies, and the
biometric copy is where a near-miss does real damage. "Not set up" must read as
*the devices do not have your fingerprint*, never as *you did something wrong*.
This joins the outstanding review already owed on the 25 flag strings and the
four calendar marks.

| Key | English |
|---|---|
| `tabProfile` | Profile |
| `sectionRecord` | Your record |
| `sectionBiometric` | Fingerprint & face |
| `sectionContact` | Contact HR has for you |
| `sectionMonth` | {month} so far |
| `sectionRoster` | Your roster |
| `labelEmployeeId` | Employee ID |
| `labelDepartment` | Department |
| `labelEmployment` | Employment |
| `labelJoined` | Joined |
| `labelReportsTo` | Reports to |
| `labelStatus` | Status |
| `labelFingers` | Fingers |
| `labelFace` | Face |
| `labelDevicesAt` | Devices at |
| `labelLastChecked` | Last checked |
| `labelPhone` | Phone |
| `labelEmail` | Email |
| `bioEnrolled` | Set up |
| `bioNotEnrolled` | Not set up |
| `bioUnknown` | Not checked yet |
| `bioNotEnrolledBody` | The fingerprint devices don't know you yet. Ask HR to enrol you, or you'll be marked absent. |
| `bioUnknownBody` | We haven't heard from the fingerprint devices yet, so we can't tell you either way. |
| `bioRecorded` | {n} recorded |
| `statDaysWorked` | days worked |
| `statHours` | hours |
| `statToCheck` | to check |
| `contactReadOnly` | Wrong? Tell HR — this page can't change it. |
| `unitYear` | y |
| `unitMonth` | mo |
| `loadingProfile` | Loading your record… |
| `errorProfile` | Couldn't load your record. |
| `fingerLeftLittle` … `fingerRightLittle` | Left little … Right little (ten keys) |
| `fingerOther` | Another finger |

Length of service composes from `unitYear`/`unitMonth` the way
`formatWorkedMinutes` composes hours and minutes — a pure function taking the
unit words, so Khmer's space-before-unit convention is driven by locale rather
than by the strings.

## Testing

Every guard below is stated as a **mutation**: the change that must make it
fail. A test that cannot be made to fail is not a guard.

**Allowlist and authorization** — `test_telegram_miniapp_api.py`

1. `get_my_profile`'s signature is exactly `(init_data)`. *Mutation: add
   `employee=None` → fails.*
2. Response keys equal the allowlist, given a fabricated Employee row carrying
   extra columns. *Mutation: add a field to the select → fails.*
3. A newly-added Employee column does not appear. *Mutation: widen
   `PROFILE_FIELDS` → fails.*
4. `employee_from_init_data` is the first statement. *Mutation: move the
   enrolment read above it → fails.*

**Biometric state**

5. `last_snapshot_at is None` → `unknown`, even with `is_registered=1`.
   *Mutation: drop the `unknown` branch → fails.*
6. Snapshot present, `is_registered=0` → `not_enrolled`.
7. Snapshot present, `is_registered=1` → `enrolled`.

**Finger slots** — `test_finger_slots.py`

8. All ten FIDs map to their slug.
9. `slug_for(11)` and `slug_for("x")` → `other_finger`. *Mutation: raise
   instead → fails.*
10. `ids_from_field("3,6")`, `""`, `None`, `"x, 3"` — junk tolerated, order
    preserved.
11. `field_from_ids([6, 3, 3])` → `"3,6"`, deduped and sorted.

**Ingest** — `test_enrollment_ingest.py`

12. `upsert_enrollment_row(finger_ids=[3, 6])` stores `"3,6"`.
13. `_clear_absent_rows` blanks `finger_ids`. *Mutation: omit it from the
    update dict → fails.* **This is the stale-list guard.**
14. A snapshot with no `finger_ids` key blanks the field.
15. `_aggregate_by_employee` unions finger ids across duplicate PINs, matching
    the existing OR-the-flags / max-the-counts rule.

**Client logic** — `miniProfile.test.ts`

16. Names shown when `fingers.length === fingerprint_count`.
17. Count shown when they disagree. *Mutation: drop the equality check →
    fails.* **This is the honesty guard.**
18. Count shown when `fingers` is empty — today's real state.
19. An unrecognised slug renders `fingerOther`, never crashes.
20. Cross-language parity: `FINGER_TEXT`'s keys are parsed out of
    `finger_slots.py` and compared, the way `miniFlags.test.ts` reads
    `EMPLOYEE_FLAG_CODES` out of `miniapp_api.py`. *Mutation: add a slug
    server-side only → fails.*
21. `serviceLength` — exact months, year boundary, joined-today → zero.
22. `monthStats` over fixture days.

**Render** — `myProfilePage.test.tsx`

23. A sparse record omits empty rows and whole empty blocks. *Mutation: render
    a dash instead → fails.*
24. `unknown` renders `bioUnknownBody`, not `bioNotEnrolledBody`.
25. `not_enrolled` renders the absence warning.

**Shell** — `miniAppShell.test.tsx`

26. Tabs are Today and Profile.
27. `isMiniTab("schedule")` is `false` and the shell falls back to `day`.

**e2e** — `miniapp.spec.ts`

28. Profile tab renders all five blocks against the full fixture.
29. The roster inside Profile still pages **forward** past today.
30. A sparse fixture renders without the contact block.

`test:web` is an explicit per-directory glob list — `src/miniapp` is already
covered, but **check the printed test count rose**, since a suite that never
ran also reports green.

## Out of scope

- **The bridge sending `finger_id`.** Its own spec, spanning the bridge repo,
  `notify_enrollment_snapshot`, and a verification pass against a real device
  to confirm the FID convention.
- **Editing anything.** Profile is read-only in every block.
- **Exposing `NO_CHECKIN_YET` to employees.** Unrelated, still undecided.
- **Roster coverage warnings.** Considered, dropped.

## Open questions for the roster

Two fields may be sparsely populated on the real Employee records, and neither
is knowable from here:

- **`reports_to`** — if most records have no manager, the row never renders and
  the code is dead weight.
- **`personal_email`** — same, for the contact block.

Both degrade correctly (the row vanishes), so this is a question about whether
the code earns its place, not about correctness. Worth a look at the live data
before implementation; if either is empty for most people, drop that row from
the plan.
