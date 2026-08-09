# A No-Show Gets To Say So

**Date:** 2026-08-09
**Status:** approved for planning
**Depends on:** nothing. Touches `intraday.py` and `absence_intervals.py` only.
**Related:** `2026-08-08-flag-queue-layout-design.md` (the queue this feeds)

## What this is

A day on which nobody turned up currently appears in the flag queue as **two** rows:

```
⚠ Missing time  08:00-12:00   240 min
⚠ Missing time  13:00-17:00   240 min
```

Two "missing 4 hours" findings, split by a lunch nobody was there to take. It reads as two
problems. It is one, and the one it is — *this person did not come to work* — is never
stated.

Three changes. The first two are legibility: no information is lost, no judgment is
suppressed, and the same rows appear at the same moment with the same severity. The third
is the tooling needed to see that they worked.

## What is already true

This matters, because the obvious framing of this request — "add an absent-without-notice
flag" — describes something that already exists.

- **`UNNOTIFIED_ABSENCE` exists**, CRITICAL, labelled "Did not show up", with its own
  hatched empty timeline and a "Punches: 0" fact whose zero *is* the finding
  (`flagNarrative.test.ts:1198`).
- **At closeout it already fires and already suppresses MISSING_TIME.** `closeout.py:568` —
  a zero-punch on-shift day raises `UNNOTIFIED_ABSENCE` and returns *before* the
  MISSING_TIME evaluation is reached. `test_integration_pilot_matrix.py:203` pins that the
  day's flag set is exactly `{"UNNOTIFIED_ABSENCE"}`.
- **A day with no schedule is also already correct.** `closeout.py:534` — `not on_shift`
  with zero punches returns immediately. No absence noise for unscheduled people.

The defect is confined to the **intraday** pass, which rebuilds provisional flags every
~30 minutes. It deliberately withholds `UNNOTIFIED_ABSENCE` — inventing a no-show for a day
that is not over would be wrong — but it has nothing else to say, so `MISSING_TIME` fills
the silence in the least legible available shape.

## Measured baseline

Produced by running the real `compute_missing_time_intervals` against an 08:00–17:00 shift
with a 12:00–13:00 scheduled lunch and a 30-minute absence threshold. Not inferred from
reading the code — the first attempt at this fixture passed `datetime` objects for the
shift times, which `shift_time_to_minutes` silently parses to `None`, and every case
returned zero intervals. Shift Type times are `timedelta`.

| punches | `max_end_min` | intervals produced |
|---|---|---|
| none | `None` (whole day) | `08:00-12:00` 240 min · `13:00-17:00` 240 min |
| none | 900 (15:00) | `08:00-12:00` 240 min · `13:00-15:00` 120 min |
| none | 630 (10:30) | `08:00-10:30` 150 min |
| stray IN/OUT 5 min apart | `None` | `08:05-12:00` 235 min · `13:00-17:00` 240 min |
| single forgotten IN at 08:00 | `None` | *nothing* |
| worked the morning only | `None` | `13:00-17:00` 240 min |

These are the raw outputs of `compute_missing_time_intervals`. Row 1 is **not** what
closeout emits — closeout returns at `closeout.py:568` before reaching this function when
`checkins_count == 0`, so no zero-punch day has ever produced it. It is shown because it is
what *intraday* reaches once the day is over but before closeout has run, and because it
isolates the lunch split from the `max_end_min` truncation.

Two rows in the table produce the confusing shape, and they are **not the same problem**.
Rows 1–2 are a no-show. Row 4 is someone who did badge in, so it cannot be called a
no-show; its defect is that the scheduled lunch is carved out of the missing window when
there is no evidence anyone took a lunch. Both are fixed below, by different means.

Row 5 — a single forgotten punch reading as full presence — is deliberate existing
behaviour (`derive_presence_intervals`, which opens a session to `session_end_min` rather
than billing everyone currently at work as absent). Out of scope.

## Decision 1 — a no-show can say so before the day ends

In `intraday.py`, inside the existing `if not skip_absence:` block (line 145), branch on
`checkins_count == 0`:

- emit `UNNOTIFIED_ABSENCE` as a provisional row (`day_closed=0`), reason
  `on_shift_no_checkins_intraday`;
- skip the `evaluate_missing_time_flags` loop entirely for that day.

### Timing

