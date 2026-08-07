# Flag Queue Pattern Nesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flag queue's "a person appears in exactly one entry" rule with "a flag appears in exactly one entry", so a repeat offender collapses from fourteen rows into one pattern group without any flag going missing or being written twice.

**Architecture:** `flag_grouping.build_queue` stops keying entries by `(employee, date)` and instead assigns every *flag* to the first entry that claims it — branch outage, then repeat pattern, then routine code, then a per-person leftover row. Each flag carries its own `attendance_date`, each person carries the `dates` its flags span, and the backend stamps a unique `entry_key` per person so a person appearing in two entries cannot collide in the frontend's selection state. A cross-reference count is stamped from the assembled entry set so the "also 1 outlier" badge cannot disagree with what is on screen.

**Tech Stack:** Python 3 (frappe-free pure module + one whitelisted API), `unittest`; React 19 + TypeScript, `node:test` via `tsx`, TailwindCSS v4.

**Spec:** `docs/superpowers/specs/2026-08-06-flag-queue-pattern-nesting-design.md`

**Companion plan:** `docs/superpowers/plans/2026-08-07-flag-queue-row.md` builds the row that renders these entries. It depends on this plan's `FlagOut.attendance_date` and `QueuePerson.dates`. **Run this plan first.**

## Global Constraints

1. **`flag_grouping.py` stays frappe-free.** No `import frappe`, no queries, no I/O — the module docstring says so and `test_flag_grouping.py` installs no frappe mock. Anything needing a query is passed in by `flag_queue_api`.
2. **`flag_queue_api` keeps a FIXED query count.** Five queries, always: flags, decisions, employees, alerts, sync rows. Adding a sixth that varies with employee or day count is a spec violation, not a slow path.
3. **`test:web` is a NON-RECURSIVE per-directory glob.** The script is
   `tsx --test src/lib/*.test.ts src/brand/*.test.ts src/brand/*.test.tsx src/pwa/*.test.ts src/pwa/*.test.tsx src/components/*.test.tsx src/components/ui/*.test.tsx src/ui/*.test.tsx`.
   A test in `src/lib/` must end `.test.ts` (NOT `.tsx`); a test in `src/ui/` must end `.test.tsx`. A file placed anywhere else, or with the wrong extension, silently never runs and the suite still exits 0.
4. **Baseline: `npm run test:web` reports `ℹ tests 487` on `main`.** Every task that touches the frontend must paste the `ℹ tests N` / `ℹ pass N` / `ℹ fail N` lines in its report. The count only ever goes up. An exit code alone is not evidence.
5. **Run every command from the repo root, and use `python3.13` for Python tests.**
   The Bash working directory persists between calls, so a `cd` into the frontend leaks
   into the next command — `cd "$(git rev-parse --show-toplevel)"` first when unsure.
   This machine's `python3` is **3.9.6**, which cannot import `test_flag_queue_api` at all
   (it pulls in `hooks.py`, whose `str | None` annotations are evaluated at runtime).
   `python3.13` is installed and is the only interpreter these commands work under.
   Baseline: `python3.13 -m unittest dewey_time.tests.test_flag_grouping
   dewey_time.tests.test_flag_queue_api dewey_time.tests.test_flag_triage
   dewey_time.tests.test_flag_identity` reports **`Ran 114 tests` / `OK`**.
6. **`node_modules` is absent from a fresh worktree** and `npm install` returns **401** (the private `@lolbikb/dewey-ui` package needs a `NODE_AUTH_TOKEN`). Before running any frontend command, from `dewey_time/frontend/hr_attendance/`:
   `ln -sfn /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance/node_modules node_modules`
   Never run `npm install` or `npm ci`.
7. **Do not change `severity`, either `FLAG_SEVERITY` dict, or `flag_triage.py`.** Triage ranks are read, never computed here. `tier_for_rank` and `triage_rank` are imported as-is.
8. **No change to `Attendance Flag Decision`, `flag_identity`, or `evidence_fingerprint`.** This is a grouping change in a pure module plus its read API.
9. **`groupPayload` and `remainingIdentities` in `src/lib/flagDecisionState.ts` are not modified.** They operate per entry over the members handed to them, which is already correct under the per-flag invariant.
10. **No HR-facing copy may name a device serial.** No device↔branch registry exists; branch is the finest granularity the data supports.
11. **Exact threshold values, verbatim from the spec:**
    - a pattern needs the same code from the same person on **3 or more distinct dates**;
    - a group of any type needs **2 or more members** — a would-be group of one degrades to a person row;
    - **only `routine` and `review` tier flags** form patterns; an `act`-tier flag never does, however many days it spans.
12. **Built assets are the deployed artifact.** Frappe Cloud never builds this SPA. The final task rebuilds and commits `dewey_time/public/hr_attendance/**` and `dewey_time/www/hr-{attendance,schedule}.html`. A merged PR that changes `frontend/` but not `public/hr_attendance/` ships nothing.
13. **`dewey_time/public/hr_attendance/assets/index-*.css` must be ≥ 150,000 bytes after a build.** Tailwind's `@source` is a filesystem glob; with no `node_modules` it silently emits ~90 kB and exits 0. `scripts/copy-html-entry.mjs` enforces the floor — do not weaken it.

---

## File Structure

| File | Responsibility | This plan |
|---|---|---|
| `dewey_time/attendance_engine/flag_grouping.py` | Pure claim-based entry assembly | **Rewrites `_entries_for`**, adds `_pattern_codes`, `_day_tier`, `_stamp_cross_references`; reshapes `_person` |
| `dewey_time/attendance_engine/flag_queue_api.py` | Batched reads + payload | Recomputes `people`/`rows` when a tier filter is applied |
| `dewey_time/tests/test_flag_grouping.py` | Pure-module tests (27 today) | Extended |
| `dewey_time/tests/test_flag_queue_api.py` | API tests | Extended |
| `src/types/flags.ts` | Wire contract, shared verbatim | `entry_key`, `dates`, `also_count`, `also_outlier_count`, `attendance_date` on `FlagOut`, `REPEAT_PATTERN`, `counts.rows` |
| `src/lib/flagQueueLabels.ts` | **All** HR-facing queue copy | Pattern headline/subline, "one-off", cross-reference badge, header description |
| `src/ui/FlagQueueList.tsx` | The list and its rows | `entryKey` reads `entry_key`; badge on person rows; group subline |
| `src/ui/FlagDecisionPanel.tsx` | Right pane | Per-flag date instead of per-person date; date range in the header |
| `src/ui/FlagQueuePage.tsx` | Page shell, toolbar | Header description gains the row count |
| `src/hooks/useFlagQueue.ts` | Query wrapper | `EMPTY_COUNTS` gains `rows` |

---

## Interface Contract

The shape every task below is written against. Tasks 1–4 produce it; Tasks 5–7 consume it.

```python
# One FlagOut — gains attendance_date (Task 1)
{
    "flag_identity": str,
    "flag_code": str,
    "attendance_date": str,     # NEW — "YYYY-MM-DD"
    "severity": str | None,
    "day_closed": int,
    "evidence": dict,
    "rank": int,
    "tier": "act" | "review" | "routine",
    "decision_state": "undecided" | "matched" | "needs_re_review",
    "decision": dict | None,
}

# One Person — an employee and the flags of theirs that landed in ONE entry
{
    "entry_key": str,           # NEW — "p:<employee>" or "<group_key>|p:<employee>"
    "employee": str,
    "employee_name": str,
    "employee_branch": str | None,
    "attendance_date": str,     # the worst unresolved flag's date
    "dates": list[str],         # NEW — sorted distinct dates of THIS entry's flags
    "rank": int,
    "tier": str,
    "flags": list[FlagOut],     # worst-first
    "undecided_count": int,
    "also_count": int,          # NEW — other entries this person also appears in
    "also_outlier_count": int,  # NEW — how many of those are lone person rows
}

# counts — gains rows
{"open": int, "needs_re_review": int, "decided": int, "people": int, "rows": int}

# group_type — gains REPEAT_PATTERN
"BRANCH_NO_DEVICE_DATA" | "REPEAT_PATTERN" | "ROUTINE_CODE"
# A REPEAT_PATTERN group has branch=None and attendance_date=None; it spans dates.
```

---

### Task 1: FlagOut carries its own date; Person becomes a span

The foundation for everything else: once an entry can span dates, a flag has to say which
date it is on, and a person has to say which dates its flags cover. This task changes only
shape — the same entries come out as before.

**Files:**
- Modify: `dewey_time/attendance_engine/flag_grouping.py:142-196` (`_flag_out`, `_person`)
- Modify: `dewey_time/attendance_engine/flag_grouping.py:95-111` (the person-day loop in `build_queue`)
- Modify: `dewey_time/attendance_engine/flag_grouping.py:206-282` (`_entries_for` call sites)
- Test: `dewey_time/tests/test_flag_grouping.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `_flag_out()` returns a dict with `"attendance_date"`. `_person(employee, person_flags, employees_by_id, *, entry_key)` — note the signature drops the positional `date_str` and gains a keyword-only `entry_key`. Persons gain `"dates": list[str]` and `"entry_key": str`.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_flag_grouping.py`:

