# Flag Queue — Pattern Nesting

**Date:** 2026-08-06
**Status:** approved for planning

## The problem

The queue gets crowded fast on real data, and the cause is structural.

`build_queue` keys people by **`(employee, date_str)`** — a person-*day*
(`flag_grouping.py:73`, `:86`). Over the default 14-day window an employee who is
late most mornings produces **fourteen separate rows**. Meanwhile `counts["people"]`
counts *distinct employees* (`:118-120`), so the toolbar reads "40 people with
something open" above a list of two hundred rows.

Two distinct defects fall out of that:

1. **Volume.** The list is roughly (people × days-with-flags) when HR expects
   roughly (people).
2. **The pattern is invisible.** Five late mornings is a materially different
   situation from one, and it is the thing HR most wants to know — but the five rows
   never sit together, so the fact is unreadable at any scale.

The original spec said "one row per person headlined by their worst flag". The
implementation is faithful to the plan — the plan's `Person` type carries
`attendance_date` — but the effect at a fortnight window is 14× the rows the header
promises.

## The invariant, restated

The current rule is *"a person appears in exactly one entry, ever."* That is not the
property that makes bulk decisions safe. The property that matters is:

> **A flag appears in exactly one entry.**

No flag can then be written twice by two bulk actions, or silently skipped by both.
`groupPayload`'s exclusion already operates per-entry over the members handed to it
(`flagDecisionState.ts`), so it is correct under the per-flag reading without change.

Under the per-flag invariant a person may legitimately appear twice — once in a
"repeatedly late" pattern group holding their four `LATE_START` flags, and once as
their own row holding a three-hour `MISSING_TIME`. Those are two different judgements,
and bundling them forced one decision onto two unrelated things.

## Structure

Two levels in the list; the third lives in the panel that already exists.

```
Repeatedly late — 8 people · 34 mornings          ← pattern group
  ├─ Sokheng Hon  4 late starts · worst 31 min  [also: 1 outlier]
  ├─ Vichea Lim   6 late starts · worst 24 min
  └─ …6 more
Sokheng Hon — Missing time · 3h 12m · Thu 6 Aug   ← individual row
Dara Chan — Did not show up · Mon 3 Aug
```

Selecting a **person inside a pattern group** shows their individual days in the right
panel — no third nesting level in the list. Selecting the **pattern group** offers a
bulk decision across all 34 mornings, with the per-member checkboxes that already
exist.

## Entry taxonomy and precedence

A third group type joins the two that exist. Precedence, first match wins:

| # | Group type | Groups by | Example |
|---|---|---|---|
| 1 | `BRANCH_NO_DEVICE_DATA` | branch + date | "Phnom Penh HQ had no device data on 3 Aug" |
| 2 | `REPEAT_PATTERN` *(new)* | flag code, across dates, per person | "Repeatedly late — 8 people, 34 mornings" |
| 3 | `ROUTINE_CODE` | flag code + date, across people | "168 one-off late starts" |
| 4 | *(none — individual row)* | person | "Sokheng Hon — Missing time 3h 12m" |

`REPEAT_PATTERN` and `ROUTINE_CODE` are complementary rather than overlapping: the
first compresses one person across many days, the second compresses many people on one
day. A repeat offender leaves the one-off pool by precedence, so `ROUTINE_CODE` becomes
"one-off" by construction and its copy should say so.

## What forms a pattern

1. **Same flag code, same person, on 3 or more days** in the window → that person
   qualifies for the pattern group for that code.
2. Fewer than 3 days, or a code they hit only once → individual row.
3. A pattern group forms only when **2 or more people** share it. One person late four
   times is a person row reading "4 late starts", not a group of one.
4. **Only `routine` and `review` tier codes form patterns.** Three no-shows in a
   fortnight is not a pattern to bulk-excuse; it is three things to look at.

Rule 4 is the load-bearing one. Pattern grouping exists to compress the *expected*.
It must never be the mechanism by which something serious disappears into a batch.

> The thresholds in rules 1 and 3 (3 days, 2 people) are judgement, not measurement.
> They should be revisited once there is real usage data — and unlike the identity-key
> question, changing them is free at any time, because nothing is persisted from them.

## The safeguard

A person with flags in more than one entry carries a **cross-reference badge** in every
entry they appear in — *"also: 1 outlier"*, *"also: 2 elsewhere"*.

Without it, C's failure mode is: HR excuses the repeatedly-late group, believes Sokheng
is dealt with, and never sees the three-hour absence. The badge is what makes the
per-flag invariant safe in practice rather than only in principle.

The badge must be derived from the assembled entry set, not from a flag count, so that
it cannot disagree with what is actually on screen.

## Counts

The header and the list must count the same thing. Today they do not.

- `counts.people` stays "distinct employees who still owe HR an answer" — it is the
  honest measure of the workload.
- The header copy gains the shape of the list alongside it, so the two cannot read as
  contradicting each other: *"40 people · 12 rows"* rather than "40 people with
  something open" above 200 rows.
- Group headers state both dimensions where both matter: "8 people · 34 mornings".

## What this does not change

- **`groupPayload` and the bulk-decision safety property.** Per-member exclusion,
  `coveredEmployeeCount`, and the rule that unchecking a member removes *every* one of
  their flags from the payload all carry over unchanged. They operate per entry, which
  is correct under the per-flag invariant.
- **The decision record.** No change to `Attendance Flag Decision`, `flag_identity`, or
  `evidence_fingerprint`. This is a grouping change in a pure module plus its read API.
- **Triage ranks.** `flag_triage.py` is untouched. A pattern group's rank is the
  maximum rank among its members' unresolved flags, so a group cannot outrank a
  genuinely worse individual flag.
- **`BRANCH_NO_DEVICE_DATA`.** Still first in precedence — a device outage explains
  flags regardless of whether the people involved are also repeat offenders.

## Testing

- A person with flags on 5 days appears **once**, not 5 times.
- Every flag appears in exactly one entry — assert over the whole assembled set, since
  this is the invariant that replaced the old one.
- A person in a pattern group who also has an unrelated flag appears in both, and
  **both** entries carry the cross-reference badge.
- An `act`-tier code never forms a pattern group, however many days it spans.
- A pattern of one person does not form a group.
- `counts.people` equals the number of distinct employees across all entries,
  including those inside pattern groups.
- A pattern group's rank equals the max rank among its members' unresolved flags.
- Bulk-decide over a pattern group writes every member's flags for that code and
  nothing else — specifically, not the outlier flag that put them in a second entry.

> `test:web` is a non-recursive per-directory glob; new frontend tests go directly in
> `src/lib/` or `src/ui/`. `flag_grouping` is a pure module with no frappe import —
> keep it that way.

## Out of scope

- The evidence panel redesign — see `2026-08-06-flag-evidence-panel-design.md`.
- Any change to what the engine writes.
- The default window length. Pattern nesting makes a fortnight tractable; changing the
  window is a separate question and should be answered with usage data, not now.