No new knob. The cutoff falls out of the existing `absence_threshold_minutes` (default 30):
below it there is no interval long enough to flag, so nothing appears. That is the *same
moment* the first `MISSING_TIME` appears today, and `UNNOTIFIED_ABSENCE` and `MISSING_TIME`
are **both CRITICAL**.

So the queue gains no rows, and no row gets louder. A row that today says "missing 4 hours"
tomorrow says "did not show up". That is the entire user-visible change.

Reusing the existing config knob also means the threshold stays tunable on the bench when
real go-live data shows 30 is wrong — no code change, no redeploy.

### Why this is safe

The device-outage gate already exists in intraday and is reused unchanged
(`intraday.py:120`): an open device-closeout alert on the employee's branch, or a delivery
or record failure, suppresses absence flags. A dead device therefore cannot produce a
branch-wide wave of false no-shows. This was the main risk and it required no new code.

The row is also self-healing: the moment the employee badges in, intraday deletes the
provisional rows and rebuilds, and the no-show is replaced by whatever is then true —
`LATE_START`, or a genuine `MISSING_TIME`.

Evidence needs no new fields. The dict already carries `checkins_count` and
`provisional: True`, which is exactly what the frontend's "Punches: 0" fact reads.

### What is NOT changed

Closeout. It is already correct, and this spec must not touch it.

## Decision 2 — an unattended lunch stops splitting one absence in two

`derive_missing_expected_intervals` subtracts the scheduled lunch from the expected window
unconditionally, which is right when someone took a lunch and wrong when nobody was there
to take one.

Bridge two missing intervals when **both** of these hold:

1. the scheduled lunch window exists (`custom_lunch_start` and `custom_lunch_end` both
   parse, and end > start);
2. the earlier interval's `endMin` equals `lunch_start` **and** the later interval's
   `startMin` equals `lunch_end` — an exact abutment on both sides, not an overlap and not
   a gap that merely contains the lunch.

Condition 2 is what keeps this from merging two unrelated absences that happen to sit
either side of midday.

An earlier draft added a third condition — that `detect_observed_lunch` found no observed
lunch. It was removed as unreachable: exact abutment on *both* sides means the employee was
absent across the entire lunch window, and an observed lunch requires punches at its
boundaries. The two conditions cannot both hold, so the gate would have been a branch no
test could reach. Condition 2 already subsumes it.

Since Decision 1 suppresses `MISSING_TIME` entirely for zero-punch days, this rule only
ever fires for days with *some* presence — the stray-punch case and anything shaped like
it. The zero-punch rows in the baseline table are reachable by this code only in the window
after the day ends and before closeout runs, and Decision 1 removes them there too.

### The arithmetic

**Minutes stay the sum of the parts, not the span.** The stray-punch day becomes one
interval `08:05→17:00` carrying **475 minutes**, not 535. The unpaid hour is still not
billed as missing work.

This means `minutes` deliberately does not equal `end − start`, and the copy must say so —
"7h55m unaccounted between 08:05 and 17:00, excluding the 1h lunch" — or the timeline band
and the number appear to contradict each other. This codebase has already paid for numbers
HR could not reconcile; `derive_presence_intervals`' own docstring records absence being
billed twice as the thing that made HR distrust the figures.

`_merge_intervals` currently recomputes `minutes` from the span. For the bridged case it
must add the parts instead.

### The rule that was rejected

"Do not carve out the lunch when there is no presence after it" is simpler and wrong: it
breaks the worked-the-morning-only case, which has no presence after lunch either and
would be billed for a lunch hour it correctly stopped for. Bridging only an *exact*
scheduled-lunch gap leaves that case byte-identical, which is the test that matters.

## Decision 3 — a bulk regenerator, so the shape can be read

Go-live is roughly a month out and the current flag data is scratch — useful for reading
shape, not a record to preserve. Two consequences.

**Nothing needs migrating.** Identity is keyed on `interval_start`
(`flag_identity.py:131`), so the merge preserves the first half's identity and drops the
second's, and a provisional `MISSING_TIME` becoming `UNNOTIFIED_ABSENCE` breaks its
decision match. Both would normally need a migration patch. Against scratch data they need
nothing, and this spec deliberately writes none.

**But the queue will otherwise show two shapes at once.** Only days re-processed after
deploy take the new form; older days keep their split rows. Opening `/hr-flags` to judge
whether this worked would mean reading a blend of before and after — an artifact that looks
like a result. Which is the whole purpose this data still serves.