```python
class FlagDateTests(unittest.TestCase):
    def test_each_flag_carries_its_own_date(self):
        flag = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})
        result = build_queue(
            flags=[flag],
            decisions_by_identity={},
            employees_by_id={"EMP-1": {"employee_name": "Sokheng Hon", "branch": "HQ"}},
            outage_branch_dates=set(),
        )
        person = result["entries"][0]
        self.assertEqual(person["flags"][0]["attendance_date"], DATE)

    def test_flag_date_is_normalised_from_a_date_object(self):
        flag = _flag("EMP-1", date(2026, 8, 3), "LATE_START", evidence={"minutes": 9})
        result = build_queue(
            flags=[flag],
            decisions_by_identity={},
            employees_by_id={},
            outage_branch_dates=set(),
        )
        self.assertEqual(result["entries"][0]["flags"][0]["attendance_date"], "2026-08-03")

    def test_person_dates_lists_every_date_its_flags_fall_on(self):
        # One person, one code, two days — too few days to form a pattern, so this
        # stays a single person entry and proves `dates` spans what the entry holds.
        flags = [
            _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-1", DATE2, "LATE_START", evidence={"minutes": 11}),
        ]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id={"EMP-1": {"employee_name": "Sokheng Hon", "branch": "HQ"}},
            outage_branch_dates=set(),
        )
        entries = result["entries"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["dates"], [DATE, DATE2])

    def test_person_attendance_date_is_the_worst_unresolved_flags_date(self):
        # A 3-hour gap on DATE2 outranks a 9-minute late start on DATE, so the
        # person's headline date is DATE2 even though DATE sorts first.
        flags = [
            _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-1", DATE2, "MISSING_TIME", evidence={"minutes": 192}),
        ]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id={"EMP-1": {"employee_name": "Sokheng Hon", "branch": "HQ"}},
            outage_branch_dates=set(),
        )
        self.assertEqual(result["entries"][0]["attendance_date"], DATE2)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from the repo root:
```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping.FlagDateTests -v
```
Expected: FAIL — `KeyError: 'attendance_date'` on the two FlagOut assertions and
`KeyError: 'dates'` on `test_person_dates_lists_every_date_its_flags_fall_on`.
`test_person_attendance_date_is_the_worst_unresolved_flags_date` fails on the same
`KeyError` reaching `_flag_out`'s output, not on the date itself.

- [ ] **Step 3: Add `attendance_date` to `_flag_out`**

In `flag_grouping.py`, replace the return of `_flag_out` (currently `:159-169`) with:

```python
    return {
        "flag_identity": identity,
        "flag_code": flag.get("flag_code"),
        # The flag's OWN date. It used to live only on the person entry, because
        # an entry WAS a person-day; once an entry spans dates (a repeat pattern,
        # or a person's leftover flags) the person can no longer answer "when"
        # for each flag it holds.
        "attendance_date": _date_str(flag.get("attendance_date")),
        "severity": flag.get("severity"),
        "day_closed": int(flag.get("day_closed") or 0),
        "evidence": evidence,
        "rank": rank,
        "tier": tier_for_rank(rank),
        "decision_state": state,
        "decision": decision,
    }
```

- [ ] **Step 4: Reshape `_person` into a span**

Replace `_person` (currently `:172-196`) in full:

```python
def _person(employee: str, person_flags: list[dict], employees_by_id: dict, *, entry_key: str) -> dict:
    """One Person: an employee and the flags of theirs that landed in ONE entry.

    `person_flags` must already be worst-first. Under the per-flag invariant a
    person may legitimately appear in more than one entry, so this no longer
    stands for a person-DAY: `dates` is every date the flags in THIS entry fall
    on, and `attendance_date` is the worst unresolved flag's date — kept because
    the panel and the list still show a single headline day.

    `entry_key` is stamped by the caller rather than derived here: it has to be
    unique across the whole assembled set, and only the assembler knows whether
    this person is a lone row or a member of a particular group.
    """
    meta = employees_by_id.get(employee) or {}
    unresolved = [f for f in person_flags if f["decision_state"] in UNRESOLVED_STATES]
    # `default=0` is what a fully settled person ranks — reachable only under
    # include_decided, and correct: they sink to the foot of a worst-first queue
    # because they are not work, they are a record to correct if HR got it wrong.
    rank = max((f["rank"] for f in unresolved), default=0)
    # Worst unresolved first; a fully settled person falls back to their worst
    # flag overall so the headline date is never blank.
    top = unresolved[0] if unresolved else (person_flags[0] if person_flags else None)
    return {
        "entry_key": entry_key,
        "employee": employee,
        # An Employee row can be missing from the batch (deleted, or outside the
        # employee query's filters). Show the id rather than dropping someone who
        # still owes HR a decision.
        "employee_name": meta.get("employee_name") or employee,
        "employee_branch": meta.get("branch"),
        "attendance_date": top["attendance_date"] if top else None,
        "dates": sorted({f["attendance_date"] for f in person_flags}),
        # Rank and tier come from the worst *unresolved* flag only: a decided
        # absence must not keep its person out of tomorrow's routine group.
        "rank": rank,
        "tier": tier_for_rank(rank),
        "flags": person_flags,
        "undecided_count": len(unresolved),
        # Stamped after assembly by _stamp_cross_references (Task 4) — a badge
        # derived from the entry set cannot be computed before that set exists.
        "also_count": 0,
        "also_outlier_count": 0,
    }
```

- [ ] **Step 5: Adapt `build_queue`'s call to the new `_person` signature**

`_entries_for` is NOT touched in this task — Task 3 rewrites it. Here `build_queue` only
has to hand `_person` its new arguments. Replace the `persons` loop (`:95-111`) with:

```python
    persons = []
    for (employee, date_str), bucket in by_person.items():
        person_flags = sorted(bucket.values(), key=_flag_sort_key)
        for flag_out in person_flags:
            if flag_out["decision_state"] == STATE_UNDECIDED:
                counts["open"] += 1
            elif flag_out["decision_state"] == STATE_NEEDS_RE_REVIEW:
                counts["needs_re_review"] += 1
            else:
                counts["decided"] += 1
        # Still one Person per person-DAY here; Task 3 is what merges a person's
        # days into one entry. The key carries the date for exactly that reason.
        person = _person(
            employee,
            person_flags,
            employees_by_id,
            entry_key="p:{0}:{1}".format(employee, date_str),
        )
        # A person leaves the queue only once every flag of theirs is settled —
        # unless the caller asked for the settled ones back, which is what makes
        # an applied decision reachable for replacement.
        if person["undecided_count"] or include_decided:
            persons.append(person)
```

- [ ] **Step 6: Scope group members' keys to their group**

In `_entries_for`'s assembly loop, immediately after the existing
`members = sorted(group["members"], key=_member_sort_key)` (`:263`), add:

```python
            # Group-scoped: the same employee can be a member here AND hold a lone
            # entry of their own once Task 3 lands, and two entries under one key
            # would make selecting the outlier select the group member instead.
            for member in members:
                member["entry_key"] = "{0}|p:{1}".format(key, member["employee"])
```

Then replace `_entry_sort_key`'s person branch (`:327`) — `entry_key` is unique by
construction, so it is a better stable tie-break than the employee/date pair it replaces:

```python
    return (-entry["rank"], -1, entry["entry_key"])
```

- [ ] **Step 7: Run the new tests and the whole module**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping -v
```
Expected: PASS — **except** `test_person_dates_lists_every_date_its_flags_fall_on`, which
asserts one entry spanning two days and still gets two entries, because entries are still
person-days until Task 3. **Mark that one test — and only that one —
`@unittest.expectedFailure` with the comment
`# Task 3 merges a person's leftover days into one entry.`** Task 3 removes the decorator.

Every other test, new and pre-existing, must pass. If a pre-existing test fails, **do not
edit it to match** — report it as a finding with the test name and its assertion. Report
the `Ran N tests` line (it prints expected failures separately).

- [ ] **Step 8: Commit**

```bash
git add dewey_time/attendance_engine/flag_grouping.py dewey_time/tests/test_flag_grouping.py
git commit -m "refactor(flag-queue): flags carry their own date, persons carry a date span"
```

---

### Task 2: Pattern detection

Which `(employee, flag_code)` pairs qualify as a repeat pattern, and which codes have
enough people to become a group. A pure helper with no side effects, so the three
thresholds are testable in isolation before anything is restructured around them.

**Files:**
- Modify: `dewey_time/attendance_engine/flag_grouping.py` (module constants; new `_is_pattern_flag`, `_pattern_codes`, `_day_tier`)
- Test: `dewey_time/tests/test_flag_grouping.py`

**Interfaces:**
- Consumes: Task 1's `FlagOut["attendance_date"]`.
- Produces:
  - `_is_pattern_flag(flag_out) -> bool`
  - `_pattern_codes(person_days: list[dict]) -> dict[str, set[str]]` — flag_code → the employees who qualify for it, containing only codes with enough qualifying employees to form a group.
  - `_day_tier(person_flags: list[dict]) -> str`
  - constants `GROUP_REPEAT_PATTERN`, `PATTERN_MIN_DAYS`, `PATTERN_TIERS`

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_flag_grouping.py`:

```python
from dewey_time.attendance_engine.flag_grouping import _pattern_codes  # add to the imports at the top


def _days(employee, code, dates, *, evidence=None):
    """person_day dicts for one employee hitting one code on several dates."""
    return [
        {
            "employee": employee,
            "date": d,
            "flags": [_flag_out_for(_flag(employee, d, code, evidence=evidence or {}))],
        }
        for d in dates
    ]


def _flag_out_for(flag):
    from dewey_time.attendance_engine.flag_grouping import _flag_out

    return _flag_out(flag, {})


D1, D2, D3, D4 = "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"


