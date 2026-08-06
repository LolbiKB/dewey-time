# Flag Evidence Panel — Design

**Date:** 2026-08-06
**Status:** approved for planning

## The problem, in one screenshot

An HR user opened a real flag and got this:

```
First check-in   2:23 PM      Effective grace         10m
Last check-out   2:23 PM      Start grace             10m
Shift start      8:00 AM      End grace               10m
Late threshold   8:10 AM      Lunch return grace      10m
Punch time       2:23 PM      Custom grace            10m
                              HRMS late entry grace   10m
                              HRMS early exit grace   10m
Reason           Single punch only
```

Thirteen rows of equal weight. Seven are grace values that have nothing to do with
whether there was one punch or two. The finding is row thirteen. And "First check-in
2:23 PM / Last check-out 2:23 PM" being *the same timestamp* is the entire story —
but the reader has to notice that and infer it.

The panel is **evidence-shaped, not question-shaped**. `formatFlagEvidenceDetails`
(`flagDetails.ts:243`) walks every key in the evidence blob and renders one row each,
with no knowledge of which flag it is describing.

### Why the irrelevant keys are there

Not a rendering accident — the engine writes them. `_generate_for_employee_date`
builds **one mutable evidence dict per employee-day** (`closeout.py:505-516`), stamps
`shift_start` plus all seven `grace_evidence()` keys plus `late_threshold` onto it at
`:606-611` for any on-shift day with a start time, adds `shift_end`/`early_threshold`
at `:662-663`, and then merges that shared dict into *every* flag it inserts for that
employee-day (`{**evidence, **extra_evidence}` at `:531`, `:566`, `:597`, `:692`).

`single_checkin` itself writes exactly three keys: `reason`, `checkins_count`,
`punch_time` (`record_issue_flags.py:24-34`).

**This design does not change that.** The evidence blob is the audit record of what
the engine saw, and trimming it would destroy forensic data. The panel's job is to
*explain*; it abdicated that and dumped the record instead.

## Shape

Four zones, in order:

1. **Verdict headline** — one sentence stating the finding in plain words.
2. **Sub-line** — the context that makes the headline actionable.
3. **Timeline** — only when the finding is a relationship between clock positions.
4. **Facts** — at most four, only what caused *this* flag.
5. **Disclosure** — the complete evidence blob, collapsed, exactly as today.

Nothing becomes unreachable. Things stop being the first thing HR reads.

## Treatment table

| Flag code | Scenario | Headline | Facts | Timeline |
|---|---|---|---|---|
| `LATE_START` | default | Clocked in at {first_in} — {n} minutes late, even after a {grace}-minute grace period. | Clocked in · Cutoff · Past cutoff | **Yes** — start boundary + threshold |
| `LATE_START` | grace = 0 | Clocked in at {first_in} — {n} minutes after the {shift_start} shift start. | Clocked in · Shift start · Late by | **Yes** — same, no threshold line |
| `LEFT_EARLY` | default | Clocked out at {last_out}, {n} minutes before their shift was scheduled to end. | Clocked out · Shift end · Early by | **Yes** — trailing hatched gap |
| `LATE_FROM_LUNCH` | default | Left for lunch at {out}, back at {in} — {n} min past the return deadline. | Actual lunch · Scheduled · Deadline · Late by | **Yes** — scheduled band + overshooting gap |
| `MISSING_TIME` | default | Gone from {start} to {end} — {duration} unaccounted, {lunch_relationship}. | Gap · Left · Back · Lunch window | **Yes** — hatched gap against lunch band |
| `UNNOTIFIED_ABSENCE` | device closeout | Scheduled for the {shift} shift, but never checked in — zero punches all day. | Shift · Punches (0) · Caught by | **Yes** — empty hatched band |
| `UNNOTIFIED_ABSENCE` | company fallback | Scheduled to work, but never checked in — zero punches all day. | Shift · Punches (0) · Caught by | **Yes** — same |
| `OFF_SHIFT_PUNCH` | holiday | Punched {n} times on {holiday}, a public holiday — nobody was scheduled. | Day · Punch times | **Yes** — punch marks, no shift band |
| `OFF_SHIFT_PUNCH` | no shift | Punched {n} times — no shift was scheduled for this employee that day. | Punch times | **Yes** — punch marks only |
| `NON_PRIMARY_SITE_PUNCH` | default | {n} of {m} punches today were at a site other than {branch}, this employee's home branch. | Home branch · N of M elsewhere | **No** |
| `ATTENDANCE_ISSUE` | `single_checkin` | Punched once at {punch_time}, then never again that day. | Only punch | **Yes** — lone mark in an empty shift |
| `ATTENDANCE_ISSUE` | `unpaired_punch` | Punched at {punch_time}, but it never got matched to a clock-out — the day's other punches paired up fine. | Odd punch · From | **Yes** — lone mark between healthy spans |
| `ATTENDANCE_ISSUE` | `unknown_device_branch` | {n} punches today came from a device that didn't report which site it's at. | Unlabelled punches | **Yes** — marked punches |
| `ATTENDANCE_ISSUE` | `delivery_failed` | Device {device_sn} recorded a punch that never reached HR's records. | Reported by · Badge | **No** |
| `MISSING_IN_OR_OUT`, `NO_CHECKIN_YET`, `MISSING_LUNCH` | no detector | "{label}" isn't a rule this engine currently checks automatically. | Raised by · Recorded reason | **No** |