So: a **System Manager-only dev tool** that wipes AUTO flags and re-runs the engine for all
active employees across a date range, chunked past `MAX_RANGE_DAYS` (31). No bulk
regenerator exists today — `run_engine_for_employee` is per-employee and 31-day capped, and
the `clear_*` tools are all schedule-related. It will be run more than once between now and
go-live, once per threshold adjustment.

It must follow the existing destructive-tool conventions in `dev_tools.py`: System Manager
check, explicit confirm, and a preview that reports what would be affected before anything
is deleted.

## Out of scope

- **Multi-site employees.** 133 employees have no `branch`. That is not one population: some
  are simply unset, and some genuinely work multiple primary sites, which a single `branch`
  field cannot express. The engine has no site-set concept anywhere — no site on the shift
  assignment, and `_non_primary_site_punch_flag` compares punches against one value. The
  consequence is real: the outage gate is keyed on `employee_branch`, so for a branchless
  employee it is skipped entirely (`intraday.py:120`, `closeout.py:380`) and they are judged
  absent regardless of whether the device that would have recorded them was alive.
  Suppressing absence for them would hide genuine no-shows, so the fix is a representation
  decision, not a suppression rule. **Its own brainstorm.**
- **Source-side MISSING_TIME suppression** as originally framed. Pulling the thread led to
  the item above; Decisions 1 and 2 take the legibility win without it.
- **A single forgotten punch reading as full presence.** Deliberate existing behaviour.
- **Closeout.** Already correct.

## Open question

Whether closed past days also carry split `MISSING_TIME` rows. Closeout deletes both
provisional and final rows and regenerates, so a properly closed day *cannot* keep them —
which means any that exist belong to days that never closed (`deferred_offline`,
`closure_failed`). To be settled before planning:

```sql
SELECT f.day_closed, COUNT(*) AS flags,
       COUNT(DISTINCT CONCAT(f.employee, f.attendance_date)) AS days
FROM `tabAttendance Flag` f
WHERE f.flag_code = 'MISSING_TIME' AND f.source = 'AUTO'
  AND f.attendance_date >= CURDATE() - INTERVAL 30 DAY
  AND NOT EXISTS (
    SELECT 1 FROM `tabEmployee Checkin` c
    WHERE c.employee = f.employee AND DATE(c.time) = f.attendance_date
  )
GROUP BY f.day_closed;
```

`day_closed=0` only confirms the intraday account above. Any `day_closed=1` is a separate
closeout defect and must be folded into the plan rather than shipped around.

## Testing

Backend, via the no-Docker fast path
(`bash dev/sandbox/frappe-sandbox test --backend --fast`). Fixtures take the shape of the
measured baseline above — **`timedelta` shift times, not `datetime`**, or every case
silently yields zero intervals and the suite proves nothing.

Every case gets a two-sided mutation check: the assertion must fail with the change
reverted, not merely pass with it applied.

| case | required outcome |
|---|---|
| zero punches, intraday | exactly one `UNNOTIFIED_ABSENCE`, **zero** `MISSING_TIME` |
| zero punches, below threshold | no flags at all |
| zero punches + open device alert | no absence flag of either kind |
| zero punches + delivery failure | no absence flag of either kind |
| employee badges in later | provisional no-show gone on rebuild |
| stray IN/OUT pair | one interval `08:05-17:00`, `minutes == 475` |
| worked morning only | byte-identical to today (`13:00-17:00`, 240) |
| gap merely straddling midday | two intervals, **not** bridged |
| no scheduled lunch configured | no-op |
| zero punches, closeout | unchanged — `{"UNNOTIFIED_ABSENCE"}` |
| no schedule | unchanged — no flags |

Mocked unit tests are not sufficient on their own for the regenerator: it deletes rows, and
a wipe verified only against mocks has burned this project before. It must be exercised
against a real `frappe-sandbox` bench before handoff.

## Risks

| risk | mitigation |
|---|---|
| A dead device produces a wave of false no-shows | The existing `skip_absence` gate is reused unchanged and is tested directly. |
| Someone merely late is called a no-show | Appears no earlier than today's first `MISSING_TIME`, at the same severity, and is withdrawn the moment they punch. |
| `minutes ≠ span` reads as a bug | Copy states the exclusion explicitly; a test pins `minutes == 475`. |
| The regenerator is run against real data post-go-live | System Manager only, explicit confirm, preview-before-delete, consistent with existing `clear_*` tools. |
| Branchless employees keep being misjudged | Unchanged by this spec and stated in Out of scope, not silently inherited. |