class PatternDetectionTests(unittest.TestCase):
    def test_three_days_two_people_qualifies(self):
        person_days = (
            _days("EMP-1", "LATE_START", [D1, D2, D3], evidence={"minutes": 9})
            + _days("EMP-2", "LATE_START", [D1, D2, D3], evidence={"minutes": 12})
        )
        self.assertEqual(_pattern_codes(person_days), {"LATE_START": {"EMP-1", "EMP-2"}})

    def test_two_days_is_not_a_pattern(self):
        person_days = (
            _days("EMP-1", "LATE_START", [D1, D2], evidence={"minutes": 9})
            + _days("EMP-2", "LATE_START", [D1, D2], evidence={"minutes": 12})
        )
        self.assertEqual(_pattern_codes(person_days), {})

    def test_one_person_alone_does_not_form_a_group(self):
        person_days = _days("EMP-1", "LATE_START", [D1, D2, D3, D4], evidence={"minutes": 9})
        self.assertEqual(_pattern_codes(person_days), {})

    def test_an_act_tier_flag_never_forms_a_pattern(self):
        # UNNOTIFIED_ABSENCE ranks 150 -> act. Four no-shows each for two people is
        # four things to look at, not a batch to excuse. Spec rule 4.
        person_days = (
            _days("EMP-1", "UNNOTIFIED_ABSENCE", [D1, D2, D3, D4])
            + _days("EMP-2", "UNNOTIFIED_ABSENCE", [D1, D2, D3, D4])
        )
        self.assertEqual(_pattern_codes(person_days), {})

    def test_a_review_tier_flag_does_form_a_pattern(self):
        # MISSING_TIME under 120 min ranks 60 -> review, which is pattern-eligible.
        person_days = (
            _days("EMP-1", "MISSING_TIME", [D1, D2, D3], evidence={"minutes": 45})
            + _days("EMP-2", "MISSING_TIME", [D1, D2, D3], evidence={"minutes": 50})
        )
        self.assertEqual(_pattern_codes(person_days), {"MISSING_TIME": {"EMP-1", "EMP-2"}})

    def test_act_tier_days_do_not_count_toward_a_pattern_of_the_same_code(self):
        # Same code, but only the review-tier days count. EMP-1 has two review-tier
        # MISSING_TIME days and one act-tier (3h) day: two days is not a pattern.
        person_days = (
            _days("EMP-1", "MISSING_TIME", [D1, D2], evidence={"minutes": 45})
            + _days("EMP-1", "MISSING_TIME", [D3], evidence={"minutes": 192})
            + _days("EMP-2", "MISSING_TIME", [D1, D2, D3], evidence={"minutes": 45})
        )
        self.assertEqual(_pattern_codes(person_days), {})

    def test_a_decided_flag_does_not_count_toward_a_pattern(self):
        person_days = _days("EMP-1", "LATE_START", [D1, D2, D3], evidence={"minutes": 9})
        for pd in person_days:
            pd["flags"][0]["decision_state"] = "matched"
        person_days += _days("EMP-2", "LATE_START", [D1, D2, D3], evidence={"minutes": 12})
        self.assertEqual(_pattern_codes(person_days), {})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping.PatternDetectionTests -v
```
Expected: FAIL at import — `ImportError: cannot import name '_pattern_codes'`.

- [ ] **Step 3: Add the constants**

In `flag_grouping.py`, beside the existing group-type constants (`:22-23`):

```python
GROUP_BRANCH_NO_DEVICE_DATA = "BRANCH_NO_DEVICE_DATA"
GROUP_REPEAT_PATTERN = "REPEAT_PATTERN"
GROUP_ROUTINE_CODE = "ROUTINE_CODE"
```

Extend the `flag_triage` import (`:20`) to bring in the review tier:

```python
from dewey_time.attendance_engine.flag_triage import (
    TIER_REVIEW,
    TIER_ROUTINE,
    tier_for_rank,
    triage_rank,
)
```

And after `GROUP_MIN_MEMBERS` (`:40`):

```python
# The same code from the same person on this many distinct dates is a pattern.
# Judgement, not measurement (spec) — but nothing is persisted from it, so
# changing it later is free.
PATTERN_MIN_DAYS = 3

# Only the expected compresses. An act-tier flag is never bulk-excusable as a
# habit: "three no-shows in a fortnight is not a pattern to bulk-excuse; it is
# three things to look at". This is the load-bearing rule of the whole feature —
# pattern grouping must never be the mechanism by which something serious
# disappears into a batch.
PATTERN_TIERS = (TIER_ROUTINE, TIER_REVIEW)
```

Note there is deliberately no `PATTERN_MIN_PEOPLE` constant: "a pattern group forms only
when 2 or more people share it" is the same rule as `GROUP_MIN_MEMBERS`, and two names for
one number is how the two drift apart.

- [ ] **Step 4: Write the helpers**

Add below `_person`:

```python
def _is_pattern_flag(flag_out: dict) -> bool:
    """Can this flag be compressed into a repeat pattern?

    Unresolved, because a decided flag is not work; and routine or review tier
    only, because the pattern group's whole purpose is a bulk decision.
    """
    return (
        flag_out["decision_state"] in UNRESOLVED_STATES
        and flag_out["tier"] in PATTERN_TIERS
    )


def _pattern_codes(person_days: list[dict]) -> dict[str, set[str]]:
    """flag_code -> the employees who hit it on PATTERN_MIN_DAYS or more dates.

    Codes with fewer than GROUP_MIN_MEMBERS qualifying employees are dropped
    here rather than downstream, so "one person late four times" never reaches
    the assembler as a would-be group: it stays a person row reading
    "4 late starts".
    """
    dates_by_pair: dict[tuple[str, str], set[str]] = {}
    for person_day in person_days:
        for flag_out in person_day["flags"]:
            if not _is_pattern_flag(flag_out):
                continue
            key = (person_day["employee"], flag_out["flag_code"])
            dates_by_pair.setdefault(key, set()).add(person_day["date"])

    by_code: dict[str, set[str]] = {}
    for (employee, code), dates in dates_by_pair.items():
        if len(dates) >= PATTERN_MIN_DAYS:
            by_code.setdefault(code, set()).add(employee)

    return {code: employees for code, employees in by_code.items() if len(employees) >= GROUP_MIN_MEMBERS}


def _day_tier(person_flags: list[dict]) -> str:
    """Tier of the worst unresolved flag on a person-day — the ROUTINE_CODE guard.

    Computed over the WHOLE day, before pattern claiming removes anything from
    it, so the group's "and nothing else wrong that day" stays true: that clause
    is about how bad the day was, not about which entry each flag ended up in.
    """
    ranks = [f["rank"] for f in person_flags if f["decision_state"] in UNRESOLVED_STATES]
    return tier_for_rank(max(ranks, default=0))
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping -v
```
Expected: PASS for `PatternDetectionTests`; the Task 1 `expectedFailure` still reports as
an expected failure; everything else passes. Report the `Ran N tests` line.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/attendance_engine/flag_grouping.py dewey_time/tests/test_flag_grouping.py
git commit -m "feat(flag-queue): detect repeat patterns — 3 days, 2 people, routine or review only"
```

---

### Task 3: Claim-based assembly with REPEAT_PATTERN

The core of the plan. Every flag is claimed by exactly one entry, first claim wins, and
what is left over per person becomes one row rather than one row per day.

**Files:**
- Modify: `dewey_time/attendance_engine/flag_grouping.py` (`_entries_for` rewritten in full; module docstring)
- Test: `dewey_time/tests/test_flag_grouping.py`

**Interfaces:**
- Consumes: Task 1's `_person(..., entry_key=)` and `FlagOut["attendance_date"]`; Task 2's `_pattern_codes`, `_is_pattern_flag`, `_day_tier`, `GROUP_REPEAT_PATTERN`.
- Produces: `_entries_for(person_days, employees_by_id, outage_branch_dates) -> list[dict]` where every entry's persons carry a unique `entry_key`, and a `REPEAT_PATTERN` group has `branch=None`, `attendance_date=None`, `flag_code=<the code>`.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_flag_grouping.py`:

```python
def _emps(*ids):
    return {e: {"employee_name": "Name {0}".format(e), "branch": "HQ"} for e in ids}


def _entries_by_kind(result, group_type=None):
    out = []
    for entry in result["entries"]:
        if group_type is None:
            out.append(entry)
        elif entry["kind"] == "group" and entry["group_type"] == group_type:
            out.append(entry)
    return out


class RepeatPatternTests(unittest.TestCase):
    def _late_pattern(self):
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3):
                flags.append(_flag(employee, d, "LATE_START", evidence={"minutes": 9}))
        return flags

    def test_a_person_with_flags_on_five_days_appears_once(self):
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3, D4, "2026-08-07"):
                flags.append(_flag(employee, d, "LATE_START", evidence={"minutes": 9}))
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        appearances = [
            person
            for person in _iter_all_people(result["entries"])
            if person["employee"] == "EMP-1"
        ]
        self.assertEqual(len(appearances), 1)
        self.assertEqual(len(appearances[0]["flags"]), 5)

    def test_every_flag_appears_in_exactly_one_entry(self):
        # The invariant that replaced "a person appears once". Asserted over the
        # whole assembled set, not per entry.
        flags = self._late_pattern() + [
            _flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192}),
            _flag("EMP-3", D1, "UNNOTIFIED_ABSENCE"),
        ]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2", "EMP-3"),
            outage_branch_dates=set(),
        )
        seen = []
        for person in _iter_all_people(result["entries"]):
            seen.extend(f["flag_identity"] for f in person["flags"])
        self.assertEqual(len(seen), len(flags))
        self.assertEqual(len(set(seen)), len(flags))

    def test_a_pattern_group_holds_the_patterned_code_only(self):
        flags = self._late_pattern() + [_flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192})]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        groups = _entries_by_kind(result, "REPEAT_PATTERN")
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["flag_code"], "LATE_START")
        self.assertIsNone(groups[0]["attendance_date"])
        self.assertIsNone(groups[0]["branch"])
        codes = {f["flag_code"] for m in groups[0]["members"] for f in m["flags"]}
        self.assertEqual(codes, {"LATE_START"})

    def test_the_outlier_becomes_its_own_person_entry(self):
        flags = self._late_pattern() + [_flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192})]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        loners = [e for e in result["entries"] if e["kind"] == "person"]
        self.assertEqual(len(loners), 1)
        self.assertEqual(loners[0]["employee"], "EMP-1")
        self.assertEqual([f["flag_code"] for f in loners[0]["flags"]], ["MISSING_TIME"])

    def test_a_pattern_group_ranks_at_its_worst_members_rank(self):
        flags = self._late_pattern()
        # EMP-2's third late start is 90 minutes -> rank 65, above the 20s.
        flags[-1] = _flag("EMP-2", D3, "LATE_START", evidence={"minutes": 90})
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        group = _entries_by_kind(result, "REPEAT_PATTERN")[0]
        self.assertEqual(group["rank"], 65)
        self.assertEqual(group["tier"], "review")

    def test_a_branch_outage_claims_the_day_ahead_of_a_pattern(self):
        # Precedence 1 beats precedence 2: a device outage explains the flags
        # regardless of whether the people involved are also repeat offenders.
        flags = self._late_pattern()
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates={("HQ", D1)},
        )
        branch_groups = _entries_by_kind(result, "BRANCH_NO_DEVICE_DATA")
        self.assertEqual(len(branch_groups), 1)
        dates = {f["attendance_date"] for m in branch_groups[0]["members"] for f in m["flags"]}
        self.assertEqual(dates, {D1})
        # D1 is gone, so only D2 and D3 remain — two days, no longer a pattern.
        self.assertEqual(_entries_by_kind(result, "REPEAT_PATTERN"), [])

    def test_one_person_late_four_times_is_a_person_row_not_a_group(self):
        flags = [_flag("EMP-1", d, "LATE_START", evidence={"minutes": 9}) for d in (D1, D2, D3, D4)]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1"),
            outage_branch_dates=set(),
        )
        self.assertEqual(_entries_by_kind(result, "REPEAT_PATTERN"), [])
        self.assertEqual(len(result["entries"]), 1)
        self.assertEqual(len(result["entries"][0]["flags"]), 4)

    def test_entry_keys_are_unique_across_the_assembled_set(self):
        flags = self._late_pattern() + [_flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192})]
        result = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )
        keys = [p["entry_key"] for p in _iter_all_people(result["entries"])]
        self.assertEqual(len(keys), len(set(keys)))
        # EMP-1 is in two entries and must not collide with themselves.
        emp1 = sorted(p["entry_key"] for p in _iter_all_people(result["entries"]) if p["employee"] == "EMP-1")
        self.assertEqual(emp1, ["REPEAT_PATTERN:LATE_START|p:EMP-1", "p:EMP-1"])
```

And this module-level helper, beside `_flag`:

```python
def _iter_all_people(entries):
    for entry in entries:
        if entry["kind"] == "group":
            for member in entry["members"]:
                yield member
        else:
            yield entry
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping.RepeatPatternTests -v
```
Expected: FAIL — no `REPEAT_PATTERN` entries exist yet, so `_entries_by_kind(result, "REPEAT_PATTERN")` is `[]` and `groups[0]` raises `IndexError`; `test_a_person_with_flags_on_five_days_appears_once` finds 5 appearances.

- [ ] **Step 3: `build_queue` hands over person-days, not Persons**

`_entries_for` now builds its own Persons, because only it knows which entry each set of
flags lands in and therefore what `entry_key` to stamp. Replace the `persons` loop Task 1
left in `build_queue` with:

```python
    person_days = []
    for (employee, date_str), bucket in by_person.items():
        person_flags = sorted(bucket.values(), key=_flag_sort_key)
        for flag_out in person_flags:
            if flag_out["decision_state"] == STATE_UNDECIDED:
                counts["open"] += 1
            elif flag_out["decision_state"] == STATE_NEEDS_RE_REVIEW:
                counts["needs_re_review"] += 1
            else:
                counts["decided"] += 1
        # A day leaves the queue only once every flag on it is settled — unless
        # the caller asked for the settled ones back, which is what makes an
        # applied decision reachable for replacement.
        unresolved = any(f["decision_state"] in UNRESOLVED_STATES for f in person_flags)
        if unresolved or include_decided:
            person_days.append({"employee": employee, "date": date_str, "flags": person_flags})

    entries = _entries_for(person_days, employees_by_id, outage_branch_dates)
```

- [ ] **Step 4: Rewrite `_entries_for`**

Replace `_entries_for` in full:

```python
def _entries_for(
    person_days: list[dict],
    employees_by_id: dict,
    outage_branch_dates: set,
) -> list[dict]:
    """Assign every flag to exactly one entry. First claim wins.

    Precedence, per the spec's taxonomy table:
      1. BRANCH_NO_DEVICE_DATA — branch + date, claims the whole day
      2. REPEAT_PATTERN        — flag code, one person across >= PATTERN_MIN_DAYS dates
      3. ROUTINE_CODE          — flag code + date, across people
      4. (none)                — everything left, one entry per person

    The invariant this guarantees is "a flag appears in exactly one entry", NOT
    "a person appears in exactly one entry". A person may legitimately appear
    twice — once in a pattern group holding their four late starts, once as
    their own row holding a three-hour gap — because those are two different
    judgements and bundling them forced one decision onto two unrelated things.
    """
    branch_groups: dict[str, dict] = {}
    unclaimed_days: list[dict] = []

    # --- 1. A device outage claims the whole day, before anything else looks at it.
    for person_day in person_days:
        branch = (employees_by_id.get(person_day["employee"]) or {}).get("branch")
        if branch and (branch, person_day["date"]) in outage_branch_dates:
            key = "{0}:{1}:{2}".format(GROUP_BRANCH_NO_DEVICE_DATA, branch, person_day["date"])
            group = branch_groups.setdefault(
                key,
                {
                    "group_type": GROUP_BRANCH_NO_DEVICE_DATA,
                    "group_key": key,
                    "branch": branch,
                    "flag_code": None,
                    "attendance_date": person_day["date"],
                    "by_employee": {},
                },
            )
            group["by_employee"].setdefault(person_day["employee"], []).extend(person_day["flags"])
            continue
        unclaimed_days.append(person_day)

    # --- 2. Repeat patterns, computed over what the outage groups left behind.
    pattern_codes = _pattern_codes(unclaimed_days)
    pattern_groups: dict[str, dict] = {}
    leftover_days: list[dict] = []

    for person_day in unclaimed_days:
        # Over the WHOLE day, before pattern claiming removes anything — see _day_tier.
        day_tier = _day_tier(person_day["flags"])
        kept: list[dict] = []
        for flag_out in person_day["flags"]:
            code = flag_out["flag_code"]
            if _is_pattern_flag(flag_out) and person_day["employee"] in pattern_codes.get(code, ()):
                key = "{0}:{1}".format(GROUP_REPEAT_PATTERN, code)
                group = pattern_groups.setdefault(
                    key,
                    {
                        "group_type": GROUP_REPEAT_PATTERN,
                        "group_key": key,
                        "branch": None,
                        # A pattern spans dates by definition, so it has no single
                        # one. Consumers must read the members' `dates` instead.
                        "attendance_date": None,
                        "flag_code": code,
                        "by_employee": {},
                    },
                )
                group["by_employee"].setdefault(person_day["employee"], []).append(flag_out)
            else:
                kept.append(flag_out)
        if kept:
            leftover_days.append({**person_day, "flags": kept, "day_tier": day_tier})

    # --- 3. Routine code groups over what is still unclaimed.
    routine_groups: dict[str, dict] = {}
    leftover_by_employee: dict[str, list[dict]] = {}

    for person_day in leftover_days:
        top = _top_unresolved(person_day["flags"])
        # Keyed off the worst REMAINING unresolved flag, so the group is always
        # named after something it actually contains — but guarded on the whole
        # day's tier, so "nothing else wrong that day" stays true. `top` is None
        # for a fully settled leftover day (only reachable under include_decided):
        # a cause group is a bulk-decide affordance and there is nothing of
        # theirs to bulk-decide, so they fall through to a person entry.
        if top is not None and person_day["day_tier"] == TIER_ROUTINE:
            key = "{0}:{1}:{2}".format(GROUP_ROUTINE_CODE, top["flag_code"], person_day["date"])
            group = routine_groups.setdefault(
                key,
                {
                    "group_type": GROUP_ROUTINE_CODE,
                    "group_key": key,
                    "branch": None,
                    "flag_code": top["flag_code"],
                    "attendance_date": person_day["date"],
                    "by_employee": {},
                },
            )
            group["by_employee"].setdefault(person_day["employee"], []).extend(person_day["flags"])
            continue
        leftover_by_employee.setdefault(person_day["employee"], []).extend(person_day["flags"])

    # --- 4. Assemble. A group of one degrades back to its member's leftovers.
    entries: list[dict] = []
    for holder in (branch_groups, pattern_groups, routine_groups):
        for group in holder.values():
            if len(group["by_employee"]) < GROUP_MIN_MEMBERS:
                for employee, flags in group["by_employee"].items():
                    leftover_by_employee.setdefault(employee, []).extend(flags)
                continue
            members = [
                _person(
                    employee,
                    sorted(flags, key=_flag_sort_key),
                    employees_by_id,
                    entry_key="{0}|p:{1}".format(group["group_key"], employee),
                )
                for employee, flags in group["by_employee"].items()
            ]
            members.sort(key=_member_sort_key)
            rank = max(member["rank"] for member in members)
            entries.append(
                {
                    "kind": "group",
                    "group_type": group["group_type"],
                    "group_key": group["group_key"],
                    "branch": group["branch"],
                    "flag_code": group["flag_code"],
                    "attendance_date": group["attendance_date"],
                    "rank": rank,
                    "tier": tier_for_rank(rank),
                    "members": members,
                }
            )

    for employee, flags in leftover_by_employee.items():
        person = _person(
            employee,
            sorted(flags, key=_flag_sort_key),
            employees_by_id,
            entry_key="p:{0}".format(employee),
        )
        entries.append({"kind": "person", **person})

    return entries
```