Emission sites for the implementer: `closeout.py:619-628` (LATE_START), `:656-674`
(LEFT_EARLY), `:524`/`:559` (OFF_SHIFT_PUNCH's two reasons), `:589` and `:301-313`
(UNNOTIFIED_ABSENCE's two producers), `:631-635` + `intraday.py:136`
(NON_PRIMARY_SITE_PUNCH), `lunch_flags.py:76-86` (LATE_FROM_LUNCH),
`absence_flags.py:55-63` (MISSING_TIME), `record_issue_flags.py:24-34`/`:37-50`/
`:52-62`/`:72-81` (the four ATTENDANCE_ISSUE reasons).

## Two sub-lines that are the most important copy here

Both name **whose problem it is**, because the current panel dresses these in the same
clothes as a genuine violation:

- `delivery_failed` → *"A lost record, not a missed check-in — nothing to hold against
  the employee."*
- `unknown_device_branch` → *"This is a device or config problem, not necessarily an
  employee problem."*

## Cross-cutting rules

**1. Relevance is scoped to `(flag_code, reason)`, not `flag_code`.** `device_sn` is
buried provenance for `single_checkin` and a first-class fact for `delivery_failed` —
same code, opposite treatment.

**2. Never rendered as a fact, for any flag.** `employee`, `date`, `attendance_date`
(already on the doctype's own fields), `on_shift` (constant), `provisional`
(superseded by the `day_closed` badge), and the three raw grace inputs
`custom_grace_minutes` / `late_entry_grace_period` / `early_exit_grace_period` —
`shift_grace.py:52-73` already folds these into the effective numbers, so showing both
is three rows saying one thing.

**3. Never read `grace_minutes`.** It is an alias whose meaning depends on which
flag's `extra_evidence` wrote it last — start grace for LATE_START, end grace for
LEFT_EARLY (`closeout.py:669`), lunch-return grace for LATE_FROM_LUNCH
(`lunch_flags.py:60`). On any other flag's row the surviving value is inherited start
grace that had nothing to do with the finding. Read the explicit `effective_*` key for
the code instead. *(Resolves designer disagreement #1 — the conservative reading.)*

**4. Grace is never its own fact.** State the **cutoff time** as the fact — it already
has grace baked in — and mention the grace figure in the headline sentence only when
it is non-zero. This kills a row on every boundary flag and is what "compact" means.
*(Resolves #2.)*

**5. Timelines are drawn when the finding is a relationship between clock positions** —
an arrival against a cutoff, a gap against a window, a return against a deadline, an
isolated mark against silence. Not drawn when the finding is **categorical** (which
branch, which device, which day type) or when there is **no trustworthy timestamp for
the thing being flagged**. Two corollaries:
   - Draw only the boundary the flag is about. LATE_START gets the start boundary and
     the first segment — no lunch band, no shift-end band. Re-showing the whole day
     re-imports the noise this removes.
   - Feed the timeline from the day's real checkin list, not the evidence blob.
     Evidence carries `first_in`/`last_out` strings, never the punch list, and
     `unknown_device_branch` carries only a count.

**6. A shift-less day auto-scales to its punches** via `computeDayTimeWindow()`. Never
a blank 24-hour axis. *(Resolves #3.)*

**7. `UNNOTIFIED_ABSENCE` keeps its empty timeline**, rendered hatched so it reads as
absence rather than as a chart. Its *width* tells HR whether a 4-hour or a 10-hour
shift was missed, which the sentence does not — and one consistent panel shape across
flags is itself an at-a-glance property. *(Resolves #4.)*

**8. The timeline is embedded, not linked.** The existing "View punches & timeline"
button (`FlagDetailPanel.tsx:126-128`) navigates away to the answer. Requiring
navigation to see the finding is the complaint this design exists to fix. *(Resolves
#5.)*

**9. Evidence supplies the finding; the live calendar supplies context.** The gap, the
punch time, the counts come from the frozen evidence — that is what the engine judged.
The shift window, lunch window and punch list come from the day's calendar data, which
is what makes the panel richer than the blob. Where the two disagree (a corrected shift
assignment, re-run lunch detection), the existing `evidence_fingerprint` comparison
already surfaces it as `needs_re_review`; the panel does not arbitrate. *(Resolves #6.)*

**10. `shift_type` stays out of the fact list.** Use the live calendar's shift label
for the headline instead — the company-fallback producer's evidence has no
`shift_type` at all, so a fact sourced from it would be present on one producer and
absent on the other for the same situation. *(Resolves #7.)*

**11. An unrecognised flag code** gets its title from the existing `formatFlagLabel`
fallback plus the "no automatic rule produces this flag" qualifier. Promote only
self-describing fields — `evidence.reason` **verbatim and unmapped**, and
`flag.source` read off the record so it survives empty evidence. Never run an unknown
code's keys through the shared `TIME_EVIDENCE_KEYS`/`GRACE_EVIDENCE_KEYS` maps
(`flagDetails.ts:65-94`): those are keyed by string name across all codes, so a manual
entry that happens to use the name `shift_start` would be silently formatted and
promoted as a cause.

**12. Empty or malformed evidence** keeps the existing degradation (`parseFlagEvidence`
try/catches; `formatFlagEvidenceDetails` returns empty), plus explicit copy for the
true-empty case — *"No evidence was recorded on this flag."* — rather than an empty
card that reads as broken.

## Headline voice

1. **State the finding, not the fields.** "Clocked out at 4:12 PM, 48 minutes before
   their shift was scheduled to end" — not `last_out` / `shift_end` / `early_threshold`
   as three rows the reader subtracts in their head.
2. **Compute and state the magnitude**, measured against the same threshold the engine
   compared to, so the headline and any on-timeline badge cannot disagree.
3. **Translate engine nouns.** `on_shift_no_checkins` → "Confirmed at end-of-day device
   closeout". HR should never read "fallback", "threshold", or "evidence".
4. **Say whose problem it is when that is knowable**, and say when the app does not
   know: "nothing here has been machine-verified."

Counter-examples, all live today:

- `Effective grace 15m · Start grace 15m · Custom grace 15m · HRMS late entry grace 15m`
  — four rows, one number, zero sentences.
- `First check-in 2:23 PM · Last check-out 2:23 PM · Punch time 2:23 PM` — one timestamp
  three times under three labels, none of which says "and then they never punched again".
- `Late threshold 8:15 AM` on a LEFT_EARLY row — a field name presented as a finding,
  for a comparison this flag never made.
- **The holiday case is actively inverted.** For `holiday_has_checkins` the single most
  decision-relevant fact — *which holiday* — is unreachable without expanding the
  disclosure, because `formatEvidenceValue` returns `null` for object values, while
  `employee_branch` gets a first-class row.

## What this does not change

- **The engine keeps writing full evidence.** Rendering change only.
- **No stored decision is disturbed.** `evidence_fingerprint`
  (`flag_identity.py:184-201`) hashes `{"minutes", "reason"}` only, so suppressing
  `shift_start` or the redundant grace keys from the *panel* re-fingerprints nothing and
  demotes no `Attendance Flag Decision` to `needs_re_review`.
- **The full blob stays behind the disclosure**, exactly as today.
- **Triage ranks, flag identity, severities and queue ordering are untouched** by this
  spec — including the two ranking anomalies below, which are reported, not fixed here.

## Prerequisites and related defects

Found while designing. **The first is data loss and should be fixed before this work.**

1. **A second delivery failure in one closeout silently destroys that employee's whole
   day of flags.** `evaluate_record_issue_flags` sets no `punch_time` for
   `delivery_failed`, so `flag_identity.py:138-149` builds an identical
   `delivery-failed-` suffix for every undelivered item. The second `doc.insert()`
   (`closeout.py:715-731`) raises a duplicate-name error, which
   `_generate_for_employee_date_isolated`'s try/except (`closeout.py:451-461`) swallows
   into an Error Log — **and aborts the remaining flag generation for that
   employee/date.** HR sees one or zero delivery flags plus missing unrelated flags,
   with nothing indicating loss.

2. **`DELIVERY_FAILED` is a dead code and the live path mis-triages.** Nothing emits it;
   delivery failures ship as `ATTENDANCE_ISSUE` reason `delivery_failed`, which ranks
   **140 ("act")** instead of the **50 ("review")** the `DELIVERY_FAILED` row in the
   triage table intends. A not-the-employee's-fault flag is currently as urgent as a
   genuine violation.

3. **`LEFT_EARLY` writes no `minutes` key**, so `flag_triage._minutes` returns `None`
   and triage cannot distinguish a 5-minute early leave from a 3-hour one. Fixing this
   changes that flag's `evidence_fingerprint` and will demote its existing decisions —
   a separate change with a migration question attached, not something to slip in
   alongside a panel redesign.

4. **`flagSummary()` and `flagHrGuidance()` assert confident findings for the three
   codes with no detector**, and `MISSING_IN_OR_OUT` ranks 140, so a hand-created row
   lands at the top of HR's queue. Rule 11 covers the panel; the ranking does not.

5. **Dead reason labels.** `RECORD_ISSUE_SUBLABELS` (`flagLabels.ts:18-25`) and
   `REASON_LABELS` (`flagDetails.ts:26-35`) both carry `off_shift_punch` and
   `missing_lunch_pair`, neither of which `record_issue_flags.py` emits. Worth pruning
   in the same pass.

6. **Mock fixtures are not a contract.** `mock/month.ts` and `mock/calendar.json`
   fabricate evidence shapes for `MISSING_IN_OR_OUT` and `MISSING_LUNCH` that no
   detector produces. Do not build the fallback against them.

## Testing

- Per scenario: the headline renders the computed magnitude, and the fact list contains
  exactly the specified keys — asserted by *absence* too, since the defect being fixed
  is extra rows. A `single_checkin` render must contain no grace string at all.
- The holiday name reaches the fact list rather than the disclosure.
- An unknown flag code renders the generic treatment and does **not** promote a key
  merely because it is named `shift_start`.
- Empty and malformed evidence render the explicit empty copy, not a blank card.
- Timeline presence matches the table: absent for `NON_PRIMARY_SITE_PUNCH`,
  `delivery_failed` and the no-detector codes.

> `test:web` is a non-recursive per-directory glob. New tests go directly in `src/lib/`
> or `src/ui/`, or they never run.

## Out of scope

- Changing what the engine writes to evidence.
- The six defects above, except where rule 11 covers the panel's half of #4.
- Anything about the flag queue's ranking, grouping or ordering.