Change `_top_unresolved` (`:199-203`) to take a flag list rather than a person, since it is
now called before a Person exists:

```python
def _top_unresolved(person_flags: list[dict]) -> dict | None:
    for flag_out in person_flags:  # already worst-first
        if flag_out["decision_state"] in UNRESOLVED_STATES:
            return flag_out
    return None
```

- [ ] **Step 5: Update the module docstring**

The docstring at `:1-11` states the old invariant ("a person-day appears in exactly one
entry"). Replace that sentence with:

```
lets the invariant this module exists to guarantee — a FLAG appears in exactly
one entry — be tested without a bench. A person may appear in more than one:
see `_entries_for`.
```

- [ ] **Step 6: Remove Task 1's `expectedFailure`**

Delete the `@unittest.expectedFailure` decorator and its comment from
`test_person_dates_lists_every_date_its_flags_fall_on`.

- [ ] **Step 7: Run the whole module**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping -v
```
Expected: PASS, with no expected-failures remaining. If any of the 27 pre-existing tests
now fails, **do not edit it to match** — report it as a finding with the test name and its
assertion. A pre-existing test failing here means the restructure changed behaviour the
spec said it would not.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/attendance_engine/flag_grouping.py dewey_time/tests/test_flag_grouping.py
git commit -m "feat(flag-queue): a flag appears in exactly one entry, with REPEAT_PATTERN groups"
```

---

### Task 4: Cross-reference badges and the row count

The safeguard. Without it, HR excuses the repeatedly-late group, believes Sokheng is dealt
with, and never sees the three-hour absence.

**Files:**
- Modify: `dewey_time/attendance_engine/flag_grouping.py` (`build_queue` tail; new `_stamp_cross_references`)
- Test: `dewey_time/tests/test_flag_grouping.py`

**Interfaces:**
- Consumes: Task 3's assembled `entries`.
- Produces: every person carries `also_count` (other entries they appear in) and `also_outlier_count` (how many of those are lone person rows); `counts["rows"]`.

- [ ] **Step 1: Write the failing tests**

```python
class CrossReferenceTests(unittest.TestCase):
    def _split_person(self):
        flags = []
        for employee in ("EMP-1", "EMP-2"):
            for d in (D1, D2, D3):
                flags.append(_flag(employee, d, "LATE_START", evidence={"minutes": 9}))
        flags.append(_flag("EMP-1", D4, "MISSING_TIME", evidence={"minutes": 192}))
        return build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_emps("EMP-1", "EMP-2"),
            outage_branch_dates=set(),
        )

    def test_a_person_in_two_entries_is_badged_in_both(self):
        result = self._split_person()
        appearances = [p for p in _iter_all_people(result["entries"]) if p["employee"] == "EMP-1"]
        self.assertEqual(len(appearances), 2)
        for person in appearances:
            self.assertEqual(person["also_count"], 1)

    def test_the_group_member_names_the_other_entry_as_an_outlier(self):
        result = self._split_person()
        member = next(
            p for p in _iter_all_people(result["entries"])
            if p["employee"] == "EMP-1" and p["entry_key"].startswith("REPEAT_PATTERN")
        )
        # The other entry is a lone person row — an outlier by construction.
        self.assertEqual(member["also_outlier_count"], 1)

    def test_the_outlier_row_does_not_count_itself(self):
        result = self._split_person()
        loner = next(
            p for p in _iter_all_people(result["entries"])
            if p["employee"] == "EMP-1" and p["entry_key"] == "p:EMP-1"
        )
        self.assertEqual(loner["also_count"], 1)
        # The OTHER entry is a group, not an outlier.
        self.assertEqual(loner["also_outlier_count"], 0)

    def test_a_person_in_one_entry_is_not_badged(self):
        result = self._split_person()
        emp2 = next(p for p in _iter_all_people(result["entries"]) if p["employee"] == "EMP-2")
        self.assertEqual(emp2["also_count"], 0)
        self.assertEqual(emp2["also_outlier_count"], 0)

    def test_counts_rows_equals_the_number_of_entries(self):
        result = self._split_person()
        self.assertEqual(result["counts"]["rows"], len(result["entries"]))
        self.assertEqual(result["counts"]["rows"], 2)

    def test_counts_people_counts_distinct_employees_including_group_members(self):
        result = self._split_person()
        self.assertEqual(result["counts"]["people"], 2)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping.CrossReferenceTests -v
```
Expected: FAIL — `also_count` is 0 everywhere (Task 1 stamps zeros), and
`counts["rows"]` raises `KeyError`.

- [ ] **Step 3: Write the stamper**

Add below `_entries_for`:

```python
def _stamp_cross_references(entries: list[dict]) -> None:
    """Badge every person who appears in more than one entry, in all of them.

    Derived from the ASSEMBLED entry set rather than from a flag count, so the
    badge cannot disagree with what is actually on screen. This is what makes
    the per-flag invariant safe in practice rather than only in principle: the
    failure mode it prevents is HR excusing the repeatedly-late group, believing
    a person is dealt with, and never seeing their three-hour absence.

    Mutates in place. A person entry is `{"kind": "person", **person}` — a fresh
    dict built by _entries_for — so writing to it writes to what is returned.
    """
    appearances: dict[str, list[tuple[dict, str]]] = {}
    for entry in entries:
        people = entry["members"] if entry["kind"] == "group" else [entry]
        for person in people:
            appearances.setdefault(person["employee"], []).append((person, entry["kind"]))

    for places in appearances.values():
        if len(places) < 2:
            continue
        loners = sum(1 for _, kind in places if kind == "person")
        for person, kind in places:
            person["also_count"] = len(places) - 1
            # How many of the OTHER entries are lone person rows. An entry that
            # holds one person's leftovers is an outlier by construction — a flag
            # that fitted no pattern — which is what lets the copy say "also 1
            # outlier" rather than the vaguer "also 1 elsewhere".
            person["also_outlier_count"] = loners - (1 if kind == "person" else 0)
```

- [ ] **Step 4: Call it, and add `rows`**

In `build_queue`, initialise counts with the new key:

```python
    counts = {"open": 0, "needs_re_review": 0, "decided": 0, "people": 0, "rows": 0}
```

and replace the tail (currently `:112-126`) with:

```python
    entries = _entries_for(person_days, employees_by_id, outage_branch_dates)
    entries.sort(key=_entry_sort_key)
    _stamp_cross_references(entries)

    # Only people who still owe HR an answer, so `people` keeps meaning "people
    # with something open" (which is what the toolbar renders it as) when settled
    # people are on show. Under the default every person in `entries` is
    # unresolved by construction, so the filter changes nothing there.
    counts["people"] = len(
        {person["employee"] for person in _iter_people(entries) if person["undecided_count"]}
    )
    # The header states people AND rows so the toolbar total and the list length
    # cannot read as contradicting each other — "40 people · 12 rows", not "40
    # people with something open" above 200 rows.
    counts["rows"] = len(entries)
```

- [ ] **Step 5: Run the whole module**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping -v
```
Expected: PASS. Report the `Ran N tests` line.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/attendance_engine/flag_grouping.py dewey_time/tests/test_flag_grouping.py
git commit -m "feat(flag-queue): cross-reference badges and a row count in the header"
```

---

### Task 5: The tier filter must not make the header lie

`counts` is computed over the whole range; the list is filtered by tier after. A header
reading "40 people · 12 rows" above 3 rows is the exact defect this spec set out to fix,
reintroduced one filter click later.

**Files:**
- Modify: `dewey_time/attendance_engine/flag_queue_api.py:359-372` (`_build_queue_payload`)
- Test: `dewey_time/tests/test_flag_queue_api.py`

**Interfaces:**
- Consumes: Task 4's `counts["rows"]`.
- Produces: no signature change. When `tier` is set, `payload["counts"]["people"]` and `["rows"]` describe the filtered list; `open`/`needs_re_review`/`decided` stay whole-range.

- [ ] **Step 1: Write the failing test**

This module stubs `build_queue` and asserts on its **inputs** and on what the API does with
its output — read the module docstring before touching it. `_harness(rows, queue=...)` is
how a canned `build_queue` return is injected; `_roster(n)` supplies the row fixtures the
five real queries serve.

First, add `"rows": 0` to `_empty_queue()`'s `counts` (`test_flag_queue_api.py:123-127`) so
the stub stays faithful to what `build_queue` now returns.

Then append to `dewey_time/tests/test_flag_queue_api.py`:

```python
class TestTierFilterCounts(unittest.TestCase):
    """The header and the list must count the same thing — under a filter too."""

    def _queue(self):
        return {
            **_empty_queue(),
            "entries": [
                {"kind": "person", "entry_key": "p:A", "employee": "A", "tier": "act",
                 "undecided_count": 1},
                {"kind": "person", "entry_key": "p:B", "employee": "B", "tier": "routine",
                 "undecided_count": 1},
            ],
            "counts": {"open": 2, "needs_re_review": 0, "decided": 0, "people": 2, "rows": 2},
        }

    def test_a_tier_filter_recounts_people_and_rows(self):
        with _harness(_roster(2), queue=self._queue()):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
        self.assertEqual(len(payload["entries"]), 1)
        self.assertEqual(payload["counts"]["people"], 1)
        self.assertEqual(payload["counts"]["rows"], 1)

    def test_state_totals_stay_whole_range_under_a_filter(self):
        # open/needs_re_review/decided are the size of the job, not a description
        # of the filtered list, and the toolbar renders them as such.
        with _harness(_roster(2), queue=self._queue()):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
        self.assertEqual(payload["counts"]["open"], 2)

    def test_without_a_filter_counts_are_passed_through_untouched(self):
        with _harness(_roster(2), queue=self._queue()):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(payload["counts"]["people"], 2)
        self.assertEqual(payload["counts"]["rows"], 2)

    def test_group_members_count_toward_the_filtered_people(self):
        # A person inside a pattern group is still a person with something open.
        queue = {
            **_empty_queue(),
            "entries": [
                {
                    "kind": "group",
                    "group_key": "REPEAT_PATTERN:LATE_START",
                    "tier": "routine",
                    "members": [
                        {"employee": "A", "undecided_count": 2},
                        {"employee": "B", "undecided_count": 1},
                    ],
                }
            ],
            "counts": {"open": 3, "needs_re_review": 0, "decided": 0, "people": 2, "rows": 1},
        }
        with _harness(_roster(2), queue=queue):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="routine")
        self.assertEqual(payload["counts"]["people"], 2)
        self.assertEqual(payload["counts"]["rows"], 1)

    def test_a_settled_person_does_not_count_toward_filtered_people(self):
        # Same rule as build_queue's own `people`: it means "people with something
        # open", and include_decided must not inflate it.
        queue = {
            **_empty_queue(),
            "entries": [
                {"kind": "person", "entry_key": "p:A", "employee": "A", "tier": "act",
                 "undecided_count": 0},
            ],
            "counts": {"open": 0, "needs_re_review": 0, "decided": 1, "people": 0, "rows": 1},
        }
        with _harness(_roster(2), queue=queue):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
        self.assertEqual(payload["counts"]["people"], 0)
        self.assertEqual(payload["counts"]["rows"], 1)
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_queue_api -v
```
Expected: FAIL — under the act filter the stubbed counts pass straight through, so
`counts["people"]` is 2 where 1 is asserted and `counts["rows"]` is 2 where 1 is asserted.
The two no-filter tests pass already; they exist to pin that the pass-through path stays
untouched.

- [ ] **Step 3: Recount after filtering**

In `_build_queue_payload`, replace the tail:

```python
    entries = queue.get("entries") or []
    counts = dict(queue.get("counts") or {})
    if tier:
        entries = [entry for entry in entries if entry.get("tier") == tier]
        # `people` and `rows` describe the LIST; leaving them whole-range would
        # put "40 people · 12 rows" above three filtered rows, which is the same
        # header-versus-list contradiction the nesting spec exists to fix.
        # open/needs_re_review/decided stay whole-range on purpose: they are the
        # size of the job and the toolbar renders them as such.
        counts["rows"] = len(entries)
        counts["people"] = len(
            {
                person["employee"]
                for entry in entries
                for person in (entry["members"] if entry["kind"] == "group" else [entry])
                if person["undecided_count"]
            }
        )

    return {
        "entries": entries,
        # counts/orphans stay whole-range for the state totals: they are the
        # toolbar numbers, not a page count.
        "counts": counts,
        "orphans": queue.get("orphans") or {},
        "alerts": alert_rows,
        "truncated": bool(flags_capped or decisions_capped),
        "start_date": str(start),
        "end_date": str(end),
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_queue_api -v
python3.13 -m unittest dewey_time.tests.test_flag_grouping -v
```
Expected: PASS for both. Report both `Ran N tests` lines.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/flag_queue_api.py dewey_time/tests/test_flag_queue_api.py
git commit -m "fix(flag-queue): a tier filter recounts people and rows so the header matches the list"
```

---

### Task 6: Frontend contract and copy

Types first, then every new string — the queue's wording lives in one file by design.

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/types/flags.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/hooks/useFlagQueue.ts:8-13`
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.test.ts`

**Interfaces:**
- Consumes: the Interface Contract above.
- Produces:
  - `groupHeadline(entry): string` — unchanged signature, now handles `REPEAT_PATTERN`
  - `groupSubline(entry): string` — NEW
  - `crossReferenceLabel(person): string | null` — NEW
  - `queueHeaderDescription(counts): string` — NEW
  - `personHeadline(person): string` — unchanged signature, now summarises repeats

- [ ] **Step 1: Update the types**

In `src/types/flags.ts`:

```ts
export type FlagOut = {
  flag_identity: string;
  flag_code: string;
  /** The flag's own date. An entry can span dates, so the person cannot answer this. */
  attendance_date: string;
  severity?: string;
  day_closed: number;
  evidence: Record<string, unknown>;
  rank: number;
  tier: Tier;
  decision_state: DecisionState;
  /** The live decision row, or null when this flag is still undecided. */
  decision: FlagDecision | null;
};

export type QueuePerson = {
  /**
   * Unique across the whole assembled entry set, stamped by the backend.
   * `p:<employee>` for a lone row, `<group_key>|p:<employee>` for a group
   * member. A person can appear in two entries under the per-flag invariant,
   * so a key derived from employee alone would collide with itself.
   */
  entry_key: string;
  employee: string;
  employee_name: string;
  employee_branch: string | null;
  /** The worst unresolved flag's date — the row's headline day. */
  attendance_date: string;
  /** Every distinct date THIS entry's flags fall on, ascending. */
  dates: string[];
  rank: number;
  tier: Tier;
  /** Worst-first, all of this person's flags **in this entry**. */
  flags: FlagOut[];
  undecided_count: number;
  /** Other entries this person also appears in. 0 means no badge. */
  also_count: number;
  /** How many of those other entries are lone person rows. */
  also_outlier_count: number;
};

export type QueueEntry =
  | ({ kind: "person" } & QueuePerson)
  | {
      kind: "group";
      group_type: "BRANCH_NO_DEVICE_DATA" | "REPEAT_PATTERN" | "ROUTINE_CODE";
      group_key: string;
      branch: string | null;
      flag_code: string | null;
      /** null for REPEAT_PATTERN, which spans dates by definition. */
      attendance_date: string | null;
      rank: number;
      tier: Tier;
      members: QueuePerson[];
    };
```

and in `QueuePayload`, `counts` becomes:

```ts
  counts: { open: number; needs_re_review: number; decided: number; people: number; rows: number };
```

In `src/hooks/useFlagQueue.ts`, add `rows: 0` to `EMPTY_COUNTS`.

- [ ] **Step 2: Write the failing copy tests**

Append to `src/lib/flagQueueLabels.test.ts` (match the file's existing `node:test` style):

```ts
test("a repeat pattern is headlined by what it is, not by a count", () => {
  const entry = patternGroup("LATE_START", 8);
  assert.equal(groupHeadline(entry), "Repeatedly late");
});

test("a repeat pattern's subline states people and occurrences", () => {
  const entry = patternGroup("LATE_START", 8, 34);
  assert.equal(groupSubline(entry), "8 people · 34 mornings");
});

test("an unknown pattern code still reads as English", () => {
  const entry = patternGroup("SOME_NEW_CODE", 2, 6);
  assert.equal(groupHeadline(entry), "Repeated some new code");
  assert.equal(groupSubline(entry), "2 people · 6 days");
});

test("routine code groups say one-off, because repeat offenders left by precedence", () => {
  const entry = routineGroup("LATE_START", [9, 20]);
  assert.match(groupHeadline(entry), /one-off late starts/);
});

test("a person whose other entries are all lone rows is badged as an outlier", () => {
  assert.equal(crossReferenceLabel(person({ also_count: 1, also_outlier_count: 1 })), "also 1 outlier");
  assert.equal(crossReferenceLabel(person({ also_count: 2, also_outlier_count: 2 })), "also 2 outliers");
});

test("a person whose other entries include a group is badged as elsewhere", () => {
  assert.equal(crossReferenceLabel(person({ also_count: 1, also_outlier_count: 0 })), "also 1 elsewhere");
  assert.equal(crossReferenceLabel(person({ also_count: 2, also_outlier_count: 1 })), "also 2 elsewhere");
});

test("a person in one entry carries no badge at all", () => {
  assert.equal(crossReferenceLabel(person({ also_count: 0, also_outlier_count: 0 })), null);
});

test("the header states people and rows, so it cannot contradict the list", () => {
  assert.equal(
    queueHeaderDescription({ open: 0, needs_re_review: 0, decided: 0, people: 40, rows: 12 }),
    "40 people · 12 rows",
  );
});

test("the header is singular for one", () => {
  assert.equal(
    queueHeaderDescription({ open: 0, needs_re_review: 0, decided: 0, people: 1, rows: 1 }),
    "1 person · 1 row",
  );
});

test("a person with several flags of one code is summarised, not headlined by one", () => {
  assert.equal(
    personHeadline(person({ flags: [lateStart(31), lateStart(12), lateStart(9), lateStart(15)] })),
    "4 late starts · worst 31 min",
  );
});

test("a person with a single flag keeps the flag's own label", () => {
  assert.equal(personHeadline(person({ flags: [lateStart(31)] })), formatFlagLabel("LATE_START", { minutes: 31 }));
});
```

Write `patternGroup`, `routineGroup`, `person` and `lateStart` as local fixture builders at
the top of the test file, matching the fixture style already there. `lateStart(n)` must
produce a `FlagOut` with `flag_code: "LATE_START"`, `evidence: { minutes: n }`,
`decision_state: "undecided"`, and an `attendance_date`.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd dewey_time/frontend/hr_attendance
ln -sfn /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance/node_modules node_modules
npm run test:web 2>&1 | tail -20
```
Expected: FAIL — `groupSubline`, `crossReferenceLabel` and `queueHeaderDescription` are not
exported.

- [ ] **Step 4: Write the copy**

In `src/lib/flagQueueLabels.ts`, rename `ROUTINE_CODE_PLURAL_LABELS` to
`FLAG_CODE_PLURAL_LABELS` and extend it to every code that can reach a group or a repeat
summary:

```ts
/**
 * A dedicated plural phrase per code, rather than a generic
 * `formatFlagLabel(...) + "s"`, because naive suffixing turns "left early" into
 * "left earlys" and "missing lunch" into "missing lunchs".
 */
const FLAG_CODE_PLURAL_LABELS: Record<string, string> = {
  LEFT_EARLY: "early departures",
  LATE_START: "late starts",
  LATE_FROM_LUNCH: "late returns from lunch",
  NON_PRIMARY_SITE_PUNCH: "other-site punches",
  MISSING_LUNCH: "missing lunches",
  MISSING_TIME: "gaps in the day",
  OFF_SHIFT_PUNCH: "off-shift punches",
  DELIVERY_FAILED: "delivery failures",
  UNKNOWN_DEVICE_BRANCH: "unknown-device punches",
};

function pluralFlagLabel(flagCode: string): string {
  return FLAG_CODE_PLURAL_LABELS[flagCode] ?? `${flagCode.replaceAll("_", " ").toLowerCase()}s`;
}

/**
 * Repeat-pattern group titles. `unit` is what one occurrence is called — a late
 * start happens in the morning, a gap does not, and "8 people · 34 mornings"
 * only reads as English when the noun fits the code.
 *
 * Every code here is one whose flags can reach routine or review tier; act-tier
 * flags never form patterns (`PATTERN_TIERS` in flag_grouping.py), so
 * UNNOTIFIED_ABSENCE and ATTENDANCE_ISSUE are deliberately absent.
 */
const REPEAT_PATTERN_LABELS: Record<string, { title: string; unit: string }> = {
  LATE_START: { title: "Repeatedly late", unit: "mornings" },
  LEFT_EARLY: { title: "Repeatedly leaving early", unit: "days" },
  LATE_FROM_LUNCH: { title: "Repeatedly late back from lunch", unit: "days" },
  NON_PRIMARY_SITE_PUNCH: { title: "Repeatedly punching at another site", unit: "days" },
  MISSING_TIME: { title: "Repeated gaps in the day", unit: "days" },
  OFF_SHIFT_PUNCH: { title: "Repeatedly punching off shift", unit: "days" },
  MISSING_LUNCH: { title: "Repeatedly no lunch recorded", unit: "days" },
  DELIVERY_FAILED: { title: "Repeated delivery failures", unit: "days" },
  UNKNOWN_DEVICE_BRANCH: { title: "Repeated unknown-device punches", unit: "days" },
};

function repeatPatternLabel(flagCode: string): { title: string; unit: string } {
  return (
    REPEAT_PATTERN_LABELS[flagCode] ?? {
      title: `Repeated ${flagCode.replaceAll("_", " ").toLowerCase()}`,
      unit: "days",
    }
  );
}
```

Change `routineCodeHeader` to insert "one-off":

```ts
/**
 * "168 one-off late starts, 6–20 min — and nothing else wrong that day".
 *
 * "one-off" is true by construction, not decoration: a repeat offender leaves
 * this pool by precedence (REPEAT_PATTERN outranks ROUTINE_CODE), so everyone
 * left here hit this code on fewer than PATTERN_MIN_DAYS days.
 */
export function routineCodeHeader(flagCode: string, members: QueuePerson[]): string {
  const label = pluralFlagLabel(flagCode);
  const range = minutesRange(members, flagCode);
  const rangeText = range ? `, ${range.min}–${range.max} min` : "";
  return `${members.length} one-off ${label}${rangeText} — and nothing else wrong that day`;
}
```

Add the three new functions:

```ts
/** "Repeatedly late" — a pattern group's title. Its size goes in the subline. */
export function repeatPatternHeader(flagCode: string): string {
  return repeatPatternLabel(flagCode).title;
}

/**
 * The second line of a group row. Both dimensions where both matter — "8 people
 * · 34 mornings" — because a pattern group's size is two numbers and reporting
 * only one is how the header started disagreeing with the list in the first
 * place.
 */
export function groupSubline(entry: Extract<QueueEntry, { kind: "group" }>): string {
  const people = `${entry.members.length} ${entry.members.length === 1 ? "person" : "people"}`;
  if (entry.group_type !== "REPEAT_PATTERN") return people;
  const occurrences = entry.members.reduce((total, member) => total + member.flags.length, 0);
  const { unit } = repeatPatternLabel(entry.flag_code ?? "");
  return `${people} · ${occurrences} ${unit}`;
}

/**
 * "also 1 outlier" / "also 2 elsewhere" — the safeguard that makes the per-flag
 * invariant safe in practice. Without it, HR excuses the repeatedly-late group,
 * believes a person is dealt with, and never sees their three-hour absence.
 *
 * "outlier" only when EVERY other entry is a lone person row, because that is
 * the only case where the word is true: a lone row holds the flags that fitted
 * no pattern. Mixed, or another group, reads as the vaguer "elsewhere" rather
 * than claiming a precision the count does not have.
 */
export function crossReferenceLabel(person: QueuePerson): string | null {
  if (person.also_count < 1) return null;
  if (person.also_outlier_count === person.also_count) {
    return `also ${person.also_count} outlier${person.also_count === 1 ? "" : "s"}`;
  }
  return `also ${person.also_count} elsewhere`;
}

/**
 * "40 people · 12 rows". The header and the list must count the same thing:
 * before nesting, `people` counted distinct employees while the list showed one
 * row per person-DAY, so the toolbar read "40 people with something open" above
 * two hundred rows.
 */
export function queueHeaderDescription(counts: QueuePayload["counts"]): string {
  const people = `${counts.people} ${counts.people === 1 ? "person" : "people"}`;
  const rows = `${counts.rows} ${counts.rows === 1 ? "row" : "rows"}`;
  return `${people} · ${rows}`;
}
```

Extend `groupHeadline`'s dispatch:

```ts
export function groupHeadline(entry: Extract<QueueEntry, { kind: "group" }>): string {
  if (entry.group_type === "BRANCH_NO_DEVICE_DATA") {
    return branchNoDeviceDataHeader(entry.branch ?? "Unknown branch", entry.attendance_date ?? "");
  }
  if (entry.group_type === "REPEAT_PATTERN") {
    return repeatPatternHeader(entry.flag_code ?? "flag");
  }
  return routineCodeHeader(entry.flag_code ?? "flag", entry.members);
}
```

And rewrite `personHeadline` so a span summarises rather than naming one flag:

```ts
/**
 * The one line that stands for a person in the list.
 *
 * `flags` arrives worst-first from `build_queue`, so the first non-`matched`
 * entry is the worst unresolved one; a fully decided person — which the queue
 * does list when HR asks for decided people — falls back to their worst flag
 * overall rather than rendering blank.
 *
 * An entry can now hold several days of the same code (a pattern member, or a
 * person whose repeat did not reach a group). Naming only the worst would
 * report "five late mornings" as "Late by 31 min" — losing the very fact the
 * nesting spec says HR most wants to know.
 */
export function personHeadline(person: QueuePerson): string {
  const unresolved = person.flags.filter((f) => f.decision_state !== "matched");
  const shown = unresolved.length > 0 ? unresolved : person.flags;
  const worst = shown[0];
  if (!worst) return "";

  const sameCode = shown.filter((f) => f.flag_code === worst.flag_code);
  if (sameCode.length < 2) {
    return formatFlagLabel(worst.flag_code, parseFlagEvidence(worst.evidence));
  }

  const minutes = sameCode
    .map((f) => f.evidence.minutes)
    .filter((value): value is number => typeof value === "number");
  const summary = `${sameCode.length} ${pluralFlagLabel(worst.flag_code)}`;
  return minutes.length > 0 ? `${summary} · worst ${Math.max(...minutes)} min` : summary;
}
```

- [ ] **Step 5: Fix the one pre-existing assertion the spec changed**

`flagQueueLabels.test.ts` pins `routineCodeHeader`'s output. The spec mandates the word
"one-off" (*"`ROUTINE_CODE` becomes 'one-off' by construction and its copy should say
so"*), so update that expected string to match — this is the single test whose expectation
this plan authorises changing. If any **other** existing assertion fails, report it as a
finding rather than editing it.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -12
```
Expected: PASS, `ℹ fail 0`, and `ℹ tests` **above 487**. Paste the count lines.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/types/flags.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.test.ts \
        dewey_time/frontend/hr_attendance/src/hooks/useFlagQueue.ts
git commit -m "feat(flag-queue): copy and types for repeat patterns and cross-references"
```

---

### Task 7: Wire the list, the panel and the header

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagQueueList.tsx:17-21` (`entryKey`), `:160-203` (`PersonRow`, `GroupRow`)
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagDecisionPanel.tsx:119`, `:153`, `:343`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx:421`
- Test: `dewey_time/frontend/hr_attendance/src/ui/flagQueuePage.test.tsx`

**Interfaces:**
- Consumes: Task 6's `groupSubline`, `crossReferenceLabel`, `queueHeaderDescription`, and `QueuePerson.entry_key`.
- Produces: no new exports. `entryKey(entry)` now returns the backend's key for a person.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/flagQueuePage.test.tsx` (the suite renders with `renderToStaticMarkup`;
follow its existing fixtures):

```tsx
test("a person in two entries carries the cross-reference badge in the list", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList
      entries={[patternGroupEntry(), outlierPersonEntry()]}
      selectedKey={null}
      expandedGroupKey={null}
      onSelect={() => {}}
    />,
  );
  // Once for the group member, once for the lone row.
  assert.equal(html.split("also 1 outlier").length - 1, 2);
});

test("a repeat pattern row states its title and its two dimensions", () => {
  const html = renderToStaticMarkup(
    <FlagQueueList
      entries={[patternGroupEntry()]}
      selectedKey={null}
      expandedGroupKey={null}
      onSelect={() => {}}
    />,
  );
  assert.match(html, /Repeatedly late/);
  assert.match(html, /2 people · 6 mornings/);
});

test("the same person in two entries produces two distinct row keys", () => {
  // A collision would make selecting the outlier select the group member.
  const group = patternGroupEntry();
  const loner = outlierPersonEntry();
  assert.notEqual(entryKey(loner), entryKey({ kind: "person", ...group.members[0] }));
});

test("the header states people and rows", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 9, needs_re_review: 0, decided: 0, people: 40, rows: 12 }}
      {...viewProps()}
    />,
  );
  assert.match(html, /40 people · 12 rows/);
});

test("a flag card is dated by its own flag, not by the person's headline day", () => {
  // A pattern member spans dates; dating every card by person.attendance_date
  // would label four different mornings as the same day.
  const person = spanPersonEntry();
  const html = renderToStaticMarkup(
    <FlagDecisionPanel entry={person} {...panelProps()} />,
  );
  assert.match(html, /3 Aug/);
  assert.match(html, /5 Aug/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -20
```
Expected: FAIL — no badge is rendered, the group subline reads "2 people", the header
reads "40 people with something open", and both flag cards carry the same date.

- [ ] **Step 3: `entryKey` reads the backend's key**

In `src/ui/FlagQueueList.tsx`:

```tsx
/**
 * Stable per-entry key. The page holds only this string as its selection, so a
 * refetch that returns fresh objects keeps the same row selected — object
 * identity is useless across a react-query refetch, and `Attendance Flag.name`
 * is not usable as an identifier anywhere in this feature (the engine rebuilds
 * those rows constantly).
 *
 * A person's key comes from the backend rather than being derived here: under
 * the per-flag invariant one employee can occupy two entries, and any key built
 * from employee (and date) alone would collide with itself — selecting the
 * outlier would select the pattern member instead.
 */
export function entryKey(entry: QueueEntry): string {
  return entry.kind === "group" ? `g:${entry.group_key}` : entry.entry_key;
}
```

- [ ] **Step 4: Badge the person row, subline the group row**

Replace `PersonRow`'s badge block and `GroupRow`'s subline:

```tsx
function PersonRow(props: { person: QueuePerson; selected: boolean; onSelect: () => void }) {
  const { person } = props;
  // undecided_count, not flags.length: a partially decided person returns to the
  // queue headlined by their next unresolved flag, so the badge must count what
  // is still open.
  const extra = Math.max(person.undecided_count - 1, 0);
  const crossReference = crossReferenceLabel(person);

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">
            {person.employee_name}
          </span>
          {/* The safeguard, in every entry this person appears in. */}
          {crossReference ? (
            <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
              {crossReference}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {personHeadline(person)}
        </span>
      </span>
      {extra > 0 ? (
        <Badge variant="outline" className="shrink-0 rounded-md text-[11px] tabular-nums">
          +{extra}
        </Badge>
      ) : null}
    </RowButton>
  );
}

function GroupRow(props: { entry: GroupEntry; selected: boolean; onSelect: () => void }) {
  const { entry } = props;

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {groupHeadline(entry)}
        </span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {groupSubline(entry)}
        </span>
      </span>
    </RowButton>
  );
}
```

Import `crossReferenceLabel` and `groupSubline` from `@/lib/flagQueueLabels`.

- [ ] **Step 5: Date each flag card by its own flag**

In `src/ui/FlagDecisionPanel.tsx`, line `:153`:

```tsx
          dateKey={flag.attendance_date}
```

and the person header at `:118-123`:

```tsx
        <div className="mt-1 text-sm text-muted-foreground">
          {/* An entry can span dates now — a pattern member holds four mornings.
              Naming only the headline day would label the other three wrongly. */}
          {person.dates.length > 1
            ? `${formatFlagContextDate(person.dates[0])} – ${formatFlagContextDate(person.dates[person.dates.length - 1])}`
            : formatFlagContextDate(person.attendance_date)}
          {person.employee_branch ? (
            <span className="text-muted-foreground/80"> · {person.employee_branch}</span>
          ) : null}
        </div>
```

At `:343` (the group header's date), guard the null a `REPEAT_PATTERN` group carries:

```tsx
          {entry.attendance_date ? formatFlagContextDate(entry.attendance_date) : groupSubline(entry)}
```

- [ ] **Step 6: The page header**

In `src/ui/FlagQueuePage.tsx:421`:

```tsx
        description={counts ? queueHeaderDescription(counts) : "Loading…"}
```

Import `queueHeaderDescription` and drop the now-unused inline template string.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -12
npx tsc --noEmit 2>&1 | tail -20
```
Expected: `ℹ fail 0`, `ℹ tests` above Task 6's count, and `tsc` clean. Paste both.

- [ ] **Step 8: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/ui/FlagQueueList.tsx \
        dewey_time/frontend/hr_attendance/src/ui/FlagDecisionPanel.tsx \
        dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx \
        dewey_time/frontend/hr_attendance/src/ui/flagQueuePage.test.tsx
git commit -m "feat(flag-queue): pattern rows, cross-reference badges, per-flag dates in the panel"
```

---

### Task 8: Rebuild and commit the assets

The built bundle **is** the deployed artifact. Frappe Cloud never builds this SPA — it
cannot, because `npm install` returns 401 without a `NODE_AUTH_TOKEN`. Whatever is
committed is what users get. Assets went un-rebuilt from #58 through #74 — four PRs of
frontend work, none of it live.

**Files:**
- Modify: `dewey_time/public/hr_attendance/**`
- Modify: `dewey_time/www/hr-attendance.html`, `dewey_time/www/hr-schedule.html`

- [ ] **Step 1: Build**

```bash
cd dewey_time/frontend/hr_attendance && npm run build 2>&1 | tail -20
```
Expected: a clean Vite build, then `copy-html-entry.mjs` reporting success. If it throws
the CSS floor error, `node_modules` is missing — re-run the symlink from Global
Constraint 5 and build again. Never weaken the floor.

- [ ] **Step 2: Verify the bundle actually contains this work**

```bash
cd "$(git rev-parse --show-toplevel)"
ls -l dewey_time/public/hr_attendance/assets/index-*.css
grep -l "Repeatedly late" dewey_time/public/hr_attendance/assets/*.js
```
Expected: the CSS is ≥ 150,000 bytes, and at least one JS chunk contains the string. An
empty grep means the build did not pick up the source — stop and report it.

- [ ] **Step 3: Run both suites once more on the built tree**

```bash
python3.13 -m unittest dewey_time.tests.test_flag_grouping dewey_time.tests.test_flag_queue_api -v 2>&1 | tail -5
cd dewey_time/frontend/hr_attendance && npm run test:web 2>&1 | tail -8
```
Expected: both green. Paste both counts.

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add dewey_time/public/hr_attendance dewey_time/www/hr-attendance.html dewey_time/www/hr-schedule.html
git commit -m "build(hr-attendance): rebuild assets for flag queue pattern nesting"
```

---

## Self-Review

**Spec coverage.** Every section of `2026-08-06-flag-queue-pattern-nesting-design.md` maps
to a task:

| Spec section | Task |
|---|---|
| The invariant, restated ("a flag appears in exactly one entry") | 3 |
| Structure (two levels, panel is the third) | 3, 7 |
| Entry taxonomy and precedence (4 rows) | 3 |
| What forms a pattern (rules 1–4) | 2 |
| The safeguard (cross-reference badge) | 4, 6, 7 |
| Counts ("40 people · 12 rows") | 4, 5, 6, 7 |
| What this does not change (`groupPayload`, decision record, triage ranks, `BRANCH_NO_DEVICE_DATA` precedence) | Global Constraints 7–9; Task 3's precedence order |
| Testing (8 bullets) | 3 (bullets 1, 2, 4, 5), 4 (3, 6, 7), 3+4 (8 — covered by "every flag appears in exactly one entry" plus `groupPayload` being unchanged) |

**Type consistency.** `entry_key`, `dates`, `also_count`, `also_outlier_count`,
`attendance_date` on `FlagOut`, and `counts.rows` are declared once in the Interface
Contract and used with those exact names in Tasks 1, 3, 4, 6 and 7. `_person`'s signature
change (positional `date_str` → keyword-only `entry_key`) is introduced in Task 1 and every
later call site uses the new form. `_top_unresolved` changes from taking a person to taking
a flag list in Task 3, and Task 3 is its only caller.

**Known residual — flagged, not hidden.** The spec's own note applies: the thresholds
(3 days, 2 people) are judgement, not measurement, and should be revisited on real usage
data. Nothing is persisted from them, so changing them later is free.
