# HR Flag Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give HR a page at `/hr-flags` that triages `Attendance Flag` records across all 500 employees and records durable, auditable Excuse/Uphold decisions in a new doctype the engine cannot destroy.

**Architecture:** HR judgments live in a new `Attendance Flag Decision` doctype keyed by a computed `flag_identity`, never by `Attendance Flag.name` — AUTO flag rows are hard-deleted and rebuilt by the engine on every punch and every closeout. The engine is not modified at all. The read API assembles the queue from a fixed number of batched queries, ranks flags by an additive `triage_rank` computed on read (the stored `severity` field is untouched), groups by branch-level device outage or routine flag code, and deduplicates to one row per person headlined by their worst flag.

**Tech Stack:** Frappe v16 (Python 3.14), `unittest` via `bench run-tests`; React 19 + TypeScript + Vite + TailwindCSS v4, `@lolbikb/dewey-ui`, `@tanstack/react-query`; `tsx --test` + `node:test` + `renderToStaticMarkup`; Playwright.

**Spec:** `docs/superpowers/specs/2026-08-05-hr-flag-management-design.md`

---

## Prerequisite — NOT part of this plan

The spec names an engine bug (`intraday.py:214` deletes every AUTO flag for an employee/date on a checkin edit but regenerates only `MISSING_TIME` and `NON_PRIMARY_SITE_PUNCH`, so on an already-closed date the rest are destroyed permanently). It ships on **its own branch, before this plan**. Do not fix it inside these tasks. If it has not landed when Task 1 starts, stop and say so.

---

## Global Constraints

Every task's requirements implicitly include this section.

1. **Never modify the flag engine.** `closeout.py`, `intraday.py`, `absence_flags.py`, `record_issue_flags.py`, `lunch_flags.py` and `attendance_flag.py`'s `before_insert` are read-only in this plan. The one exception is `attendance_flag.json`, which gains `search_index` and deprecation labels only.
2. **Never use `Attendance Flag.name` as a foreign key**, and never derive identity by stripping `-prov` from it. `attendance_flag.py:71` truncates with `key[:140]` *after* appending the marker.
3. **Never use `Attendance Flag.linked_checkin`.** It is declared on the doctype and never written by any insert path. It is permanently NULL.
4. **Never change `severity`, either `FLAG_SEVERITY` dict, or any existing consumer.** The map is duplicated in `attendance_flag.py:6-20` and `closeout.py:61-75` and pinned equal by `test_the_two_severity_maps_agree`. The TS `Severity` union is closed and `WeekFlagSummary` assumes exactly three buckets.
5. **Query budget in `get_flag_queue` is O(1) regardless of employee count.** Any per-employee or per-day query inside it is a defect. Never loop `get_employee_calendar` (`hr_calendar.py:603-646`) or reuse `get_my_week`'s per-day shape (`api.py:78-82,109-112`).
6. **Gate every new endpoint with `hr_calendar._require_hr_role()`**, imported exactly as `schedule_api.py` and `coverage_api.py:89` do. It raises `frappe.ValidationError` (HTTP 417), **not** `PermissionError` (403). That inconsistency is deliberate for drop-in consistency — do not "fix" it.
7. **Mutating endpoints are `@frappe.whitelist(methods=["POST"])`; reads are bare `@frappe.whitelist()`.** Frontend writes go through `frappeCall(method, params, { method: "POST" })`; only POST sends the CSRF header and a JSON body (`lib/frappe.ts:42-64`).
8. **Bulk fan-out uses per-row `try/except`** appending `{"flag_identity", "error"}` to an `errors` list, responding `{"ok": not errors, ...}`. One bad row must never block the other 499. Pattern: `schedule_resolver.py:1203-1254`.
9. **Never name a device serial in user-facing copy.** No device↔branch registry exists. Cause grouping is branch-granularity: "Phnom Penh HQ had no device data on 3 Aug".
10. **`test:web` is an explicit per-directory glob, not recursive.** It covers `src/lib/*.test.ts`, `src/components/ui/*.test.tsx` and `src/ui/*.test.tsx` — **not** subdirectories and **not** `src/services/`. Put every new frontend test directly in `src/lib/` or `src/ui/`, or the tests silently never run. Verify with `npm run test:web` and read the `# tests N` count.
11. **Built assets are the deployed artifact and MUST be committed.** After any frontend change run `npm run build` from `dewey_time/frontend/hr_attendance/` and commit `dewey_time/public/hr_attendance/**` plus `dewey_time/www/hr-*.html` in the same task. Frappe Cloud never builds this SPA.
12. **A new patch file must be registered in `dewey_time/patches.txt`** or it never runs.
13. **Changing a DocType JSON requires bumping its `modified` timestamp**, or `bench migrate` skips the schema reimport and the change silently never applies.
14. Commit trailers on every commit:
    ```
    Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
    ```

---

## File Structure

**Backend — new**

| File | Responsibility |
|---|---|
| `dewey_time/attendance_engine/flag_identity.py` | Pure. Evidence parsing, `flag_identity`, `evidence_fingerprint`. No I/O. |
| `dewey_time/attendance_engine/flag_triage.py` | Pure. `triage_rank`, `tier_for_rank`. No I/O. |
| `dewey_time/attendance_engine/flag_grouping.py` | Pure. Person-dedup + cause grouping + orphan classification over plain dicts. No I/O. |
| `dewey_time/attendance_engine/flag_queue_api.py` | `get_flag_queue` — batched reads, cache, `truncated`. |
| `dewey_time/attendance_engine/flag_decision_api.py` | `decide_flags`, `reverse_decision_group` — writes, supersession. |
| `dewey_time/dewey_time/doctype/attendance_flag_decision/` | Doctype JSON + controller + `__init__.py`. |
| `dewey_time/patches/migrate_legacy_flag_decisions.py` | One-off migration of surviving in-place Desk decisions. |

**Backend — modified**

| File | Change |
|---|---|
| `dewey_time/hooks.py` | `doc_events` entries invalidating the queue cache. |
| `dewey_time/patches.txt` | Register the migration patch. |
| `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json` | `search_index` on `attendance_date`/`flag_code`/`status`; deprecate the four in-place HR fields; bump `modified`. |
| `dewey_time/attendance_engine/hr_calendar.py` | Attach `decision` to each flag `get_employee_calendar` already returns. |

**Backend — tests (all new, in `dewey_time/tests/`)**

`test_flag_identity.py` · `test_flag_triage.py` · `test_flag_grouping.py` · `test_flag_decision_api.py` · `test_flag_queue_api.py` · `test_migrate_legacy_flag_decisions.py`

**Frontend — new** (paths relative to `dewey_time/frontend/hr_attendance/src/`)

| File | Responsibility |
|---|---|
| `types/flags.ts` | Payload types shared by service, hooks and UI. |
| `services/flags.ts` | Thin `frappeCall` wrappers. No logic. |
| `lib/flagDecisionState.ts` | Pure. Selection state, per-member exclusion, "same reason applies" payload building. |
| `lib/flagQueueLabels.ts` | Pure. Copy for tiers, reasons, group headers, orphan states. |
| `hooks/useFlagQueue.ts` | react-query wiring. |
| `ui/FlagQueuePage.tsx` | Page shell: toolbar counts, split layout, error/loading states. |
| `ui/FlagQueueList.tsx` | Left pane: ranked groups + person rows. |
| `ui/FlagDecisionPanel.tsx` | Right pane: person day or group detail, decide actions. |

**Frontend — tests** (must live directly in `src/lib/` or `src/ui/`)

`lib/flagDecisionState.test.ts` · `lib/flagQueueLabels.test.ts` · `ui/flagQueuePage.test.tsx`

**Frontend — modified**

| File | Change |
|---|---|
| `src/main.tsx` | `/hr-flags` route inside `HrAppShell`. |
| `src/ui/HrAppShell.tsx` | HR-only "Flags" tab; repoint `FLAGS_INBOX_URL` (line 22) from `/app/attendance-flag` to `/hr-flags`. |
| `src/lib/flagDetails.ts` | Rewrite `flagHrGuidance` (126-163) to stop directing HR to Desk. |
| `src/ui/FlagDetailPanel.tsx` | Demote "Review in Desk" (118-125) to a secondary "Open record" link. |
| `e2e/flags.spec.ts` | New Playwright spec. |

---

## Interface Contract

**Every task must use these exact names and shapes.** A task that invents a different signature breaks its neighbours.

### Python — `flag_identity.py`

```python
def parse_evidence(evidence) -> dict:
    """str | dict | None -> dict. Never returns None; unparseable -> {}."""

def flag_identity(*, employee: str, attendance_date, flag_code: str, evidence) -> str:
    """Stable key, independent of day_closed. Format:
    "AUTO-{scrub(employee)}-{YYYY-MM-DD}-{suffix}" — no [:140] truncation."""

def evidence_fingerprint(evidence) -> str:
    """32 lowercase hex chars, sha256 over {"minutes", "reason"} only."""
```

### Python — `flag_triage.py`

```python
TIER_ACT = "act"
TIER_REVIEW = "review"
TIER_ROUTINE = "routine"

def triage_rank(flag_code: str, evidence) -> int:
    """Additive rank, computed on read. Never stored. Unknown code -> 5."""

def tier_for_rank(rank: int) -> str:
    """rank >= 100 -> "act"; rank >= 50 -> "review"; else "routine"."""
```

### Python — `flag_grouping.py`

```python
def build_queue(
    *,
    flags: list[dict],                          # each: flag_identity, employee, attendance_date,
                                                #       flag_code, severity, day_closed, evidence
    decisions_by_identity: dict[str, dict],     # live (superseded=0) decisions
    employees_by_id: dict[str, dict],           # id -> {employee_name, branch}
    outage_branch_dates: set[tuple[str, str]],  # (branch, "YYYY-MM-DD") with no device data
) -> dict:
    """Returns {"entries": [...], "counts": {...}, "orphans": {...}}. Pure."""
```

**Entry** is one of:

```python
{"kind": "group", "group_type": "BRANCH_NO_DEVICE_DATA" | "ROUTINE_CODE",
 "group_key": str, "branch": str | None, "flag_code": str | None,
 "attendance_date": str, "rank": int, "tier": str, "members": [Person, ...]}

{"kind": "person", **Person}
```

**Person:**

```python
{"employee": str, "employee_name": str, "employee_branch": str | None,
 "attendance_date": str, "rank": int, "tier": str,
 "flags": [FlagOut, ...],        # worst-first, ALL that person's flags that day
 "undecided_count": int}
```

**FlagOut:**

```python
{"flag_identity": str, "flag_code": str, "severity": str, "day_closed": int,
 "evidence": dict, "rank": int, "tier": str,
 "decision_state": "undecided" | "matched" | "needs_re_review",
 "decision": dict | None}        # the live decision row, or None
```

**counts:** `{"open": int, "needs_re_review": int, "decided": int, "people": int}`
**orphans:** `{"orphaned_flag_gone": int, "orphaned_evidence_changed": int}`

A person appears in **exactly one** entry. Group precedence: `BRANCH_NO_DEVICE_DATA`, then `ROUTINE_CODE`, then ungrouped person. A person qualifies for `ROUTINE_CODE` only when their **highest-ranked undecided flag** is tier `routine`.

### Python — API signatures

```python
# flag_queue_api.py
@frappe.whitelist()
def get_flag_queue(start_date: str, end_date: str, tier: str | None = None, limit: int = 2000) -> dict
# -> {"entries": [...], "counts": {...}, "orphans": {...},
#     "alerts": [{"branch", "local_date", "status", "last_error"}],
#     "truncated": bool, "start_date": str, "end_date": str}

QUEUE_FLAG_LIMIT = 5000
QUEUE_MAX_RANGE_DAYS = 31

# flag_decision_api.py
@frappe.whitelist(methods=["POST"])
def decide_flags(identities, outcome: str, reason: str, note: str | None = None,
                 group_key: str | None = None, confirm=None) -> dict
# -> {"ok": bool, "written": int, "group_key": str, "errors": [{"flag_identity", "error"}]}
# -> or {"needs_confirm": True, "preview": {"count": int, "employees": int}} when
#    len(identities) > DECIDE_CONFIRM_THRESHOLD and confirm is falsy

@frappe.whitelist(methods=["POST"])
def reverse_decision_group(group_key: str, note: str, confirm=None) -> dict

DECIDE_CONFIRM_THRESHOLD = 25
OUTCOMES = ("EXCUSED", "UPHELD")
REASONS = ("APPROVED_LEAVE", "DEVICE_OR_DATA_FAULT", "MANAGER_APPROVED",
           "SCHEDULE_WRONG", "COVERING_OTHER_SITE", "GENUINE_VIOLATION", "OTHER")
```

Cache: `_QUEUE_CACHE_PREFIX = "flag_queue:v1"`, `_QUEUE_CACHE_TTL_SECONDS = 60`, keyed by
`f"{_QUEUE_CACHE_PREFIX}:{start_date}:{end_date}:{tier or 'all'}"`.
Invalidator: `flag_queue_api.invalidate_flag_queue_cache(doc=None, method=None)`.

### TypeScript — `types/flags.ts`

```ts
export type Tier = "act" | "review" | "routine";
export type DecisionState = "undecided" | "matched" | "needs_re_review";
export type Outcome = "EXCUSED" | "UPHELD";
export type Reason =
  | "APPROVED_LEAVE" | "DEVICE_OR_DATA_FAULT" | "MANAGER_APPROVED"
  | "SCHEDULE_WRONG" | "COVERING_OTHER_SITE" | "GENUINE_VIOLATION" | "OTHER";

export type FlagOut = {
  flag_identity: string; flag_code: string; severity?: string; day_closed: number;
  evidence: Record<string, unknown>; rank: number; tier: Tier;
  decision_state: DecisionState; decision: FlagDecision | null;
};

export type FlagDecision = {
  name: string; outcome: Outcome; reason: Reason; note?: string | null;
  decided_by: string; decided_at: string; group_key?: string | null;
};

export type QueuePerson = {
  employee: string; employee_name: string; employee_branch: string | null;
  attendance_date: string; rank: number; tier: Tier;
  flags: FlagOut[]; undecided_count: number;
};

export type QueueEntry =
  | ({ kind: "person" } & QueuePerson)
  | { kind: "group"; group_type: "BRANCH_NO_DEVICE_DATA" | "ROUTINE_CODE";
      group_key: string; branch: string | null; flag_code: string | null;
      attendance_date: string; rank: number; tier: Tier; members: QueuePerson[] };

export type QueuePayload = {
  entries: QueueEntry[];
  counts: { open: number; needs_re_review: number; decided: number; people: number };
  orphans: { orphaned_flag_gone: number; orphaned_evidence_changed: number };
  alerts: { branch: string; local_date: string; status: string; last_error?: string | null }[];
  truncated: boolean; start_date: string; end_date: string;
};
```

### TypeScript — `lib/flagDecisionState.ts`

```ts
export type PendingDecision = { outcome: Outcome; reason: Reason; note: string };

export function decisionIsComplete(d: PendingDecision): boolean;
// note required when reason === "OTHER" or outcome === "UPHELD"

export function groupPayload(
  members: QueuePerson[], excluded: ReadonlySet<string>
): { identities: string[]; employeeCount: number };
// excludes every flag of an excluded employee; only undecided flags are included

export function remainingIdentities(person: QueuePerson): string[];
// undecided flag identities, worst-first — backs "Apply to remaining N"
```

---

### Task 1: Pure flag identity and evidence fingerprint

**Files:**
- Create: `dewey_time/attendance_engine/flag_identity.py`
- Test: `dewey_time/tests/test_flag_identity.py`

**Interfaces:**
- Consumes: nothing — this is the first task in the plan; it has no upstream dependency.
- Produces (exact signatures from the Interface Contract; later tasks import these
  directly — do not rename):
  ```python
  def parse_evidence(evidence) -> dict:
      """str | dict | None -> dict. Never returns None; unparseable -> {}."""

  def flag_identity(*, employee: str, attendance_date, flag_code: str, evidence) -> str:
      """Stable key, independent of day_closed. Format:
      "AUTO-{scrub(employee)}-{YYYY-MM-DD}-{suffix}" — no [:140] truncation."""

  def evidence_fingerprint(evidence) -> str:
      """32 lowercase hex chars, sha256 over {"minutes", "reason"} only."""
  ```
  Task 4 (`flag_grouping.py`'s `build_queue`) consumes `FlagOut["flag_identity"]` values
  that Task 5 (`flag_queue_api.py`) computes by calling `flag_identity()` per live
  `Attendance Flag` row and comparing `evidence_fingerprint()` against each decision's
  stored `evidence_fingerprint` column. Task 6 (`flag_decision_api.py`) calls
  `flag_identity()` + `evidence_fingerprint()` at write time to stamp new
  `Attendance Flag Decision` rows. Every one of those call sites must import from this
  module — none may reimplement the suffix rules locally.

- [ ] **Step 1: Write the failing test**

```python
import unittest
from datetime import date

from dewey_time.attendance_engine.flag_identity import (
    evidence_fingerprint,
    flag_identity,
    parse_evidence,
)


class TestFlagIdentity(unittest.TestCase):
    def test_provisional_and_final_produce_the_same_identity(self):
        # flag_identity() has no day_closed parameter at all, but the point
        # being guarded is behavioural, not just "the signature lacks a
        # field": a provisional flag row and the final row that later
        # replaces it at closeout carry identical employee/attendance_date/
        # flag_code/evidence and MUST resolve to the same key so a decision
        # recorded pre-closeout still attaches post-closeout.
        provisional = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="LATE_START",
            evidence={"minutes": 12, "reason": "late_start"},
        )
        final = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="LATE_START",
            evidence={"minutes": 12, "reason": "late_start"},
        )
        self.assertEqual(provisional, final)
        self.assertEqual(provisional, "AUTO-hr_emp_00042-2026-08-03-late_start")

    def test_missing_time_identity_changes_when_interval_start_changes(self):
        first = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="MISSING_TIME",
            evidence={"interval_start": "2026-08-03T09:00:00"},
        )
        second = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="MISSING_TIME",
            evidence={"interval_start": "2026-08-03T11:30:00"},
        )
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("AUTO-hr_emp_00042-2026-08-03-missing-time-"))
        self.assertTrue(second.startswith("AUTO-hr_emp_00042-2026-08-03-missing-time-"))

    def test_delivery_failed_evidence_key_over_80_chars_is_capped(self):
        long_pin = "9" * 120
        identity = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="DELIVERY_FAILED",
            evidence={"pin": long_pin},
        )
        prefix = "AUTO-hr_emp_00042-2026-08-03-delivery-failed-"
        self.assertTrue(identity.startswith(prefix))
        suffix_key = identity[len(prefix):]
        # scrub() of an all-digit string is a no-op besides str(), so the
        # capped key is just the first 80 of the 120 nines -- this is the
        # exact truncation window attendance_flag.py:90-103 leaves open
        # (uncapped there); this module closes it.
        self.assertEqual(suffix_key, "9" * 80)
        self.assertEqual(len(suffix_key), 80)

    def test_missing_evidence_keys_fall_back_to_scrub_flag_code(self):
        # MISSING_TIME with no interval_start: _missing_time_suffix returns
        # None, so flag_identity() falls back to scrub(flag_code) -- same
        # fallback attendance_flag.py's before_insert uses when its own
        # _missing_time_key() returns None.
        missing_time = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="MISSING_TIME",
            evidence={},
        )
        self.assertEqual(missing_time, "AUTO-hr_emp_00042-2026-08-03-missing_time")

        # DELIVERY_FAILED with none of the recognised keys present, at
        # top level or nested under "undelivered".
        delivery_failed = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="DELIVERY_FAILED",
            evidence={"undelivered": {"something_else": "x"}},
        )
        self.assertEqual(delivery_failed, "AUTO-hr_emp_00042-2026-08-03-delivery_failed")

        # A code with no evidence-keyed suffix at all (e.g. UNNOTIFIED_ABSENCE)
        # always falls straight to scrub(flag_code), regardless of evidence.
        unnotified = flag_identity(
            employee="HR-EMP-00042",
            attendance_date=date(2026, 8, 3),
            flag_code="UNNOTIFIED_ABSENCE",
            evidence={"reason": "irrelevant"},
        )
        self.assertEqual(unnotified, "AUTO-hr_emp_00042-2026-08-03-unnotified_absence")

    def test_fingerprint_stable_for_equal_evidence_and_differs_when_minutes_change(self):
        fp_a = evidence_fingerprint({"minutes": 12, "reason": "late_start"})
        fp_b = evidence_fingerprint({"minutes": 12, "reason": "late_start"})
        fp_c = evidence_fingerprint({"minutes": 90, "reason": "late_start"})

        self.assertEqual(fp_a, fp_b)
        self.assertNotEqual(fp_a, fp_c)
        self.assertEqual(len(fp_a), 32)
        # lowercase hex only
        self.assertTrue(all(ch in "0123456789abcdef" for ch in fp_a))

    def test_flag_carrying_neither_minutes_nor_reason_has_a_constant_fingerprint(self):
        # UNNOTIFIED_ABSENCE-shaped evidence: no "minutes", no "reason" key
        # at all. Both should hash the same constant {"minutes": null,
        # "reason": null} payload regardless of what else is in evidence.
        fp_empty = evidence_fingerprint({})
        fp_other_keys = evidence_fingerprint({"employee_branch": "PP-HQ", "device_id": "42"})
        fp_none = evidence_fingerprint(None)

        self.assertEqual(fp_empty, fp_other_keys)
        self.assertEqual(fp_empty, fp_none)

    def test_parse_evidence_never_returns_none(self):
        self.assertEqual(parse_evidence(None), {})
        self.assertEqual(parse_evidence(""), {})
        self.assertEqual(parse_evidence("not json"), {})
        self.assertEqual(parse_evidence("[1, 2, 3]"), {})
        self.assertEqual(parse_evidence('{"minutes": 5}'), {"minutes": 5})
        self.assertEqual(parse_evidence({"minutes": 5}), {"minutes": 5})


if __name__ == "__main__":
    unittest.main()
```

Save this as `dewey_time/tests/test_flag_identity.py`. Unlike `test_closeout.py` /
`test_absence_flags.py`, this test file does **not** call `_install_frappe_mock()` — the
module under test never imports `frappe` (see Step 3's module docstring), so there is
nothing to mock. This mirrors `dewey_time/tests/test_shift_grace.py`, which imports its
pure target directly with no frappe mocking at all — read that file to confirm the pattern
before assuming every backend test needs the mock idiom.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_identity`

Expected: FAIL at collection/import time, before any test body runs, because
`dewey_time/attendance_engine/flag_identity.py` does not exist yet:

```
ModuleNotFoundError: No module named 'dewey_time.attendance_engine.flag_identity'
```

(Verified directly with `python3 -m unittest dewey_time.tests.test_flag_identity` against
a scratch package tree with the test file present and `flag_identity.py` absent — this is
the exact error text produced, not a paraphrase.)

- [ ] **Step 3: Implement `flag_identity.py`**

```python
"""Pure identity + fingerprint math for Attendance Flag rows.

`Attendance Flag` documents are hard-deleted and rebuilt by the flag engine on
every punch and every closeout (see `intraday.py`, `closeout.py`) -- their
`name` is therefore useless as a foreign key from `Attendance Flag Decision`,
and doubly so because a provisional row's name carries a `-prov` suffix that
a finalised row for the same employee/date/code does not
(`attendance_flag.py:53-71`). `flag_identity()` recomputes a stable key from
the flag's *content* instead, so a decision recorded against a provisional
flag still applies once closeout replaces it with a final one sharing the
same identity.

This module has NO frappe import and does no I/O -- it is pure functions
over plain values, importable and unit-testable without a live bench (same
shape as `shift_grace.py`, whose pure helpers are tested in
`test_shift_grace.py` with no frappe mock at all -- see that file before
assuming every backend test needs `_install_frappe_mock()`).

Deliberate differences from `attendance_flag.py`'s `before_insert` /
`_*_key` helpers, which this module mirrors in spirit but does not call:

- `day_closed` is excluded from the key entirely (no `-prov` marker). A
  provisional flag and the final flag that replaces it at closeout therefore
  share one identity -- that is the whole point of this module existing.
- The `DELIVERY_FAILED` suffix is capped at `[:80]` like its `MISSING_TIME`
  and `ATTENDANCE_ISSUE` siblings. The controller's `_delivery_failed_key`
  leaves it uncapped (`attendance_flag.py:90-103`), which is a
  truncation-collision window on long `custom_supabase_log_id` values; this
  module closes it instead of reproducing it.
- There is no `[:140]` truncation. `attendance_flag.name` is capped because
  it is a Frappe docname; `flag_identity` is an ordinary `Data` column on
  `Attendance Flag Decision`, not a name, so nothing caps it.
"""

from __future__ import annotations

import hashlib
import json

_DELIVERY_FAILED_EVIDENCE_KEYS = ("pin", "user_id", "supabase_log_id", "custom_supabase_log_id")


def _scrub(value) -> str:
    """Local stand-in for `frappe.scrub`: lowercase, spaces/hyphens -> underscores.

    Deliberately NOT a call to `frappe.scrub` -- this module must import and
    run without a live bench (see module docstring). Parity with frappe's
    own scrub is not required, only that every caller of `flag_identity()`
    agrees on the same transform for the same input: write-time
    (`flag_decision_api.py`, computing the identity to store on a new
    decision) and read-time (`flag_queue_api.py`, computing the identity of
    each live `Attendance Flag` to match decisions against) both import this
    same function, so they can never disagree with each other even if they
    disagreed with the real `frappe.scrub`.
    """
    return str(value).strip().lower().replace(" ", "_").replace("-", "_")


def parse_evidence(evidence) -> dict:
    """Normalise `Attendance Flag.evidence` to a dict.

    The field is stored as a JSON string on the doctype but is frequently
    handled already-decoded (e.g. a dict evidence payload built in-process
    by the engine before insert, or a test fixture). Accept `str | dict |
    None` and never raise or return `None`: an absent or unparseable
    payload becomes `{}`, so every caller can unconditionally `.get()` off
    the result instead of null-checking first.
    """
    if isinstance(evidence, dict):
        return evidence
    if isinstance(evidence, str) and evidence:
        try:
            parsed = json.loads(evidence)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _format_date(attendance_date) -> str:
    if hasattr(attendance_date, "strftime"):
        return attendance_date.strftime("%Y-%m-%d")
    return str(attendance_date)


def _delivery_failed_suffix(evidence: dict):
    # Mirrors attendance_flag.py:90-103: check the nested "undelivered" dict
    # first (the shape the delivery-failure path actually writes), then fall
    # back to the same keys at the top level of evidence.
    undelivered = evidence.get("undelivered")
    if isinstance(undelivered, dict):
        for key in _DELIVERY_FAILED_EVIDENCE_KEYS:
            value = undelivered.get(key)
            if value:
                return _scrub(value)[:80]
    for key in _DELIVERY_FAILED_EVIDENCE_KEYS:
        value = evidence.get(key)
        if value:
            return _scrub(value)[:80]
    return None


def _missing_time_suffix(evidence: dict):
    start = evidence.get("interval_start")
    if start:
        return _scrub(start)[:80]
    return None


def _attendance_issue_suffix(evidence: dict):
    # `reason` defaults to "issue" (mirrors attendance_flag.py:116), so this
    # never returns None for a dict payload -- even an empty one. The
    # scrub(flag_code) fallback in flag_identity() below only fires when
    # `evidence` itself didn't parse to a dict at all (parse_evidence
    # already folded that case to `{}` before this function ever sees it,
    # which is indistinguishable here from a genuinely empty dict -- an
    # accepted simplification, since ATTENDANCE_ISSUE evidence is always
    # engine-written and always a real dict in practice).
    reason = evidence.get("reason") or "issue"
    punch = evidence.get("punch_time") or ""
    return _scrub(f"{reason}-{punch}")[:80]


# code -> (literal suffix prefix, evidence -> key-or-None builder)
_SUFFIX_BUILDERS = {
    "DELIVERY_FAILED": ("delivery-failed", _delivery_failed_suffix),
    "MISSING_TIME": ("missing-time", _missing_time_suffix),
    "ATTENDANCE_ISSUE": ("attendance-issue", _attendance_issue_suffix),
}


def flag_identity(*, employee: str, attendance_date, flag_code: str, evidence) -> str:
    """Stable key for an AUTO Attendance Flag, independent of day_closed.

    Format: "AUTO-{scrub(employee)}-{YYYY-MM-DD}-{suffix}" -- no [:140]
    truncation. See the module docstring for the deliberate differences
    from `attendance_flag.py`'s `before_insert`, which this mirrors.
    """
    parsed = parse_evidence(evidence)
    suffix = None
    spec = _SUFFIX_BUILDERS.get(flag_code)
    if spec is not None:
        prefix, builder = spec
        key = builder(parsed)
        if key:
            suffix = f"{prefix}-{key}"
    if suffix is None:
        # Either flag_code isn't one of the three evidence-keyed codes, or
        # it is but the specific evidence key was absent -- same fallback
        # attendance_flag.py's before_insert uses (`:39`, before any of the
        # elif branches run).
        suffix = _scrub(flag_code)
    return "AUTO-{0}-{1}-{2}".format(_scrub(employee), _format_date(attendance_date), suffix)


def evidence_fingerprint(evidence) -> str:
    """32 lowercase hex chars, sha256 over {"minutes", "reason"} only.

    Identity (`flag_identity`) deliberately ignores flag magnitude -- e.g.
    LATE_START's suffix is just "late_start" regardless of how many minutes
    late. The fingerprint is the staleness guard for that gap: a decision's
    stored fingerprint is compared against the live flag's on every read
    (`flag_queue_api.py`), and a mismatch demotes the decision to
    `needs_re_review` instead of silently applying an "excused 6 minutes
    late" decision to a punch later corrected to 90 minutes late. Codes
    carrying neither key (e.g. UNNOTIFIED_ABSENCE) hash a constant
    {"minutes": None, "reason": None} payload and so can never go stale --
    correct for a binary flag with no magnitude to drift.
    """
    parsed = parse_evidence(evidence)
    payload = {"minutes": parsed.get("minutes"), "reason": parsed.get("reason")}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:32]
```

Save this as `dewey_time/attendance_engine/flag_identity.py`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_identity`

Expected: `OK`, 7 tests run, 0 failures, 0 errors. (Verified directly with
`python3 -m unittest dewey_time.tests.test_flag_identity -v` against the module and test
above in isolation — output was:
```
test_delivery_failed_evidence_key_over_80_chars_is_capped ... ok
test_fingerprint_stable_for_equal_evidence_and_differs_when_minutes_change ... ok
test_flag_carrying_neither_minutes_nor_reason_has_a_constant_fingerprint ... ok
test_missing_evidence_keys_fall_back_to_scrub_flag_code ... ok
test_missing_time_identity_changes_when_interval_start_changes ... ok
test_parse_evidence_never_returns_none ... ok
test_provisional_and_final_produce_the_same_identity ... ok

Ran 7 tests in 0.000s

OK
```
inside `bench run-tests` the module count and test names will match; the runner harness
differs but the pass/fail outcome does not, since the module under test has no frappe
dependency.)

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/flag_identity.py dewey_time/tests/test_flag_identity.py
git commit -m "$(cat <<'EOF'
feat(flag-identity): add pure flag_identity/evidence_fingerprint module (T1)

Foundational module for HR Flag Management: computes a durable Attendance
Flag Decision key independent of day_closed (fixing the -prov rename hazard
in attendance_flag.py:53-71) plus the evidence_fingerprint staleness guard.
Pure, no frappe import, no I/O -- unit-tested without a live bench.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Additive triage ranking

**Files:**
- Create: `dewey_time/attendance_engine/flag_triage.py`
- Test: `dewey_time/tests/test_flag_triage.py`

**Interfaces:**
- Consumes: nothing. This is a leaf pure module — no dependency on `flag_identity.py` (Task 1) or any other task.
- Produces: `triage_rank(flag_code: str, evidence) -> int`, `tier_for_rank(rank: int) -> str`, and constants `TIER_ACT = "act"`, `TIER_REVIEW = "review"`, `TIER_ROUTINE = "routine"`. `flag_grouping.build_queue` (Task 3) calls `triage_rank`/`tier_for_rank` to populate each `FlagOut`'s `rank`/`tier`, and to compute each `Person`'s `rank`/`tier` as the max among their **undecided** flags. `flag_queue_api.get_flag_queue` (Task 4) passes those values through unmodified inside `entries`.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_flag_triage.py`:

```python
import unittest

from dewey_time.attendance_engine.flag_triage import (
    TIER_ACT,
    TIER_REVIEW,
    TIER_ROUTINE,
    tier_for_rank,
    triage_rank,
)


class TestTriageRankFixedCodes(unittest.TestCase):
    """Flag codes with no minute-band: rank is constant regardless of evidence."""

    def test_unnotified_absence(self):
        self.assertEqual(triage_rank("UNNOTIFIED_ABSENCE", {}), 150)

    def test_attendance_issue_and_missing_in_or_out_share_a_band(self):
        self.assertEqual(triage_rank("ATTENDANCE_ISSUE", {}), 140)
        self.assertEqual(triage_rank("MISSING_IN_OR_OUT", {}), 140)

    def test_off_shift_punch_delivery_failed_unknown_device_branch_share_a_band(self):
        self.assertEqual(triage_rank("OFF_SHIFT_PUNCH", {}), 50)
        self.assertEqual(triage_rank("DELIVERY_FAILED", {}), 50)
        self.assertEqual(triage_rank("UNKNOWN_DEVICE_BRANCH", {}), 50)

    def test_non_primary_site_punch(self):
        self.assertEqual(triage_rank("NON_PRIMARY_SITE_PUNCH", {}), 10)

    def test_missing_lunch(self):
        self.assertEqual(triage_rank("MISSING_LUNCH", {}), 5)

    def test_unknown_flag_code_returns_5(self):
        self.assertEqual(triage_rank("SOME_FUTURE_CODE", {}), 5)
        self.assertEqual(triage_rank("SOME_FUTURE_CODE", {"minutes": 999}), 5)


class TestTriageRankMissingTimeBands(unittest.TestCase):
    """MISSING_TIME: 130 + min(minutes // 60, 9) once minutes >= 120, else the flat
    60 review band. 120 is the only real boundary — there is no separate band below
    30, so values under it (including 29) still land on 60, same as a missing value."""

    def test_29_minutes_falls_to_the_only_lower_band(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 29}), 60)

    def test_30_minutes(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 30}), 60)

    def test_119_minutes_still_under_the_act_threshold(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 119}), 60)

    def test_120_minutes_crosses_into_act(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 120}), 132)

    def test_scaling_beyond_120_and_the_cap_at_9(self):
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 180}), 133)
        # 1000 // 60 == 16, which the spec's `min(..., 9)` clamps to 9.
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": 1000}), 139)

    def test_missing_or_unparseable_minutes_falls_to_lowest_band(self):
        self.assertEqual(triage_rank("MISSING_TIME", {}), 60)
        self.assertEqual(triage_rank("MISSING_TIME", None), 60)
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": "not-a-number"}), 60)
        self.assertEqual(triage_rank("MISSING_TIME", {"minutes": None}), 60)


class TestTriageRankLeftEarlyBand(unittest.TestCase):
    def test_59_minutes_is_routine(self):
        self.assertEqual(triage_rank("LEFT_EARLY", {"minutes": 59}), 25)

    def test_60_minutes_crosses_into_review(self):
        self.assertEqual(triage_rank("LEFT_EARLY", {"minutes": 60}), 70)

    def test_missing_minutes_falls_to_lowest_band(self):
        self.assertEqual(triage_rank("LEFT_EARLY", {}), 25)


class TestTriageRankLateStartBand(unittest.TestCase):
    def test_59_minutes_is_routine(self):
        self.assertEqual(triage_rank("LATE_START", {"minutes": 59}), 20)

    def test_60_minutes_crosses_into_review(self):
        self.assertEqual(triage_rank("LATE_START", {"minutes": 60}), 65)

    def test_missing_minutes_falls_to_lowest_band(self):
        self.assertEqual(triage_rank("LATE_START", {}), 20)


class TestTriageRankLateFromLunchBand(unittest.TestCase):
    def test_29_minutes_is_routine(self):
        self.assertEqual(triage_rank("LATE_FROM_LUNCH", {"minutes": 29}), 15)

    def test_30_minutes_crosses_into_review(self):
        self.assertEqual(triage_rank("LATE_FROM_LUNCH", {"minutes": 30}), 55)

    def test_missing_minutes_falls_to_lowest_band(self):
        self.assertEqual(triage_rank("LATE_FROM_LUNCH", {}), 15)


class TestTriageRankOrderings(unittest.TestCase):
    """The two orderings the spec calls out by name — the reason this module exists
    as a dimension separate from `severity` at all (see the module docstring)."""

    def test_a_3h_missing_time_outranks_a_35_minute_one(self):
        long_gap = triage_rank("MISSING_TIME", {"minutes": 180})
        short_gap = triage_rank("MISSING_TIME", {"minutes": 35})
        self.assertGreater(long_gap, short_gap)
        self.assertEqual(tier_for_rank(long_gap), TIER_ACT)
        self.assertEqual(tier_for_rank(short_gap), TIER_REVIEW)

    def test_off_shift_punch_outranks_late_start_despite_equal_severity(self):
        # Both flag codes carry FLAG_SEVERITY "WARNING" (attendance_flag.py:6-20) —
        # severity alone cannot express this ordering, which is exactly why
        # triage_rank is a second, additive dimension rather than a severity change.
        off_shift = triage_rank("OFF_SHIFT_PUNCH", {})
        modest_late_start = triage_rank("LATE_START", {"minutes": 15})
        self.assertGreater(off_shift, modest_late_start)


class TestTierForRank(unittest.TestCase):
    def test_boundary_at_100_is_act(self):
        self.assertEqual(tier_for_rank(100), TIER_ACT)
        self.assertEqual(tier_for_rank(99), TIER_REVIEW)

    def test_boundary_at_50_is_review(self):
        self.assertEqual(tier_for_rank(50), TIER_REVIEW)
        self.assertEqual(tier_for_rank(49), TIER_ROUTINE)

    def test_zero_and_negative_are_routine(self):
        self.assertEqual(tier_for_rank(0), TIER_ROUTINE)
        self.assertEqual(tier_for_rank(-1), TIER_ROUTINE)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_triage`

Expected: FAIL at collection/import time with `ModuleNotFoundError: No module named 'dewey_time.attendance_engine.flag_triage'` — the module does not exist yet.

- [ ] **Step 3: Implement `flag_triage.py`**

Create `dewey_time/attendance_engine/flag_triage.py`:

```python
"""Additive triage ranking for Attendance Flag rows, computed on read.

Pure arithmetic over a `flag_code` string and an `evidence` dict — no I/O, and no
`import frappe` anywhere in this file. That is deliberate, not incidental: Global
Constraint 4 of this plan forbids changing `severity`, either `FLAG_SEVERITY` dict, or
any of their existing consumers (`attendance_flag.py:6-20`, `closeout.py:61-75`, pinned
equal by `test_the_two_severity_maps_agree` in `test_closeout.py`). `triage_rank` is a
*second*, additive dimension that the queue API computes fresh on every read and never
persists anywhere — it exists precisely because `severity` cannot express some
orderings HR needs: LATE_START and OFF_SHIFT_PUNCH are both `WARNING`, yet the spec
ranks a device-outage punch above a routine late start (see
`test_off_shift_punch_outranks_late_start_despite_equal_severity` in the test module).
Keeping this module frappe-free means it is trivially unit-testable with zero mocking
and cannot, even by accident, touch a doctype or the database.

Table transcribed verbatim from
docs/superpowers/specs/2026-08-05-hr-flag-management-design.md,
"Triage ranking — additive, computed on read".
"""

from __future__ import annotations

TIER_ACT = "act"
TIER_REVIEW = "review"
TIER_ROUTINE = "routine"

# Flag codes whose rank doesn't depend on evidence at all.
_FIXED_RANKS = {
    "UNNOTIFIED_ABSENCE": 150,
    "ATTENDANCE_ISSUE": 140,
    "MISSING_IN_OR_OUT": 140,
    "OFF_SHIFT_PUNCH": 50,
    "DELIVERY_FAILED": 50,
    "UNKNOWN_DEVICE_BRANCH": 50,
    "NON_PRIMARY_SITE_PUNCH": 10,
    "MISSING_LUNCH": 5,
}


def _minutes(evidence) -> int | None:
    """Best-effort int `minutes` out of an evidence dict, else None.

    None covers every way the spec's "missing or unparseable" can show up: `evidence`
    isn't a dict at all (e.g. None, or a raw JSON string `flag_identity.parse_evidence`
    hasn't touched yet), the "minutes" key is absent, or its value isn't numeric.
    Every caller below treats None the same as "below the lowest threshold" — never a
    top band — because a value we cannot read is not evidence of urgency.
    """
    if not isinstance(evidence, dict):
        return None
    value = evidence.get("minutes")
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError:
            return None
    return None


def triage_rank(flag_code: str, evidence) -> int:
    """Additive rank, computed on read. Never stored. Unknown code -> 5."""
    if flag_code in _FIXED_RANKS:
        return _FIXED_RANKS[flag_code]

    minutes = _minutes(evidence)

    if flag_code == "MISSING_TIME":
        # Two bands total: >=120 min scales up through Act (130-139 via
        # 130 + min(minutes // 60, 9)); everything else — 0-119 min, and a
        # missing/unparseable `minutes` — collapses into the single Review band
        # (60). 60 already *is* "the lowest band for this code": there is no
        # separate below-30 band to fall to, so 29 min lands here too.
        if minutes is not None and minutes >= 120:
            return 130 + min(minutes // 60, 9)
        return 60

    if flag_code == "LEFT_EARLY":
        return 70 if minutes is not None and minutes >= 60 else 25

    if flag_code == "LATE_START":
        return 65 if minutes is not None and minutes >= 60 else 20

    if flag_code == "LATE_FROM_LUNCH":
        return 55 if minutes is not None and minutes >= 30 else 15

    return 5


def tier_for_rank(rank: int) -> str:
    """rank >= 100 -> "act"; rank >= 50 -> "review"; else "routine"."""
    if rank >= 100:
        return TIER_ACT
    if rank >= 50:
        return TIER_REVIEW
    return TIER_ROUTINE
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_triage`

Expected: PASS, all 26 test methods across the 7 `TestCase` classes above green (no other module's tests are touched by this task, so nothing else moves).

- [ ] **Step 5: Commit**

```bash
git add dewey_time/attendance_engine/flag_triage.py dewey_time/tests/test_flag_triage.py
git commit -m "feat(flag-triage): add additive triage_rank/tier_for_rank"
```

---

### Task 3: Person-dedup and cause grouping

**Files:**
- Create: `dewey_time/attendance_engine/flag_grouping.py`
- Test: `dewey_time/tests/test_flag_grouping.py`

**Interfaces:**

- Consumes (all from the two pure sibling modules; **nothing else is imported — no `frappe`, no `json`**):
  - `flag_identity.parse_evidence(evidence) -> dict` (Task 1) — `str | dict | None -> dict`, unparseable `-> {}`
  - `flag_identity.evidence_fingerprint(evidence) -> str` (Task 1) — 32 lowercase hex chars
  - `flag_triage.triage_rank(flag_code: str, evidence) -> int` (Task 2)
  - `flag_triage.tier_for_rank(rank: int) -> str` (Task 2)
  - `flag_triage.TIER_ROUTINE` (Task 2) — the string `"routine"`
- Produces, for Task 4 (`flag_queue_api.get_flag_queue`) and, through it, the frontend:
  - `build_queue(*, flags: list[dict], decisions_by_identity: dict[str, dict], employees_by_id: dict[str, dict], outage_branch_dates: set[tuple[str, str]]) -> dict`
    returning `{"entries": [...], "counts": {...}, "orphans": {...}}` exactly as the contract's
    Entry / Person / FlagOut shapes specify.
  - Module constants `GROUP_BRANCH_NO_DEVICE_DATA`, `GROUP_ROUTINE_CODE`, `STATE_UNDECIDED`,
    `STATE_MATCHED`, `STATE_NEEDS_RE_REVIEW`, `UNRESOLVED_STATES`, `GROUP_MIN_MEMBERS`.
  - Four judgement calls this task pins, which Tasks 4/7/8 must not re-decide:
    1. **`needs_re_review` counts as unresolved.** The spec says the mismatched decision is "not
       applied and not deleted; the flag re-enters the queue", so such a flag still ranks its
       person, still counts in `undecided_count`, and still keeps that person from clearing.
    2. **The queue's unit is a person-*day*** — `(employee, attendance_date)`. That unit appears in
       exactly one entry. One employee flagged on two dates is two entries; `counts["people"]`
       counts distinct *employees*, so they count once.
    3. **A would-be group with one member degrades to a lone person entry** (`GROUP_MIN_MEMBERS = 2`).
    4. **`counts` are flag counts over the whole input range**, including flags of people who have
       fully cleared the queue (that is what makes `decided` a useful toolbar number);
       `counts["people"]` alone is scoped to entries.

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_flag_grouping.py`:

```python
import json
import unittest
from datetime import date

from dewey_time.tests.test_closeout import _install_frappe_mock

# flag_grouping itself is frappe-free, but it imports flag_identity, which reaches
# for frappe.scrub when it builds identity suffixes (mirroring
# attendance_flag.py:39). Installing the shared mock first is what keeps this
# module runnable on the Docker-free fast lane; same idiom as test_coverage_api.py:4-6.
_install_frappe_mock()

from dewey_time.attendance_engine.flag_grouping import build_queue  # noqa: E402
from dewey_time.attendance_engine.flag_identity import evidence_fingerprint  # noqa: E402
from dewey_time.attendance_engine.flag_triage import triage_rank  # noqa: E402

DATE = "2026-08-03"
DATE2 = "2026-08-04"

_MATCH = object()


def _flag(employee, attendance_date, flag_code, *, evidence=None, identity=None,
          day_closed=1, severity="WARNING"):
    """One `Attendance Flag` row as flag_queue_api's batched read hands it over."""
    return {
        "flag_identity": identity or "AUTO-{0}-{1}-{2}".format(
            employee.lower(), attendance_date, flag_code.lower().replace("_", "-")
        ),
        "employee": employee,
        "attendance_date": attendance_date,
        "flag_code": flag_code,
        "severity": severity,
        "day_closed": day_closed,
        "evidence": {} if evidence is None else evidence,
    }


def _decision(flag, *, name="AFD-0001", outcome="EXCUSED", reason="DEVICE_OR_DATA_FAULT",
              fingerprint=_MATCH, group_key=None):
    """One live (superseded=0) `Attendance Flag Decision` row.

    `fingerprint` defaults to the flag's own fingerprint, i.e. a decision that
    still matches; pass an explicit value to simulate a corrected punch.
    """
    return {
        "name": name,
        "flag_identity": flag["flag_identity"],
        "employee": flag["employee"],
        "attendance_date": flag["attendance_date"],
        "flag_code": flag["flag_code"],
        "outcome": outcome,
        "reason": reason,
        "note": None,
        "evidence_fingerprint": (
            evidence_fingerprint(flag["evidence"]) if fingerprint is _MATCH else fingerprint
        ),
        "group_key": group_key,
        "decided_by": "hr@example.com",
        "decided_at": "2026-08-05 09:00:00",
    }


def _employees(*rows):
    """rows: (employee_id, employee_name, branch)."""
    return {emp: {"employee_name": name, "branch": branch} for emp, name, branch in rows}


def _people_in(payload):
    """Every Person in the payload, groups flattened — the dedup invariant's subject."""
    people = []
    for entry in payload["entries"]:
        if entry["kind"] == "group":
            people.extend(entry["members"])
        else:
            people.append(entry)
    return people


def _person_days(payload):
    return [(person["employee"], person["attendance_date"]) for person in _people_in(payload)]


def _groups(payload, group_type=None):
    return [
        entry
        for entry in payload["entries"]
        if entry["kind"] == "group" and (group_type is None or entry["group_type"] == group_type)
    ]


class TestPersonDedup(unittest.TestCase):
    def test_act_flag_outranks_a_routine_group_and_person_appears_once(self):
        gap = _flag(
            "EMP-1", DATE, "MISSING_TIME",
            evidence={"minutes": 180, "interval_start": "2026-08-03 10:00:00"},
        )
        late = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})
        others = [
            _flag(emp, DATE, "LATE_START", evidence={"minutes": 9})
            for emp in ("EMP-2", "EMP-3", "EMP-4")
        ]

        payload = build_queue(
            flags=[gap, late] + others,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"),
                ("EMP-2", "Ben", "BR-A"),
                ("EMP-3", "Cy", "BR-A"),
                ("EMP-4", "Dee", "BR-A"),
            ),
            outage_branch_dates=set(),
        )

        head = payload["entries"][0]
        self.assertEqual(head["kind"], "person")
        self.assertEqual(head["employee"], "EMP-1")
        self.assertEqual(head["tier"], "act")
        self.assertEqual([f["flag_code"] for f in head["flags"]], ["MISSING_TIME", "LATE_START"])
        self.assertEqual(head["undecided_count"], 2)

        routine = _groups(payload, "ROUTINE_CODE")
        self.assertEqual(len(routine), 1)
        self.assertEqual(routine[0]["tier"], "routine")
        self.assertEqual([m["employee"] for m in routine[0]["members"]], ["EMP-2", "EMP-3", "EMP-4"])
        self.assertNotIn("EMP-1", [m["employee"] for m in routine[0]["members"]])
        self.assertEqual(_person_days(payload).count(("EMP-1", DATE)), 1)

    def test_no_person_day_appears_in_two_entries(self):
        flags = [
            _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-1", DATE, "NON_PRIMARY_SITE_PUNCH"),
            _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-2", DATE, "UNNOTIFIED_ABSENCE"),
            _flag("EMP-3", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-4", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-4", DATE2, "LATE_START", evidence={"minutes": 9}),
        ]

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"),
                ("EMP-2", "Ben", "BR-A"),
                ("EMP-3", "Cy", "BR-A"),
                ("EMP-4", "Dee", "BR-A"),
            ),
            outage_branch_dates=set(),
        )

        days = _person_days(payload)
        self.assertEqual(len(days), len(set(days)))
        self.assertEqual(sorted(d for emp, d in days if emp == "EMP-4"), [DATE, DATE2])
        # EMP-2's absence is act tier, so their routine LATE_START must not pull
        # them into the routine group.
        routine_members = [m["employee"] for m in _groups(payload, "ROUTINE_CODE")[0]["members"]]
        self.assertNotIn("EMP-2", routine_members)

    def test_one_employee_flagged_on_two_days_is_two_entries_but_one_person(self):
        payload = build_queue(
            flags=[
                _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE"),
                _flag("EMP-1", DATE2, "UNNOTIFIED_ABSENCE"),
            ],
            decisions_by_identity={},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(len(payload["entries"]), 2)
        self.assertEqual(sorted(e["attendance_date"] for e in payload["entries"]), [DATE, DATE2])
        self.assertEqual(payload["counts"]["people"], 1)

    def test_unknown_employee_row_still_yields_a_person(self):
        payload = build_queue(
            flags=[_flag("EMP-404", DATE, "UNNOTIFIED_ABSENCE")],
            decisions_by_identity={},
            employees_by_id={},
            outage_branch_dates=set(),
        )

        person = payload["entries"][0]
        self.assertEqual(person["employee_name"], "EMP-404")
        self.assertIsNone(person["employee_branch"])


class TestBranchOutageGrouping(unittest.TestCase):
    def test_outage_branch_claims_people_who_only_have_routine_flags(self):
        flags = [
            _flag(emp, DATE, "LATE_START", evidence={"minutes": 9})
            for emp in ("EMP-1", "EMP-2", "EMP-3", "EMP-4")
        ]

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "Phnom Penh HQ"),
                ("EMP-2", "Ben", "Phnom Penh HQ"),
                ("EMP-3", "Cy", "Siem Reap"),
                ("EMP-4", "Dee", "Siem Reap"),
            ),
            outage_branch_dates={("Phnom Penh HQ", DATE)},
        )

        outage = _groups(payload, "BRANCH_NO_DEVICE_DATA")
        self.assertEqual(len(outage), 1)
        self.assertEqual(outage[0]["group_key"], "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ:" + DATE)
        self.assertEqual(outage[0]["branch"], "Phnom Penh HQ")
        self.assertIsNone(outage[0]["flag_code"])
        self.assertEqual([m["employee"] for m in outage[0]["members"]], ["EMP-1", "EMP-2"])

        routine = _groups(payload, "ROUTINE_CODE")
        self.assertEqual([m["employee"] for m in routine[0]["members"]], ["EMP-3", "EMP-4"])
        days = _person_days(payload)
        self.assertEqual(len(days), len(set(days)))

    def test_outage_group_carries_the_rank_of_its_worst_member(self):
        payload = build_queue(
            flags=[
                _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE"),
                _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 9}),
            ],
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "Phnom Penh HQ"),
                ("EMP-2", "Ben", "Phnom Penh HQ"),
            ),
            outage_branch_dates={("Phnom Penh HQ", DATE)},
        )

        group = _groups(payload, "BRANCH_NO_DEVICE_DATA")[0]
        self.assertEqual(group["rank"], triage_rank("UNNOTIFIED_ABSENCE", {}))
        self.assertEqual(group["tier"], "act")
        self.assertEqual([m["employee"] for m in group["members"]], ["EMP-1", "EMP-2"])

    def test_a_group_of_one_degrades_to_a_lone_person_entry(self):
        employees = _employees(("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-B"))
        # Two routine people, two different codes -> two would-be groups of one.
        payload = build_queue(
            flags=[
                _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9}),
                _flag("EMP-2", DATE, "NON_PRIMARY_SITE_PUNCH"),
            ],
            decisions_by_identity={},
            employees_by_id=employees,
            outage_branch_dates=set(),
        )
        self.assertEqual([e["kind"] for e in payload["entries"]], ["person", "person"])
        self.assertEqual(_groups(payload), [])

        # Same rule for a dark branch with a single flagged employee.
        solo = build_queue(
            flags=[_flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 9})],
            decisions_by_identity={},
            employees_by_id=employees,
            outage_branch_dates={("BR-A", DATE)},
        )
        self.assertEqual([e["kind"] for e in solo["entries"]], ["person"])

    def test_date_objects_from_the_database_normalise_to_iso_strings(self):
        # frappe.get_all returns datetime.date; the outage set is built from
        # string dates. Both must land in the same group key.
        payload = build_queue(
            flags=[
                _flag("EMP-1", date(2026, 8, 3), "LATE_START", evidence={"minutes": 9}),
                _flag("EMP-2", date(2026, 8, 3), "LATE_START", evidence={"minutes": 9}),
            ],
            decisions_by_identity={},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A")),
            outage_branch_dates={("BR-A", "2026-08-03")},
        )

        group = _groups(payload, "BRANCH_NO_DEVICE_DATA")[0]
        self.assertEqual(group["group_key"], "BRANCH_NO_DEVICE_DATA:BR-A:2026-08-03")
        self.assertEqual(group["attendance_date"], "2026-08-03")
        self.assertEqual([m["attendance_date"] for m in group["members"]], ["2026-08-03"] * 2)


class TestDecisionState(unittest.TestCase):
    def test_fingerprint_mismatch_is_needs_re_review_with_the_decision_as_context(self):
        flag = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 90})
        stale = _decision(flag, name="AFD-0007", fingerprint=evidence_fingerprint({"minutes": 6}))

        payload = build_queue(
            flags=[flag],
            decisions_by_identity={flag["flag_identity"]: stale},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        person = payload["entries"][0]
        out = person["flags"][0]
        self.assertEqual(out["decision_state"], "needs_re_review")
        self.assertEqual(out["decision"]["name"], "AFD-0007")
        self.assertEqual(out["decision"]["outcome"], "EXCUSED")
        self.assertEqual(person["undecided_count"], 1)
        self.assertEqual(
            payload["counts"], {"open": 0, "needs_re_review": 1, "decided": 0, "people": 1}
        )
        self.assertEqual(
            payload["orphans"], {"orphaned_flag_gone": 0, "orphaned_evidence_changed": 0}
        )

    def test_matching_fingerprint_clears_the_person_from_the_queue(self):
        flag = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 90})

        payload = build_queue(
            flags=[flag],
            decisions_by_identity={flag["flag_identity"]: _decision(flag)},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(payload["entries"], [])
        self.assertEqual(
            payload["counts"], {"open": 0, "needs_re_review": 0, "decided": 1, "people": 0}
        )

    def test_decision_without_a_stored_fingerprint_is_needs_re_review(self):
        # Rows migrated out of the old Desk workflow carry no fingerprint. A match
        # that cannot be proven must not silently excuse a flag.
        flag = _flag("EMP-1", DATE, "LATE_START", evidence={"minutes": 90})

        payload = build_queue(
            flags=[flag],
            decisions_by_identity={flag["flag_identity"]: _decision(flag, fingerprint=None)},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(payload["entries"][0]["flags"][0]["decision_state"], "needs_re_review")

    def test_partially_decided_people_rank_by_their_remaining_flag(self):
        flags = []
        decisions = {}
        for emp in ("EMP-1", "EMP-2"):
            absence = _flag(emp, DATE, "UNNOTIFIED_ABSENCE")
            late = _flag(emp, DATE, "LATE_START", evidence={"minutes": 9})
            flags.extend([absence, late])
            decisions[absence["flag_identity"]] = _decision(absence, name="AFD-" + emp)

        payload = build_queue(
            flags=flags,
            decisions_by_identity=decisions,
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A")),
            outage_branch_dates=set(),
        )

        group = _groups(payload, "ROUTINE_CODE")[0]
        self.assertEqual(group["flag_code"], "LATE_START")
        self.assertEqual(group["rank"], triage_rank("LATE_START", {"minutes": 9}))
        member = group["members"][0]
        self.assertEqual(member["undecided_count"], 1)
        # The decided act flag stays on the person, worst-first, so the right pane
        # can still show the whole day.
        self.assertEqual([f["flag_code"] for f in member["flags"]], ["UNNOTIFIED_ABSENCE", "LATE_START"])
        self.assertEqual(member["flags"][0]["decision_state"], "matched")
        self.assertEqual(
            payload["counts"], {"open": 2, "needs_re_review": 0, "decided": 2, "people": 2}
        )

    def test_evidence_arrives_as_json_text_from_the_database(self):
        flag = _flag(
            "EMP-1", DATE, "MISSING_TIME",
            evidence=json.dumps({"minutes": 180, "interval_start": "2026-08-03 10:00:00"}),
        )

        payload = build_queue(
            flags=[flag],
            decisions_by_identity={},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        out = payload["entries"][0]["flags"][0]
        self.assertEqual(out["evidence"]["minutes"], 180)
        self.assertEqual(out["tier"], "act")


class TestOrphans(unittest.TestCase):
    def test_decision_with_no_live_flag_is_orphaned_flag_gone_and_shows_nowhere(self):
        live = _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE")
        vanished = _flag(
            "EMP-9", DATE, "MISSING_TIME",
            evidence={"minutes": 45, "interval_start": "2026-08-03 10:00:00"},
        )

        payload = build_queue(
            flags=[live],
            decisions_by_identity={vanished["flag_identity"]: _decision(vanished)},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A"), ("EMP-9", "Zed", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(
            payload["orphans"], {"orphaned_flag_gone": 1, "orphaned_evidence_changed": 0}
        )
        self.assertNotIn("EMP-9", [p["employee"] for p in _people_in(payload)])
        self.assertEqual(payload["counts"]["people"], 1)

    def test_decision_under_a_superseded_evidence_key_is_orphaned_evidence_changed(self):
        old = _flag(
            "EMP-1", DATE, "MISSING_TIME",
            evidence={"minutes": 45, "interval_start": "2026-08-03 10:00:00"},
            identity="AUTO-emp-1-2026-08-03-missing-time-2026-08-03-100000",
        )
        new = _flag(
            "EMP-1", DATE, "MISSING_TIME",
            evidence={"minutes": 45, "interval_start": "2026-08-03 10:15:00"},
            identity="AUTO-emp-1-2026-08-03-missing-time-2026-08-03-101500",
        )

        payload = build_queue(
            flags=[new],
            decisions_by_identity={old["flag_identity"]: _decision(old)},
            employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
            outage_branch_dates=set(),
        )

        self.assertEqual(
            payload["orphans"], {"orphaned_flag_gone": 0, "orphaned_evidence_changed": 1}
        )
        out = payload["entries"][0]["flags"][0]
        self.assertEqual(out["decision_state"], "undecided")
        self.assertIsNone(out["decision"])


class TestCounts(unittest.TestCase):
    def test_counts_people_is_distinct_employees_across_every_entry(self):
        flags = [
            _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE"),
            _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-3", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-4", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-5", DATE, "LATE_START", evidence={"minutes": 9}),
            _flag("EMP-1", DATE2, "LATE_START", evidence={"minutes": 9}),
        ]

        payload = build_queue(
            flags=flags,
            decisions_by_identity={},
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"),
                ("EMP-2", "Ben", "BR-A"),
                ("EMP-3", "Cy", "BR-A"),
                ("EMP-4", "Dee", "Phnom Penh HQ"),
                ("EMP-5", "Eve", "Phnom Penh HQ"),
            ),
            outage_branch_dates={("Phnom Penh HQ", DATE)},
        )

        self.assertEqual(len(_person_days(payload)), 6)
        self.assertEqual(payload["counts"]["people"], 5)
        self.assertEqual(
            payload["counts"]["people"], len({p["employee"] for p in _people_in(payload)})
        )

    def test_counts_split_by_decision_state_over_the_whole_range(self):
        undecided = _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE")
        decided = _flag("EMP-2", DATE, "LATE_START", evidence={"minutes": 90})
        stale = _flag("EMP-3", DATE, "LEFT_EARLY", evidence={"minutes": 90})

        payload = build_queue(
            flags=[undecided, decided, stale],
            decisions_by_identity={
                decided["flag_identity"]: _decision(decided, name="AFD-1"),
                stale["flag_identity"]: _decision(
                    stale, name="AFD-2", fingerprint=evidence_fingerprint({"minutes": 5})
                ),
            },
            employees_by_id=_employees(
                ("EMP-1", "Ana", "BR-A"), ("EMP-2", "Ben", "BR-A"), ("EMP-3", "Cy", "BR-A")
            ),
            outage_branch_dates=set(),
        )

        # EMP-2 has cleared the queue, but their decided flag still counts — the
        # toolbar reports work done over the range, not just work outstanding.
        self.assertEqual(
            payload["counts"], {"open": 1, "needs_re_review": 1, "decided": 1, "people": 2}
        )
        self.assertNotIn("EMP-2", [p["employee"] for p in _people_in(payload)])


class TestProvisionalFinalCollision(unittest.TestCase):
    def test_provisional_and_final_rows_for_one_identity_collapse_to_the_final(self):
        identity = "AUTO-emp-1-2026-08-03-unnotified-absence"
        provisional = _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE", identity=identity, day_closed=0)
        final = _flag("EMP-1", DATE, "UNNOTIFIED_ABSENCE", identity=identity, day_closed=1)

        for order in ([provisional, final], [final, provisional]):
            with self.subTest(first=order[0]["day_closed"]):
                payload = build_queue(
                    flags=order,
                    decisions_by_identity={},
                    employees_by_id=_employees(("EMP-1", "Ana", "BR-A")),
                    outage_branch_dates=set(),
                )
                person = payload["entries"][0]
                self.assertEqual(len(person["flags"]), 1)
                self.assertEqual(person["flags"][0]["day_closed"], 1)
                self.assertEqual(person["undecided_count"], 1)
                self.assertEqual(payload["counts"]["open"], 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run (fast lane — no Docker, mirrors `dev/sandbox/frappe_sandbox/commands.py:56-66`):

```bash
cd /Users/lolbikb/projects/dewey-time && PYTHONPATH=$PWD python3 -m unittest dewey_time.tests.test_flag_grouping -v
```

Expected: FAIL — the run aborts during import with
`ModuleNotFoundError: No module named 'dewey_time.attendance_engine.flag_grouping'`
(0 tests run). Nothing in the repo answers `build_queue` yet, so every assertion below is
currently unreachable, not merely unasserted.

CI-parity form of the same run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_grouping`.

- [ ] **Step 3: Create the module with its constants and public entry point**

Create `dewey_time/attendance_engine/flag_grouping.py`:

```python
"""Person-dedup and cause grouping for the HR flag queue.

Pure module: no frappe import, no queries, no I/O. `flag_queue_api` owns every
read (its query budget is O(1) in employee count) and hands the result sets in as
plain dicts; everything here is a transformation over those dicts. That is what
lets the invariant this module exists to guarantee — a person-day appears in
exactly one entry — be tested without a bench.

Spec: docs/superpowers/specs/2026-08-05-hr-flag-management-design.md, sections
"Triage ranking — additive, computed on read" and "Cause grouping — branch level".
"""

from __future__ import annotations

from dewey_time.attendance_engine.flag_identity import evidence_fingerprint, parse_evidence
from dewey_time.attendance_engine.flag_triage import TIER_ROUTINE, tier_for_rank, triage_rank

GROUP_BRANCH_NO_DEVICE_DATA = "BRANCH_NO_DEVICE_DATA"
GROUP_ROUTINE_CODE = "ROUTINE_CODE"

STATE_UNDECIDED = "undecided"
STATE_MATCHED = "matched"
STATE_NEEDS_RE_REVIEW = "needs_re_review"

# A flag that still owes HR an answer. `needs_re_review` belongs here on purpose:
# per the spec a fingerprint mismatch means the decision is "not applied and not
# deleted; the flag re-enters the queue with its prior decision shown as
# context", so it must still rank its person and still keep that person from
# clearing the queue.
UNRESOLVED_STATES = (STATE_UNDECIDED, STATE_NEEDS_RE_REVIEW)

# Both cause groups are defined by people *sharing* a key ("employees sharing
# (Employee.branch, attendance_date)"). A one-member group card would bury a
# person row behind an expander and an all-checked member list for no gain, so a
# would-be group of one degrades back to a lone person entry.
GROUP_MIN_MEMBERS = 2


def build_queue(
    *,
    flags: list[dict],
    decisions_by_identity: dict[str, dict],
    employees_by_id: dict[str, dict],
    outage_branch_dates: set[tuple[str, str]],
) -> dict:
    """Rank, dedup and group live flags against live decisions.

    `flags` are `Attendance Flag` rows (flag_identity, employee, attendance_date,
    flag_code, severity, day_closed, evidence); `decisions_by_identity` holds only
    live (superseded=0) `Attendance Flag Decision` rows; `employees_by_id` maps an
    employee id to {employee_name, branch}; `outage_branch_dates` holds
    (branch, "YYYY-MM-DD") pairs with an open closeout alert or no sync watermark.

    Returns {"entries", "counts", "orphans"}. Counts are flag counts over the
    whole input — including flags belonging to people who have fully cleared the
    queue, which is what makes `decided` a meaningful toolbar number — while
    `counts["people"]` counts distinct employees actually present in `entries`.
    """
    counts = {"open": 0, "needs_re_review": 0, "decided": 0, "people": 0}
    by_person: dict[tuple[str, str], dict[str, dict]] = {}
    live_identities: set[str] = set()
    live_code_keys: set[tuple] = set()

    for flag in flags:
        employee = flag.get("employee")
        if not employee:
            continue
        date_str = _date_str(flag.get("attendance_date"))
        flag_out = _flag_out(flag, decisions_by_identity)
        live_identities.add(flag_out["flag_identity"])
        live_code_keys.add((employee, date_str, flag_out["flag_code"]))

        bucket = by_person.setdefault((employee, date_str), {})
        previous = bucket.get(flag_out["flag_identity"])
        # flag_identity deliberately excludes day_closed (spec: "a provisional flag
        # and the final flag that replaces it share one identity"), so the two rows
        # collide here whenever both are briefly live. Closeout is the authority:
        # the final wins and the day is counted once.
        if previous is None or flag_out["day_closed"] > previous["day_closed"]:
            bucket[flag_out["flag_identity"]] = flag_out

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
        person = _person(employee, date_str, person_flags, employees_by_id)
        # A person leaves the queue only once every flag of theirs is settled.
        if person["undecided_count"]:
            persons.append(person)

    entries = _entries_for(persons, outage_branch_dates)
    entries.sort(key=_entry_sort_key)
    counts["people"] = len({person["employee"] for person in _iter_people(entries)})

    return {
        "entries": entries,
        "counts": counts,
        "orphans": _orphans(decisions_by_identity, live_identities, live_code_keys),
    }
```

- [ ] **Step 4: Add the per-flag and per-person builders**

Append to `dewey_time/attendance_engine/flag_grouping.py`:

```python
def _date_str(value) -> str:
    """Frappe returns dates as datetime.date from get_all but as str from the
    client, and both must land in the same group key and outage lookup."""
    if value is None:
        return ""
    return str(value)[:10]


def _flag_out(flag: dict, decisions_by_identity: dict[str, dict]) -> dict:
    """One FlagOut: rank, tier, and how its live decision (if any) currently stands."""
    identity = flag.get("flag_identity") or ""
    evidence = parse_evidence(flag.get("evidence"))
    rank = triage_rank(flag.get("flag_code") or "", evidence)
    decision = decisions_by_identity.get(identity)

    if decision is None:
        state = STATE_UNDECIDED
    elif (decision.get("evidence_fingerprint") or "") == evidence_fingerprint(evidence):
        state = STATE_MATCHED
    else:
        # Includes decisions with no stored fingerprint at all (rows migrated out
        # of the old Desk workflow): a match that cannot be proven must surface
        # for re-review rather than silently excuse a corrected flag.
        state = STATE_NEEDS_RE_REVIEW

    return {
        "flag_identity": identity,
        "flag_code": flag.get("flag_code"),
        "severity": flag.get("severity"),
        "day_closed": int(flag.get("day_closed") or 0),
        "evidence": evidence,
        "rank": rank,
        "tier": tier_for_rank(rank),
        "decision_state": state,
        "decision": decision,
    }


def _person(employee: str, date_str: str, person_flags: list[dict], employees_by_id: dict) -> dict:
    """One Person. `person_flags` must already be worst-first."""
    meta = employees_by_id.get(employee) or {}
    unresolved = [f for f in person_flags if f["decision_state"] in UNRESOLVED_STATES]
    rank = max((f["rank"] for f in unresolved), default=0)
    return {
        "employee": employee,
        # An Employee row can be missing from the batch (deleted, or outside the
        # employee query's filters). Show the id rather than dropping someone who
        # still owes HR a decision.
        "employee_name": meta.get("employee_name") or employee,
        "employee_branch": meta.get("branch"),
        "attendance_date": date_str,
        # Rank and tier come from the worst *unresolved* flag only: a decided
        # absence must not keep its person out of tomorrow's routine group.
        "rank": rank,
        "tier": tier_for_rank(rank),
        # Every flag that person has that day, decided ones included, so the right
        # pane can show the whole day.
        "flags": person_flags,
        "undecided_count": len(unresolved),
    }


def _top_unresolved(person: dict) -> dict | None:
    for flag_out in person["flags"]:  # already worst-first
        if flag_out["decision_state"] in UNRESOLVED_STATES:
            return flag_out
    return None
```

- [ ] **Step 5: Add cause grouping**

Append to `dewey_time/attendance_engine/flag_grouping.py`:

```python
def _entries_for(persons: list[dict], outage_branch_dates: set) -> list[dict]:
    """Place each person in the first group that claims them, else on their own.

    Precedence is BRANCH_NO_DEVICE_DATA, then ROUTINE_CODE, then ungrouped —
    a person is claimed once and never considered again.
    """
    branch_groups: dict[str, dict] = {}
    routine_groups: dict[str, dict] = {}
    loners: list[dict] = []

    for person in persons:
        date_str = person["attendance_date"]
        branch = person["employee_branch"]

        if branch and (branch, date_str) in outage_branch_dates:
            key = "{0}:{1}:{2}".format(GROUP_BRANCH_NO_DEVICE_DATA, branch, date_str)
            group = branch_groups.setdefault(
                key,
                {"branch": branch, "flag_code": None, "attendance_date": date_str, "members": []},
            )
            group["members"].append(person)
            continue

        # Routine grouping keys off the person's WORST unresolved flag, never off
        # a routine flag they merely also have: someone 9 minutes late who also
        # has a 3h gap must land under the gap. person["tier"] is that worst
        # flag's tier by construction (_person).
        top = _top_unresolved(person)
        if top is not None and person["tier"] == TIER_ROUTINE:
            key = "{0}:{1}:{2}".format(GROUP_ROUTINE_CODE, top["flag_code"], date_str)
            group = routine_groups.setdefault(
                key,
                {
                    "branch": None,
                    "flag_code": top["flag_code"],
                    "attendance_date": date_str,
                    "members": [],
                },
            )
            group["members"].append(person)
            continue

        loners.append(person)

    entries: list[dict] = []
    for group_type, holder in (
        (GROUP_BRANCH_NO_DEVICE_DATA, branch_groups),
        (GROUP_ROUTINE_CODE, routine_groups),
    ):
        for key, group in holder.items():
            if len(group["members"]) < GROUP_MIN_MEMBERS:
                loners.extend(group["members"])
                continue
            members = sorted(group["members"], key=_member_sort_key)
            rank = max(member["rank"] for member in members)
            entries.append(
                {
                    "kind": "group",
                    "group_type": group_type,
                    "group_key": key,
                    "branch": group["branch"],
                    "flag_code": group["flag_code"],
                    "attendance_date": group["attendance_date"],
                    "rank": rank,
                    "tier": tier_for_rank(rank),
                    "members": members,
                }
            )

    for person in loners:
        entries.append({"kind": "person", **person})

    return entries
```

- [ ] **Step 6: Add orphan classification, sorting and iteration helpers**

Append to `dewey_time/attendance_engine/flag_grouping.py`:

```python
def _orphans(
    decisions_by_identity: dict[str, dict],
    live_identities: set,
    live_code_keys: set,
) -> dict:
    """Count decisions that matched no live flag. They never enter `entries`.

    Retained forever for audit (spec: "Orphaned decisions are retained forever and
    never shown as applied"); the queue only reports how many there are.
    """
    orphans = {"orphaned_flag_gone": 0, "orphaned_evidence_changed": 0}
    for identity, decision in decisions_by_identity.items():
        if identity in live_identities:
            continue
        code_key = (
            decision.get("employee"),
            _date_str(decision.get("attendance_date")),
            decision.get("flag_code"),
        )
        # Same employee/date/code still flagged under a different identity -> the
        # punch underneath was corrected and the evidence suffix moved. Nothing
        # there at all -> the flag was corrected away or deleted outright.
        if code_key in live_code_keys:
            orphans["orphaned_evidence_changed"] += 1
        else:
            orphans["orphaned_flag_gone"] += 1
    return orphans


def _flag_sort_key(flag_out: dict) -> tuple:
    return (-flag_out["rank"], flag_out["flag_code"] or "", flag_out["flag_identity"])


def _member_sort_key(person: dict) -> tuple:
    return (-person["rank"], (person["employee_name"] or "").lower(), person["employee"])


def _entry_sort_key(entry: dict) -> tuple:
    """Rank first, so a lone 3h gap can outrank a 168-member routine group; then
    blast radius; then a stable string so two runs of the same data never reorder."""
    if entry["kind"] == "group":
        return (-entry["rank"], -len(entry["members"]), entry["group_key"])
    return (-entry["rank"], -1, "{0}|{1}".format(entry["employee"], entry["attendance_date"]))


def _iter_people(entries: list[dict]):
    for entry in entries:
        if entry["kind"] == "group":
            for member in entry["members"]:
                yield member
        else:
            yield entry
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd /Users/lolbikb/projects/dewey-time && PYTHONPATH=$PWD python3 -m unittest dewey_time.tests.test_flag_grouping -v
```

Expected: `OK`, **18 tests** run (4 + 4 + 5 + 2 + 2 + 1 across the six classes). If the count is
lower, a class or method was dropped — read the
count, do not trust the word OK (`test:web`-style silent no-runs have bitten this repo before).

- [ ] **Step 8: Run the neighbouring pure-module tests for regressions**

```bash
cd /Users/lolbikb/projects/dewey-time && PYTHONPATH=$PWD python3 -m unittest dewey_time.tests.test_flag_identity dewey_time.tests.test_flag_triage dewey_time.tests.test_flag_grouping
```

Expected: `OK`. This module is additive and imports only Tasks 1–2, so a failure here means an
import cycle or a changed signature in `flag_identity` / `flag_triage`, not a grouping bug.

- [ ] **Step 9: Commit**

```bash
git add dewey_time/attendance_engine/flag_grouping.py dewey_time/tests/test_flag_grouping.py
git commit -m "feat(flag-queue): person-dedup and branch/routine cause grouping" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Attendance Flag Decision doctype

**Files:**
- Create: `dewey_time/dewey_time/doctype/attendance_flag_decision/__init__.py`
- Create: `dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.json`
- Create: `dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.py`
- Modify: `dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json:75-79` (attendance_date), `:85-90` (flag_code), `:103-108` (status), `:160-175` (hr_note/hr_user/hr_decided_at), `:194` (modified)
- Test: `dewey_time/tests/test_flag_decision_doctype.py`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is the first task that touches the schema. Global Constraint 13 (bump `modified` or `bench migrate` skips the reimport) and Global Constraint 1 (only `attendance_flag.json` may change on the `Attendance Flag` side, never `attendance_flag.py`'s `before_insert` or `FLAG_SEVERITY`) both apply directly.
- Produces: the `Attendance Flag Decision` doctype — fields `flag_identity, employee, attendance_date, flag_code, employee_branch, outcome, reason, note, evidence_fingerprint, group_key, decided_by, decided_at, supersedes, superseded`, `autoname: hash`, `search_index` on `flag_identity`/`attendance_date`/`superseded` — that `flag_decision_api.decide_flags`/`reverse_decision_group` write to via `frappe.get_doc({...}).insert()` and `frappe.db.set_value(..., "superseded", 1)`, and that `flag_grouping.build_queue`'s `decisions_by_identity: dict[str, dict]` parameter is populated from. The doctype's `outcome`/`reason`/`note`/`decided_by`/`decided_at`/`group_key` fields are the exact superset backing the contract's TS `FlagDecision` shape (`name, outcome, reason, note, decided_by, decided_at, group_key`). `Attendance Flag`'s `status`, `hr_note`, `hr_user`, `hr_decided_at` remain present and readable (not dropped) — the later legacy-migration patch task reads them by field name. `Attendance Flag`'s new `search_index` on `attendance_date`/`flag_code`/`status` backs `flag_queue_api.get_flag_queue`'s batched range query.

- [ ] **Step 1: Write the failing test**

```python
# dewey_time/tests/test_flag_decision_doctype.py
import json
import os
import sys
import unittest
from datetime import date
from types import ModuleType
from unittest.mock import MagicMock


# Same idiom as dewey_time/tests/test_closeout.py:24-96 — mock frappe wholesale
# so this runs without a live bench where possible. Kept local (not imported
# from test_closeout) because bench's test discovery loads modules independently
# and importing across test modules for a helper is not the established pattern
# in this test suite.
def _install_frappe_mock():
    if "frappe" in sys.modules and isinstance(sys.modules["frappe"], MagicMock):
        return

    frappe = MagicMock(name="frappe")
    frappe.throw = MagicMock(
        side_effect=lambda msg, exc=None: (_ for _ in ()).throw(exc or Exception(msg))
    )
    frappe.session = MagicMock(user="Guest")
    frappe.scrub = lambda value: str(value).lower().replace(" ", "-").replace("_", "-")

    model_mod = ModuleType("frappe.model.document")

    class Document:
        def __init__(self, *args, **kwargs):
            payload = {}
            if args and isinstance(args[0], dict):
                payload.update(args[0])
            payload.update(kwargs)
            self.__dict__.update(payload)

    model_mod.Document = Document

    sys.modules["frappe"] = frappe
    sys.modules["frappe.model.document"] = model_mod


_install_frappe_mock()


# Resolve doctype JSON paths from __file__, never the CWD — bench run-tests
# runs from the bench directory, not this repo, so a repo-relative path
# ("dewey_time/dewey_time/doctype/...") silently fails to open there.
_DOCTYPE_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dewey_time", "doctype")
)


def _load_doctype_json(doctype_folder, filename):
    path = os.path.join(_DOCTYPE_DIR, doctype_folder, filename)
    with open(path) as fh:
        return json.load(fh)


def _fields_by_name(doctype_json):
    return {f["fieldname"]: f for f in doctype_json["fields"]}


class TestAttendanceFlagDecisionValidate(unittest.TestCase):
    """The controller's *only* rule: note required when reason == OTHER or
    outcome == UPHELD. decided_by/decided_at/supersedes/superseded are set by
    flag_decision_api.py, not validate() — test_validate_does_not_touch_
    supersession_fields below guards against that boundary eroding."""

    def _doc(self, **overrides):
        from dewey_time.dewey_time.doctype.attendance_flag_decision.attendance_flag_decision import (
            AttendanceFlagDecision,
        )

        defaults = {
            "flag_identity": "AUTO-hr-emp-00001-2026-08-01-late-start",
            "employee": "HR-EMP-00001",
            "attendance_date": date(2026, 8, 1),
            "flag_code": "LATE_START",
            "outcome": "EXCUSED",
            "reason": "APPROVED_LEAVE",
            "note": "",
        }
        defaults.update(overrides)
        return AttendanceFlagDecision(defaults)

    def test_note_required_for_reason_other(self):
        doc = self._doc(reason="OTHER", note="")
        with self.assertRaises(Exception):
            doc.validate()

        doc_with_note = self._doc(
            reason="OTHER", note="Covered a colleague's shift, approved verbally."
        )
        doc_with_note.validate()  # must not raise

    def test_note_required_for_outcome_upheld(self):
        doc = self._doc(outcome="UPHELD", reason="GENUINE_VIOLATION", note="")
        with self.assertRaises(Exception):
            doc.validate()

        doc_with_note = self._doc(
            outcome="UPHELD",
            reason="GENUINE_VIOLATION",
            note="No-call no-show, confirmed with manager.",
        )
        doc_with_note.validate()  # must not raise

    def test_note_not_required_for_plain_excused_non_other_reason(self):
        doc = self._doc(outcome="EXCUSED", reason="APPROVED_LEAVE", note="")
        doc.validate()  # must not raise

    def test_validate_does_not_touch_supersession_fields(self):
        # decided_by/decided_at/supersedes/superseded are the API layer's
        # job (flag_decision_api.py, a later task). validate() must leave
        # them exactly as constructed, whatever they were set to.
        doc = self._doc(
            outcome="EXCUSED",
            reason="APPROVED_LEAVE",
            note="",
            decided_by="PRESET",
            decided_at="PRESET",
            supersedes="PRESET",
            superseded="PRESET",
        )
        doc.validate()
        self.assertEqual(doc.decided_by, "PRESET")
        self.assertEqual(doc.decided_at, "PRESET")
        self.assertEqual(doc.supersedes, "PRESET")
        self.assertEqual(doc.superseded, "PRESET")


class TestAttendanceFlagDecisionJson(unittest.TestCase):
    def test_search_index_fields_present(self):
        fields = _fields_by_name(
            _load_doctype_json("attendance_flag_decision", "attendance_flag_decision.json")
        )
        for fieldname in ("flag_identity", "attendance_date", "superseded"):
            self.assertEqual(
                fields[fieldname].get("search_index"),
                1,
                f"{fieldname} is missing search_index: 1",
            )

    def test_autoname_is_hash(self):
        doctype_json = _load_doctype_json(
            "attendance_flag_decision", "attendance_flag_decision.json"
        )
        self.assertEqual(doctype_json.get("autoname"), "hash")


class TestAttendanceFlagJsonDeprecation(unittest.TestCase):
    def test_search_index_fields_present(self):
        fields = _fields_by_name(_load_doctype_json("attendance_flag", "attendance_flag.json"))
        for fieldname in ("attendance_date", "flag_code", "status"):
            self.assertEqual(
                fields[fieldname].get("search_index"),
                1,
                f"{fieldname} is missing search_index: 1",
            )

    def test_deprecated_fields_are_read_only_and_relabelled(self):
        fields = _fields_by_name(_load_doctype_json("attendance_flag", "attendance_flag.json"))
        for fieldname in ("status", "hr_note", "hr_user", "hr_decided_at"):
            field = fields[fieldname]
            self.assertEqual(field.get("read_only"), 1, f"{fieldname} is not read_only")
            label = field.get("label", "")
            self.assertTrue(
                label.startswith("(deprecated) "),
                f"{fieldname} label {label!r} is not prefixed '(deprecated) '",
            )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_decision_doctype`

Expected: FAIL. Every test errors or fails, for two distinct pre-change reasons:

- `TestAttendanceFlagDecisionValidate.*` and `TestAttendanceFlagDecisionJson.*` raise `ModuleNotFoundError: No module named 'dewey_time.dewey_time.doctype.attendance_flag_decision'` (nothing under that path exists yet) — the `TestAttendanceFlagDecisionJson` cases fail the same way at `_load_doctype_json`, via `FileNotFoundError: [Errno 2] No such file or directory: '.../doctype/attendance_flag_decision/attendance_flag_decision.json'`.
- `TestAttendanceFlagJsonDeprecation.test_search_index_fields_present` fails with `AssertionError: None != 1` (today's `attendance_flag.json` has no `search_index` key on `attendance_date`/`flag_code`/`status`).
- `TestAttendanceFlagJsonDeprecation.test_deprecated_fields_are_read_only_and_relabelled` fails with `AssertionError: None != 1` (`status`/`hr_note`/`hr_user`/`hr_decided_at` are not `read_only` today) before it would even reach the label assertion.

- [ ] **Step 3: Create the doctype package `__init__.py`**

```python
# dewey_time/dewey_time/doctype/attendance_flag_decision/__init__.py
```

(empty file — matches `attendance_flag/__init__.py`, `schedule_change_log/__init__.py`)

- [ ] **Step 4: Create the doctype JSON**

```json
{
  "actions": [],
  "allow_copy": 0,
  "allow_guest_to_view": 0,
  "allow_import": 0,
  "allow_rename": 0,
  "autoname": "hash",
  "creation": "2026-08-05 00:00:00.000000",
  "custom": 1,
  "docstatus": 0,
  "doctype": "DocType",
  "document_type": "Document",
  "editable_grid": 1,
  "engine": "InnoDB",
  "field_order": [
    "flag_identity",
    "employee",
    "attendance_date",
    "flag_code",
    "employee_branch",
    "column_break_1",
    "outcome",
    "reason",
    "note",
    "evidence_fingerprint",
    "group_key",
    "column_break_2",
    "decided_by",
    "decided_at",
    "supersedes",
    "superseded"
  ],
  "fields": [
    {
      "fieldname": "flag_identity",
      "fieldtype": "Data",
      "label": "Flag Identity",
      "reqd": 1,
      "search_index": 1,
      "in_list_view": 1,
      "in_standard_filter": 1
    },
    {
      "fieldname": "employee",
      "fieldtype": "Link",
      "label": "Employee",
      "options": "Employee",
      "reqd": 1,
      "in_list_view": 1,
      "in_standard_filter": 1
    },
    {
      "fieldname": "attendance_date",
      "fieldtype": "Date",
      "label": "Attendance Date",
      "reqd": 1,
      "search_index": 1,
      "in_list_view": 1
    },
    {
      "fieldname": "flag_code",
      "fieldtype": "Select",
      "label": "Flag Code",
      "options": "NON_PRIMARY_SITE_PUNCH\nLATE_START\nLATE_FROM_LUNCH\nLEFT_EARLY\nMISSING_TIME\nATTENDANCE_ISSUE\nNO_CHECKIN_YET\nOFF_SHIFT_PUNCH\nMISSING_IN_OR_OUT\nMISSING_LUNCH\nUNNOTIFIED_ABSENCE\nUNKNOWN_DEVICE_BRANCH\nDELIVERY_FAILED",
      "reqd": 1,
      "in_list_view": 1
    },
    {
      "fieldname": "employee_branch",
      "fieldtype": "Data",
      "label": "Employee Branch"
    },
    {
      "fieldname": "column_break_1",
      "fieldtype": "Column Break"
    },
    {
      "fieldname": "outcome",
      "fieldtype": "Select",
      "label": "Outcome",
      "options": "EXCUSED\nUPHELD",
      "reqd": 1,
      "in_list_view": 1
    },
    {
      "fieldname": "reason",
      "fieldtype": "Select",
      "label": "Reason",
      "options": "APPROVED_LEAVE\nDEVICE_OR_DATA_FAULT\nMANAGER_APPROVED\nSCHEDULE_WRONG\nCOVERING_OTHER_SITE\nGENUINE_VIOLATION\nOTHER",
      "reqd": 1,
      "in_list_view": 1
    },
    {
      "fieldname": "note",
      "fieldtype": "Text",
      "label": "Note"
    },
    {
      "fieldname": "evidence_fingerprint",
      "fieldtype": "Data",
      "label": "Evidence Fingerprint"
    },
    {
      "fieldname": "group_key",
      "fieldtype": "Data",
      "label": "Group Key",
      "in_standard_filter": 1
    },
    {
      "fieldname": "column_break_2",
      "fieldtype": "Column Break"
    },
    {
      "fieldname": "decided_by",
      "fieldtype": "Link",
      "label": "Decided By",
      "options": "User",
      "read_only": 1
    },
    {
      "fieldname": "decided_at",
      "fieldtype": "Datetime",
      "label": "Decided At",
      "read_only": 1
    },
    {
      "fieldname": "supersedes",
      "fieldtype": "Link",
      "label": "Supersedes",
      "options": "Attendance Flag Decision",
      "read_only": 1
    },
    {
      "fieldname": "superseded",
      "fieldtype": "Check",
      "label": "Superseded",
      "read_only": 1,
      "default": "0",
      "search_index": 1
    }
  ],
  "index_web_pages_for_search": 0,
  "links": [],
  "modified": "2026-08-05 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "Dewey Time",
  "name": "Attendance Flag Decision",
  "naming_rule": "Random",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1,
      "delete": 0,
      "email": 1,
      "export": 0,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "HR User",
      "share": 0,
      "write": 1
    },
    {
      "create": 1,
      "delete": 1,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "HR Manager",
      "share": 1,
      "write": 1
    },
    {
      "create": 1,
      "delete": 1,
      "email": 1,
      "export": 1,
      "print": 1,
      "read": 1,
      "report": 1,
      "role": "System Manager",
      "share": 1,
      "write": 1
    }
  ],
  "sort_field": "modified",
  "sort_order": "DESC",
  "states": [],
  "track_changes": 1
}
```

Note on what's deliberately absent: this doctype does **not** inherit `Attendance Flag`'s permission block (spec `Data model` section, "The doctype does **not** inherit `Attendance Flag`'s permission block — it needs its own") and carries no `index` (composite/unique-index) array like `device_sync_status.json`'s `device_sn`+`local_date` pair — supersession means multiple `Attendance Flag Decision` rows legitimately share one `flag_identity` over time, so no uniqueness constraint applies here.

- [ ] **Step 5: Create the controller**

```python
# dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.py
import frappe
from frappe.model.document import Document


class AttendanceFlagDecision(Document):
    def validate(self):
        # This is the ONLY rule this controller enforces. decided_by,
        # decided_at, supersedes and superseded are written by
        # flag_decision_api.decide_flags() / reverse_decision_group() at
        # insert time and by a direct frappe.db.set_value(..., "superseded", 1)
        # on the row being replaced (spec 2026-08-05-hr-flag-management-design.md
        # "Supersession") — never here. validate() touching those fields
        # would either race that direct db write or force the API layer to
        # re-derive values validate() had just overwritten.
        if self.reason == "OTHER" or self.outcome == "UPHELD":
            if not (self.note or "").strip():
                frappe.throw("Note is required when reason is OTHER or the outcome is UPHELD")
```

- [ ] **Step 6: Modify `attendance_flag.json`** — add `search_index`, deprecate the four in-place HR fields, bump `modified`

Change 1 — `attendance_date` (currently lines 75-79):

```json
    {
      "fieldname": "attendance_date",
      "fieldtype": "Date",
      "label": "Attendance Date",
      "search_index": 1
    },
```

Change 2 — `flag_code` (currently lines 85-90):

```json
    {
      "fieldname": "flag_code",
      "fieldtype": "Select",
      "label": "Flag Code",
      "options": "NON_PRIMARY_SITE_PUNCH\nLATE_START\nLATE_FROM_LUNCH\nLEFT_EARLY\nMISSING_TIME\nATTENDANCE_ISSUE\nNO_CHECKIN_YET\nOFF_SHIFT_PUNCH\nMISSING_IN_OR_OUT\nMISSING_LUNCH\nUNNOTIFIED_ABSENCE\nUNKNOWN_DEVICE_BRANCH\nDELIVERY_FAILED",
      "search_index": 1
    },
```

Change 3 — `status` (currently lines 103-108): gains `search_index` (it is a real query filter in `flag_queue_api.py`) *and* is deprecated (HR no longer decides through it) — both apply at once:

```json
    {
      "fieldname": "status",
      "fieldtype": "Select",
      "label": "(deprecated) Status",
      "options": "OPEN\nEXPLAINED\nAPPROVED\nREJECTED\nCLOSED",
      "search_index": 1,
      "read_only": 1
    },
```

Change 4 — `hr_note` (currently lines 160-164):

```json
    {
      "fieldname": "hr_note",
      "fieldtype": "Text",
      "label": "(deprecated) HR Note",
      "read_only": 1
    },
```

Change 5 — `hr_user` (currently lines 165-170):

```json
    {
      "fieldname": "hr_user",
      "fieldtype": "Link",
      "label": "(deprecated) HR User",
      "options": "User",
      "read_only": 1
    },
```

Change 6 — `hr_decided_at` (currently lines 171-175):

```json
    {
      "fieldname": "hr_decided_at",
      "fieldtype": "Datetime",
      "label": "(deprecated) HR Decided At",
      "read_only": 1
    },
```

Change 7 — `modified` (currently line 194): bump the timestamp, or none of the above ships. Global Constraint 13 and `CLAUDE.md`'s deployment notes both call this out explicitly: `bench migrate` diffs a DocType JSON's `modified` timestamp against what's stored in the `DocType` table and **skips the schema reimport entirely** when it hasn't changed, so `search_index`, the new `read_only` flags and the relabels would silently never apply to a real site even though the file on disk is correct. This is a documented, previously-hit trap in this exact repo (see the `frappe-doctype-modified-reimport` memory note) — not a hypothetical.

```json
  "modified": "2026-08-05 12:00:00.000000",
```

Nothing else in `attendance_flag.json` changes — no field is removed, `field_order` is untouched, and `attendance_flag.py`'s `before_insert`/`before_save` (Global Constraint 1) is not touched by this task.

- [ ] **Step 7: Run the test again to verify it passes**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_decision_doctype`

Expected: `OK` — all 8 tests pass (4 in `TestAttendanceFlagDecisionValidate`, 2 in `TestAttendanceFlagDecisionJson`, 2 in `TestAttendanceFlagJsonDeprecation`).

- [ ] **Step 8: Validate JSON/Python syntax standalone**

Run:
```bash
cd /Users/lolbikb/projects/dewey-time
python3 -c "import json; json.load(open('dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.json')); print('decision json ok')"
python3 -c "import json; json.load(open('dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json')); print('attendance_flag json ok')"
python3 -m py_compile dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.py && echo "py_compile ok"
```
Expected: `decision json ok`, `attendance_flag json ok`, `py_compile ok`.

- [ ] **Step 9: Commit**

```bash
git add dewey_time/dewey_time/doctype/attendance_flag_decision/__init__.py \
        dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.json \
        dewey_time/dewey_time/doctype/attendance_flag_decision/attendance_flag_decision.py \
        dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json \
        dewey_time/tests/test_flag_decision_doctype.py
git commit -m "$(cat <<'EOF'
feat(flags): add Attendance Flag Decision doctype, deprecate in-place HR fields

The engine hard-deletes and rebuilds Attendance Flag rows constantly
(intraday.py, closeout.py, schedule_resolver.py), so status/hr_note/hr_user/
hr_decided_at can never durably hold an HR decision. Attendance Flag
Decision is a separate doctype the engine never reads or writes, keyed by
a computed flag_identity rather than Attendance Flag.name. The four
in-place fields are marked deprecated + read_only rather than removed, so
surviving history is not destroyed ahead of the later migration patch.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Decision write API with supersession

**Files:**
- Create: `dewey_time/attendance_engine/flag_decision_api.py`
- Test: `dewey_time/tests/test_flag_decision_api.py`

**Interfaces:**

- Consumes:
  - `dewey_time.attendance_engine.flag_identity.flag_identity(*, employee, attendance_date, flag_code, evidence) -> str`
  - `dewey_time.attendance_engine.flag_identity.evidence_fingerprint(evidence) -> str`
  - `dewey_time.attendance_engine.hr_calendar._require_hr_role()` — raises `frappe.ValidationError` (417), **not** `PermissionError`. That inconsistency is deliberate; do not "fix" it.
  - The `Attendance Flag Decision` doctype with fields `flag_identity`, `employee`, `attendance_date`, `flag_code`, `employee_branch`, `outcome`, `reason`, `note`, `evidence_fingerprint`, `group_key`, `decided_by`, `decided_at`, `supersedes`, `superseded`.
- Produces:
  - `decide_flags(identities, outcome: str, reason: str, note: str | None = None, group_key: str | None = None, confirm=None) -> dict` → `{"ok": bool, "written": int, "group_key": str, "errors": [{"flag_identity", "error"}]}` or `{"needs_confirm": True, "preview": {"count": int, "employees": int}}`
  - `reverse_decision_group(group_key: str, note: str, confirm=None) -> dict` → `{"ok": bool, "reversed": int, "group_key": str, "errors": [...]}` or `{"needs_confirm": True, "preview": {...}}`
  - `DECIDE_CONFIRM_THRESHOLD = 25`, `OUTCOMES = ("EXCUSED", "UPHELD")`, `REASONS = (...)` — the frontend service/labels tasks import these values' spelling, not the module.

---

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_flag_decision_api.py`:

```python
import json
import sys
import unittest
from datetime import date, datetime
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

import frappe  # noqa: E402

FIXED_NOW = datetime(2026, 8, 4, 9, 30, 0)
FLAG_DATE = date(2026, 8, 3)


def _getdate(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return date.fromisoformat(value[:10])
    return value


frappe.utils.getdate = _getdate
frappe.utils.now_datetime = MagicMock(return_value=FIXED_NOW)
sys.modules["frappe.utils"].getdate = _getdate
sys.modules["frappe.utils"].now_datetime = frappe.utils.now_datetime
frappe.get_roles = MagicMock(return_value=["HR User"])
frappe.generate_hash = MagicMock(return_value="a1b2c3d4e5f6")
frappe.db.commit = MagicMock()
frappe.db.set_value = MagicMock()
frappe.log_error = MagicMock()

# flag_decision_api binds getdate/now_datetime at import time, so a copy imported by an
# earlier test module in the same run would hold the un-fixed mocks. Drop both modules
# and let the tests re-import them — same trick as test_dev_tools.py:36-39.
for _mod in list(sys.modules):
    if _mod.startswith("dewey_time.attendance_engine.flag_decision_api") or _mod.startswith(
        "dewey_time.attendance_engine.flag_identity"
    ):
        del sys.modules[_mod]

from dewey_time.attendance_engine.flag_identity import (  # noqa: E402
    evidence_fingerprint,
    flag_identity,
)


def _flag_row(employee, *, flag_code="LATE_START", minutes=12, day_closed=1):
    return {
        "name": f"AF-{employee}-{flag_code}",
        "employee": employee,
        "attendance_date": FLAG_DATE,
        "flag_code": flag_code,
        "evidence": json.dumps({"minutes": minutes}),
        "day_closed": day_closed,
    }


def _identity(row):
    return flag_identity(
        employee=row["employee"],
        attendance_date=row["attendance_date"],
        flag_code=row["flag_code"],
        evidence=row["evidence"],
    )


class _FakeDoc:
    """Stands in for a Frappe Document: records the insert payload and hands back a
    deterministic name so supersession pointers can be asserted."""

    def __init__(self, payload, store):
        self.payload = dict(payload)
        self._store = store
        self.name = None

    def insert(self, ignore_permissions=False):
        self._store.append(self)
        self.name = f"AFD-{len(self._store):04d}"
        self.ignore_permissions = ignore_permissions
        return self


def _make_get_doc(store):
    def _get_doc(payload, *args, **kwargs):
        return _FakeDoc(payload, store)

    return _get_doc


def _make_get_all(*, flags=(), decisions=(), employees=()):
    def _get_all(doctype, **kwargs):
        if doctype == "Attendance Flag":
            return [dict(row) for row in flags]
        if doctype == "Attendance Flag Decision":
            return [dict(row) for row in decisions]
        if doctype == "Employee":
            return [dict(row) for row in employees]
        return []

    return _get_all


def _decision_docs(store):
    return [doc for doc in store if doc.payload.get("doctype") == "Attendance Flag Decision"]


class TestDecideFlags(unittest.TestCase):
    def setUp(self):
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["HR User"]
        # A real dict, not the module MagicMock: `form_dict.get("confirm")` on a
        # MagicMock returns a truthy MagicMock and would silently confirm everything.
        frappe.form_dict = {}
        frappe.db.set_value.reset_mock()
        frappe.db.commit.reset_mock()

    def test_non_hr_session_is_rejected(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        frappe.session.user = "punchclock@example.com"
        frappe.get_roles.return_value = []
        store = []

        with patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            with self.assertRaises(Exception) as ctx:
                decide_flags(
                    identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                    outcome="EXCUSED",
                    reason="APPROVED_LEAVE",
                )

        self.assertIn("Not permitted", str(ctx.exception))
        self.assertEqual(store, [])

    def test_invalid_outcome_throws(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        with self.assertRaises(Exception) as ctx:
            decide_flags(
                identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                outcome="FORGIVEN",
                reason="APPROVED_LEAVE",
            )

        self.assertIn("outcome", str(ctx.exception))

    def test_invalid_reason_throws(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        with self.assertRaises(Exception) as ctx:
            decide_flags(
                identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                outcome="EXCUSED",
                reason="FELT_LIKE_IT",
            )

        self.assertIn("reason", str(ctx.exception))

    def test_upheld_without_note_throws(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        with self.assertRaises(Exception) as ctx:
            decide_flags(
                identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                outcome="UPHELD",
                reason="GENUINE_VIOLATION",
            )

        self.assertIn("note", str(ctx.exception))

    def test_other_reason_without_note_throws(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        with self.assertRaises(Exception) as ctx:
            decide_flags(
                identities=["AUTO-hr-emp-00001-2026-08-03-late-start"],
                outcome="EXCUSED",
                reason="OTHER",
            )

        self.assertIn("note", str(ctx.exception))

    def test_decision_row_denormalises_flag_and_branch(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        row = _flag_row("HR-EMP-00001")
        store = []

        with patch.object(
            frappe,
            "get_all",
            side_effect=_make_get_all(
                flags=[row],
                employees=[{"name": "HR-EMP-00001", "branch": "Phnom Penh HQ"}],
            ),
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            result = decide_flags(
                identities=[_identity(row)],
                outcome="EXCUSED",
                reason="APPROVED_LEAVE",
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["written"], 1)
        payload = _decision_docs(store)[0].payload
        self.assertEqual(payload["doctype"], "Attendance Flag Decision")
        self.assertEqual(payload["flag_identity"], _identity(row))
        self.assertEqual(payload["employee"], "HR-EMP-00001")
        self.assertEqual(payload["attendance_date"], FLAG_DATE)
        self.assertEqual(payload["flag_code"], "LATE_START")
        self.assertEqual(payload["employee_branch"], "Phnom Penh HQ")
        self.assertEqual(payload["evidence_fingerprint"], evidence_fingerprint(row["evidence"]))
        self.assertEqual(payload["superseded"], 0)
        self.assertIsNone(payload["supersedes"])

    def test_identities_accepted_as_json_string(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        row = _flag_row("HR-EMP-00002")
        store = []

        with patch.object(
            frappe, "get_all", side_effect=_make_get_all(flags=[row])
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            result = decide_flags(
                identities=json.dumps([_identity(row)]),
                outcome="EXCUSED",
                reason="DEVICE_OR_DATA_FAULT",
            )

        self.assertEqual(result["written"], 1)
        self.assertEqual(len(_decision_docs(store)), 1)

    def test_decided_by_and_decided_at_come_from_the_session_not_the_client(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        row = _flag_row("HR-EMP-00003")
        store = []
        frappe.form_dict = {
            "decided_by": "attacker@example.com",
            "decided_at": "2020-01-01 00:00:00",
        }

        with patch.object(
            frappe, "get_all", side_effect=_make_get_all(flags=[row])
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            decide_flags(
                identities=[_identity(row)],
                outcome="EXCUSED",
                reason="MANAGER_APPROVED",
            )

        payload = _decision_docs(store)[0].payload
        self.assertEqual(payload["decided_by"], "hr@example.com")
        self.assertEqual(payload["decided_at"], FIXED_NOW)

    def test_one_bad_identity_among_39_writes_38_and_reports_one_error(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        rows = [_flag_row(f"HR-EMP-{index:05d}") for index in range(1, 40)]
        # The 39th flag was corrected away while HR was deciding — its identity no
        # longer resolves to a live AUTO flag.
        live_rows = rows[:-1]
        identities = [_identity(row) for row in rows]
        store = []

        with patch.object(
            frappe,
            "get_all",
            side_effect=_make_get_all(
                flags=live_rows,
                employees=[{"name": row["employee"], "branch": "Siem Reap"} for row in live_rows],
            ),
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            result = decide_flags(
                identities=identities,
                outcome="EXCUSED",
                reason="DEVICE_OR_DATA_FAULT",
                confirm=1,
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["written"], 38)
        self.assertEqual(len(_decision_docs(store)), 38)
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["errors"][0]["flag_identity"], identities[-1])
        self.assertTrue(result["errors"][0]["error"])
        # One group_key, generated server-side, shared by every row in the call.
        self.assertTrue(result["group_key"])
        self.assertEqual(
            {doc.payload["group_key"] for doc in _decision_docs(store)},
            {result["group_key"]},
        )

    def test_over_threshold_without_confirm_previews_and_writes_nothing(self):
        from dewey_time.attendance_engine.flag_decision_api import (
            DECIDE_CONFIRM_THRESHOLD,
            decide_flags,
        )

        rows = [
            _flag_row(f"HR-EMP-{index:05d}")
            for index in range(1, DECIDE_CONFIRM_THRESHOLD + 2)
        ]
        store = []

        with patch.object(
            frappe, "get_all", side_effect=_make_get_all(flags=rows)
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            result = decide_flags(
                identities=[_identity(row) for row in rows],
                outcome="EXCUSED",
                reason="DEVICE_OR_DATA_FAULT",
            )

        self.assertTrue(result["needs_confirm"])
        self.assertEqual(result["preview"]["count"], DECIDE_CONFIRM_THRESHOLD + 1)
        self.assertEqual(result["preview"]["employees"], DECIDE_CONFIRM_THRESHOLD + 1)
        self.assertEqual(store, [])
        frappe.db.set_value.assert_not_called()

    def test_second_decision_supersedes_the_first(self):
        from dewey_time.attendance_engine.flag_decision_api import decide_flags

        row = _flag_row("HR-EMP-00007")
        identity = _identity(row)
        decisions = []
        store = []

        with patch.object(
            frappe,
            "get_all",
            side_effect=_make_get_all(flags=[row], decisions=decisions),
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            decide_flags(
                identities=[identity],
                outcome="EXCUSED",
                reason="APPROVED_LEAVE",
            )
            first = _decision_docs(store)[0]
            self.assertIsNone(first.payload["supersedes"])
            frappe.db.set_value.assert_not_called()

            # The first row is now the live one for this identity.
            decisions.append({"name": first.name, "flag_identity": identity})

            second_result = decide_flags(
                identities=[identity],
                outcome="UPHELD",
                reason="GENUINE_VIOLATION",
                note="Third unexplained late start this month.",
            )

        self.assertEqual(second_result["written"], 1)
        second = _decision_docs(store)[1]
        self.assertEqual(second.payload["supersedes"], first.name)
        self.assertEqual(second.payload["superseded"], 0)
        self.assertEqual(second.payload["outcome"], "UPHELD")
        # Only the pointer flips on the old row; its content is never edited.
        frappe.db.set_value.assert_called_once_with(
            "Attendance Flag Decision",
            first.name,
            "superseded",
            1,
            update_modified=False,
        )


class TestReverseDecisionGroup(unittest.TestCase):
    def setUp(self):
        frappe.session.user = "hr@example.com"
        frappe.get_roles.return_value = ["HR User"]
        frappe.form_dict = {}
        frappe.db.set_value.reset_mock()
        frappe.db.commit.reset_mock()

    def test_plain_hr_user_cannot_reverse_a_group(self):
        from dewey_time.attendance_engine.flag_decision_api import reverse_decision_group

        store = []
        with patch.object(frappe, "get_all", side_effect=_make_get_all()), patch.object(
            frappe, "get_doc", side_effect=_make_get_doc(store)
        ):
            with self.assertRaises(Exception) as ctx:
                reverse_decision_group(
                    group_key="AFD-a1b2c3d4e5f6",
                    note="Wrong batch.",
                    confirm=1,
                )

        self.assertIn("HR Manager", str(ctx.exception))
        frappe.db.set_value.assert_not_called()
        self.assertEqual(store, [])

    def test_reversal_requires_a_note(self):
        from dewey_time.attendance_engine.flag_decision_api import reverse_decision_group

        frappe.get_roles.return_value = ["HR User", "HR Manager"]

        with patch.object(frappe, "get_all", side_effect=_make_get_all()):
            with self.assertRaises(Exception) as ctx:
                reverse_decision_group(group_key="AFD-a1b2c3d4e5f6", note="  ", confirm=1)

        self.assertIn("note", str(ctx.exception))

    def test_hr_manager_previews_then_supersedes_every_live_row_in_the_group(self):
        from dewey_time.attendance_engine.flag_decision_api import reverse_decision_group

        frappe.get_roles.return_value = ["HR User", "HR Manager"]
        rows = [
            {"name": "AFD-0001", "flag_identity": "AUTO-a-2026-08-03-late-start", "employee": "HR-EMP-00001"},
            {"name": "AFD-0002", "flag_identity": "AUTO-b-2026-08-03-late-start", "employee": "HR-EMP-00002"},
        ]
        store = []

        with patch.object(
            frappe, "get_all", side_effect=_make_get_all(decisions=rows)
        ), patch.object(frappe, "get_doc", side_effect=_make_get_doc(store)):
            preview = reverse_decision_group(
                group_key="AFD-a1b2c3d4e5f6",
                note="Device fault was misdiagnosed.",
            )
            self.assertTrue(preview["needs_confirm"])
            self.assertEqual(preview["preview"], {"count": 2, "employees": 2})
            frappe.db.set_value.assert_not_called()

            result = reverse_decision_group(
                group_key="AFD-a1b2c3d4e5f6",
                note="Device fault was misdiagnosed.",
                confirm=1,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["reversed"], 2)
        self.assertEqual(result["errors"], [])
        self.assertEqual(
            [call.args for call in frappe.db.set_value.call_args_list],
            [
                ("Attendance Flag Decision", "AFD-0001", "superseded", 1),
                ("Attendance Flag Decision", "AFD-0002", "superseded", 1),
            ],
        )
        comments = [doc for doc in store if doc.payload.get("doctype") == "Comment"]
        self.assertEqual(len(comments), 2)
        self.assertIn("Device fault was misdiagnosed.", comments[0].payload["content"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_decision_api`

Expected: FAIL — every test errors during collection with
`ModuleNotFoundError: No module named 'dewey_time.attendance_engine.flag_decision_api'`,
because the module does not exist yet. (`dewey_time.attendance_engine.flag_identity` from
Task 2 must already exist; if that import is what fails, Task 2 has not landed — stop and
say so rather than stubbing it here.)

- [ ] **Step 3: Create the module header — constants, validation, and argument coercion**

Create `dewey_time/attendance_engine/flag_decision_api.py` with:

```python
from __future__ import annotations

import json
import re

import frappe
from frappe.utils import getdate, now_datetime

from dewey_time.attendance_engine.flag_identity import evidence_fingerprint, flag_identity
from dewey_time.attendance_engine.hr_calendar import _require_hr_role

DECISION_DOCTYPE = "Attendance Flag Decision"

DECIDE_CONFIRM_THRESHOLD = 25
OUTCOMES = ("EXCUSED", "UPHELD")
REASONS = (
    "APPROVED_LEAVE",
    "DEVICE_OR_DATA_FAULT",
    "MANAGER_APPROVED",
    "SCHEDULE_WRONG",
    "COVERING_OTHER_SITE",
    "GENUINE_VIOLATION",
    "OTHER",
)

# flag_identity is "AUTO-{scrub(employee)}-{YYYY-MM-DD}-{suffix}" (flag_identity.py).
# The employee token is matched non-greedily so the FIRST ISO date wins: a MISSING_TIME
# suffix embeds its own scrubbed interval_start ("...-2026-08-03-08-15-00") and a greedy
# match would read that as the attendance_date.
_IDENTITY_RE = re.compile(r"^AUTO-(?P<employee>.+?)-(?P<date>\d{4}-\d{2}-\d{2})-.+$")


def _parse_confirm(value) -> bool:
    """Same coercion as dev_tools._parse_confirm (dev_tools.py:124-129). Duplicated rather
    than imported because dev_tools pulls in closeout + intraday at import time, and a
    decision write must not drag the whole flag engine into its import graph."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes")
    return bool(value)


def _parse_identities(identities) -> list[str]:
    """Frappe serialises structured arguments as JSON over the wire, so the same argument
    arrives as a list from Python and as a string from the SPA — coerce both, exactly as
    schedule_api._parse_json (schedule_api.py:74-84) does.

    Duplicates are collapsed: two copies of one identity in a single call would otherwise
    make the second row supersede the first row of the *same* action.
    """
    if isinstance(identities, str):
        text = identities.strip()
        if not text:
            identities = []
        else:
            try:
                identities = json.loads(text)
            except ValueError:
                frappe.throw("identities must be a JSON array of flag_identity strings")
    if identities is None:
        identities = []
    if not isinstance(identities, (list, tuple)):
        frappe.throw("identities must be a list of flag_identity strings")

    seen: set[str] = set()
    out: list[str] = []
    for item in identities:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)

    if not out:
        frappe.throw("identities is required")
    return out


def _split_identity(identity: str) -> tuple[str, str]:
    """(scrubbed employee token, "YYYY-MM-DD"). Raises ValueError on anything that is not
    a flag_identity, so a malformed row lands in the per-row errors list rather than
    aborting the batch."""
    match = _IDENTITY_RE.match(identity)
    if not match:
        raise ValueError(f"Unrecognised flag_identity: {identity}")
    return match.group("employee"), match.group("date")


def _validate_decision(outcome, reason, note) -> tuple[str, str, str]:
    outcome = (outcome or "").strip().upper()
    reason = (reason or "").strip().upper()
    note = (note or "").strip()

    if outcome not in OUTCOMES:
        frappe.throw(f"outcome must be one of: {', '.join(OUTCOMES)}")
    if reason not in REASONS:
        frappe.throw(f"reason must be one of: {', '.join(REASONS)}")
    # OTHER explains nothing on its own, and UPHELD is the outcome that costs the
    # employee — both have to carry a written justification or the audit trail is
    # unreadable a year later.
    if not note and (reason == "OTHER" or outcome == "UPHELD"):
        frappe.throw("note is required when reason is OTHER or outcome is UPHELD")

    return outcome, reason, note
```

- [ ] **Step 4: Add the batched lookup helpers**

Append to `dewey_time/attendance_engine/flag_decision_api.py`:

```python
def _preview(identities: list[str]) -> dict:
    """Blast radius, counted straight off the identity strings so the preview path touches
    no rows at all. The employee token is the scrubbed employee id, which is distinct per
    employee for the id formats this site issues — good enough for a number HR reads
    before confirming, and it is never used as a join key."""
    employees: set[str] = set()
    for identity in identities:
        try:
            employee_token, _date = _split_identity(identity)
        except ValueError:
            continue
        employees.add(employee_token)
    return {"count": len(identities), "employees": len(employees)}


def _live_flags_by_identity(identities: list[str]) -> dict[str, dict]:
    """One batched read of the AUTO flags these identities point at, keyed by identity.

    The date window comes out of the identities themselves, which keeps this a single
    query however many rows the bulk action covers — a per-identity lookup would be 39
    queries for one group decision.
    """
    dates: set[str] = set()
    for identity in identities:
        try:
            _employee_token, date_text = _split_identity(identity)
        except ValueError:
            continue
        dates.add(date_text)
    if not dates:
        return {}

    rows = (
        frappe.get_all(
            "Attendance Flag",
            filters={"attendance_date": ["in", sorted(dates)], "source": "AUTO"},
            fields=["name", "employee", "attendance_date", "flag_code", "evidence", "day_closed"],
            order_by="day_closed asc",
            limit_page_length=0,
        )
        or []
    )

    wanted = set(identities)
    by_identity: dict[str, dict] = {}
    for row in rows:
        identity = flag_identity(
            employee=row.get("employee"),
            attendance_date=row.get("attendance_date"),
            flag_code=row.get("flag_code"),
            evidence=row.get("evidence"),
        )
        if identity not in wanted:
            continue
        # A provisional and its final replacement share one identity by design
        # (day_closed is excluded from the key), so ordering day_closed asc lets the
        # final row win and the fingerprint be taken from the closed-out evidence.
        by_identity[identity] = row
    return by_identity


def _branch_by_employee(employees) -> dict[str, str | None]:
    """Denormalisation source for `employee_branch`: one query, so cause grouping in the
    queue never has to join Employee (spec: Data model / employee_branch)."""
    names = sorted({name for name in employees if name})
    if not names:
        return {}
    rows = (
        frappe.get_all(
            "Employee",
            filters={"name": ["in", names]},
            fields=["name", "branch"],
            limit_page_length=0,
        )
        or []
    )
    return {row["name"]: row.get("branch") for row in rows}


def _live_decisions_by_identity(identities: list[str]) -> dict[str, str]:
    """identity -> name of the row currently live (superseded=0) for it."""
    rows = (
        frappe.get_all(
            DECISION_DOCTYPE,
            filters={"flag_identity": ["in", sorted(identities)], "superseded": 0},
            fields=["name", "flag_identity"],
            limit_page_length=0,
        )
        or []
    )
    return {row["flag_identity"]: row["name"] for row in rows}


def _new_group_key() -> str:
    return f"AFD-{frappe.generate_hash(length=12)}"
```

- [ ] **Step 5: Add the single-row write with supersession**

Append to `dewey_time/attendance_engine/flag_decision_api.py`:

```python
def _write_decision(
    *,
    identity: str,
    flag: dict | None,
    branch_by_employee: dict,
    live_decisions: dict,
    outcome: str,
    reason: str,
    note: str,
    group_key: str,
    decided_by: str,
    decided_at,
) -> str:
    if not flag:
        # Correcting a punch changes the evidence and therefore the identity, and
        # correcting a punch is the most common thing HR does while triaging — so this
        # is the expected "the flag changed while you were deciding" race, not a bug.
        raise ValueError("No live AUTO flag matches this identity")

    employee = flag.get("employee")
    previous = live_decisions.get(identity)

    doc = frappe.get_doc(
        {
            "doctype": DECISION_DOCTYPE,
            "flag_identity": identity,
            "employee": employee,
            "attendance_date": getdate(flag.get("attendance_date")),
            "flag_code": flag.get("flag_code"),
            "employee_branch": branch_by_employee.get(employee),
            "outcome": outcome,
            "reason": reason,
            "note": note or None,
            "evidence_fingerprint": evidence_fingerprint(flag.get("evidence")),
            "group_key": group_key,
            "decided_by": decided_by,
            "decided_at": decided_at,
            "supersedes": previous,
            "superseded": 0,
        }
    )
    # ignore_permissions because authorisation is the endpoint gate (_require_hr_role()):
    # going through the doctype's own perms would additionally apply User Permissions on
    # Employee, which would stop an HR User deciding for employees outside their own
    # scope — deliberately not the model here (spec, Open risk 4). Same reason
    # upsert_device_closeout_alert inserts this way (closeout.py:219).
    doc.insert(ignore_permissions=True)

    if previous:
        # Flipped AFTER the insert, so a failed insert can never leave the identity with
        # no live decision at all. Decision content is immutable — this pointer is the
        # only thing that ever changes on an existing row — and update_modified=False
        # keeps the audit row byte-stable.
        frappe.db.set_value(DECISION_DOCTYPE, previous, "superseded", 1, update_modified=False)

    # The row just written is now the live one for this identity.
    live_decisions[identity] = doc.name
    return doc.name
```

- [ ] **Step 6: Add `decide_flags`**

Append to `dewey_time/attendance_engine/flag_decision_api.py`:

```python
@frappe.whitelist(methods=["POST"])
def decide_flags(
    identities,
    outcome: str,
    reason: str,
    note: str | None = None,
    group_key: str | None = None,
    confirm=None,
) -> dict:
    """Record an HR judgment on 1..N flags.

    A single-flag decision and a 39-person bulk action deliberately share this one code
    path, so the supersession and partial-failure rules cannot drift between them.
    """
    _require_hr_role()

    identity_list = _parse_identities(identities)
    outcome, reason, note = _validate_decision(outcome, reason, note)

    confirm_value = confirm if confirm is not None else frappe.form_dict.get("confirm")
    if len(identity_list) > DECIDE_CONFIRM_THRESHOLD and not _parse_confirm(confirm_value):
        # Show the blast radius before committing it — the same preview/confirm two-step
        # as schedule_api.apply_weekly_schedule (schedule_api.py:438) and
        # dev_tools.clear_employee_schedule_api (dev_tools.py:160-162). Nothing is
        # written on this path.
        return {"needs_confirm": True, "preview": _preview(identity_list)}

    # One group_key for the whole call, generated here when the caller did not supply
    # one: it is what reverse_decision_group undoes later.
    group_key = (group_key or "").strip() or _new_group_key()

    flags_by_identity = _live_flags_by_identity(identity_list)
    branch_by_employee = _branch_by_employee(
        row.get("employee") for row in flags_by_identity.values()
    )
    live_decisions = _live_decisions_by_identity(identity_list)

    # Stamped from the session, never from the payload: a client-supplied decider makes
    # the whole audit trail worthless.
    decided_by = frappe.session.user
    decided_at = now_datetime()

    written = 0
    errors: list[dict] = []
    for identity in identity_list:
        # Per-row isolation — one stale identity out of 39 must never cost the other 38.
        # Pattern: schedule_resolver.clear_employee_schedule (schedule_resolver.py:1214-1223).
        try:
            _write_decision(
                identity=identity,
                flag=flags_by_identity.get(identity),
                branch_by_employee=branch_by_employee,
                live_decisions=live_decisions,
                outcome=outcome,
                reason=reason,
                note=note,
                group_key=group_key,
                decided_by=decided_by,
                decided_at=decided_at,
            )
            written += 1
        except Exception as exc:
            errors.append({"flag_identity": identity, "error": str(exc)})

    # Commit here rather than leaning on request teardown, so the rows that did write
    # survive a later failure in the same request (dev_tools.py:68 does the same). The
    # inserts fire the doc_event that busts the 60s queue cache; no explicit
    # invalidation is needed on this path.
    frappe.db.commit()

    return {
        "ok": not errors,
        "written": written,
        "group_key": group_key,
        "errors": errors,
    }
```

- [ ] **Step 7: Run the tests — `TestDecideFlags` should pass**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_decision_api`

Expected: the ten `TestDecideFlags` tests PASS; the three `TestReverseDecisionGroup`
tests still FAIL with
`ImportError: cannot import name 'reverse_decision_group' from 'dewey_time.attendance_engine.flag_decision_api'`.

- [ ] **Step 8: Add the stricter reversal gate, the reversal note, and `reverse_decision_group`**

Append to `dewey_time/attendance_engine/flag_decision_api.py`:

```python
def _require_hr_manager_for_reversal():
    """Deciding is HR User; mass-reversing is not.

    A reversal supersedes every row one bulk action wrote — up to the whole roster in a
    single call — so it gets the explicit stricter check layered on top of
    _require_hr_role(), the way dev_tools._require_system_manager_for_clear
    (dev_tools.py:132-139) does for other high-blast-radius operations. The asymmetry is
    deliberate: an HR User who mis-decides one flag simply decides it again (supersession
    is append-only and cheap), but an HR User who wipes someone else's 168-row batch
    cannot put it back — every reversed row would have to be re-decided by hand.
    """
    user = frappe.session.user
    if user == "Administrator":
        return
    roles = set(frappe.get_roles(user) or [])
    if roles & {"HR Manager", "System Manager"}:
        return
    frappe.throw("Reversing a decision batch requires the HR Manager or System Manager role")


def _record_reversal_note(names: list[str], *, note: str, group_key: str):
    """Best-effort audit trail for WHY a batch was reversed.

    A decision row is immutable apart from `superseded` and the doctype has no
    reversal-note field, so the note lands as a standard Frappe Comment on each row the
    reversal touched. Never raises: an audit-write failure must not undo an already
    committed reversal — same rule as schedule_change_log.record_schedule_change
    (schedule_change_log.py:19-21).
    """
    if not names:
        return
    content = f"Decision batch {group_key} reversed by {frappe.session.user}: {note}"
    try:
        for name in names:
            frappe.get_doc(
                {
                    "doctype": "Comment",
                    "comment_type": "Comment",
                    "reference_doctype": DECISION_DOCTYPE,
                    "reference_name": name,
                    "content": content,
                }
            ).insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(title="flag decision reversal: comment write failed")


@frappe.whitelist(methods=["POST"])
def reverse_decision_group(group_key: str, note: str, confirm=None) -> dict:
    """Undo one bulk decision by superseding every live row that shares its group_key."""
    _require_hr_role()
    _require_hr_manager_for_reversal()

    group_key = (group_key or "").strip()
    if not group_key:
        frappe.throw("group_key is required")
    note = (note or "").strip()
    if not note:
        frappe.throw("note is required to reverse a decision batch")

    rows = (
        frappe.get_all(
            DECISION_DOCTYPE,
            filters={"group_key": group_key, "superseded": 0},
            fields=["name", "flag_identity", "employee"],
            limit_page_length=0,
        )
        or []
    )

    confirm_value = confirm if confirm is not None else frappe.form_dict.get("confirm")
    if not _parse_confirm(confirm_value):
        return {
            "needs_confirm": True,
            "preview": {
                "count": len(rows),
                "employees": len({row.get("employee") for row in rows if row.get("employee")}),
            },
        }

    reversed_names: list[str] = []
    errors: list[dict] = []
    for row in rows:
        # Per-row isolation again: one locked row must not strand the rest of the batch
        # half-reversed with no report of which half.
        try:
            frappe.db.set_value(
                DECISION_DOCTYPE, row["name"], "superseded", 1, update_modified=False
            )
            reversed_names.append(row["name"])
        except Exception as exc:
            errors.append({"flag_identity": row.get("flag_identity"), "error": str(exc)})

    _record_reversal_note(reversed_names, note=note, group_key=group_key)
    frappe.db.commit()

    # `superseded` flips through raw set_value, which fires no document hooks, so the
    # doc_event that busts the 60s queue cache never runs on a reversal — unlike
    # decide_flags, which invalidates it via the insert. Invalidate explicitly,
    # best-effort: a cache miss must not fail a reversal that has already committed.
    try:
        from dewey_time.attendance_engine.flag_queue_api import invalidate_flag_queue_cache

        invalidate_flag_queue_cache()
    except Exception:
        frappe.log_error(title="flag decision reversal: queue cache invalidation failed")

    return {
        "ok": not errors,
        "reversed": len(reversed_names),
        "group_key": group_key,
        "errors": errors,
    }
```

- [ ] **Step 9: Run the full test module — everything passes**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_decision_api`

Expected: PASS, 13 tests, 0 failures, 0 errors. Read the printed test count — a module
that silently collects nothing also prints no failures.

- [ ] **Step 10: Run the neighbouring suites to confirm nothing regressed**

Run: `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_hr_calendar`
then `bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_dev_tools`

Expected: both PASS. This module mutates the shared `frappe` MagicMock
(`getdate`, `now_datetime`, `get_roles`, `form_dict`), so a green run of the two modules
that share that mock is the check that the mutation did not leak.

- [ ] **Step 11: Commit**

```bash
git add dewey_time/attendance_engine/flag_decision_api.py dewey_time/tests/test_flag_decision_api.py
git commit -m "feat(flags): decision write API with append-only supersession"
```

Commit message body must end with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 6: Batched queue read API with cache

**Files:**
- Create: `dewey_time/attendance_engine/flag_queue_api.py`
- Create: `dewey_time/tests/test_flag_queue_api.py`
- Modify: `dewey_time/hooks.py:121-133`
- Test: `dewey_time/tests/test_flag_queue_api.py`

**Interfaces:**

- Consumes (all from earlier tasks, exact signatures):
  - `flag_identity.parse_evidence(evidence) -> dict`
  - `flag_identity.flag_identity(*, employee: str, attendance_date, flag_code: str, evidence) -> str`
  - `flag_triage.TIER_ACT` / `TIER_REVIEW` / `TIER_ROUTINE` (the three tier strings)
  - `flag_grouping.build_queue(*, flags: list[dict], decisions_by_identity: dict[str, dict], employees_by_id: dict[str, dict], outage_branch_dates: set[tuple[str, str]]) -> dict` returning `{"entries", "counts", "orphans"}`
  - `hr_calendar._require_hr_role()` — raises `frappe.ValidationError` (417), **not** `PermissionError`. That inconsistency is deliberate; do not "fix" it.
  - Doctype `Attendance Flag Decision` with fields `flag_identity`, `attendance_date`, `superseded`, `outcome`, `reason`, `note`, `evidence_fingerprint`, `group_key`, `decided_by`, `decided_at`.

- Produces (later tasks rely on these exact names):
  ```python
  QUEUE_FLAG_LIMIT = 5000
  QUEUE_MAX_RANGE_DAYS = 31

  @frappe.whitelist()
  def get_flag_queue(start_date: str, end_date: str, tier: str | None = None, limit: int = 2000) -> dict
  # -> {"entries": [...], "counts": {...}, "orphans": {...},
  #     "alerts": [{"branch", "local_date", "status", "last_error"}],
  #     "truncated": bool, "start_date": str, "end_date": str}

  def invalidate_flag_queue_cache(doc=None, method=None) -> None
  ```
  Cache: `_QUEUE_CACHE_PREFIX = "flag_queue:v1"`, `_QUEUE_CACHE_TTL_SECONDS = 60`, key
  `f"{_QUEUE_CACHE_PREFIX}:{start_date}:{end_date}:{tier or 'all'}"`.

---

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_flag_queue_api.py`:

```python
"""Envelope tests for the HR flag queue read API.

Scope: what flag_queue_api itself is responsible for — the permission gate, the range
cap, the FIXED query budget, truncation, the cache, and the device-outage/alert
assembly. Ranking, person-dedup and grouping belong to flag_grouping and are covered by
test_flag_grouping.py, so build_queue is stubbed here and asserted on its INPUTS.
"""

import sys
import unittest
from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

# hooks.py imports the asset-sync helpers, which pull in `requests`; stub it exactly as
# test_hooks_launcher_tiles.py:12-19 does so the doc_events wiring test can import hooks.
if "requests" not in sys.modules:
    _requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    _requests_stub.RequestException = _RequestException
    sys.modules["requests"] = _requests_stub

import dewey_time.hooks as hooks  # noqa: E402
from dewey_time.attendance_engine import flag_queue_api  # noqa: E402

INVALIDATOR = "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache"


def _real_getdate(value):
    """The shared frappe mock stubs getdate to identity (test_closeout.py:35), which
    breaks the range arithmetic get_flag_queue does. Give the module a real one."""
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


class _FakeCache:
    """Minimal stand-in for frappe.cache() — a real dict so the second call in a test
    actually hits the cache instead of just recording that set_value happened."""

    def __init__(self):
        self.store = {}
        self.set_calls = []
        self.deleted_prefixes = []

    def get_value(self, key):
        return self.store.get(key)

    def set_value(self, key, value, expires_in_sec=None):
        self.store[key] = value
        self.set_calls.append((key, expires_in_sec))

    def delete_keys(self, prefix):
        self.deleted_prefixes.append(prefix)
        self.store = {k: v for k, v in self.store.items() if not k.startswith(prefix)}


class _Recorder:
    """Stands in for frappe.get_all: serves canned rows and records every call, so a
    test can assert the query COUNT and the filters each query was issued with."""

    def __init__(self, rows_by_doctype):
        self.rows_by_doctype = rows_by_doctype
        self.calls = []

    def __call__(self, doctype, **kwargs):
        self.calls.append((doctype, kwargs))
        rows = self.rows_by_doctype.get(doctype, [])
        limit = kwargs.get("limit_page_length")
        if limit:
            rows = rows[:limit]
        # Copies: the API stringifies dates in place, and a shared row would leak
        # between the two calls of the cache test.
        return [dict(row) for row in rows]

    @property
    def count(self):
        return len(self.calls)

    def doctypes(self):
        return [name for name, _kwargs in self.calls]

    def kwargs_for(self, doctype):
        return [kwargs for name, kwargs in self.calls if name == doctype]


def _empty_queue():
    return {
        "entries": [],
        "counts": {"open": 0, "needs_re_review": 0, "decided": 0, "people": 0},
        "orphans": {"orphaned_flag_gone": 0, "orphaned_evidence_changed": 0},
    }


@contextmanager
def _harness(rows_by_doctype=None, *, hr=True, queue=None, cache=None):
    import frappe

    recorder = _Recorder(rows_by_doctype or {})
    fake_cache = cache or _FakeCache()
    build = MagicMock(return_value=queue if queue is not None else _empty_queue())

    # frappe.db is shared across every test module using this mock; reset the two calls
    # a per-employee implementation would reach for so `assert_not_called` is meaningful.
    frappe.db.get_value.reset_mock()
    frappe.db.exists.reset_mock()

    with patch.object(flag_queue_api, "getdate", _real_getdate), patch.object(
        flag_queue_api.frappe, "get_all", recorder
    ), patch.object(
        flag_queue_api.frappe, "cache", MagicMock(return_value=fake_cache)
    ), patch.object(
        flag_queue_api, "build_queue", build
    ), patch(
        # The gate itself is covered by test_hr_calendar.py; here we only need to drive
        # it. flag_queue_api holds a reference to _require_hr_role, which reads
        # hr_calendar's module-global _is_hr_staff, so patching that drives both.
        "dewey_time.attendance_engine.hr_calendar._is_hr_staff",
        return_value=hr,
    ):
        yield SimpleNamespace(recorder=recorder, cache=fake_cache, build=build, frappe=frappe)


def _flag_row(employee, attendance_date="2026-08-03", flag_code="LATE_START", **extra):
    row = {
        "employee": employee,
        "attendance_date": attendance_date,
        "flag_code": flag_code,
        "severity": "WARNING",
        "day_closed": 1,
        "evidence": '{"minutes": 12}',
    }
    row.update(extra)
    return row


def _employee_row(employee, branch="BR-A"):
    return {"name": employee, "employee_name": f"Name {employee}", "branch": branch}


def _roster(n, *, branch="BR-A", attendance_date="2026-08-03"):
    """n employees, each with exactly one flag on the same day."""
    ids = [f"HR-EMP-{i:05d}" for i in range(n)]
    return {
        "Attendance Flag": [_flag_row(e, attendance_date=attendance_date) for e in ids],
        "Attendance Flag Decision": [],
        "Employee": [_employee_row(e, branch=branch) for e in ids],
        "Device Closeout Alert": [],
        "Device Sync Status": [{"branch": branch, "local_date": attendance_date}],
    }


class TestQueuePermissionAndRange(unittest.TestCase):
    def test_non_hr_session_is_rejected_before_any_query(self):
        with _harness(_roster(2), hr=False) as h:
            with self.assertRaises(Exception):
                flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            self.assertEqual(h.recorder.count, 0)

    def test_range_longer_than_the_cap_is_rejected(self):
        with _harness(_roster(2)) as h:
            with self.assertRaises(Exception):
                # 32 days inclusive, one over QUEUE_MAX_RANGE_DAYS.
                flag_queue_api.get_flag_queue("2026-08-01", "2026-09-01")
            self.assertEqual(h.recorder.count, 0)

    def test_range_exactly_at_the_cap_is_accepted(self):
        with _harness(_roster(2)):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-31")  # 31 days
        self.assertEqual(payload["start_date"], "2026-08-01")
        self.assertEqual(payload["end_date"], "2026-08-31")

    def test_inverted_range_is_rejected(self):
        with _harness(_roster(2)):
            with self.assertRaises(Exception):
                flag_queue_api.get_flag_queue("2026-08-07", "2026-08-01")


class TestQueryBudget(unittest.TestCase):
    def test_query_count_is_independent_of_employee_count(self):
        with _harness(_roster(3)) as small:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            small_count = small.recorder.count
            small_doctypes = sorted(small.recorder.doctypes())

        with _harness(_roster(300)) as large:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            large_count = large.recorder.count
            large_doctypes = sorted(large.recorder.doctypes())
            large.frappe.db.get_value.assert_not_called()
            large.frappe.db.exists.assert_not_called()

        self.assertEqual(small_count, large_count)
        self.assertEqual(small_doctypes, large_doctypes)

    def test_each_doctype_is_queried_exactly_once(self):
        with _harness(_roster(300)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            doctypes = h.recorder.doctypes()
        for doctype in (
            "Attendance Flag",
            "Attendance Flag Decision",
            "Employee",
            "Device Closeout Alert",
            "Device Sync Status",
        ):
            self.assertEqual(doctypes.count(doctype), 1, f"{doctype} queried {doctypes.count(doctype)}x")

    def test_flag_query_carries_no_employee_filter(self):
        with _harness(_roster(3)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            filters = h.recorder.kwargs_for("Attendance Flag")[0]["filters"]
        self.assertNotIn("employee", filters)
        self.assertIn("attendance_date", filters)


class TestTruncation(unittest.TestCase):
    def test_flag_query_is_capped_at_the_flag_limit(self):
        with _harness(_roster(3)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            kwargs = h.recorder.kwargs_for("Attendance Flag")[0]
        self.assertEqual(kwargs.get("limit_page_length"), flag_queue_api.QUEUE_FLAG_LIMIT)

    def test_truncated_is_set_when_the_flag_query_hits_the_cap(self):
        with _harness(_roster(3)), patch.object(flag_queue_api, "QUEUE_FLAG_LIMIT", 3):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertTrue(payload["truncated"])

    def test_not_truncated_below_the_cap(self):
        with _harness(_roster(3)):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertFalse(payload["truncated"])

    def test_entry_limit_slices_and_marks_truncated(self):
        entries = [
            {"kind": "person", "employee": f"HR-EMP-{i:05d}", "tier": "routine"} for i in range(4)
        ]
        queue = {**_empty_queue(), "entries": entries}
        with _harness(_roster(4), queue=queue):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", limit=2)
        self.assertEqual(len(payload["entries"]), 2)
        self.assertTrue(payload["truncated"])


class TestQueueInputs(unittest.TestCase):
    def test_flags_are_handed_to_build_queue_with_identities_and_parsed_evidence(self):
        with _harness(_roster(2)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            kwargs = h.build.call_args.kwargs
        flags = kwargs["flags"]
        self.assertEqual(len(flags), 2)
        self.assertTrue(all(f["flag_identity"] for f in flags))
        self.assertEqual(len({f["flag_identity"] for f in flags}), 2)
        self.assertEqual(flags[0]["evidence"], {"minutes": 12})
        self.assertEqual(flags[0]["attendance_date"], "2026-08-03")
        self.assertEqual(
            kwargs["employees_by_id"]["HR-EMP-00000"],
            {"employee_name": "Name HR-EMP-00000", "branch": "BR-A"},
        )

    def test_provisional_and_final_rows_collapse_to_the_final_flag(self):
        # flag_identity deliberately excludes day_closed, so during the closeout window
        # the same identity can arrive twice; the final row must win, once.
        rows = _roster(1)
        rows["Attendance Flag"] = [
            _flag_row("HR-EMP-00000", day_closed=0),
            _flag_row("HR-EMP-00000", day_closed=1),
        ]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            flags = h.build.call_args.kwargs["flags"]
        self.assertEqual(len(flags), 1)
        self.assertEqual(flags[0]["day_closed"], 1)

    def test_live_decisions_are_keyed_by_identity_and_filtered_to_superseded_zero(self):
        rows = _roster(1)
        rows["Attendance Flag Decision"] = [
            {
                "name": "AFD-0001",
                "flag_identity": "AUTO-hr-emp-00000-2026-08-03-late-start",
                "outcome": "EXCUSED",
                "reason": "MANAGER_APPROVED",
                "note": None,
                "evidence_fingerprint": "abc",
                "group_key": None,
                "decided_by": "hr@example.com",
                "decided_at": "2026-08-04 09:00:00",
            }
        ]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            decisions = h.build.call_args.kwargs["decisions_by_identity"]
            filters = h.recorder.kwargs_for("Attendance Flag Decision")[0]["filters"]
        self.assertEqual(filters["superseded"], 0)
        self.assertEqual(
            decisions["AUTO-hr-emp-00000-2026-08-03-late-start"]["outcome"], "EXCUSED"
        )

    def test_branch_date_with_no_sync_row_is_an_outage(self):
        rows = _roster(2)
        rows["Device Sync Status"] = []  # nothing ever reported for BR-A that day
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            outage = h.build.call_args.kwargs["outage_branch_dates"]
        self.assertIn(("BR-A", "2026-08-03"), outage)

    def test_branch_date_with_a_sync_row_and_no_alert_is_not_an_outage(self):
        with _harness(_roster(2)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            outage = h.build.call_args.kwargs["outage_branch_dates"]
        self.assertEqual(outage, set())

    def test_unresolved_alert_makes_the_branch_date_an_outage_even_with_sync_rows(self):
        rows = _roster(2)
        rows["Device Closeout Alert"] = [
            {
                "branch": "BR-A",
                "local_date": "2026-08-03",
                "status": "closure_failed",
                "last_error": "timeout",
            }
        ]
        with _harness(rows) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            outage = h.build.call_args.kwargs["outage_branch_dates"]
        self.assertIn(("BR-A", "2026-08-03"), outage)


class TestAlerts(unittest.TestCase):
    def test_alerts_include_a_branch_with_an_unresolved_alert_and_zero_flags(self):
        # The fallback path skips these employees entirely, so NO flag exists — the whole
        # point of the alert list. It must therefore not be filtered by flag branches.
        rows = {
            "Attendance Flag": [],
            "Attendance Flag Decision": [],
            "Employee": [],
            "Device Closeout Alert": [
                {
                    "branch": "Phnom Penh HQ",
                    "local_date": "2026-08-03",
                    "status": "deferred_offline",
                    "last_error": None,
                }
            ],
            "Device Sync Status": [],
        }
        with _harness(rows) as h:
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            filters = h.recorder.kwargs_for("Device Closeout Alert")[0]["filters"]
        self.assertEqual(len(payload["alerts"]), 1)
        self.assertEqual(payload["alerts"][0]["branch"], "Phnom Penh HQ")
        self.assertEqual(payload["alerts"][0]["local_date"], "2026-08-03")
        self.assertNotIn("branch", filters)

    def test_alerts_never_carry_a_device_serial(self):
        rows = {
            "Attendance Flag": [],
            "Attendance Flag Decision": [],
            "Employee": [],
            "Device Closeout Alert": [
                {
                    "branch": "BR-A",
                    "local_date": "2026-08-03",
                    "status": "closure_failed",
                    "last_error": None,
                    "device_sn": "ZK-99",
                }
            ],
            "Device Sync Status": [],
        }
        with _harness(rows) as h:
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            fields = h.recorder.kwargs_for("Device Closeout Alert")[0]["fields"]
        self.assertNotIn("device_sn", fields)
        self.assertNotIn("device_sn", payload["alerts"][0])

    def test_two_devices_failing_at_one_branch_are_one_alert_card(self):
        rows = {
            "Attendance Flag": [],
            "Attendance Flag Decision": [],
            "Employee": [],
            "Device Closeout Alert": [
                {"branch": "BR-A", "local_date": "2026-08-03", "status": "closure_failed", "last_error": None},
                {"branch": "BR-A", "local_date": "2026-08-03", "status": "deferred_offline", "last_error": None},
            ],
            "Device Sync Status": [],
        }
        with _harness(rows):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
        self.assertEqual(len(payload["alerts"]), 1)


class TestTierFilter(unittest.TestCase):
    def test_tier_filters_entries(self):
        entries = [
            {"kind": "person", "employee": "A", "tier": "act"},
            {"kind": "person", "employee": "B", "tier": "routine"},
        ]
        with _harness(_roster(2), queue={**_empty_queue(), "entries": entries}):
            payload = flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
        self.assertEqual([e["employee"] for e in payload["entries"]], ["A"])

    def test_unknown_tier_is_rejected(self):
        with _harness(_roster(2)):
            with self.assertRaises(Exception):
                flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="urgent")


class TestQueueCache(unittest.TestCase):
    def test_second_call_issues_no_further_queries(self):
        with _harness(_roster(3)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            after_first = h.recorder.count
            self.assertGreater(after_first, 0)
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            self.assertEqual(h.recorder.count, after_first)

    def test_cache_key_and_ttl_match_the_contract(self):
        with _harness(_roster(1)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            self.assertEqual(h.cache.set_calls, [("flag_queue:v1:2026-08-01:2026-08-07:all", 60)])

        with _harness(_roster(1)) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07", tier="act")
            self.assertEqual(h.cache.set_calls[0][0], "flag_queue:v1:2026-08-01:2026-08-07:act")

    def test_a_different_range_is_a_different_cache_entry(self):
        cache = _FakeCache()
        with _harness(_roster(1), cache=cache) as h:
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            after_first = h.recorder.count
            flag_queue_api.get_flag_queue("2026-08-08", "2026-08-14")
            self.assertGreater(h.recorder.count, after_first)

    def test_invalidate_drops_every_cached_page(self):
        cache = _FakeCache()
        with _harness(_roster(1), cache=cache):
            flag_queue_api.get_flag_queue("2026-08-01", "2026-08-07")
            self.assertEqual(len(cache.store), 1)
            flag_queue_api.invalidate_flag_queue_cache()
        self.assertEqual(cache.deleted_prefixes, ["flag_queue:v1"])
        self.assertEqual(cache.store, {})

    def test_invalidate_accepts_doc_event_args(self):
        cache = _FakeCache()
        with _harness(cache=cache):
            # Frappe doc_events call handlers as (doc, method); must not raise.
            flag_queue_api.invalidate_flag_queue_cache(doc=object(), method="on_update")
        self.assertEqual(cache.deleted_prefixes, ["flag_queue:v1"])


class TestHooksWiring(unittest.TestCase):
    def test_flag_writes_invalidate_the_queue_cache(self):
        events = hooks.doc_events["Attendance Flag"]
        for event in ("after_insert", "on_update", "on_trash"):
            self.assertEqual(events[event], INVALIDATOR)

    def test_decision_writes_invalidate_the_queue_cache(self):
        events = hooks.doc_events["Attendance Flag Decision"]
        for event in ("after_insert", "on_update", "on_trash"):
            self.assertEqual(events[event], INVALIDATOR)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from the bench directory, not this repo):
```bash
bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_queue_api
```

Expected: FAIL at import — `ModuleNotFoundError: No module named 'dewey_time.attendance_engine.flag_queue_api'`
(the whole module errors out before any test runs; every test in the file is reported as an error).

- [ ] **Step 3: Create the module header, constants and cache helpers**

Create `dewey_time/attendance_engine/flag_queue_api.py`:

```python
"""HR flag triage queue — the batched cross-employee read behind /hr-flags.

This is the only endpoint that reads flags for the whole roster at once, so the query
budget is the defining constraint: a FIXED number of queries per request, regardless of
how many employees have flags. Everything that looks per-employee — branch resolution,
decision matching, device-outage detection — is done in Python over batched result sets
and then handed to flag_grouping.build_queue, which is pure. Never loop
get_employee_calendar (hr_calendar.py:603-646) or reuse get_my_week's per-day shape
(api.py:78-82,109-112); ×500 employees is thousands of queries for one week.

Bounding follows coverage_api.get_schedule_coverage, the established shape for an
HR-only whole-roster read: a hard row cap, a short Redis cache, doc-event invalidation
wired in hooks.py, and a `truncated` flag instead of a cursor (there is no cursor
pattern in this repo to copy, and `truncated` is honest about what was dropped).
"""

from __future__ import annotations

import frappe
from frappe.utils import getdate

from dewey_time.attendance_engine.flag_grouping import build_queue
from dewey_time.attendance_engine.flag_identity import flag_identity, parse_evidence
from dewey_time.attendance_engine.flag_triage import TIER_ACT, TIER_REVIEW, TIER_ROUTINE
from dewey_time.attendance_engine.hr_calendar import _require_hr_role

# Row cap on the one unfiltered Attendance Flag scan. Sized defensively: 500 employees ×
# a month of flags is unmeasured (spec Open risk 3), so `truncated` reports when it bites.
QUEUE_FLAG_LIMIT = 5000

# A month at a time. The scan is unfiltered by employee, so the date range is the only
# thing bounding it.
QUEUE_MAX_RANGE_DAYS = 31

# Ceiling on entries returned in one response; also the `limit` default in the signature
# below (kept as a literal there so the whitelisted signature reads as documented).
_MAX_ENTRIES = 2000

_TIERS = frozenset({TIER_ACT, TIER_REVIEW, TIER_ROUTINE})

_QUEUE_CACHE_PREFIX = "flag_queue:v1"

# 60s, deliberately half of coverage_api's 120s (coverage_api.py:26). The invalidator
# below is best-effort only: the engine deletes flags with raw frappe.db.delete()
# (closeout.py:712, reached from intraday.py:78,214 and closeout.py:295,473,476), which
# fires NO document hooks at all, so a regeneration cycle can leave this cache stale
# without ever calling the invalidator. The short TTL, not the hook, is what actually
# bounds staleness — that is why it is 60s and not longer.
_QUEUE_CACHE_TTL_SECONDS = 60


def _queue_cache_key(start_date: str, end_date: str, tier: str | None) -> str:
    return f"{_QUEUE_CACHE_PREFIX}:{start_date}:{end_date}:{tier or 'all'}"


def invalidate_flag_queue_cache(doc=None, method=None):
    """Drop every cached queue page. Wired to Attendance Flag and Attendance Flag
    Decision doc events (after_insert / on_update / on_trash) in hooks.py, mirroring
    coverage_api.invalidate_coverage_cache.

    delete_keys (not delete_value) because the key carries the range and tier, so one
    request writes one of many pages. Best-effort — see _QUEUE_CACHE_TTL_SECONDS above
    for why the TTL is what really bounds staleness.
    """
    frappe.cache().delete_keys(_QUEUE_CACHE_PREFIX)


def _coerce_limit(limit) -> int:
    try:
        value = int(limit)
    except (TypeError, ValueError):
        return _MAX_ENTRIES
    return max(1, min(value, _MAX_ENTRIES))


def _apply_entry_limit(payload: dict, limit: int) -> dict:
    """Slice the cached payload down to `limit` entries. Applied AFTER the cache read on
    purpose: the contract's cache key has no `limit` component, so the cache stores the
    full page for a (range, tier) and each caller trims it."""
    entries = payload.get("entries") or []
    if len(entries) <= limit:
        return payload
    return {**payload, "entries": entries[:limit], "truncated": True}
```

- [ ] **Step 4: Run the test to confirm the module now imports but the endpoint is missing**

Run:
```bash
bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_queue_api
```
Expected: FAIL with `AttributeError: module 'dewey_time.attendance_engine.flag_queue_api' has no attribute 'get_flag_queue'` on the query/range/cache tests; the two `TestHooksWiring` tests fail with `KeyError: 'Attendance Flag'`.

- [ ] **Step 5: Append the batched readers**

Append to `dewey_time/attendance_engine/flag_queue_api.py`:

```python
def _flag_rows(start, end) -> tuple[list[dict], bool]:
    """The single unfiltered Attendance Flag scan for the range. Returns (flags, hit_cap).

    source == "AUTO" only: flag_identity is prefixed "AUTO-" by construction, so an
    HR-created flag for the same employee/date/code would collide with the engine's row
    under one identity. Manual flags are HR's own and were never at risk from the
    delete-and-rebuild cycle this queue exists for.
    """
    rows = (
        frappe.get_all(
            "Attendance Flag",
            filters={"attendance_date": ["between", [start, end]], "source": "AUTO"},
            fields=["employee", "attendance_date", "flag_code", "severity", "day_closed", "evidence"],
            # Deterministic so truncation at the cap always drops the same tail.
            order_by="attendance_date asc, employee asc, creation asc",
            limit_page_length=QUEUE_FLAG_LIMIT,
        )
        or []
    )

    # flag_identity deliberately excludes day_closed (that is the whole point of the
    # scheme), so inside the closeout window a provisional and its final replacement can
    # both be live and share one identity. Collapse to one row, final preferred.
    by_identity: dict[str, dict] = {}
    for row in rows:
        attendance_date = str(row.get("attendance_date"))
        evidence = parse_evidence(row.get("evidence"))
        identity = flag_identity(
            employee=row.get("employee"),
            # Stringified first so the identity cannot depend on whether the driver
            # handed back a date object or a string.
            attendance_date=attendance_date,
            flag_code=row.get("flag_code"),
            evidence=evidence,
        )
        flag = {
            "flag_identity": identity,
            "employee": row.get("employee"),
            "attendance_date": attendance_date,
            "flag_code": row.get("flag_code"),
            "severity": row.get("severity"),
            "day_closed": row.get("day_closed"),
            "evidence": evidence,
        }
        previous = by_identity.get(identity)
        if previous is None or (flag.get("day_closed") or 0) >= (previous.get("day_closed") or 0):
            by_identity[identity] = flag

    return list(by_identity.values()), len(rows) >= QUEUE_FLAG_LIMIT


def _decisions_by_identity(start, end) -> tuple[dict[str, dict], bool]:
    """Live (superseded=0) decisions for the range, keyed by flag_identity."""
    rows = (
        frappe.get_all(
            "Attendance Flag Decision",
            filters={"attendance_date": ["between", [start, end]], "superseded": 0},
            fields=[
                "name",
                "flag_identity",
                "outcome",
                "reason",
                "note",
                "evidence_fingerprint",
                "group_key",
                "decided_by",
                "decided_at",
            ],
            order_by="decided_at asc",
            limit_page_length=QUEUE_FLAG_LIMIT,
        )
        or []
    )

    by_identity: dict[str, dict] = {}
    for row in rows:
        if row.get("decided_at"):
            row["decided_at"] = str(row["decided_at"])
        # Supersession should already guarantee one live row per identity; ordering by
        # decided_at asc means the newest wins if a write ever raced and left two.
        by_identity[row.get("flag_identity")] = row

    return by_identity, len(rows) >= QUEUE_FLAG_LIMIT


def _employees_by_id(employee_ids: set[str]) -> dict[str, dict]:
    """One Employee query for every flagged employee — never one per employee. The IN
    list is bounded by QUEUE_FLAG_LIMIT distinct employees."""
    if not employee_ids:
        return {}
    rows = (
        frappe.get_all(
            "Employee",
            filters={"name": ["in", sorted(employee_ids)]},
            fields=["name", "employee_name", "branch"],
        )
        or []
    )
    return {
        row["name"]: {"employee_name": row.get("employee_name"), "branch": row.get("branch")}
        for row in rows
    }


def _open_alert_rows(start, end) -> list[dict]:
    """Unresolved Device Closeout Alert rows for the range — the flagless cause list.

    Deliberately NOT filtered by the branches that have flags: when a device reports
    deferred_offline or closure_failed the company-fallback path skips those employees
    entirely and generates no flags at all, which is exactly the silence HR cannot see
    today. Same branch+date+resolved_at shape as hr_calendar.py:487-500, minus the
    per-employee branch filter.

    device_sn is deliberately not selected: no device↔branch registry exists, so nothing
    HR-facing may name a serial (spec "Must not do" 6). Two devices failing at one branch
    is one fact for HR, so rows collapse to one card per (branch, date).
    """
    if not frappe.db.table_exists("Device Closeout Alert"):
        return []

    rows = (
        frappe.get_all(
            "Device Closeout Alert",
            filters={"local_date": ["between", [start, end]], "resolved_at": ["is", "not set"]},
            fields=["branch", "local_date", "status", "last_error"],
            order_by="local_date asc, branch asc",
        )
        or []
    )

    deduped: dict[tuple[str, str], dict] = {}
    for row in rows:
        branch = row.get("branch")
        if not branch:
            # branch comes from the webhook payload and can be absent. Without it there
            # is nothing sayable to HR that does not name a serial, so drop the card
            # rather than render "unknown device".
            continue
        row["local_date"] = str(row.get("local_date"))
        deduped.setdefault((branch, row["local_date"]), row)
    return list(deduped.values())


def _device_sync_pairs(branches: set[str], start, end) -> set[tuple[str, str]]:
    """(branch, date) pairs that reported ANY sync row. Existence is all we need, so this
    skips dedupe_device_sync_for_calendar (hr_calendar.py:531) entirely."""
    if not branches or not frappe.db.table_exists("Device Sync Status"):
        return set()
    rows = (
        frappe.get_all(
            "Device Sync Status",
            filters={"branch": ["in", sorted(branches)], "local_date": ["between", [start, end]]},
            fields=["branch", "local_date"],
        )
        or []
    )
    return {(row.get("branch"), str(row.get("local_date"))) for row in rows}


def _outage_branch_dates(*, flags, employees_by_id, alert_rows, sync_pairs) -> set[tuple[str, str]]:
    """(branch, date) pairs with either an unresolved closeout alert or no sync row at all.

    Detecting "no row at all" needs a candidate set to test against, and there is no
    device registry to enumerate — so the candidates are the (branch, date) pairs of
    employees who actually have flags in the range. Branch granularity is by design, not
    an approximation of something finer: nothing in this app maps a device to a branch.
    """
    candidates = set()
    for flag in flags:
        branch = (employees_by_id.get(flag["employee"]) or {}).get("branch")
        if branch:
            candidates.add((branch, flag["attendance_date"]))

    outage = {pair for pair in candidates if pair not in sync_pairs}
    for row in alert_rows:
        outage.add((row["branch"], row["local_date"]))
    return outage
```

- [ ] **Step 6: Append the payload assembly and the whitelisted endpoint**

Append to `dewey_time/attendance_engine/flag_queue_api.py`:

```python
def _build_queue_payload(*, start, end, tier: str | None) -> dict:
    """Five queries, always: flags, decisions, employees, alerts, sync rows. Adding a
    sixth that varies with employee or day count is a spec violation, not a slow path."""
    flags, flags_capped = _flag_rows(start, end)
    decisions_by_identity, decisions_capped = _decisions_by_identity(start, end)
    employees_by_id = _employees_by_id({flag["employee"] for flag in flags if flag.get("employee")})
    alert_rows = _open_alert_rows(start, end)
    branches = {info.get("branch") for info in employees_by_id.values() if info.get("branch")}
    sync_pairs = _device_sync_pairs(branches, start, end)

    queue = build_queue(
        flags=flags,
        decisions_by_identity=decisions_by_identity,
        employees_by_id=employees_by_id,
        outage_branch_dates=_outage_branch_dates(
            flags=flags,
            employees_by_id=employees_by_id,
            alert_rows=alert_rows,
            sync_pairs=sync_pairs,
        ),
    )

    entries = queue.get("entries") or []
    if tier:
        entries = [entry for entry in entries if entry.get("tier") == tier]

    return {
        "entries": entries,
        # counts/orphans stay whole-range: they are the toolbar totals, not a page count.
        "counts": queue.get("counts") or {},
        "orphans": queue.get("orphans") or {},
        "alerts": alert_rows,
        "truncated": bool(flags_capped or decisions_capped),
        "start_date": str(start),
        "end_date": str(end),
    }


@frappe.whitelist()
def get_flag_queue(start_date: str, end_date: str, tier: str | None = None, limit: int = 2000) -> dict:
    """HR-only: every AUTO flag in the range, ranked, person-deduped and cause-grouped,
    plus the unresolved device alerts that produced no flags at all.

    _require_hr_role() raises frappe.ValidationError (417), not PermissionError (403) —
    inconsistent with its neighbours and deliberately kept that way for drop-in
    consistency with schedule_api and coverage_api (hr_calendar.py:50-53).
    """
    _require_hr_role()

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be >= start_date")
    if (end - start).days + 1 > QUEUE_MAX_RANGE_DAYS:
        frappe.throw(f"Date range must be {QUEUE_MAX_RANGE_DAYS} days or fewer")

    tier = (tier or "").strip() or None
    if tier and tier not in _TIERS:
        # Silently returning nothing for a typo'd tier looks like an empty queue.
        frappe.throw("Unknown tier")

    # Normalised dates in the key so "2026-8-1" and "2026-08-01" are one cache entry.
    cache_key = _queue_cache_key(str(start), str(end), tier)
    payload = frappe.cache().get_value(cache_key)
    if not payload:
        payload = _build_queue_payload(start=start, end=end, tier=tier)
        frappe.cache().set_value(cache_key, payload, expires_in_sec=_QUEUE_CACHE_TTL_SECONDS)

    return _apply_entry_limit(payload, _coerce_limit(limit))
```

- [ ] **Step 7: Run the test — only the hooks-wiring tests should still fail**

Run:
```bash
bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_queue_api
```
Expected: FAIL with exactly two failures, both `KeyError: 'Attendance Flag'` / `KeyError: 'Attendance Flag Decision'` in `TestHooksWiring`. Every other test passes.

- [ ] **Step 8: Wire the invalidator into `hooks.py`**

In `dewey_time/hooks.py`, extend the `doc_events` dict (currently `hooks.py:121-133`) by
appending these two blocks after the `Shift Schedule Assignment` block, matching its
comment style:

```python
    # Keep the HR flag queue fresh: clear its cached pages whenever a flag or an HR
    # decision is written. Best-effort ONLY — the engine deletes flags with a raw
    # frappe.db.delete() (closeout.py:712), which fires no document hooks at all, so a
    # regeneration cycle never reaches this handler. The 60s TTL in flag_queue_api is
    # what actually bounds staleness; this hook just makes the common case immediate.
    "Attendance Flag": {
        "after_insert": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
        "on_update": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
        "on_trash": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
    },
    "Attendance Flag Decision": {
        "after_insert": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
        "on_update": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
        "on_trash": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
    },
```

After the edit the whole dict reads:

```python
doc_events = {
    "Employee Checkin": {
        "after_insert": "dewey_time.attendance_engine.intraday.on_employee_checkin_after_insert",
        "on_update": "dewey_time.attendance_engine.intraday.on_employee_checkin_on_update",
    },
    # Keep the Schedule Coverage page fresh: clear its cached payload whenever a
    # shift schedule assignment is created, changed, or removed.
    "Shift Schedule Assignment": {
        "after_insert": "dewey_time.attendance_engine.coverage_api.invalidate_coverage_cache",
        "on_update": "dewey_time.attendance_engine.coverage_api.invalidate_coverage_cache",
        "on_trash": "dewey_time.attendance_engine.coverage_api.invalidate_coverage_cache",
    },
    # Keep the HR flag queue fresh: clear its cached pages whenever a flag or an HR
    # decision is written. Best-effort ONLY — the engine deletes flags with a raw
    # frappe.db.delete() (closeout.py:712), which fires no document hooks at all, so a
    # regeneration cycle never reaches this handler. The 60s TTL in flag_queue_api is
    # what actually bounds staleness; this hook just makes the common case immediate.
    "Attendance Flag": {
        "after_insert": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
        "on_update": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
        "on_trash": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
    },
    "Attendance Flag Decision": {
        "after_insert": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
        "on_update": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
        "on_trash": "dewey_time.attendance_engine.flag_queue_api.invalidate_flag_queue_cache",
    },
}
```

- [ ] **Step 9: Run the test again — everything passes**

Run:
```bash
bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_flag_queue_api
```
Expected: OK, 24 tests, 0 failures. If the count is lower than 24, the module errored on
import rather than running — read the traceback, do not treat a green line as proof.

- [ ] **Step 10: Regression-run the neighbours that share the frappe mock and hooks.py**

Run:
```bash
bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_coverage_api
bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_hooks_launcher_tiles
bench --site <site> run-tests --app dewey_time --module dewey_time.tests.test_hr_calendar
```
Expected: all OK. These share `_install_frappe_mock()` and `hooks.py`; the new doc_events
keys must not disturb them.

- [ ] **Step 11: Commit**

```bash
git add dewey_time/attendance_engine/flag_queue_api.py dewey_time/tests/test_flag_queue_api.py dewey_time/hooks.py
git commit -m "feat(flags): batched HR flag queue read API with cache invalidation"
```

Commit trailer (required by Global Constraints 14):
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 7: Attach decisions to the existing calendar API

**Files:**
- Modify: `dewey_time/attendance_engine/hr_calendar.py:16-19,450-453,571-589`
- Test: `dewey_time/tests/test_hr_calendar.py` (existing file — add `import json` and a new `TestCalendarDecisions` class)

**Interfaces:**
- Consumes:
  - `dewey_time.attendance_engine.flag_identity.flag_identity(*, employee: str, attendance_date, flag_code: str, evidence) -> str`
  - `dewey_time.attendance_engine.flag_identity.evidence_fingerprint(evidence) -> str`
  - `Attendance Flag Decision` doctype fields (from the doctype task): `flag_identity`, `employee`, `attendance_date`, `flag_code`, `outcome`, `reason`, `note`, `decided_by`, `decided_at`, `group_key`, `evidence_fingerprint`, `superseded`.
- Produces: on every flag object inside `get_employee_calendar`'s `days[*].flags[*]`, two additive keys — `"decision": dict | None` (the live decision row, or `None`) and `"decision_state": "undecided" | "matched" | "needs_re_review"`. No existing key changes shape. Consumed by later frontend tasks (day inspector / week grid chips) and by nothing else on the backend — `flag_queue_api.py`/`flag_grouping.py` compute their own `decision_state` independently over the whole-roster batch, using the *same* `flag_identity.evidence_fingerprint()` function and the same equal/not-equal comparison, which is what keeps the two surfaces from disagreeing (not a shared call path between the two API modules).

- [ ] **Step 1: Write the failing tests**

Add `import json` near the top of `dewey_time/tests/test_hr_calendar.py`, and append this new test class just before the `if __name__ == "__main__":` block at the end of the file:

```python
class TestCalendarDecisions(unittest.TestCase):
    """get_employee_calendar attaches a `decision` + `decision_state` to each flag,
    batched over the whole range in ONE query — see hr-flag-management-design.md
    "get_employee_calendar (existing) — additive change". Identity/fingerprint
    computation is mocked here: this module only has to prove it wires the batched
    query and the match/mismatch/absent branching correctly, not that
    flag_identity.py itself is correct (that lives in its own test module)."""

    FLAG_ROW = {
        "name": "AF-1",
        "attendance_date": "2026-08-05",
        "flag_code": "MISSING_TIME",
        "severity": "WARNING",
        "source": "AUTO",
        "status": "OPEN",
        "day_closed": 1,
        "rule_version": 1,
        "evidence": json.dumps({"minutes": 45, "reason": "gap", "interval_start": "12:00:00"}),
    }

    def _call(self, *, decision_rows, identity_return="IDENT-1", fingerprint_return="fp-current",
              start="2026-08-05", end="2026-08-05"):
        from datetime import date as _date

        import dewey_time.attendance_engine.hr_calendar as hc

        get_all_calls = {"Attendance Flag Decision": 0}

        def _get_all(doctype, **_kwargs):
            if doctype == "Employee Checkin":
                return []
            if doctype == "Attendance Flag":
                return [dict(self.FLAG_ROW)]
            if doctype == "Attendance Flag Decision":
                get_all_calls["Attendance Flag Decision"] += 1
                return list(decision_rows)
            return []

        def _table_exists(doctype):
            return doctype in ("Attendance Flag", "Attendance Flag Decision")

        with patch.object(hc, "_require_calendar_access"), \
             patch.object(hc, "getdate", lambda v: _date.fromisoformat(str(v))), \
             patch.object(hc, "get_datetime", lambda v: str(v)), \
             patch.object(hc, "nowdate", lambda: "2026-08-06"), \
             patch.object(hc.frappe.db, "get_value", return_value=None), \
             patch.object(hc.frappe, "get_all", side_effect=_get_all), \
             patch.object(hc.frappe.db, "table_exists", side_effect=_table_exists), \
             patch.object(hc, "flag_identity", return_value=identity_return), \
             patch.object(hc, "evidence_fingerprint", return_value=fingerprint_return):
            payload = hc.get_employee_calendar("EMP-001", start, end)
        return payload, get_all_calls

    def test_matching_decision_reports_matched(self):
        decision_row = {
            "name": "AFD-1",
            "flag_identity": "IDENT-1",
            "outcome": "EXCUSED",
            "reason": "APPROVED_LEAVE",
            "note": None,
            "decided_by": "hr@example.com",
            "decided_at": "2026-08-05 09:00:00",
            "group_key": "GRP-1",
            "evidence_fingerprint": "fp-current",
        }
        payload, _ = self._call(
            decision_rows=[decision_row],
            identity_return="IDENT-1",
            fingerprint_return="fp-current",
        )
        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "matched")
        self.assertEqual(flag["decision"]["name"], "AFD-1")
        self.assertEqual(flag["decision"]["outcome"], "EXCUSED")

    def test_fingerprint_mismatch_reports_needs_re_review_but_keeps_decision(self):
        decision_row = {
            "name": "AFD-1",
            "flag_identity": "IDENT-1",
            "outcome": "EXCUSED",
            "reason": "APPROVED_LEAVE",
            "note": None,
            "decided_by": "hr@example.com",
            "decided_at": "2026-08-05 09:00:00",
            "group_key": "GRP-1",
            "evidence_fingerprint": "fp-stale",
        }
        payload, _ = self._call(
            decision_rows=[decision_row],
            identity_return="IDENT-1",
            fingerprint_return="fp-corrected",
        )
        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "needs_re_review")
        self.assertIsNotNone(flag["decision"])
        self.assertEqual(flag["decision"]["name"], "AFD-1")

    def test_no_decision_reports_undecided_and_none(self):
        payload, _ = self._call(
            decision_rows=[],
            identity_return="IDENT-1",
            fingerprint_return="fp-current",
        )
        flag = payload["days"][0]["flags"][0]
        self.assertEqual(flag["decision_state"], "undecided")
        self.assertIsNone(flag["decision"])

    def test_decision_lookup_is_one_query_for_the_whole_range(self):
        _, get_all_calls = self._call(
            decision_rows=[],
            start="2026-08-01",
            end="2026-08-05",
        )
        self.assertEqual(get_all_calls["Attendance Flag Decision"], 1)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bench --site test_site run-tests --app dewey_time --module dewey_time.tests.test_hr_calendar`

Expected: all four new tests FAIL with `AttributeError: <module 'dewey_time.attendance_engine.hr_calendar' from '...'> does not have the attribute 'flag_identity'` — `patch.object(hc, "flag_identity", ...)` requires the attribute to already exist on the module, and `hr_calendar.py` does not import `flag_identity` (or `evidence_fingerprint`) yet. This proves the tests are exercising code that does not exist on `main` yet, not a typo in the test itself.

- [ ] **Step 3: Import the pure identity helpers**

In `dewey_time/attendance_engine/hr_calendar.py`, add one import line after the existing `shift_assignment` import block (currently lines 16-19):

```python
from dewey_time.attendance_engine.shift_assignment import (
    get_shift_assignment as _get_shift_assignment,
    shift_assignment_bounds_by_employee,
)
from dewey_time.attendance_engine.flag_identity import evidence_fingerprint, flag_identity
```

- [ ] **Step 4: Add the batched decision-lookup helper**

Insert this function directly above `get_employee_calendar` (i.e. right after `_employee_nav_meta`'s closing brace, before the `@frappe.whitelist()` decorator currently at line 453):

```python
def _live_decisions_by_identity(*, employee: str, start, end) -> dict[str, dict]:
    """Live (superseded=0) Attendance Flag Decision rows for one employee's date
    range, as ONE batched query keyed by flag_identity — never per-day, never
    per-flag (Global Constraint 5). Called exactly once per get_employee_calendar
    request, regardless of how many days or flags are in range; the per-flag
    attach below this is an in-memory dict lookup, not a query."""
    if not frappe.db.table_exists("Attendance Flag Decision"):
        return {}

    rows = (
        frappe.get_all(
            "Attendance Flag Decision",
            filters={
                "employee": employee,
                "attendance_date": ["between", [start, end]],
                "superseded": 0,
            },
            fields=[
                "name",
                "flag_identity",
                "outcome",
                "reason",
                "note",
                "decided_by",
                "decided_at",
                "group_key",
                "evidence_fingerprint",
            ],
        )
        or []
    )

    by_identity: dict[str, dict] = {}
    for row in rows:
        row["decided_at"] = _format_datetime(row.get("decided_at"))
        identity = row.get("flag_identity")
        if identity:
            by_identity[identity] = row
    return by_identity
```

- [ ] **Step 5: Wire the lookup into the per-flag loop**

Replace the existing `flags_by_day_raw` construction inside `get_employee_calendar` (currently lines 571-589):

```python
    flags_by_day_raw: dict[str, list[dict]] = defaultdict(list)
    for f in flags:
        d = f.get("attendance_date")
        key = str(d) if d else None
        if not key:
            continue
        ev = f.get("evidence")
        if isinstance(ev, str) and ev:
            try:
                f["evidence"] = json.loads(ev)
            except Exception:
                f["evidence"] = None
        day_closed = f.get("day_closed")
        flags_by_day_raw[key].append(
            {
                **f,
                "is_provisional": day_closed == 0,
            }
        )
```

with:

```python
    decisions_by_identity = _live_decisions_by_identity(employee=employee, start=start, end=end)

    flags_by_day_raw: dict[str, list[dict]] = defaultdict(list)
    for f in flags:
        d = f.get("attendance_date")
        key = str(d) if d else None
        if not key:
            continue
        ev = f.get("evidence")
        if isinstance(ev, str) and ev:
            try:
                f["evidence"] = json.loads(ev)
            except Exception:
                f["evidence"] = None
        day_closed = f.get("day_closed")
        # Attach the live decision (if any) by flag_identity, computed from the
        # flag's own fields — never from `name`, which is unstable across the
        # provisional/final rename (attendance_flag.py:53-71, Global Constraint 2).
        identity = flag_identity(
            employee=employee,
            attendance_date=key,
            flag_code=f.get("flag_code"),
            evidence=f.get("evidence"),
        )
        decision = decisions_by_identity.get(identity)
        if decision is None:
            decision_state = "undecided"
        elif evidence_fingerprint(f.get("evidence")) == decision.get("evidence_fingerprint"):
            decision_state = "matched"
        else:
            # Evidence moved under the decision (e.g. HR corrected the punch that
            # produced it). Same match/mismatch rule flag_grouping.build_queue
            # uses for the triage queue, so this surface and that one can never
            # disagree about the same flag_identity.
            decision_state = "needs_re_review"
        flags_by_day_raw[key].append(
            {
                **f,
                "is_provisional": day_closed == 0,
                "decision": decision,
                "decision_state": decision_state,
            }
        )
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bench --site test_site run-tests --app dewey_time --module dewey_time.tests.test_hr_calendar`
Expected: PASS — all pre-existing tests in the module plus the four new `TestCalendarDecisions` tests are green. Confirm the printed test count increased by 4 over the pre-Step-1 baseline; a passing run with the same count means the new tests were never collected.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/attendance_engine/hr_calendar.py dewey_time/tests/test_hr_calendar.py
git commit -m "$(cat <<'EOF'
feat(hr-calendar): attach flag decisions to get_employee_calendar

Each flag get_employee_calendar returns now carries a "decision" object
(or None) and a "decision_state" of undecided/matched/needs_re_review,
looked up by flag_identity in one batched Attendance Flag Decision
query per request — not per day, not per flag. Uses the same
evidence_fingerprint comparison flag_grouping.build_queue uses, so the
day inspector and the HR triage queue can never disagree about one
flag's decision state. No existing field changes shape.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Frontend types, service and pure decision state

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/types/flags.ts`
- Create: `dewey_time/frontend/hr_attendance/src/services/flags.ts`
- Create: `dewey_time/frontend/hr_attendance/src/lib/flagDecisionState.ts`
- Create: `dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts`
- Create: `dewey_time/frontend/hr_attendance/src/hooks/useFlagQueue.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/queryKeys.ts:41-45`
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagDecisionState.test.ts`
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.test.ts`

**Interfaces:**
- Consumes: the Python API surface pinned by the plan's Interface Contract, which earlier backend
  tasks build: `get_flag_queue(start_date, end_date, tier=None, limit=2000) -> {"entries", "counts",
  "orphans", "alerts", "truncated", "start_date", "end_date"}` (`flag_queue_api.py`),
  `decide_flags(identities, outcome, reason, note=None, group_key=None, confirm=None) -> {"ok",
  "written", "group_key", "errors"}` or `{"needs_confirm", "preview"}` and
  `reverse_decision_group(group_key, note, confirm=None) -> dict` (`flag_decision_api.py`). The
  `Entry`/`Person`/`FlagOut` dict shapes from `flag_grouping.build_queue` are transcribed verbatim
  into `types/flags.ts` below.
- Produces (for every later frontend task — hooks, `ui/FlagQueuePage.tsx`, `ui/FlagQueueList.tsx`,
  `ui/FlagDecisionPanel.tsx`):
  - `types/flags.ts`: `Tier`, `DecisionState`, `Outcome`, `Reason`, `FlagDecision`, `FlagOut`,
    `QueuePerson`, `QueueEntry`, `QueuePayload` — exact contract shapes.
  - `services/flags.ts`: `getFlagQueue(args)`, `decideFlags(args)`, `reverseDecisionGroup(args)`.
  - `lib/flagDecisionState.ts`: `decisionIsComplete(d: PendingDecision): boolean`,
    `groupPayload(members: QueuePerson[], excluded: ReadonlySet<string>): { identities: string[];
    employeeCount: number }`, `remainingIdentities(person: QueuePerson): string[]` — exact contract
    signatures.
  - `lib/flagQueueLabels.ts`: `TIER_LABELS`, `tierLabel(tier)`, `REASON_LABELS`, `reasonLabel(reason)`,
    `branchNoDeviceDataHeader(branch, attendanceDate)`, `routineCodeHeader(flagCode, members)`,
    `orphanedFlagGoneSummary(count)`, `orphanedEvidenceChangedSummary(count)`.
  - `hooks/useFlagQueue.ts`: `useFlagQueue({ startDate, endDate, tier? })`.
  - `queryKeys.flags.queue(startDate, endDate, tier)`, added to the shared registry so later
    mutations can invalidate by `queryKeys.flags.all`.

---

- [ ] **Step 1: Create `types/flags.ts` — transcribed verbatim from the Interface Contract**

The contract (`plan-spine.md` § "TypeScript — `types/flags.ts`") gives this block exactly; only the
file header comment and per-field line-wrapping are added, no field is renamed, added, or dropped.

```typescript
/**
 * Payload types for the flag-queue feature — shared verbatim by
 * `services/flags.ts`, `hooks/useFlagQueue.ts` and the queue UI (later
 * tasks). These mirror the Python dict shapes `flag_queue_api.get_flag_queue`
 * and `flag_grouping.build_queue` return (see the plan's Interface Contract)
 * field for field. Do not add, rename, or reshape anything here without
 * updating that contract in the same change — every later frontend task is
 * built directly on these exact names.
 */

export type Tier = "act" | "review" | "routine";

export type DecisionState = "undecided" | "matched" | "needs_re_review";

export type Outcome = "EXCUSED" | "UPHELD";

export type Reason =
  | "APPROVED_LEAVE"
  | "DEVICE_OR_DATA_FAULT"
  | "MANAGER_APPROVED"
  | "SCHEDULE_WRONG"
  | "COVERING_OTHER_SITE"
  | "GENUINE_VIOLATION"
  | "OTHER";

export type FlagDecision = {
  name: string;
  outcome: Outcome;
  reason: Reason;
  note?: string | null;
  decided_by: string;
  decided_at: string;
  group_key?: string | null;
};

export type FlagOut = {
  flag_identity: string;
  flag_code: string;
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
  employee: string;
  employee_name: string;
  employee_branch: string | null;
  attendance_date: string;
  rank: number;
  tier: Tier;
  /** Worst-first, ALL that person's flags that day. */
  flags: FlagOut[];
  undecided_count: number;
};

export type QueueEntry =
  | ({ kind: "person" } & QueuePerson)
  | {
      kind: "group";
      group_type: "BRANCH_NO_DEVICE_DATA" | "ROUTINE_CODE";
      group_key: string;
      branch: string | null;
      flag_code: string | null;
      attendance_date: string;
      rank: number;
      tier: Tier;
      members: QueuePerson[];
    };

export type QueuePayload = {
  entries: QueueEntry[];
  counts: { open: number; needs_re_review: number; decided: number; people: number };
  orphans: { orphaned_flag_gone: number; orphaned_evidence_changed: number };
  alerts: { branch: string; local_date: string; status: string; last_error?: string | null }[];
  truncated: boolean;
  start_date: string;
  end_date: string;
};
```

No test — this file declares no runtime behaviour to assert on, matching `types/schedule.ts` and
`types/calendar.ts`, neither of which has a dedicated test file.

- [ ] **Step 2: Create `services/flags.ts` — thin `frappeCall` wrappers, no logic**

Matches `services/schedule.ts`'s idiom exactly (plain async functions, one `NS` constant per Python
module). Two Python modules split the read path from the write path
(`flag_queue_api.py` for `get_flag_queue`, `flag_decision_api.py` for `decide_flags` /
`reverse_decision_group`), so this file carries two `NS` constants — the same split
`services/scheduleImport.ts` uses for `IMPORT_NS`/`SCHEDULE_NS`. `decide_flags`'s and
`reverse_decision_group`'s exact TS result shapes are not given in the contract (only the Python
`-> dict` comments), so their result types are declared locally here rather than added to
`types/flags.ts`, which Step 1 keeps verbatim.

```typescript
/**
 * HR flag-queue reads/writes. Plain async functions with no React, following
 * the same shape as `services/schedule.ts` — `hooks/useFlagQueue.ts` wraps
 * `getFlagQueue` with `useQuery`; the decide/reverse mutations are wired up
 * by a later task.
 *
 * Two backend modules split the read path from the write path
 * (`flag_queue_api.py` for `get_flag_queue`, `flag_decision_api.py` for
 * `decide_flags` / `reverse_decision_group` — see the plan's Interface
 * Contract), so this file carries two NS constants rather than one, the same
 * split `services/scheduleImport.ts` uses for IMPORT_NS/SCHEDULE_NS.
 */
import { frappeCall } from "@/lib/frappe";
import type { Outcome, QueuePayload, Reason, Tier } from "@/types/flags";

const QUEUE_NS = "dewey_time.attendance_engine.flag_queue_api";
const DECISION_NS = "dewey_time.attendance_engine.flag_decision_api";

/** One row of a bulk write's partial failure — Global Constraint 8's fan-out shape. */
export type DecideFlagsError = { flag_identity: string; error: string };

export type DecideFlagsResult =
  | { ok: boolean; written: number; group_key: string; errors: DecideFlagsError[] }
  | { needs_confirm: true; preview: { count: number; employees: number } };

export type ReverseDecisionResult = {
  ok: boolean;
  written: number;
  errors: DecideFlagsError[];
};

export function getFlagQueue(args: {
  startDate: string;
  endDate: string;
  tier?: Tier | null;
  limit?: number;
}) {
  return frappeCall<QueuePayload>(`${QUEUE_NS}.get_flag_queue`, {
    start_date: args.startDate,
    end_date: args.endDate,
    tier: args.tier ?? undefined,
    limit: args.limit,
  });
}

export function decideFlags(args: {
  identities: string[];
  outcome: Outcome;
  reason: Reason;
  note?: string | null;
  groupKey?: string | null;
  confirm?: boolean;
}) {
  return frappeCall<DecideFlagsResult>(
    `${DECISION_NS}.decide_flags`,
    {
      identities: args.identities,
      outcome: args.outcome,
      reason: args.reason,
      note: args.note ?? undefined,
      group_key: args.groupKey ?? undefined,
      confirm: args.confirm ?? undefined,
    },
    { method: "POST" },
  );
}

export function reverseDecisionGroup(args: { groupKey: string; note: string; confirm?: boolean }) {
  return frappeCall<ReverseDecisionResult>(
    `${DECISION_NS}.reverse_decision_group`,
    {
      group_key: args.groupKey,
      note: args.note,
      confirm: args.confirm ?? undefined,
    },
    { method: "POST" },
  );
}
```

No test — `src/services/` is explicitly excluded from the `test:web` glob (Global Constraint 10),
and `services/schedule.ts`/`coverage.ts`/`maintenance.ts` have no dedicated tests either.

- [ ] **Step 3: Write the failing test for `lib/flagDecisionState.ts`**

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import { decisionIsComplete, groupPayload, remainingIdentities } from "@/lib/flagDecisionState";
import type { FlagOut, QueuePerson } from "@/types/flags";

function flag(over: Partial<FlagOut> & { flag_identity: string }): FlagOut {
  return {
    flag_code: "LATE_START",
    severity: "WARNING",
    day_closed: 1,
    evidence: {},
    rank: 20,
    tier: "routine",
    decision_state: "undecided",
    decision: null,
    ...over,
  } as FlagOut;
}

function person(over: Partial<QueuePerson> & { employee: string; flags: FlagOut[] }): QueuePerson {
  return {
    employee_name: over.employee,
    employee_branch: null,
    attendance_date: "2026-08-03",
    rank: 20,
    tier: "routine",
    undecided_count: over.flags.filter((f) => f.decision_state === "undecided").length,
    ...over,
  } as QueuePerson;
}

test("decisionIsComplete requires a note when the outcome is UPHELD", () => {
  assert.equal(decisionIsComplete({ outcome: "UPHELD", reason: "GENUINE_VIOLATION", note: "" }), false);
  assert.equal(
    decisionIsComplete({
      outcome: "UPHELD",
      reason: "GENUINE_VIOLATION",
      note: "Confirmed with the shift lead.",
    }),
    true,
  );
});

test("decisionIsComplete requires a note when the reason is OTHER", () => {
  assert.equal(decisionIsComplete({ outcome: "EXCUSED", reason: "OTHER", note: "" }), false);
  assert.equal(
    decisionIsComplete({
      outcome: "EXCUSED",
      reason: "OTHER",
      note: "Approved via WhatsApp, see thread.",
    }),
    true,
  );
});

test("decisionIsComplete does not require a note for EXCUSED with a non-OTHER reason", () => {
  assert.equal(decisionIsComplete({ outcome: "EXCUSED", reason: "APPROVED_LEAVE", note: "" }), true);
});

test("groupPayload drops an excluded employee's flags entirely and returns the right employeeCount", () => {
  const members: QueuePerson[] = [
    person({ employee: "HR-EMP-00001", flags: [flag({ flag_identity: "AUTO-1" })] }),
    person({
      employee: "HR-EMP-00002",
      flags: [flag({ flag_identity: "AUTO-2a" }), flag({ flag_identity: "AUTO-2b" })],
    }),
    person({ employee: "HR-EMP-00003", flags: [flag({ flag_identity: "AUTO-3" })] }),
  ];

  const { identities, employeeCount } = groupPayload(members, new Set(["HR-EMP-00002"]));

  assert.deepEqual(identities.sort(), ["AUTO-1", "AUTO-3"]);
  assert.equal(employeeCount, 2);
  // both of the excluded employee's flags are gone, not just their headline one
  assert.ok(!identities.includes("AUTO-2a"));
  assert.ok(!identities.includes("AUTO-2b"));
});

test("groupPayload never includes an already-decided flag", () => {
  const decided = flag({
    flag_identity: "AUTO-decided",
    decision_state: "matched",
    decision: {
      name: "AFD-1",
      outcome: "EXCUSED",
      reason: "DEVICE_OR_DATA_FAULT",
      decided_by: "hr@example.com",
      decided_at: "2026-08-03 09:00:00",
    },
  });
  const undecided = flag({ flag_identity: "AUTO-undecided" });
  const members: QueuePerson[] = [person({ employee: "HR-EMP-00001", flags: [decided, undecided] })];

  const { identities } = groupPayload(members, new Set());

  assert.deepEqual(identities, ["AUTO-undecided"]);
});

test("remainingIdentities is worst-first and omits decided flags", () => {
  const decided = flag({
    flag_identity: "AUTO-already-decided",
    rank: 150,
    tier: "act",
    decision_state: "matched",
    decision: {
      name: "AFD-2",
      outcome: "UPHELD",
      reason: "GENUINE_VIOLATION",
      note: "Confirmed no-show.",
      decided_by: "hr@example.com",
      decided_at: "2026-08-03 09:00:00",
    },
  });
  const worst = flag({ flag_identity: "AUTO-worst", rank: 140, tier: "act" });
  const middle = flag({ flag_identity: "AUTO-middle", rank: 60, tier: "review" });
  // `decided` is placed first even though its rank is highest, to prove the
  // function filters rather than leaning on decided rows always sorting last.
  const p = person({ employee: "HR-EMP-00001", flags: [decided, worst, middle] });

  assert.deepEqual(remainingIdentities(p), ["AUTO-worst", "AUTO-middle"]);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run (from `dewey_time/frontend/hr_attendance/`): `npm run test:web`

Expected FAIL: `lib/flagDecisionState.ts` does not exist yet, so `tsx` aborts loading
`src/lib/flagDecisionState.test.ts` with a module-resolution error before any of its `test()` blocks
run:

```
Error: Cannot find module '@/lib/flagDecisionState'
...
  code: 'MODULE_NOT_FOUND',
```

The runner reports this file itself as one failing test (`✖ .../flagDecisionState.test.ts`) while
every other existing test file still runs and passes — confirmed by running the equivalent failure
against this repo's fixtures: total `fail` count is exactly 1 higher than the pre-change baseline
(336 passing today per `npm run test:web`), not a wholesale abort.

- [ ] **Step 5: Implement `lib/flagDecisionState.ts`**

```typescript
/**
 * Pure decision-state logic for the flag triage page: whether a pending
 * decision has what it needs before "Decide" submits, and the two payload
 * builders that turn a person or a cause-group selection into the exact
 * `identities` array `decide_flags` expects.
 *
 * `groupPayload` is the safety property the design doc calls out under
 * "Per-member exclusion on group decisions"
 * (docs/superpowers/specs/2026-08-05-hr-flag-management-design.md): unchecking
 * one member of a 41-person BRANCH_NO_DEVICE_DATA group must remove ALL of
 * that employee's flags from the bulk write — not just the flag that put
 * them in the group — and must never sweep in a flag the queue already shows
 * as decided. Without both of those, one genuine no-show hidden among 41
 * device-fault rows could be silently excused by a checkbox that only
 * covered their headline flag, which the design doc calls "the single most
 * damaging thing this page could do".
 */
import type { FlagOut, Outcome, QueuePerson, Reason } from "@/types/flags";

export type PendingDecision = { outcome: Outcome; reason: Reason; note: string };

/**
 * A note is mandatory for `outcome: "UPHELD"` (an uncontested violation
 * still needs the "why" on the audit record) and for `reason: "OTHER"` (the
 * closed vocabulary's escape hatch is unreadable without free text) — see
 * the `Attendance Flag Decision.note` field spec. Every other combination
 * can submit with an empty note.
 */
export function decisionIsComplete(decision: PendingDecision): boolean {
  const noteRequired = decision.outcome === "UPHELD" || decision.reason === "OTHER";
  return !noteRequired || decision.note.trim().length > 0;
}

function isUndecided(flag: FlagOut): boolean {
  return flag.decision_state === "undecided";
}

/**
 * Builds the `identities` array (plus a live headcount for the group header)
 * for a bulk `decide_flags` call over a cause group's members.
 *
 * Two filters, both load-bearing:
 *   - an excluded employee contributes NOTHING: every flag of theirs is
 *     dropped, not just the one that put them in the group. A person can
 *     carry flags their `+N` badge never itemises, and all of them must
 *     stay out of the write.
 *   - only `undecided` flags are ever included, even for a checked-in
 *     member. A `matched` or `needs_re_review` flag already has a decision
 *     (or needs a human to look again, not a bulk repeat); including it
 *     would produce a spurious supersession nobody asked for.
 *
 * `employeeCount` counts every non-excluded member once, independent of
 * whether they end up contributing an identity — it backs the group
 * header's live count ("Excuse 39" when 2 of 41 are unchecked), which
 * tracks the checkboxes, not the write's contents.
 */
export function groupPayload(
  members: QueuePerson[],
  excluded: ReadonlySet<string>,
): { identities: string[]; employeeCount: number } {
  const identities: string[] = [];
  let employeeCount = 0;

  for (const person of members) {
    if (excluded.has(person.employee)) continue;
    employeeCount += 1;
    for (const f of person.flags) {
      if (isUndecided(f)) identities.push(f.flag_identity);
    }
  }

  return { identities, employeeCount };
}

/**
 * A person's undecided flag identities, worst-first. `person.flags` already
 * arrives worst-first per the queue contract (FlagOut[] — "worst-first, ALL
 * that person's flags that day"), so this only filters; it never re-sorts.
 * Backs "Apply to remaining N" once the panel's first decision has fired.
 */
export function remainingIdentities(person: QueuePerson): string[] {
  return person.flags.filter(isUndecided).map((f) => f.flag_identity);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:web`

Expected: all 6 new tests in `flagDecisionState.test.ts` pass; total `pass` count is 6 higher than
the pre-Step-3 baseline, `fail` is back to 0.

- [ ] **Step 7: Write the failing test for `lib/flagQueueLabels.ts`**

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import {
  branchNoDeviceDataHeader,
  orphanedEvidenceChangedSummary,
  orphanedFlagGoneSummary,
  REASON_LABELS,
  reasonLabel,
  routineCodeHeader,
  tierLabel,
} from "@/lib/flagQueueLabels";
import type { FlagOut, QueuePerson, Reason } from "@/types/flags";

// Hardcoded independently of REASON_LABELS's own keys. Iterating
// `Object.keys(REASON_LABELS)` would trivially pass even if a Reason added to
// `types/flags.ts` was never given a label, because the map would simply
// lack that key and `Object.keys` would never produce it to check. This list
// mirrors the closed `REASONS` tuple in `flag_decision_api.py` (Interface
// Contract) so a future addition to the union has to be added here too, or
// this test fails instead of the UI silently rendering "GENUINE_VIOLATION".
const ALL_REASONS: Reason[] = [
  "APPROVED_LEAVE",
  "DEVICE_OR_DATA_FAULT",
  "MANAGER_APPROVED",
  "SCHEDULE_WRONG",
  "COVERING_OTHER_SITE",
  "GENUINE_VIOLATION",
  "OTHER",
];

test("every Reason in the union has a non-empty label", () => {
  for (const reason of ALL_REASONS) {
    const label = reasonLabel(reason);
    assert.ok(typeof label === "string" && label.trim().length > 0, `${reason} has no label`);
    // Guards against a formatFlagLabel-style raw-enum fallback leaking into
    // HR-facing copy, e.g. "GENUINE_VIOLATION" or "genuine violation".
    assert.notEqual(label, reason);
    assert.doesNotMatch(label, /_/);
  }
});

test("tierLabel covers all three tiers", () => {
  assert.equal(tierLabel("act"), "Act");
  assert.equal(tierLabel("review"), "Review");
  assert.equal(tierLabel("routine"), "Routine");
});

test("REASON_LABELS matches the design doc's exact wording", () => {
  assert.equal(REASON_LABELS.APPROVED_LEAVE, "Approved leave or holiday");
  assert.equal(REASON_LABELS.DEVICE_OR_DATA_FAULT, "Device or data fault");
  assert.equal(REASON_LABELS.MANAGER_APPROVED, "Manager pre-approved");
  assert.equal(REASON_LABELS.SCHEDULE_WRONG, "Schedule was wrong");
  assert.equal(REASON_LABELS.COVERING_OTHER_SITE, "Covering another site");
  assert.equal(REASON_LABELS.GENUINE_VIOLATION, "Genuine violation");
  assert.equal(REASON_LABELS.OTHER, "Other");
});

test("branchNoDeviceDataHeader names the branch and date, never a device serial", () => {
  const header = branchNoDeviceDataHeader("Phnom Penh HQ", "2026-08-03");
  assert.equal(header, "Phnom Penh HQ had no device data on 3 Aug");
  // No device serial has ever been passed in for this to leak — this is a
  // sanity check that the format string itself carries no ID-shaped token.
  assert.doesNotMatch(header, /ZK-|SN-|\d{4,}/);
});

function routineFlag(flagCode: string, minutes: number): FlagOut {
  return {
    flag_identity: `AUTO-${flagCode}-${minutes}`,
    flag_code: flagCode,
    severity: "INFO",
    day_closed: 1,
    evidence: { minutes },
    rank: 20,
    tier: "routine",
    decision_state: "undecided",
    decision: null,
  };
}

function routinePerson(employee: string, flagCode: string, minutes: number): QueuePerson {
  return {
    employee,
    employee_name: employee,
    employee_branch: "Phnom Penh HQ",
    attendance_date: "2026-08-03",
    rank: 20,
    tier: "routine",
    flags: [routineFlag(flagCode, minutes)],
    undecided_count: 1,
  };
}

test("routineCodeHeader matches the design doc's example wording exactly", () => {
  const minutes = [6, 20, ...Array.from({ length: 166 }, () => 12)];
  const members = minutes.map((m, i) => routinePerson(`HR-EMP-${i}`, "LATE_START", m));
  assert.equal(members.length, 168);
  assert.equal(
    routineCodeHeader("LATE_START", members),
    "168 late starts, 6–20 min — and nothing else wrong that day",
  );
});

test("orphan summaries pluralise correctly", () => {
  assert.match(orphanedFlagGoneSummary(1), /^1 decision /);
  assert.match(orphanedFlagGoneSummary(3), /^3 decisions /);
  assert.match(orphanedEvidenceChangedSummary(1), /^1 flag /);
  assert.match(orphanedEvidenceChangedSummary(4), /^4 flags /);
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npm run test:web`

Expected FAIL: `lib/flagQueueLabels.ts` does not exist yet, so `tsx` aborts loading
`src/lib/flagQueueLabels.test.ts` the same way Step 4 did:

```
Error: Cannot find module '@/lib/flagQueueLabels'
...
  code: 'MODULE_NOT_FOUND',
```

`fail` count is 1 higher than the Step 6 baseline (which was back to 0); the six new tests never
run because the import throws before the first `test()` call is reached.

- [ ] **Step 9: Implement `lib/flagQueueLabels.ts`**

```typescript
/**
 * All HR-facing copy for the flag triage queue: tier names, the closed
 * reason vocabulary, cause-group headers, and orphan-state summaries. Pure
 * string formatting — no fetching, no state.
 *
 * Group headers never name a device serial. No device↔branch registry
 * exists in this app: `Employee Checkin.custom_device_serial_number` is
 * unused, and `Device Sync Status`/`Device Closeout Alert` are both keyed by
 * branch, not device id (design doc "Must not do" #6; Global Constraint 9).
 * Branch is therefore the finest granularity the data can support, and this
 * module's copy is written to that ceiling rather than implying a precision
 * the queue does not have — e.g. "Phnom Penh HQ had no device data on
 * 3 Aug", never a serial like "ZK-A4-014". `branchNoDeviceDataHeader` below
 * has no parameter a serial could even arrive through.
 */
import { format } from "date-fns";

import { formatBranchLabel, parseDateKey } from "@/lib/attendanceTime";
import type { QueuePerson, Reason, Tier } from "@/types/flags";

export const TIER_LABELS: Record<Tier, string> = {
  act: "Act",
  review: "Review",
  routine: "Routine",
};

export function tierLabel(tier: Tier): string {
  return TIER_LABELS[tier];
}

/** Wording lifted verbatim from the design doc's `reason` vocabulary table. */
export const REASON_LABELS: Record<Reason, string> = {
  APPROVED_LEAVE: "Approved leave or holiday",
  DEVICE_OR_DATA_FAULT: "Device or data fault",
  MANAGER_APPROVED: "Manager pre-approved",
  SCHEDULE_WRONG: "Schedule was wrong",
  COVERING_OTHER_SITE: "Covering another site",
  GENUINE_VIOLATION: "Genuine violation",
  OTHER: "Other",
};

export function reasonLabel(reason: Reason): string {
  return REASON_LABELS[reason];
}

function formatDayMonth(attendanceDate: string): string {
  // `parseDateKey` parses "YYYY-MM-DD" at local noon, sidestepping the
  // UTC/local off-by-one a plain `new Date(attendanceDate)` risks on exactly
  // the date boundary this queue is triaging (attendanceTime.ts:66-69).
  return format(parseDateKey(attendanceDate), "d MMM");
}

/**
 * "Phnom Penh HQ had no device data on 3 Aug" — the BRANCH_NO_DEVICE_DATA
 * group header. `branch` is expected pre-resolved to a display name
 * (`Employee.branch`, run through `formatBranchLabel` for the `BRANCH-`
 * prefix some records still carry, the same helper `DeviceAlerts.tsx` uses
 * for branch display).
 */
export function branchNoDeviceDataHeader(branch: string, attendanceDate: string): string {
  const label = formatBranchLabel(branch) ?? branch;
  return `${label} had no device data on ${formatDayMonth(attendanceDate)}`;
}

// The five flag codes that can appear in a ROUTINE_CODE group (design doc
// "Triage ranking" table, Routine tier). A dedicated plural phrase per code,
// rather than a generic `formatFlagLabel(...) + "s"`, because naive
// suffixing turns "left early" into "left earlys" and "missing lunch" into
// "missing lunchs".
const ROUTINE_CODE_PLURAL_LABELS: Record<string, string> = {
  LEFT_EARLY: "early departures",
  LATE_START: "late starts",
  LATE_FROM_LUNCH: "late returns from lunch",
  NON_PRIMARY_SITE_PUNCH: "other-site punches",
  MISSING_LUNCH: "missing lunches",
};

function minutesRange(members: QueuePerson[], flagCode: string): { min: number; max: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const person of members) {
    for (const f of person.flags) {
      if (f.flag_code !== flagCode) continue;
      const minutes = f.evidence.minutes;
      if (typeof minutes !== "number") continue;
      min = min === null ? minutes : Math.min(min, minutes);
      max = max === null ? minutes : Math.max(max, minutes);
    }
  }
  return min === null || max === null ? null : { min, max };
}

/**
 * "168 late starts, 6–20 min — and nothing else wrong that day" — the
 * ROUTINE_CODE group header. The minute range is scanned from the members'
 * own flags rather than passed in separately, so the header can never drift
 * from what the group actually contains.
 */
export function routineCodeHeader(flagCode: string, members: QueuePerson[]): string {
  const label =
    ROUTINE_CODE_PLURAL_LABELS[flagCode] ?? `${flagCode.replaceAll("_", " ").toLowerCase()}s`;
  const range = minutesRange(members, flagCode);
  const rangeText = range ? `, ${range.min}–${range.max} min` : "";
  return `${members.length} ${label}${rangeText} — and nothing else wrong that day`;
}

/**
 * Orphan-state summaries for the two counts `get_flag_queue` returns under
 * `orphans`. Both describe a past decision, never an action the toolbar can
 * take — see the design doc's "Orphaning" table (`orphaned_flag_gone`,
 * `orphaned_evidence_changed`).
 */
export function orphanedFlagGoneSummary(count: number): string {
  const noun = count === 1 ? "decision" : "decisions";
  const verb = count === 1 ? "has" : "have";
  return `${count} ${noun} no longer ${verb} a matching flag — kept for audit, not shown in the queue.`;
}

export function orphanedEvidenceChangedSummary(count: number): string {
  const noun = count === 1 ? "flag" : "flags";
  const pronoun = count === 1 ? "it was" : "they were";
  const object = count === 1 ? "it" : "them";
  return `${count} ${noun} changed since ${pronoun} decided — review ${object} again.`;
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npm run test:web`

Expected: all 6 new tests in `flagQueueLabels.test.ts` pass; total `pass` count is 12 higher than
the original 336-test baseline (6 from Step 6, 6 from this step), `fail` is 0.

- [ ] **Step 11: Add the `flags` query-key family and create `hooks/useFlagQueue.ts`**

`queryKeys.ts` currently has no `flags` family and imports no types (every existing builder takes
plain `string`/`boolean` params) — match that and type `tier` as `string | null` here rather than
importing `Tier`, keeping this file dependency-free the way it already is.

Edit `dewey_time/frontend/hr_attendance/src/lib/queryKeys.ts`, inserting a new family between
`coverage` (ends line 43) and `maintenance` (starts line 45):

```typescript
  coverage: {
    all: ["coverage"] as const,
  },

  flags: {
    all: ["flags"] as const,
    queue: (startDate: string, endDate: string, tier: string | null) =>
      [...queryKeys.flags.all, "queue", startDate, endDate, tier ?? "all"] as const,
  },

  maintenance: {
```

`queryKeys.test.ts` needs no change — it walks `Object.entries(queryKeys)` generically, so the new
`flags` family is automatically covered by "every key builder carries its family prefix", "families
do not invalidate each other" (add an explicit pair for it below anyway, since that test currently
only checks hand-picked pairs) and "no two keys in the registry collide".

Now create the hook, matching `hooks/useScheduleCoverage.ts`'s shape (`EMPTY_*` fallback constants,
`useMemo`, `refresh` via `refetch`):

```typescript
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { queryKeys } from "@/lib/queryKeys";
import { getFlagQueue } from "@/services/flags";
import type { QueuePayload, Tier } from "@/types/flags";

const EMPTY_COUNTS: QueuePayload["counts"] = {
  open: 0,
  needs_re_review: 0,
  decided: 0,
  people: 0,
};

const EMPTY_ORPHANS: QueuePayload["orphans"] = {
  orphaned_flag_gone: 0,
  orphaned_evidence_changed: 0,
};

export type FlagQueueParams = {
  startDate: string;
  endDate: string;
  tier?: Tier | null;
};

export type FlagQueue = {
  entries: QueuePayload["entries"];
  counts: QueuePayload["counts"];
  orphans: QueuePayload["orphans"];
  alerts: QueuePayload["alerts"];
  truncated: boolean;
  isLoading: boolean;
  error: unknown;
  refresh: () => void;
};

export function useFlagQueue(params: FlagQueueParams): FlagQueue {
  const { startDate, endDate, tier = null } = params;

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: queryKeys.flags.queue(startDate, endDate, tier),
    queryFn: () => getFlagQueue({ startDate, endDate, tier }),
  });

  return useMemo(
    () => ({
      entries: data?.entries ?? [],
      counts: data?.counts ?? EMPTY_COUNTS,
      orphans: data?.orphans ?? EMPTY_ORPHANS,
      alerts: data?.alerts ?? [],
      truncated: data?.truncated ?? false,
      isLoading,
      error,
      refresh: () => void refetch(),
    }),
    [data, isLoading, error, refetch],
  );
}
```

No dedicated test for this file — `hooks/` is not in the `test:web` glob (Global Constraint 10),
matching `hooks/useScheduleCoverage.ts`, which also has none.

- [ ] **Step 12: Run the full suite, and verify the build stays byte-for-byte unaffected**

Run: `npm run test:web`

Expected: `# tests 348`, `# pass 348`, `# fail 0` — the pre-change baseline of 336 plus the 12 new
tests from Steps 3 and 7.

Global Constraint 11 requires rebuilding and committing `public/hr_attendance/**` after "any
frontend change". Run it and check for a diff anyway, rather than assuming none:

```bash
npm run build
git status --porcelain ../../public/hr_attendance ../../www/hr-attendance.html ../../www/hr-schedule.html
```

Expected: no output from `git status --porcelain` — none of this task's new files (`types/flags.ts`,
`services/flags.ts`, `lib/flagDecisionState.ts`, `lib/flagQueueLabels.ts`, `hooks/useFlagQueue.ts`)
are imported by `main.tsx` or any other file already reachable from an entry point (that wiring is a
later task's job), so Vite's tree-shaking excludes all of them from the bundle and the built output
is unchanged. If this ever shows a diff — e.g. because a later edit to this same branch already
wired one of these modules in before this step runs — commit the changed `public/hr_attendance/**`
and `www/hr-*.html` paths in this same commit; do not leave them uncommitted per the deploy note in
`CLAUDE.md` ("build output ... missed before, from #58 through #74").

- [ ] **Step 13: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/types/flags.ts \
        dewey_time/frontend/hr_attendance/src/services/flags.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagDecisionState.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagDecisionState.test.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts \
        dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.test.ts \
        dewey_time/frontend/hr_attendance/src/hooks/useFlagQueue.ts \
        dewey_time/frontend/hr_attendance/src/lib/queryKeys.ts
git commit -m "$(cat <<'EOF'
feat(hr-flags): frontend flag types, service, and pure decision state

Contract types transcribed from the plan's Interface Contract, a thin
frappeCall service split across the queue/decision NS pair, and the pure
decisionIsComplete/groupPayload/remainingIdentities helpers the triage UI
will build on — including the per-member exclusion safety property that
keeps an unchecked employee's flags out of a bulk decision entirely.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Queue page, list and decision panel

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/ui/FlagQueueList.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/FlagDecisionPanel.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts` (Step 9 appends
  `deviceAlertHeadline` and `DEVICE_ALERT_EXPLAINER` to the module Task 8 created)
- Test: `dewey_time/frontend/hr_attendance/src/ui/flagQueuePage.test.tsx`

All four `src/ui/` files sit **directly** in that directory. Global Constraint 10: `test:web` is an explicit
per-directory glob (`package.json:10` — `… src/ui/*.test.tsx`), **not** recursive. A
`src/ui/flags/` subdirectory would compile, render and ship with its tests never running once.
Do not create one.

**Interfaces:**

- Consumes, from `@/types/flags` (contract, "TypeScript — `types/flags.ts`"):
  `Tier`, `DecisionState`, `Outcome`, `Reason`, `FlagOut`, `FlagDecision`, `QueuePerson`,
  `QueueEntry`, `QueuePayload`.
- Consumes, from `@/lib/flagDecisionState` (contract, "TypeScript — `lib/flagDecisionState.ts`" —
  these three exact signatures):
  ```ts
  export type PendingDecision = { outcome: Outcome; reason: Reason; note: string };
  export function decisionIsComplete(d: PendingDecision): boolean;
  export function groupPayload(members: QueuePerson[], excluded: ReadonlySet<string>):
    { identities: string[]; employeeCount: number };
  export function remainingIdentities(person: QueuePerson): string[];
  ```
- Consumes, from `@/lib/flagQueueLabels` — **every** string this task renders comes from here; the
  components hold no copy of their own:
  ```ts
  export function tierLabel(tier: Tier): string;                        // "Act now" | "Review" | "Routine"
  export function decisionStateLabel(state: DecisionState): string;     // "Not decided" | "Decided" | "Needs re-review"
  export function outcomeLabel(outcome: Outcome): string;               // "Excuse" | "Uphold" (imperative — it labels buttons)
  export function reasonLabel(reason: Reason): string;                  // "Approved leave or holiday", …
  export const OUTCOME_OPTIONS: readonly Outcome[];
  export const REASON_OPTIONS: readonly Reason[];
  export function groupHeadline(entry: Extract<QueueEntry, { kind: "group" }>): string;
  export function personHeadline(person: QueuePerson): string;          // headlines the worst UNDECIDED flag
  export function priorDecisionLabel(decision: FlagDecision): string;   // context wording — must not read as applied
  export function appliedDecisionLabel(decision: FlagDecision): string; // wording for a live, matched decision
  export function partialFailureMessage(saved: number, attempted: number): string;
  export function applyToRemainingLabel(count: number): string;         // "Apply to remaining 2"
  export const SAME_REASON_LABEL: string;                               // "Same reason applies"
  export const DECIDE_ONE_BY_ONE_LABEL: string;                         // "Decide one by one"
  ```
- Consumes, from `@/hooks/useFlagQueue`:
  ```ts
  export function useFlagQueue(args: { startDate: string; endDate: string }): {
    data: QueuePayload | null; isLoading: boolean; error: unknown; refresh: () => void;
  };
  ```
  (same shape as `hooks/useScheduleCoverage.ts`'s `{ …, isLoading, error, refresh }`.)
- Consumes, from `@/services/flags`:
  ```ts
  export function decideFlags(args: {
    identities: string[]; outcome: Outcome; reason: Reason; note?: string;
    groupKey?: string | null; confirm?: boolean;
  }): Promise<{ ok: boolean; written: number; group_key: string;
                errors: { flag_identity: string; error: string }[] }
             | { needs_confirm: true; preview: { count: number; employees: number } }>;
  ```
- Consumes, already in the repo: `AttentionStrip` / `FailureBlock` (`@/components/ui/notice`),
  `formatFlagEvidenceDetails` / `flagSummary` / `formatFlagContextDate` (`@/lib/flagDetails`),
  `formatFlagLabel` / `parseFlagEvidence` (`@/lib/flagLabels`), `HrAccessOutletContext`
  (`@/lib/hrAccess`), `ResponsiveModal` (`@/components/ResponsiveModal`).
- Produces, for the routing task that follows:
  ```ts
  // ui/FlagQueuePage.tsx
  export function FlagQueuePage(): JSX.Element;            // route element for /hr-flags
  export function FlagQueueView(props: FlagQueueViewProps): JSX.Element;  // pure shell, testable
  export type FlagQueueViewProps; export type BulkFailure;
  // ui/FlagQueueList.tsx
  export function entryKey(entry: QueueEntry): string;
  export function FlagQueueList(props: FlagQueueListProps): JSX.Element;
  export type FlagQueueListProps;
  // ui/FlagDecisionPanel.tsx
  export function FlagDecisionPanel(props: FlagDecisionPanelProps): JSX.Element;
  export type FlagDecisionPanelProps;
  ```
  `FlagQueuePage` is the **only** export that touches the router or react-query. Everything the
  tests assert on is a pure props-in/markup-out component, which is what makes
  `renderToStaticMarkup` sufficient here.

**Never `Alert`.** `components/ui/alert.tsx` hardcodes `role="alert"` — an assertive live region
that interrupts a screen reader for a persistent condition. Use `AttentionStrip` (role 2, polite)
and `FailureBlock` (role 3, the one correct `role="alert"`), per the three-role notice system
merged in 823d43c1 and enforced by `components/ui/notice.test.tsx:145-158`.

---

- [ ] **Step 1: Confirm the modules this section imports already exist, with these names**

Run:
```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance
grep -hn "^export" src/types/flags.ts src/lib/flagDecisionState.ts src/lib/flagQueueLabels.ts \
                   src/hooks/useFlagQueue.ts src/services/flags.ts
```

Expected: every name in **Interfaces → Consumes** above appears. If one is missing or spelled
differently, stop and reconcile it in the task that owns that file — do **not** add a second copy
of a label or a helper here. Two copies of the copy layer is precisely the drift the plan's
Interface Contract exists to prevent, and a duplicated `decisionIsComplete` would let the panel
and the API disagree about when a note is required.

- [ ] **Step 2: Write the failing test**

Create `dewey_time/frontend/hr_attendance/src/ui/flagQueuePage.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { PendingDecision } from "@/lib/flagDecisionState";
import {
  SAME_REASON_LABEL,
  applyToRemainingLabel,
  decisionStateLabel,
  outcomeLabel,
  partialFailureMessage,
  reasonLabel,
  tierLabel,
} from "@/lib/flagQueueLabels";
import type { DecisionState, FlagDecision, FlagOut, QueueEntry, QueuePerson, Tier } from "@/types/flags";

import { FlagDecisionPanel, type FlagDecisionPanelProps } from "./FlagDecisionPanel";
import { FlagQueueList } from "./FlagQueueList";
import { FlagQueueView } from "./FlagQueuePage";

const DATE = "2026-08-03";

function makeFlag(args: {
  identity: string;
  code: string;
  rank: number;
  tier: Tier;
  state?: DecisionState;
  decision?: FlagDecision | null;
  evidence?: Record<string, unknown>;
}): FlagOut {
  return {
    flag_identity: args.identity,
    flag_code: args.code,
    severity: "WARNING",
    day_closed: 1,
    evidence: args.evidence ?? {},
    rank: args.rank,
    tier: args.tier,
    decision_state: args.state ?? "undecided",
    decision: args.decision ?? null,
  };
}

// rank/tier are passed in rather than derived: build_queue computes them
// server-side from the person's UNDECIDED flags, and a fixture that recomputes
// them here would be testing the fixture, not the component.
function makePerson(args: {
  employee: string;
  name: string;
  rank: number;
  tier: Tier;
  flags: FlagOut[];
}): QueuePerson {
  return {
    employee: args.employee,
    employee_name: args.name,
    employee_branch: "Phnom Penh HQ",
    attendance_date: DATE,
    rank: args.rank,
    tier: args.tier,
    flags: args.flags,
    undecided_count: args.flags.filter((f) => f.decision_state !== "matched").length,
  };
}

function panelProps(overrides: Partial<FlagDecisionPanelProps>): FlagDecisionPanelProps {
  return {
    entry: null,
    draft: { outcome: "EXCUSED", reason: "APPROVED_LEAVE", note: "" },
    onDraftChange: () => {},
    activeIdentity: null,
    onOpenFlag: () => {},
    lastDecision: null,
    onSubmit: () => {},
    excluded: new Set<string>(),
    onToggleMember: () => {},
    onDecideOneByOne: () => {},
    ...overrides,
  };
}

// Person-dedup is the whole point of build_queue's "a person appears in exactly
// one entry" rule, and this is where it becomes visible: Ada has a routine
// LATE_START that would otherwise pull her into the routine group as well.
test("a person with a routine flag and an act flag appears once, under Act", () => {
  const ada = makePerson({
    employee: "HR-EMP-00001",
    name: "Ada Lovelace",
    rank: 150,
    tier: "act",
    flags: [
      makeFlag({ identity: "id-absence", code: "UNNOTIFIED_ABSENCE", rank: 150, tier: "act" }),
      makeFlag({
        identity: "id-late",
        code: "LATE_START",
        rank: 20,
        tier: "routine",
        evidence: { minutes: 12 },
      }),
    ],
  });

  const routineGroup: QueueEntry = {
    kind: "group",
    group_type: "ROUTINE_CODE",
    group_key: "ROUTINE_CODE:LATE_START:2026-08-03",
    branch: null,
    flag_code: "LATE_START",
    attendance_date: DATE,
    rank: 20,
    tier: "routine",
    members: [
      makePerson({
        employee: "HR-EMP-00002",
        name: "Grace Hopper",
        rank: 20,
        tier: "routine",
        flags: [
          makeFlag({
            identity: "id-late-2",
            code: "LATE_START",
            rank: 20,
            tier: "routine",
            evidence: { minutes: 9 },
          }),
        ],
      }),
    ],
  };

  const html = renderToStaticMarkup(
    <FlagQueueList
      entries={[routineGroup, { kind: "person", ...ada }]}
      selectedKey={null}
      expandedGroupKey={null}
      onSelect={() => {}}
    />
  );

  assert.equal(
    html.split("Ada Lovelace").length - 1,
    1,
    "Ada must appear in exactly one row, not once as a person and once in the routine group"
  );

  const actAt = html.indexOf(tierLabel("act"));
  const routineAt = html.indexOf(tierLabel("routine"));
  const adaAt = html.indexOf("Ada Lovelace");
  assert.ok(actAt >= 0, "the Act tier heading is rendered");
  assert.ok(routineAt >= 0, "the Routine tier heading is rendered");
  // Interleaved by rank (150 before 20), so Ada sits above the routine group.
  assert.ok(actAt < adaAt && adaAt < routineAt, "Ada is listed under Act, above the routine group");
});

// Per-member exclusion is the safety valve on bulk decisions: one genuine
// no-show hidden among 41 device-fault rows must not be silently excused. If the
// header count ever stops tracking the checkboxes, that protection is gone while
// still looking present.
test("the group action count drops when members are excluded", () => {
  const members = Array.from({ length: 41 }, (_, i) =>
    makePerson({
      employee: `HR-EMP-${String(i + 1).padStart(5, "0")}`,
      name: `Employee ${i + 1}`,
      rank: 150,
      tier: "act",
      flags: [
        makeFlag({ identity: `id-${i}`, code: "UNNOTIFIED_ABSENCE", rank: 150, tier: "act" }),
      ],
    })
  );

  const group: QueueEntry = {
    kind: "group",
    group_type: "BRANCH_NO_DEVICE_DATA",
    group_key: "BRANCH_NO_DEVICE_DATA:Phnom Penh HQ:2026-08-03",
    branch: "Phnom Penh HQ",
    flag_code: null,
    attendance_date: DATE,
    rank: 150,
    tier: "act",
    members,
  };

  const all = renderToStaticMarkup(<FlagDecisionPanel {...panelProps({ entry: group })} />);
  assert.ok(all.includes(`${outcomeLabel("EXCUSED")} 41`), "all 41 members are included by default");

  const partial = renderToStaticMarkup(
    <FlagDecisionPanel
      {...panelProps({ entry: group, excluded: new Set(["HR-EMP-00007", "HR-EMP-00019"]) })}
    />
  );
  assert.ok(partial.includes(`${outcomeLabel("EXCUSED")} 39`), "two exclusions drop the count to 39");
  assert.ok(
    !partial.includes(`${outcomeLabel("EXCUSED")} 41`),
    "the stale 41 must not survive anywhere in the panel"
  );
});

const PRIOR: FlagDecision = {
  name: "afd00000001",
  outcome: "EXCUSED",
  reason: "DEVICE_OR_DATA_FAULT",
  note: "Device was offline for the whole morning.",
  decided_by: "hr@dewey.test",
  decided_at: "2026-08-04 09:12:00",
  group_key: "grp-1",
};

// The staleness guard: the evidence changed under this decision, so it is
// deliberately NOT applied and the flag is back in the queue. Rendering it as an
// applied outcome would tell HR the day is handled when it is not.
test("a needs_re_review flag shows its prior decision as context, not as an applied outcome", () => {
  const person = makePerson({
    employee: "HR-EMP-00001",
    name: "Ada Lovelace",
    rank: 132,
    tier: "act",
    flags: [
      makeFlag({
        identity: "id-missing",
        code: "MISSING_TIME",
        rank: 132,
        tier: "act",
        evidence: { minutes: 180, interval_start: "2026-08-03 10:00:00" },
        state: "needs_re_review",
        decision: PRIOR,
      }),
    ],
  });

  const html = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry: { kind: "person", ...person } })} />
  );

  assert.ok(
    html.includes(reasonLabel("DEVICE_OR_DATA_FAULT")),
    "the prior decision's reason is shown as context"
  );
  assert.ok(html.includes(decisionStateLabel("needs_re_review")), "the state badge says re-review");
  assert.ok(
    !html.includes(decisionStateLabel("matched")),
    "it must not read as decided — the decision is retained but not applied"
  );
  assert.ok(html.includes(">Decide<"), "the flag is still decidable");
});

// "Nothing is ever auto-closed": the one-click repeat only exists once HR has
// actually made a decision on this person, and it still requires a click.
test('"Same reason applies" appears only once a decision exists on the person', () => {
  const person = makePerson({
    employee: "HR-EMP-00001",
    name: "Ada Lovelace",
    rank: 140,
    tier: "act",
    flags: [
      makeFlag({
        identity: "id-issue",
        code: "ATTENDANCE_ISSUE",
        rank: 140,
        tier: "act",
        evidence: { reason: "single_checkin" },
        state: "matched",
        decision: PRIOR,
      }),
      makeFlag({
        identity: "id-late",
        code: "LATE_START",
        rank: 20,
        tier: "routine",
        evidence: { minutes: 12 },
      }),
      makeFlag({ identity: "id-left", code: "LEFT_EARLY", rank: 25, tier: "routine", evidence: { minutes: 20 } }),
    ],
  });
  const entry: QueueEntry = { kind: "person", ...person };

  const fresh = renderToStaticMarkup(<FlagDecisionPanel {...panelProps({ entry })} />);
  assert.ok(!fresh.includes(SAME_REASON_LABEL), "no repeat affordance before a first decision");

  const repeat: PendingDecision = { outcome: "EXCUSED", reason: "DEVICE_OR_DATA_FAULT", note: "" };
  const after = renderToStaticMarkup(
    <FlagDecisionPanel {...panelProps({ entry, lastDecision: repeat })} />
  );
  assert.ok(after.includes(SAME_REASON_LABEL), "each remaining flag offers the repeat");
  assert.ok(
    after.includes(applyToRemainingLabel(2)),
    "and the person-level bulk repeat counts only the two undecided flags"
  );
});

test("a load failure renders exactly one assertive alert", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={null}
      isLoading={false}
      error={new Error("Network request failed")}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div>LIST-SENTINEL</div>}
      panel={<div>PANEL-SENTINEL</div>}
    />
  );

  const alerts = html.match(/role="alert"/g) ?? [];
  assert.equal(alerts.length, 1, "one failure, announced exactly once");
  assert.ok(html.includes("Retry"), "the failure is recoverable in place");
  // FailureBlock replaces the region the queue would occupy — a page showing
  // both a banner and a replaced region reports one failure twice.
  assert.ok(!html.includes("LIST-SENTINEL"));
  assert.ok(!html.includes("PANEL-SENTINEL"));
});

test("a partial bulk failure is reported politely, with the failures disclosed", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 12, needs_re_review: 5, decided: 88, people: 40 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={{
        saved: 34,
        attempted: 39,
        errors: [
          { flag_identity: "AUTO-hr-emp-00007-2026-08-03-late-start", error: "Flag no longer exists" },
        ],
      }}
      list={<div>LIST-SENTINEL</div>}
      panel={<div>PANEL-SENTINEL</div>}
    />
  );

  assert.ok(html.includes(partialFailureMessage(34, 39)));
  // Role 2, not role 3: 34 decisions did land, so nothing the user asked for is
  // wholly missing and a screen reader must not be interrupted.
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /role="alert"/);
  const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
  assert.ok(!summary.includes("AUTO-hr-emp-00007"), "identities live behind the disclosure");
  assert.ok(html.includes("AUTO-hr-emp-00007"), "…but they are present");
  // The queue itself is still usable while the strip is up.
  assert.ok(html.includes("LIST-SENTINEL"));
});

test("the toolbar reports open, needs re-review and decided counts", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 12, needs_re_review: 5, decided: 88, people: 40 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      list={<div />}
      panel={<div />}
    />
  );

  assert.ok(html.includes("Open"));
  assert.ok(html.includes("Needs re-review"));
  assert.ok(html.includes("Decided"));
  assert.ok(html.includes(">12<"));
  assert.ok(html.includes(">5<"));
  assert.ok(html.includes(">88<"));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:web
```

Expected: FAIL at module load, before any assertion runs —
`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/ui/FlagDecisionPanel'` (the first of the
three unresolved imports). Node's test runner reports this as a failed file, so the run ends
non-zero. None of the seven tests can pass against the pre-change tree: all three components are
being created by this task.

Read the `# tests N` line in the output and note the current N — Step 8 checks it grew by 7. A
suite that silently ran zero of your new tests looks identical to a passing one otherwise
(memory note `test-green-is-not-tests-ran`).

- [ ] **Step 4: Create `src/ui/FlagQueueList.tsx`**

```tsx
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { groupHeadline, personHeadline, tierLabel } from "@/lib/flagQueueLabels";
import { cn } from "@/lib/utils";
import type { QueueEntry, QueuePerson, Tier } from "@/types/flags";

type GroupEntry = Extract<QueueEntry, { kind: "group" }>;

/**
 * Stable per-entry key. The page holds only this string as its selection, so a
 * refetch that returns fresh objects keeps the same row selected — object
 * identity is useless across a react-query refetch, and `Attendance Flag.name`
 * is not usable as an identifier anywhere in this feature (the engine rebuilds
 * those rows constantly).
 */
export function entryKey(entry: QueueEntry): string {
  return entry.kind === "group"
    ? `g:${entry.group_key}`
    : `p:${entry.employee}:${entry.attendance_date}`;
}

export type FlagQueueListProps = {
  entries: QueueEntry[];
  selectedKey: string | null;
  /** Group the user sent to "decide one by one" — rendered as its member rows. */
  expandedGroupKey: string | null;
  onSelect: (key: string) => void;
};

export function FlagQueueList(props: FlagQueueListProps) {
  // build_queue already ranks entries; this re-sort is defensive and *stable*
  // (V8's sort is), so the backend's tie-break order within one rank survives
  // untouched. Sorting here rather than trusting transport order is what keeps a
  // lone 3-hour gap above a 168-member routine group.
  const ordered = [...props.entries].sort((a, b) => b.rank - a.rank);

  if (ordered.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        Nothing to triage in this range.
      </p>
    );
  }

  const rows: { key: string; tier: Tier; element: ReactNode }[] = [];

  for (const entry of ordered) {
    if (entry.kind === "group" && entry.group_key === props.expandedGroupKey) {
      // "Decide one by one": the group turned out not to be uniform, so its
      // members take its place as ordinary person rows. They keep the same keys
      // they would have had ungrouped, so selection survives collapsing again.
      for (const member of entry.members) {
        const key = entryKey({ kind: "person", ...member });
        rows.push({
          key,
          tier: member.tier,
          element: (
            <PersonRow
              person={member}
              selected={props.selectedKey === key}
              onSelect={() => props.onSelect(key)}
            />
          ),
        });
      }
      continue;
    }

    const key = entryKey(entry);
    rows.push({
      key,
      tier: entry.tier,
      element:
        entry.kind === "group" ? (
          <GroupRow
            entry={entry}
            selected={props.selectedKey === key}
            onSelect={() => props.onSelect(key)}
          />
        ) : (
          <PersonRow
            person={entry}
            selected={props.selectedKey === key}
            onSelect={() => props.onSelect(key)}
          />
        ),
    });
  }

  // Tier is derived from rank, so a rank-descending list already produces
  // contiguous tier runs — the heading only has to appear where the tier turns
  // over. That gives "Act now / Review / Routine" section headers without
  // bucketing the list and losing the interleaving.
  let lastTier: Tier | null = null;

  return (
    <div className="space-y-1 pb-4">
      {rows.map((row) => {
        const heading = row.tier !== lastTier ? row.tier : null;
        lastTier = row.tier;
        return (
          <div key={row.key}>
            {heading ? (
              <h3 className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {tierLabel(heading)}
              </h3>
            ) : null}
            {row.element}
          </div>
        );
      })}
    </div>
  );
}

function RowButton(props: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
        props.selected
          ? "border-primary/30 bg-primary/5"
          : "border-transparent hover:border-border/60 hover:bg-muted/40"
      )}
    >
      {props.children}
    </button>
  );
}

function PersonRow(props: { person: QueuePerson; selected: boolean; onSelect: () => void }) {
  const { person } = props;
  // undecided_count, not flags.length: a partially decided person returns to the
  // queue headlined by their next *undecided* flag, so the badge must count what
  // is still open. Counting all flags would keep showing "+2" on someone with one
  // thing left to do.
  const extra = Math.max(person.undecided_count - 1, 0);

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {person.employee_name}
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
  const count = entry.members.length;

  return (
    <RowButton selected={props.selected} onSelect={props.onSelect}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {groupHeadline(entry)}
        </span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {count} {count === 1 ? "person" : "people"}
        </span>
      </span>
    </RowButton>
  );
}
```

- [ ] **Step 5: Create `src/ui/FlagDecisionPanel.tsx`**

```tsx
import { EmptyState } from "@lolbikb/dewey-ui";
import { FlagIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  decisionIsComplete,
  groupPayload,
  remainingIdentities,
  type PendingDecision,
} from "@/lib/flagDecisionState";
import { flagSummary, formatFlagContextDate, formatFlagEvidenceDetails } from "@/lib/flagDetails";
import { formatFlagLabel, parseFlagEvidence } from "@/lib/flagLabels";
import {
  DECIDE_ONE_BY_ONE_LABEL,
  OUTCOME_OPTIONS,
  REASON_OPTIONS,
  SAME_REASON_LABEL,
  appliedDecisionLabel,
  applyToRemainingLabel,
  decisionStateLabel,
  groupHeadline,
  outcomeLabel,
  personHeadline,
  priorDecisionLabel,
  reasonLabel,
} from "@/lib/flagQueueLabels";
import { cn } from "@/lib/utils";
import type { FlagOut, QueueEntry, QueuePerson, Reason } from "@/types/flags";

type GroupEntry = Extract<QueueEntry, { kind: "group" }>;

export type FlagDecisionPanelProps = {
  entry: QueueEntry | null;
  /** The form's working copy. Owned by the page so selecting a new row resets it. */
  draft: PendingDecision;
  onDraftChange: (draft: PendingDecision) => void;
  /** Person mode: which flag currently has its decide form open. */
  activeIdentity: string | null;
  onOpenFlag: (identity: string | null) => void;
  /** The decision HR last recorded on THIS person — backs "Same reason applies". */
  lastDecision: PendingDecision | null;
  onSubmit: (identities: string[], decision: PendingDecision) => void;
  /** Group mode: employees whose checkbox has been unchecked. */
  excluded: ReadonlySet<string>;
  onToggleMember: (employee: string) => void;
  onDecideOneByOne: () => void;
  submitting?: boolean;
};

export function FlagDecisionPanel(props: FlagDecisionPanelProps) {
  if (!props.entry) {
    return (
      <EmptyState
        icon={FlagIcon}
        title="Pick a row to review"
        description="Groups and people are ranked by consequence — work down from the top."
        className="border-none"
      />
    );
  }

  return props.entry.kind === "group" ? (
    <GroupDecision {...props} entry={props.entry} />
  ) : (
    <PersonDecision {...props} person={props.entry} />
  );
}

function PersonDecision(props: FlagDecisionPanelProps & { person: QueuePerson }) {
  const { person } = props;
  const remaining = remainingIdentities(person);

  return (
    <div className="space-y-4 pb-4">
      <header>
        <div className="text-base font-semibold tracking-tight">{person.employee_name}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {formatFlagContextDate(person.attendance_date)}
          {person.employee_branch ? (
            <span className="text-muted-foreground/80"> · {person.employee_branch}</span>
          ) : null}
        </div>
      </header>

      {/* One click, one write — this prefills nothing and submits nothing on its
          own. It only exists once HR has actually decided something on this
          person, which is what stops a stray click closing a whole day. */}
      {props.lastDecision && remaining.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {SAME_REASON_LABEL} — {outcomeLabel(props.lastDecision.outcome)},{" "}
            {reasonLabel(props.lastDecision.reason)}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={props.submitting}
            onClick={() => props.onSubmit(remaining, props.lastDecision as PendingDecision)}
          >
            {applyToRemainingLabel(remaining.length)}
          </Button>
        </div>
      ) : null}

      {/* Worst-first, exactly as build_queue ordered them, and every one of them
          individually decidable: the person only leaves the queue when all of
          their flags are decided. */}
      {person.flags.map((flag) => (
        <FlagCard
          key={flag.flag_identity}
          flag={flag}
          dateKey={person.attendance_date}
          open={props.activeIdentity === flag.flag_identity}
          draft={props.draft}
          onDraftChange={props.onDraftChange}
          onOpen={() => props.onOpenFlag(flag.flag_identity)}
          onClose={() => props.onOpenFlag(null)}
          lastDecision={props.lastDecision}
          onSubmit={props.onSubmit}
          submitting={props.submitting}
        />
      ))}
    </div>
  );
}

function FlagCard(props: {
  flag: FlagOut;
  dateKey: string;
  open: boolean;
  draft: PendingDecision;
  onDraftChange: (draft: PendingDecision) => void;
  onOpen: () => void;
  onClose: () => void;
  lastDecision: PendingDecision | null;
  onSubmit: (identities: string[], decision: PendingDecision) => void;
  submitting?: boolean;
}) {
  const { flag } = props;
  const evidence = formatFlagEvidenceDetails(flag.evidence, props.dateKey);
  const decided = flag.decision_state === "matched";

  return (
    <section className="space-y-2.5 rounded-xl border border-border/60 bg-card px-3 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {formatFlagLabel(flag.flag_code, parseFlagEvidence(flag.evidence))}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {flagSummary(flag.flag_code)}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 rounded-md text-[11px]",
            flag.decision_state === "needs_re_review" &&
              "border-brand-accent/40 bg-brand-accent/10 text-brand-accent"
          )}
        >
          {decisionStateLabel(flag.decision_state)}
        </Badge>
      </div>

      {/* Same dl/dt/dd shape as FlagDetailPanel.tsx:88-96 — one evidence idiom
          across both surfaces, so a change to formatFlagEvidenceDetails lands in
          both without a second layout to keep in step. */}
      {evidence.rows.length > 0 ? (
        <dl className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2">
          {evidence.rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2 text-xs">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* CONTEXT, not an outcome. The evidence fingerprint moved under this
          decision, so the backend deliberately did not apply it and put the flag
          back in the queue. Styling it like a live decision would tell HR the day
          is handled when it is not. */}
      {flag.decision && flag.decision_state === "needs_re_review" ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          {priorDecisionLabel(flag.decision)}
        </p>
      ) : null}

      {flag.decision && decided ? (
        <p className="text-xs text-muted-foreground">{appliedDecisionLabel(flag.decision)}</p>
      ) : null}

      {decided ? null : props.open ? (
        <DecisionForm
          draft={props.draft}
          onChange={props.onDraftChange}
          submitLabel={outcomeLabel(props.draft.outcome)}
          onSubmit={() => props.onSubmit([flag.flag_identity], props.draft)}
          onCancel={props.onClose}
          submitting={props.submitting}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={props.onOpen}>
            Decide
          </Button>
          {props.lastDecision ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={props.submitting}
              onClick={() =>
                props.onSubmit([flag.flag_identity], props.lastDecision as PendingDecision)
              }
            >
              {SAME_REASON_LABEL}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function GroupDecision(props: FlagDecisionPanelProps & { entry: GroupEntry }) {
  const { entry } = props;
  // groupPayload owns both halves of the exclusion rule — drop every flag of an
  // excluded employee, and only ever send undecided identities. The header count
  // is read straight off it so the button can never promise a different number
  // from the one the request carries.
  const payload = groupPayload(entry.members, props.excluded);

  return (
    <div className="space-y-4 pb-4">
      <header>
        <div className="text-base font-semibold tracking-tight">{groupHeadline(entry)}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {formatFlagContextDate(entry.attendance_date)}
          <span className="text-muted-foreground/80 tabular-nums">
            {" "}
            · {entry.members.length} people
          </span>
        </div>
      </header>

      <DecisionForm
        draft={props.draft}
        onChange={props.onDraftChange}
        submitLabel={`${outcomeLabel(props.draft.outcome)} ${payload.employeeCount}`}
        onSubmit={() => props.onSubmit(payload.identities, props.draft)}
        submitting={props.submitting || payload.employeeCount === 0}
      />

      <Button variant="outline" size="sm" onClick={props.onDecideOneByOne}>
        {DECIDE_ONE_BY_ONE_LABEL}
      </Button>

      <section className="space-y-1.5">
        <div className="text-xs font-medium text-muted-foreground">Who this covers</div>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-border/60 px-2 py-1.5">
          {entry.members.map((member) => (
            <li key={member.employee} className="flex items-center gap-2 py-1">
              <Checkbox
                checked={!props.excluded.has(member.employee)}
                onCheckedChange={() => props.onToggleMember(member.employee)}
                aria-label={`Include ${member.employee_name}`}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {member.employee_name}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {personHeadline(member)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function DecisionForm(props: {
  draft: PendingDecision;
  onChange: (draft: PendingDecision) => void;
  submitLabel: string;
  onSubmit: () => void;
  onCancel?: () => void;
  submitting?: boolean;
}) {
  // The note rule (required when reason is OTHER or the outcome is UPHELD) lives
  // in decisionIsComplete and is duplicated nowhere here — the form only reads
  // its verdict, so it can never drift from what the doctype's validate() will
  // accept.
  const complete = decisionIsComplete(props.draft);

  return (
    <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/10 px-2.5 py-2.5">
      <div role="group" aria-label="Outcome" className="flex gap-1 rounded-md bg-muted/40 p-1">
        {OUTCOME_OPTIONS.map((option) => {
          const active = props.draft.outcome === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => props.onChange({ ...props.draft, outcome: option })}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {outcomeLabel(option)}
            </button>
          );
        })}
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Reason</span>
        {/* A native <select>, not dewey-ui's Radix Select: Radix renders its items
            into a portal, which renderToStaticMarkup never emits and which is
            unreachable before hydration. Seven fixed options do not need a
            combobox, and this way the list is actually in the markup. */}
        <select
          value={props.draft.reason}
          onChange={(event) =>
            props.onChange({ ...props.draft, reason: event.target.value as Reason })
          }
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
        >
          {REASON_OPTIONS.map((reason) => (
            <option key={reason} value={reason}>
              {reasonLabel(reason)}
            </option>
          ))}
        </select>
      </label>

      <Textarea
        value={props.draft.note}
        rows={2}
        placeholder="Note"
        onChange={(event) => props.onChange({ ...props.draft, note: event.target.value })}
        className="text-xs"
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!complete || props.submitting} onClick={props.onSubmit}>
          {props.submitLabel}
        </Button>
        {props.onCancel ? (
          <Button size="sm" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `src/ui/FlagQueuePage.tsx`**

```tsx
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { EmptyState, Page, PageHeader, Section } from "@lolbikb/dewey-ui";
import { useMutation } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { TriangleAlertIcon } from "lucide-react";
import { Navigate, useOutletContext } from "react-router-dom";

import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { AttentionStrip, FailureBlock } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { useFlagQueue } from "@/hooks/useFlagQueue";
import type { PendingDecision } from "@/lib/flagDecisionState";
import { REASON_OPTIONS, partialFailureMessage } from "@/lib/flagQueueLabels";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { decideFlags } from "@/services/flags";
import type { QueueEntry, QueuePayload } from "@/types/flags";
import { FlagDecisionPanel } from "@/ui/FlagDecisionPanel";
import { FlagQueueList, entryKey } from "@/ui/FlagQueueList";

/** get_flag_queue caps a request at QUEUE_MAX_RANGE_DAYS (31); two weeks is the
 *  window HR actually works and keeps the payload well under QUEUE_FLAG_LIMIT. */
const QUEUE_DAYS = 14;

export type BulkFailure = {
  saved: number;
  attempted: number;
  errors: { flag_identity: string; error: string }[];
};

type DecideArgs = {
  identities: string[];
  decision: PendingDecision;
  groupKey?: string | null;
  confirm?: boolean;
};

/**
 * The two shapes decide_flags can return, merged into one optional-field record.
 * The success path sends no discriminant, so narrowing on `needs_confirm` is the
 * only honest test — a union with a fabricated tag would be a lie about the wire
 * format.
 */
type DecideResponse = {
  ok?: boolean;
  written?: number;
  group_key?: string;
  errors?: { flag_identity: string; error: string }[];
  needs_confirm?: boolean;
  preview?: { count: number; employees: number };
};

type PendingConfirm = { args: DecideArgs; preview: { count: number; employees: number } };

/** A fresh draft for a newly selected row. REASON_OPTIONS[0] only seeds the
 *  <select>'s value; nothing is written until HR clicks, and decisionIsComplete
 *  still gates the button. */
function emptyDraft(): PendingDecision {
  return { outcome: "EXCUSED", reason: REASON_OPTIONS[0], note: "" };
}

export function FlagQueuePage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();

  const range = useMemo(() => {
    const today = new Date();
    return {
      startDate: format(subDays(today, QUEUE_DAYS - 1), "yyyy-MM-dd"),
      endDate: format(today, "yyyy-MM-dd"),
    };
  }, []);

  const { data, isLoading, error, refresh } = useFlagQueue(range);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<PendingDecision>(emptyDraft);
  const [activeIdentity, setActiveIdentity] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<PendingDecision | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [bulkFailure, setBulkFailure] = useState<BulkFailure | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const entries = data?.entries ?? [];

  // The selected row can be a group member surfaced by "Decide one by one",
  // which is not itself a top-level entry — so resolve against the expanded
  // group's members too, not just `entries`.
  const selectedEntry = useMemo<QueueEntry | null>(() => {
    if (!selectedKey) return null;
    for (const entry of entries) {
      if (entryKey(entry) === selectedKey) return entry;
      if (entry.kind === "group" && entry.group_key === expandedGroupKey) {
        for (const member of entry.members) {
          const memberEntry: QueueEntry = { kind: "person", ...member };
          if (entryKey(memberEntry) === selectedKey) return memberEntry;
        }
      }
    }
    return null;
  }, [entries, expandedGroupKey, selectedKey]);

  const handleSelect = useCallback((key: string) => {
    // Everything below is per-row state: a draft, a repeat decision or an
    // exclusion set leaking across a selection change would apply one person's
    // reasoning to the next.
    setSelectedKey(key);
    setDraft(emptyDraft());
    setActiveIdentity(null);
    setLastDecision(null);
    setExcluded(new Set<string>());
    setBulkFailure(null);
  }, []);

  const handleToggleMember = useCallback((employee: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(employee)) next.delete(employee);
      else next.add(employee);
      return next;
    });
  }, []);

  const decide = useMutation({
    mutationFn: async (args: DecideArgs): Promise<DecideResponse> =>
      decideFlags({
        identities: args.identities,
        outcome: args.decision.outcome,
        reason: args.decision.reason,
        note: args.decision.note,
        groupKey: args.groupKey ?? null,
        confirm: args.confirm,
      }),
    onSuccess: (result, args) => {
      if (result.needs_confirm) {
        // decide_flags refuses more than DECIDE_CONFIRM_THRESHOLD (25) writes
        // without an explicit confirm. Show the blast radius and re-issue the
        // identical call — never auto-confirm on the user's behalf.
        setPendingConfirm({
          args,
          preview: result.preview ?? { count: args.identities.length, employees: 0 },
        });
        return;
      }

      setPendingConfirm(null);
      setActiveIdentity(null);
      setLastDecision(args.decision);

      const errors = result.errors ?? [];
      setBulkFailure(
        errors.length > 0
          ? { saved: result.written ?? 0, attempted: args.identities.length, errors }
          : null
      );

      // Refetch rather than patch local state: the rows that failed come back as
      // needs_re_review, and a person only leaves the queue once the server says
      // all their flags are decided.
      refresh();
    },
  });

  const handleSubmit = useCallback(
    (identities: string[], decision: PendingDecision) => {
      if (identities.length === 0) return;
      const groupKey = selectedEntry?.kind === "group" ? selectedEntry.group_key : null;
      decide.mutate({ identities, decision, groupKey });
    },
    [decide, selectedEntry]
  );

  const handleDecideOneByOne = useCallback(() => {
    if (selectedEntry?.kind !== "group") return;
    setExpandedGroupKey(selectedEntry.group_key);
    setSelectedKey(null);
  }, [selectedEntry]);

  if (sessionLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={Spinner} title="Loading…" className="border-none" />
      </div>
    );
  }
  if (!hrStaff) {
    return <Navigate to="/hr-attendance" replace />;
  }

  return (
    <>
      <FlagQueueView
        counts={data?.counts ?? null}
        truncated={data?.truncated}
        isLoading={isLoading}
        error={error}
        onRetry={refresh}
        bulkFailure={bulkFailure}
        list={
          <FlagQueueList
            entries={entries}
            selectedKey={selectedKey}
            expandedGroupKey={expandedGroupKey}
            onSelect={handleSelect}
          />
        }
        panel={
          <FlagDecisionPanel
            entry={selectedEntry}
            draft={draft}
            onDraftChange={setDraft}
            activeIdentity={activeIdentity}
            onOpenFlag={setActiveIdentity}
            lastDecision={lastDecision}
            onSubmit={handleSubmit}
            excluded={excluded}
            onToggleMember={handleToggleMember}
            onDecideOneByOne={handleDecideOneByOne}
            submitting={decide.isPending}
          />
        }
      />

      <ResponsiveModal
        open={pendingConfirm != null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
        size="sm"
        title="Confirm this decision"
        description={
          pendingConfirm
            ? `${pendingConfirm.preview.count} flags across ${pendingConfirm.preview.employees} employees`
            : null
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPendingConfirm(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => {
                if (pendingConfirm) decide.mutate({ ...pendingConfirm.args, confirm: true });
              }}
            >
              Write {pendingConfirm?.preview.count ?? 0} decisions
            </Button>
          </>
        }
      >
        <p className="px-5 py-4 text-sm text-muted-foreground">
          Decisions are appended, never edited — a later decision supersedes this one and both stay
          on the record.
        </p>
      </ResponsiveModal>
    </>
  );
}

export type FlagQueueViewProps = {
  counts: QueuePayload["counts"] | null;
  truncated?: boolean;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  bulkFailure: BulkFailure | null;
  list: ReactNode;
  panel: ReactNode;
};

/**
 * The page's shell — toolbar counts, split layout, loading and failure states —
 * with no router, no react-query and no data fetching, so it renders under
 * renderToStaticMarkup in the test suite. FlagQueuePage above is the only piece
 * that talks to either.
 */
export function FlagQueueView(props: FlagQueueViewProps) {
  const counts = props.counts;

  return (
    <Page>
      <PageHeader
        title="Flags"
        description={counts ? `${counts.people} people with something open` : "Loading…"}
      >
        {props.truncated ? (
          <p className="text-xs text-brand-accent">
            Showing the first flags in this range — more exist. Narrow the dates to see the rest.
          </p>
        ) : null}

        {/* Counts, not filters. They report the size of the job; making them
            silently filter the list is how a queue starts hiding work. */}
        <div
          role="group"
          aria-label="Queue counts"
          className="flex w-full gap-1 rounded-lg bg-muted/40 p-1 sm:w-fit"
        >
          <CountChip label="Open" value={counts?.open ?? 0} />
          <CountChip label="Needs re-review" value={counts?.needs_re_review ?? 0} />
          <CountChip label="Decided" value={counts?.decided ?? 0} />
        </div>
      </PageHeader>

      {/* Role 2, polite: most of the batch landed, so nothing the user asked for
          is wholly missing and a screen reader must not be interrupted. The
          failing identities live behind the disclosure so the strip stays one
          row at rest. */}
      {props.bulkFailure ? (
        <AttentionStrip
          tone="amber"
          icon={<TriangleAlertIcon className="size-4 text-amber-600" aria-hidden="true" />}
          count={props.bulkFailure.errors.length}
          detail={
            <ul className="space-y-1">
              {props.bulkFailure.errors.map((failure) => (
                <li key={failure.flag_identity} className="text-xs text-muted-foreground">
                  <span className="font-mono">{failure.flag_identity}</span> — {failure.error}
                </li>
              ))}
            </ul>
          }
        >
          {partialFailureMessage(props.bulkFailure.saved, props.bulkFailure.attempted)}
        </AttentionStrip>
      ) : null}

      <Section grow>
        {props.isLoading ? (
          <EmptyState icon={Spinner} title="Loading flags…" />
        ) : props.error ? (
          // Replaces the region the queue would occupy rather than sitting above
          // it — a page showing both a banner and a replaced region reports one
          // failure twice (components/ui/notice.tsx:69-75). min-h-0 because
          // `Section grow` is an overflow-hidden clipper that would otherwise cut
          // the Retry button off on a short viewport.
          <FailureBlock
            title="Flags didn't load"
            cause="Try again, or refresh the page."
            onRetry={props.onRetry}
            className="min-h-0"
          />
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto overscroll-contain">{props.list}</div>
            <div className="min-h-0 overflow-y-auto overscroll-contain">{props.panel}</div>
          </div>
        )}
      </Section>
    </Page>
  );
}

function CountChip(props: { label: string; value: number }) {
  return (
    <span className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground sm:flex-none">
      {props.label}
      <span className="tabular-nums text-foreground">{props.value}</span>
    </span>
  );
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run:
```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run test:web
```

Expected: `# pass` covers all seven new tests and `# fail 0`. Compare the `# tests N` line against
the number you noted in Step 3 — it must have grown by exactly 7. If it did not grow, the file is
not being picked up by the glob: check it is at `src/ui/flagQueuePage.test.tsx` and nowhere deeper.

- [ ] **Step 8: Write the failing test for the device alert cards**

`get_flag_queue` returns an `alerts` array (Task 6) that nothing renders yet. These are the branch/dates
where a device self-reported `deferred_offline` or `closure_failed` — and on those the company-fallback
path *skips those employees entirely*, so **no flags are generated at all**. A flag-derived list is
therefore blind to the worst outages by construction. These cards are the only way that silence reaches
HR.

Append to `src/ui/flagQueuePage.test.tsx`:

```tsx
// The alerts array is NOT derived from flags — it is read straight from Device
// Closeout Alert. When a device reports deferred_offline/closure_failed the
// fallback path skips those employees and generates nothing, so a queue built
// only from flag rows shows an empty, reassuring screen during a real outage.
test("device alert cards render from alerts, with no flags present", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      alerts={[
        { branch: "Phnom Penh HQ", local_date: "2026-08-03", status: "deferred_offline" },
      ]}
      list={<div />}
      panel={<div />}
    />
  );

  assert.match(html, /Phnom Penh HQ/);
  assert.match(html, /3 Aug/);
  // Polite, not assertive: an outage is a persistent condition, not a failed
  // request. role="alert" would interrupt a screen reader mid-sentence.
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /role="alert"/);
});

// Constraint 9: no device↔branch registry exists, so a serial number in the copy
// would be a claim the data cannot support. The engine's last_error text can
// contain one, which is exactly why it is not rendered.
test("device alert cards never render a device serial", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      alerts={[
        {
          branch: "Phnom Penh HQ",
          local_date: "2026-08-03",
          status: "closure_failed",
          last_error: "device ZK-A4-014 timed out after 3 retries",
        },
      ]}
      list={<div />}
      panel={<div />}
    />
  );

  assert.doesNotMatch(html, /ZK-A4-014/);
  assert.match(html, /Phnom Penh HQ/);
});

// Informational only. A decide action here would be a lie — there are no flags
// behind these rows to decide on.
test("device alert cards carry no decide action", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      alerts={[
        { branch: "Phnom Penh HQ", local_date: "2026-08-03", status: "deferred_offline" },
      ]}
      list={<div />}
      panel={<div />}
    />
  );

  assert.doesNotMatch(html, />Excuse</);
  assert.doesNotMatch(html, />Uphold</);
});

test("no alert cards render when the array is empty", () => {
  const html = renderToStaticMarkup(
    <FlagQueueView
      counts={{ open: 0, needs_re_review: 0, decided: 0, people: 0 }}
      isLoading={false}
      error={null}
      onRetry={() => {}}
      bulkFailure={null}
      alerts={[]}
      list={<div />}
      panel={<div />}
    />
  );

  assert.doesNotMatch(html, /no device data/i);
  assert.doesNotMatch(html, /went offline/i);
});
```

Run: `npm run test:web`

Expected: FAIL. `FlagQueueViewProps` has no `alerts` member, so `tsx` reports a type error at each of
the four new call sites, and — because the prop is simply ignored at runtime — the first assertion to
execute fails with `Phnom Penh HQ` absent from the markup:

```
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Phnom Penh HQ/
```

- [ ] **Step 9: Add the alert copy to `src/lib/flagQueueLabels.ts`**

This extends the module Task 8 created. Append:

```ts
import { format, parseISO } from "date-fns";

import type { QueuePayload } from "@/types/flags";

type DeviceAlert = QueuePayload["alerts"][number];

/**
 * Headline for a flagless device-outage card.
 *
 * Branch-granularity on purpose. There is no device↔branch registry in this app
 * — Device Sync Status and Device Closeout Alert are daily transactional rows
 * keyed by (device_sn, local_date), not a persistent registry — so naming a
 * serial here would assert something the data cannot support. The branch is the
 * finest granularity that is actually true.
 */
export function deviceAlertHeadline(alert: DeviceAlert): string {
  const when = format(parseISO(alert.local_date), "d MMM");
  if (alert.status === "deferred_offline") {
    return `${alert.branch} went offline on ${when} — its punches never arrived`;
  }
  if (alert.status === "closure_failed") {
    return `${alert.branch} failed to close out on ${when}`;
  }
  return `${alert.branch} had no device data on ${when}`;
}

/**
 * The sentence under the cards. Written to explain the absence, because the
 * intuitive reading of a short queue during an outage is "a quiet day" — the
 * opposite of the truth.
 */
export const DEVICE_ALERT_EXPLAINER =
  "No attendance flags were generated for these branches and dates. A short queue here means missing data, not a quiet day.";
```

- [ ] **Step 10: Render the cards in `FlagQueueView`**

In `src/ui/FlagQueuePage.tsx`, add `alerts` to the props type:

```tsx
export type FlagQueueViewProps = {
  counts: QueuePayload["counts"] | null;
  truncated?: boolean;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  bulkFailure: BulkFailure | null;
  /** Flagless device outages, straight from Device Closeout Alert. */
  alerts?: QueuePayload["alerts"];
  list: ReactNode;
  panel: ReactNode;
};
```

Extend the imports:

```tsx
import { CloudOffIcon, TriangleAlertIcon } from "lucide-react";
import {
  DEVICE_ALERT_EXPLAINER,
  REASON_OPTIONS,
  deviceAlertHeadline,
  partialFailureMessage,
} from "@/lib/flagQueueLabels";
```

Then render the block immediately above the split layout, inside `FlagQueueView`, after the
`bulkFailure` strip and before `props.list` / `props.panel`:

```tsx
{props.alerts && props.alerts.length > 0 ? (
  <Section>
    <div className="space-y-1.5">
      {props.alerts.map((alert) => (
        <AttentionStrip
          key={`${alert.branch}:${alert.local_date}`}
          tone="amber"
          icon={<CloudOffIcon className="size-4 text-amber-600" aria-hidden="true" />}
        >
          {deviceAlertHeadline(alert)}
        </AttentionStrip>
      ))}
      <p className="px-1 text-xs text-muted-foreground">{DEVICE_ALERT_EXPLAINER}</p>
    </div>
  </Section>
) : null}
```

And pass it from `FlagQueuePage` where `FlagQueueView` is rendered:

```tsx
<FlagQueueView
  counts={data?.counts ?? null}
  truncated={data?.truncated}
  isLoading={isLoading}
  error={error}
  onRetry={refresh}
  bulkFailure={bulkFailure}
  alerts={data?.alerts}
  list={/* unchanged */}
  panel={/* unchanged */}
/>
```

`AttentionStrip` is deliberately used without a `detail` prop: `last_error` is engine text that can
name a device serial, and constraint 9 forbids putting one in front of a user. The card carries no
decide action because there are no flags behind it to decide.

- [ ] **Step 11: Run the test to verify it passes**

Run: `npm run test:web`

Expected: PASS. The four new tests pass and the `# tests` total is 4 higher than after Step 7. Read the
count — do not trust the exit code alone; a glob that fails to match a file exits 0 with the tests
silently unrun.



- [ ] **Step 12: Typecheck**

Run:
```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npx tsc --noEmit
```
Expected: no output. `tsx --test` strips types without checking them, so a wrong prop type or a
mismatch against `@/types/flags` passes the test run and only surfaces here (or in `npm run build`).

- [ ] **Step 13: Rebuild the deployed bundle**

Run:
```bash
cd /Users/lolbikb/projects/dewey-time/dewey_time/frontend/hr_attendance && npm run build
cd /Users/lolbikb/projects/dewey-time && git status --short dewey_time/public/hr_attendance dewey_time/www
```

Expected: the build succeeds. `git status` most likely shows **nothing** — nothing imports these
three components yet (the `/hr-flags` route is wired in a later task), so Rollup tree-shakes them
out and the bundle is byte-identical. That is the expected outcome here, *not* a reason to skip
the build: Global Constraint 11 and `CLAUDE.md` are unambiguous that built assets are the deployed
artifact, Frappe Cloud never builds this SPA, and assets went un-rebuilt across four PRs (#58–#74)
before a35c950e caught it. If anything under `public/hr_attendance/` or `www/hr-*.html` *did*
change, add it in Step 10.

- [ ] **Step 14: Commit**

```bash
cd /Users/lolbikb/projects/dewey-time
git add dewey_time/frontend/hr_attendance/src/ui/FlagQueueList.tsx \
        dewey_time/frontend/hr_attendance/src/ui/FlagDecisionPanel.tsx \
        dewey_time/frontend/hr_attendance/src/ui/FlagQueuePage.tsx \
        dewey_time/frontend/hr_attendance/src/ui/flagQueuePage.test.tsx \
        dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.ts
git add --all dewey_time/public/hr_attendance dewey_time/www
git commit -m "$(cat <<'EOF'
feat(hr-flags): queue page, ranked list and decision panel

The left pane interleaves cause groups and lone people by rank, so a
single 3-hour gap can outrank a 168-member routine group, and a person
appears exactly once — headlined by their worst undecided flag with a
+N badge for the rest. The right pane decides a person's whole day
worst-first, one flag at a time, or a whole group with per-member
checkboxes whose exclusions the header count tracks live ("Excuse 39"
of 41). needs_re_review shows its prior decision as context, visibly
not applied. Every write needs an explicit click.

Ranking, exclusion payloads and copy stay in lib/flagDecisionState and
lib/flagQueueLabels; these components only render. FlagQueueView,
FlagQueueList and FlagDecisionPanel are pure so renderToStaticMarkup
can cover them without a router or a query client.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Route, shell wiring, and retiring the Desk path

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/main.tsx:6-9,25-30`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/HrAppShell.tsx:21-41,68-91`
- Modify: `dewey_time/frontend/hr_attendance/src/lib/flagDetails.ts:126-165`
- Modify: `dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.tsx:118-125`
- Test: `dewey_time/frontend/hr_attendance/src/lib/flagDetails.test.ts` (new)
- Test: `dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.test.tsx` (new)
- Test: `dewey_time/frontend/hr_attendance/src/ui/HrAppShell.test.tsx` (new)

**Interfaces:**
- Consumes: `ui/FlagQueuePage.tsx` exporting a named, prop-less `FlagQueuePage` component (File
  Structure — built by an earlier UI task in this plan; it owns its own data fetching via
  `useFlagQueue` from Task 8, so this task only has to mount it on a route). Also consumes,
  unchanged: `useCalendarSession()` → `{ hrStaff: boolean, ... }` (`hooks/useCalendarSession.ts`),
  the `MobileTab` type (`ui/MobileTabBar.tsx`: `{ label, href, active, icon }`), and the existing
  `Flag` / `FlagStatus` types (`types/calendar.ts`). This task does **not** add a `decision` field
  to the frontend `Flag` type — `hr_calendar.py`'s additive `decision` object (File Structure) is
  consumed by later tasks, not this one.
- Produces: the `/hr-flags` route mounted inside `<HrAppShell />` in `main.tsx`, reachable for the
  e2e task's `e2e/flags.spec.ts`. `HrAppShell`'s `AppTab` union gains `"flags"`; `tabHref("flags",
  employee)` resolves to `/hr-flags` (optionally `?employee=...`) as the one canonical href for
  that destination — later work should reuse it rather than hardcoding the path. `FLAGS_INBOX_URL
  === "/hr-flags"` (was `/app/attendance-flag`) is the shell header's "Flags" button target.
  `flagHrGuidance(flag: Flag): string` keeps its exact signature but is now guaranteed to never
  contain the substring `"Desk"` in its return value, for any `flag_code`/`status` combination —
  later UI copy can rely on that. `FlagDetailPanel`'s `showDeskReview?: boolean` prop keeps its
  existing contract (`undefined`/`true` shows the record link, `false` hides it) so existing and
  future callers (e.g. a `FlagDecisionPanel`) are unaffected by the demotion.

---

- [ ] **Step 1: Write the failing test for `flagHrGuidance` — no branch may mention Desk**

```typescript
// dewey_time/frontend/hr_attendance/src/lib/flagDetails.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { flagHrGuidance } from "@/lib/flagDetails";
import type { Flag, FlagStatus } from "@/types/calendar";

function flag(overrides: Partial<Flag>): Flag {
  return {
    name: "FLAG-TEST-0001",
    flag_code: "LATE_START",
    status: "OPEN",
    day_closed: 1,
    is_provisional: false,
    ...overrides,
  };
}

// Every flag_code branch flagHrGuidance can reach once a day is finalized
// (status still "OPEN", day_closed=1) — the exhaustive switch at
// flagDetails.ts:147-164 — plus one code absent from the switch, to hit `default`.
const FINALIZED_FLAG_CODES = [
  "UNNOTIFIED_ABSENCE",
  "OFF_SHIFT_PUNCH",
  "MISSING_TIME",
  "LATE_START",
  "LATE_FROM_LUNCH",
  "LEFT_EARLY",
  "ATTENDANCE_ISSUE",
  "MISSING_IN_OR_OUT",
  "DELIVERY_FAILED",
  "UNKNOWN_DEVICE_BRANCH",
  "SOME_FUTURE_CODE",
];

// Every terminal status branch — checked before flag_code, so flag_code is
// irrelevant for these.
const TERMINAL_STATUSES: FlagStatus[] = ["APPROVED", "REJECTED", "EXPLAINED", "CLOSED"];

// /hr-flags is now the only place HR decides — see the design doc's "Retiring the
// Desk decision path". Pre-change, every flag_code branch and three of the four
// status branches literally say "in Desk" or point at "the Attendance Flag
// record"; this loop fails loudly against that code the moment it reaches the
// first branch (UNNOTIFIED_ABSENCE).
test("flagHrGuidance never tells HR to act in Desk, for any flag_code", () => {
  for (const flag_code of FINALIZED_FLAG_CODES) {
    const guidance = flagHrGuidance(flag({ flag_code, status: "OPEN", day_closed: 1 }));
    assert.doesNotMatch(
      guidance,
      /desk/i,
      `flag_code ${flag_code} guidance still mentions Desk: "${guidance}"`
    );
  }
});

test("flagHrGuidance never tells HR to act in Desk, for any terminal status", () => {
  for (const status of TERMINAL_STATUSES) {
    const guidance = flagHrGuidance(flag({ status, flag_code: "LATE_START", day_closed: 1 }));
    assert.doesNotMatch(
      guidance,
      /desk/i,
      `status ${status} guidance still mentions Desk: "${guidance}"`
    );
  }
});

test("flagHrGuidance for a still-provisional flag also avoids Desk", () => {
  const guidance = flagHrGuidance(
    flag({ status: "OPEN", day_closed: 0, is_provisional: true, flag_code: "MISSING_TIME" })
  );
  assert.doesNotMatch(guidance, /desk/i, `provisional guidance mentions Desk: "${guidance}"`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/lib/flagDetails.test.ts`
Expected: FAIL on the first test, on the first loop iteration (`UNNOTIFIED_ABSENCE`), with:
```
AssertionError [ERR_ASSERTION]: flag_code UNNOTIFIED_ABSENCE guidance still mentions Desk: "Confirm whether the employee was on approved leave, holiday, or an excused absence. If not, follow your no-show process and record the decision in Desk."
```

- [ ] **Step 3: Rewrite `flagHrGuidance` to point at the flag queue instead of Desk**

Replace `dewey_time/frontend/hr_attendance/src/lib/flagDetails.ts:126-165` (the whole function body,
every existing branch kept, only the copy changes):

```typescript
export function flagHrGuidance(flag: Flag): string {
  const status = flag.status ?? "OPEN";
  const provisional = flagIsProvisional(flag);

  if (status === "APPROVED") {
    return "This flag was excused. No further action is required unless payroll policy changes.";
  }
  if (status === "REJECTED") {
    return "This flag was upheld. Review the note on the decision for context.";
  }
  if (status === "EXPLAINED") {
    return "The employee submitted an explanation. Review it in the flag queue and decide to excuse or uphold the flag.";
  }
  if (status === "CLOSED") {
    return "This flag is closed. It remains visible for audit but does not need action.";
  }

  if (provisional) {
    return "This flag is still provisional and may change or disappear after device closeout. Use the timeline below to verify punches, then check the flag queue again after closeout if it remains.";
  }

  switch (flag.flag_code) {
    case "UNNOTIFIED_ABSENCE":
      return "Confirm whether the employee was on approved leave, holiday, or an excused absence. If not, follow your no-show process and record the decision in the flag queue.";
    case "OFF_SHIFT_PUNCH":
      return "Check whether the punches were expected (for example overtime or a schedule error). Record the outcome — excused or upheld — in the flag queue.";
    case "MISSING_TIME":
    case "LATE_START":
    case "LATE_FROM_LUNCH":
    case "LEFT_EARLY":
      return "Compare the supporting details with the day timeline, then decide to excuse or uphold this flag in the flag queue.";
    case "ATTENDANCE_ISSUE":
    case "MISSING_IN_OR_OUT":
    case "DELIVERY_FAILED":
    case "UNKNOWN_DEVICE_BRANCH":
      return "This is a data-quality issue. Verify punches in the timeline, then decide in the flag queue whether the underlying time still counts.";
    default:
      return "Review the supporting details, then excuse or uphold this flag in the flag queue.";
  }
}
```

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/lib/flagDetails.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 4: Write the failing test for `FlagDetailPanel`'s demoted Desk link**

```typescript
// dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.test.tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FlagDetailPanel } from "@/ui/FlagDetailPanel";
import type { Flag } from "@/types/calendar";

const FLAG: Flag = {
  name: "FLAG-0001",
  flag_code: "LATE_START",
  status: "OPEN",
  severity: "WARNING",
  day_closed: 1,
  is_provisional: false,
  evidence: {},
};

// /hr-flags is now where HR decides; Desk is a fallback record view, not the
// primary action. "Review in Desk" — a primary Button, the panel's only call to
// action — used to be what sent HR back to Desk out of habit. It must now read
// as a secondary link labelled "Open record".
test("FlagDetailPanel demotes the Desk link to a secondary 'Open record' action", () => {
  const html = renderToStaticMarkup(
    <FlagDetailPanel
      flag={FLAG}
      date="2026-08-04"
      employeeLabel="Jane Doe"
      employeeId="EMP-0001"
    />
  );
  assert.doesNotMatch(html, /Review in Desk/, "old primary-button label should be gone");
  assert.match(html, /Open record/, "expected the new secondary label");

  const linkStart = html.indexOf("Open record");
  const tagStart = html.lastIndexOf("<a", linkStart);
  const tagEnd = html.indexOf(">", tagStart);
  const anchorHtml = html.slice(tagStart, tagEnd);
  // dewey-ui's Button stamps data-variant on the rendered element even when
  // `asChild` hands it off to a plain <a> (dewey-ui button.tsx:62-67) — "link" is
  // its lowest-emphasis style; "default" (the prior implicit value) is the
  // filled, primary one.
  assert.match(
    anchorHtml,
    /data-variant="link"/,
    "expected the low-emphasis link variant, not a primary button"
  );
});

test("showDeskReview=false still hides the record link entirely (prop contract preserved)", () => {
  const html = renderToStaticMarkup(
    <FlagDetailPanel
      flag={FLAG}
      date="2026-08-04"
      employeeLabel="Jane Doe"
      employeeId="EMP-0001"
      showDeskReview={false}
    />
  );
  assert.doesNotMatch(html, /Open record/);
  assert.doesNotMatch(html, /Review in Desk/);
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/ui/FlagDetailPanel.test.tsx`
Expected: FAIL on the first test with:
```
AssertionError [ERR_ASSERTION]: old primary-button label should be gone
```

- [ ] **Step 6: Demote the Desk button to a secondary link**

Replace `dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.tsx:118-125`:

```tsx
        {props.showDeskReview !== false ? (
          <Button variant="link" size="sm" className="gap-1.5 px-0" asChild>
            <a href={flagDeskUrl(flag.name)} target="_blank" rel="noreferrer">
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              Open record
            </a>
          </Button>
        ) : null}
```

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/ui/FlagDetailPanel.test.tsx`
Expected: PASS, both tests.

- [ ] **Step 7: Write the failing test for the Flags tab, `FLAGS_INBOX_URL`, and the `/hr-flags` route**

```tsx
// dewey_time/frontend/hr_attendance/src/ui/HrAppShell.test.tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

// HrAppShell renders through useCalendarSession (react-query, hits the network)
// and useIsMobile (reads window.innerWidth) — neither works under plain
// node:test/renderToStaticMarkup with no DOM available. This file follows the
// same source-assertion pattern already used for this component in
// src/lib/queryKeys.test.ts:41-47 rather than mounting it.
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHELL_PATH = resolve(PKG, "src/ui/HrAppShell.tsx");

function shellSource(): string {
  return readFileSync(SHELL_PATH, "utf8");
}

test("the Flags tab is gated in the same hrStaff-only block as Schedule and Coverage", () => {
  const src = shellSource();
  const gate = src.match(/\.\.\.\(hrStaff\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[\]\)/);
  assert.ok(gate, "expected a `...(hrStaff ? [...] : [])` block in the tabs array");
  const gatedBlock = gate![1];
  assert.match(gatedBlock, /label:\s*"Schedule"/, "sanity: Schedule is in the gated block");
  assert.match(gatedBlock, /label:\s*"Coverage"/, "sanity: Coverage is in the gated block");
  assert.match(gatedBlock, /label:\s*"Flags"/, "Flags tab is missing from the HR-only block");
  assert.match(
    gatedBlock,
    /icon:\s*FlagIcon/,
    "Flags tab should use the already-imported FlagIcon"
  );
});

test("the Flags tab is absent from the tabs array's always-visible head (non-HR users)", () => {
  const src = shellSource();
  const tabsStart = src.indexOf("const tabs: MobileTab[] = [");
  const gateStart = src.indexOf("...(hrStaff", tabsStart);
  assert.ok(tabsStart !== -1 && gateStart !== -1, "could not locate the tabs array / HR gate");
  const alwaysVisibleHead = src.slice(tabsStart, gateStart);
  assert.doesNotMatch(
    alwaysVisibleHead,
    /label:\s*"Flags"/,
    "Flags must only render inside the hrStaff-gated block, never unconditionally"
  );
});

test("FLAGS_INBOX_URL points at the in-app flag queue, not the retired Desk list view", () => {
  const src = shellSource();
  const match = src.match(/FLAGS_INBOX_URL\s*=\s*"([^"]+)"/);
  assert.ok(match, "expected a FLAGS_INBOX_URL constant");
  assert.equal(match![1], "/hr-flags");
  assert.ok(
    !match![1].startsWith("/app/"),
    `FLAGS_INBOX_URL still points at Desk: "${match![1]}"`
  );
});

// activeTab checks /hr-schedule/coverage before the plain /hr-schedule prefix,
// because startsWith("/hr-schedule") alone also matches "/hr-schedule/coverage"
// and would misclassify it (HrAppShell.tsx:27-28). Adding /hr-flags must not
// disturb that order.
test("activeTab keeps the coverage-before-schedule check and adds /hr-flags", () => {
  const src = shellSource();
  const fnStart = src.indexOf("function activeTab");
  const fnEnd = src.indexOf("function tabHref");
  assert.ok(fnStart !== -1 && fnEnd !== -1, "could not locate activeTab/tabHref");
  const fn = src.slice(fnStart, fnEnd);
  const coverageIdx = fn.indexOf('pathname.startsWith("/hr-schedule/coverage")');
  const scheduleIdx = fn.indexOf('pathname.startsWith("/hr-schedule")');
  const flagsIdx = fn.indexOf('pathname.startsWith("/hr-flags")');
  assert.ok(coverageIdx !== -1, "missing the /hr-schedule/coverage check");
  assert.ok(scheduleIdx !== -1, "missing the /hr-schedule check");
  assert.ok(flagsIdx !== -1, "missing the new /hr-flags check");
  assert.ok(
    coverageIdx < scheduleIdx,
    "the more specific /hr-schedule/coverage check must stay first"
  );
});

test("main.tsx registers /hr-flags inside the HrAppShell element, alongside the other four routes", () => {
  const main = readFileSync(resolve(PKG, "src/main.tsx"), "utf8");
  assert.match(
    main,
    /import \{ FlagQueuePage \} from ["']\.\/ui\/FlagQueuePage["']/,
    "missing the FlagQueuePage import"
  );
  const shellStart = main.indexOf("<Route element={<HrAppShell");
  const shellEnd = main.indexOf("</Route>", shellStart);
  assert.ok(shellStart !== -1 && shellEnd !== -1, "could not locate the <HrAppShell /> route block");
  const shellBlock = main.slice(shellStart, shellEnd);
  for (const path of [
    "/hr-attendance",
    "/hr-schedule",
    "/hr-schedule/import",
    "/hr-schedule/coverage",
    "/hr-flags",
  ]) {
    assert.match(
      shellBlock,
      new RegExp(`<Route path="${path}"`),
      `expected a <Route path="${path}"> inside the HrAppShell element`
    );
  }
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/ui/HrAppShell.test.tsx`
Expected: FAIL on the first test with:
```
AssertionError [ERR_ASSERTION]: Flags tab is missing from the HR-only block
```
(The "absent from the always-visible head" and Desk-ordering tests will pass already —
nothing to regress there yet — but `FLAGS_INBOX_URL`, `activeTab`, and the `main.tsx` route test
also fail, since none of the source changes exist yet.)

- [ ] **Step 9: Add the HR-only Flags tab, repoint `FLAGS_INBOX_URL`, and extend `activeTab`/`tabHref`**

Replace `dewey_time/frontend/hr_attendance/src/ui/HrAppShell.tsx:21-41`:

```tsx
const DESK_URL = "/desk";
const FLAGS_INBOX_URL = "/hr-flags";

type AppTab = "attendance" | "schedule" | "coverage" | "flags";

function activeTab(pathname: string): AppTab {
  // Check the more specific /hr-schedule/coverage before the /hr-schedule prefix.
  if (pathname.startsWith("/hr-schedule/coverage")) return "coverage";
  if (pathname.startsWith("/hr-schedule")) return "schedule";
  if (pathname.startsWith("/hr-flags")) return "flags";
  return "attendance";
}

function tabHref(tab: AppTab, employee: string | null): string {
  const base =
    tab === "flags"
      ? "/hr-flags"
      : tab === "coverage"
        ? "/hr-schedule/coverage"
        : tab === "schedule"
          ? "/hr-schedule"
          : "/hr-attendance";
  return employee ? `${base}?employee=${encodeURIComponent(employee)}` : base;
}
```

Then replace `dewey_time/frontend/hr_attendance/src/ui/HrAppShell.tsx:68-91` (the `tabs` array —
`FlagIcon` is already imported at the top of the file for the header's `DeskLink`, so no new
import is needed):

```tsx
  const tabs: MobileTab[] = [
    {
      label: hrStaff ? "Attendance" : "My calendar",
      href: tabHref("attendance", employee),
      active: tab === "attendance",
      icon: CalendarDaysIcon,
    },
    ...(hrStaff
      ? [
          {
            label: "Schedule",
            href: tabHref("schedule", employee),
            active: tab === "schedule",
            icon: CalendarRangeIcon,
          },
          {
            label: "Coverage",
            href: tabHref("coverage", employee),
            active: tab === "coverage",
            icon: UserCheckIcon,
          },
          {
            label: "Flags",
            href: tabHref("flags", employee),
            active: tab === "flags",
            icon: FlagIcon,
          },
        ]
      : []),
  ];
```

- [ ] **Step 10: Mount `/hr-flags` inside `HrAppShell` in `main.tsx`**

Replace the import block at `dewey_time/frontend/hr_attendance/src/main.tsx:6-9`:

```tsx
import { App } from "./ui/App";
import { HrAppShell } from "./ui/HrAppShell";
import { WeeklySchedulePage } from "./ui/WeeklySchedulePage";
import { ScheduleImportPage } from "./ui/schedule-import/ScheduleImportPage";
import { ScheduleCoveragePage } from "./ui/schedule-coverage/ScheduleCoveragePage";
import { FlagQueuePage } from "./ui/FlagQueuePage";
import { DeweyTimeIntro } from "./brand/DeweyTimeIntro";
```

Then replace the routes block at `dewey_time/frontend/hr_attendance/src/main.tsx:25-30`:

```tsx
              <Route element={<HrAppShell />}>
                <Route path="/hr-attendance" element={<App />} />
                <Route path="/hr-schedule" element={<WeeklySchedulePage />} />
                <Route path="/hr-schedule/import" element={<ScheduleImportPage />} />
                <Route path="/hr-schedule/coverage" element={<ScheduleCoveragePage />} />
                <Route path="/hr-flags" element={<FlagQueuePage />} />
              </Route>
```

- [ ] **Step 11: Run the full frontend suite and confirm everything passes**

Run: `cd dewey_time/frontend/hr_attendance && npm run test:web`
Expected: PASS, no failures. Baseline before this task was 336 tests (`ℹ tests 336` /
`# tests 336` depending on whether the runner sees a TTY); this task adds 3 (`flagDetails.test.ts`)
+ 2 (`FlagDetailPanel.test.tsx`) + 5 (`HrAppShell.test.tsx`) = 10, so the summary line should read
`tests 346` / `pass 346` / `fail 0`. If the count differs, some other task landed tests in
parallel — check the delta is explained before treating this as green.

- [ ] **Step 12: Build the SPA — Frappe Cloud never builds this app, so the committed bundle is what ships**

Run: `cd dewey_time/frontend/hr_attendance && npm run build`
Expected: builds clean, emitting into `dewey_time/public/hr_attendance/`.

- [ ] **Step 13: Commit**

```bash
git add \
  dewey_time/frontend/hr_attendance/src/main.tsx \
  dewey_time/frontend/hr_attendance/src/ui/HrAppShell.tsx \
  dewey_time/frontend/hr_attendance/src/ui/HrAppShell.test.tsx \
  dewey_time/frontend/hr_attendance/src/lib/flagDetails.ts \
  dewey_time/frontend/hr_attendance/src/lib/flagDetails.test.ts \
  dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.tsx \
  dewey_time/frontend/hr_attendance/src/ui/FlagDetailPanel.test.tsx \
  dewey_time/public/hr_attendance \
  dewey_time/www/hr-attendance.html \
  dewey_time/www/hr-schedule.html \
  dewey_time/www/hr-personal.html
git commit -m "$(cat <<'EOF'
feat(hr-flags): wire /hr-flags route and Flags tab, retire Desk guidance

HrAppShell gains an HR-only Flags tab and its header "Flags" button now
points at /hr-flags instead of the Desk list view. flagHrGuidance no
longer sends HR to Desk to decide, and FlagDetailPanel's Desk link is
demoted from primary action to a secondary "Open record" link now that
the flag queue is where decisions happen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Migrate surviving in-place Desk decisions

**Files:**
- Create: `dewey_time/patches/migrate_legacy_flag_decisions.py`
- Modify: `dewey_time/patches.txt:20` (append a new line 21)
- Test: `dewey_time/tests/test_migrate_legacy_flag_decisions.py`

**Interfaces:**
- Consumes:
  - `dewey_time.attendance_engine.flag_identity.flag_identity(*, employee: str, attendance_date, flag_code: str, evidence) -> str` (Task 1) — called with keyword args only, per the contract's `*` marker.
  - `dewey_time.attendance_engine.flag_identity.evidence_fingerprint(evidence) -> str` (Task 1) — called positionally.
  - The `Attendance Flag Decision` doctype (Task 6, `dewey_time/dewey_time/doctype/attendance_flag_decision/`) with fields `flag_identity, employee, attendance_date, flag_code, employee_branch, outcome, reason, note, evidence_fingerprint, group_key, decided_by, decided_at, supersedes, superseded`.
  - `Attendance Flag`'s existing (soon-to-be-deprecated) fields: `status` (`OPEN | EXPLAINED | APPROVED | REJECTED | CLOSED`), `hr_note`, `hr_user`, `hr_decided_at`, plus `employee`, `attendance_date`, `flag_code`, `evidence` (`attendance_flag.json:104-174`).
- Produces:
  - Nothing any other task imports — this is a one-off `execute()` invoked once by `bench migrate`. Its only effect is data: rows in `Attendance Flag Decision` that `get_flag_queue` (`flag_queue_api.py`, later task) reads exactly like any natively-written decision, because `flag_identity` and `evidence_fingerprint` were computed the same way.
  - `dewey_time/patches.txt` gains the line `dewey_time.patches.migrate_legacy_flag_decisions`, appended after the existing 20 entries — this is the only task in the plan that touches `patches.txt`.

- [ ] **Step 1: Write the failing test**

```python
# dewey_time/tests/test_migrate_legacy_flag_decisions.py
import unittest
from unittest.mock import MagicMock, patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()


def _legacy_rows():
    """Four Attendance Flag rows spanning every status this patch must handle.

    Two map cleanly (APPROVED, REJECTED); two have no Attendance Flag Decision
    equivalent (CLOSED predates this feature, EXPLAINED belongs to Spec 2's
    employee-note flow) and must be skipped rather than guessed at.
    """
    return [
        {
            "name": "AUTO-hr-emp-00001-2026-07-19-late-start",
            "employee": "HR-EMP-00001",
            "attendance_date": "2026-07-19",
            "flag_code": "LATE_START",
            "evidence": None,
            "status": "APPROVED",
            "hr_note": "manager pre-approved the late start",
            "hr_user": "hr.manager@dewey.test",
            "hr_decided_at": "2026-07-19 18:00:00",
        },
        {
            "name": "AUTO-hr-emp-00002-2026-07-20-off-shift-punch",
            "employee": "HR-EMP-00002",
            "attendance_date": "2026-07-20",
            "flag_code": "OFF_SHIFT_PUNCH",
            "evidence": None,
            "status": "REJECTED",
            "hr_note": "no valid reason given",
            "hr_user": "hr.manager@dewey.test",
            "hr_decided_at": "2026-07-20 09:30:00",
        },
        {
            "name": "AUTO-hr-emp-00003-2026-07-21-missing-time-08-00",
            "employee": "HR-EMP-00003",
            "attendance_date": "2026-07-21",
            "flag_code": "MISSING_TIME",
            "evidence": None,
            "status": "CLOSED",
            "hr_note": None,
            "hr_user": None,
            "hr_decided_at": None,
        },
        {
            "name": "AUTO-hr-emp-00004-2026-07-22-attendance-issue-single-checkin",
            "employee": "HR-EMP-00004",
            "attendance_date": "2026-07-22",
            "flag_code": "ATTENDANCE_ISSUE",
            "evidence": None,
            "status": "EXPLAINED",
            "hr_note": None,
            "hr_user": None,
            "hr_decided_at": None,
        },
    ]


class TestMigrateLegacyFlagDecisions(unittest.TestCase):
    def _run_with(self, rows, *, exists=False):
        from dewey_time.patches import migrate_legacy_flag_decisions as patch_mod

        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", return_value=exists
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod.frappe, "get_doc"
        ) as get_doc, patch.object(
            patch_mod.frappe, "log_error"
        ) as log_error:
            patch_mod.execute()
        return get_doc, log_error

    def test_approved_maps_to_excused_and_rejected_to_upheld(self):
        rows = _legacy_rows()[:2]  # APPROVED, REJECTED only
        get_doc, _log_error = self._run_with(rows, exists=False)

        self.assertEqual(get_doc.call_count, 2)
        written = [call.args[0] for call in get_doc.call_args_list]

        approved_doc = next(d for d in written if d["employee"] == "HR-EMP-00001")
        self.assertEqual(approved_doc["doctype"], "Attendance Flag Decision")
        self.assertEqual(approved_doc["outcome"], "EXCUSED")
        self.assertEqual(approved_doc["reason"], "OTHER")
        self.assertEqual(approved_doc["note"], "manager pre-approved the late start")
        self.assertEqual(approved_doc["decided_by"], "hr.manager@dewey.test")
        self.assertEqual(approved_doc["decided_at"], "2026-07-19 18:00:00")
        self.assertTrue(approved_doc["flag_identity"].startswith("AUTO-"))

        rejected_doc = next(d for d in written if d["employee"] == "HR-EMP-00002")
        self.assertEqual(rejected_doc["outcome"], "UPHELD")
        self.assertEqual(rejected_doc["reason"], "OTHER")

        # insert() must run with ignore_permissions=True -- this is a one-off
        # migration script with no logged-in HR session behind it.
        for call in get_doc.return_value.insert.call_args_list:
            self.assertTrue(call.kwargs.get("ignore_permissions"))

    def test_closed_and_explained_are_skipped_and_counted(self):
        rows = _legacy_rows()
        get_doc, log_error = self._run_with(rows, exists=False)

        # Only the two mappable rows (APPROVED, REJECTED) ever reach get_doc.
        # If CLOSED/EXPLAINED were wrongly mapped, this would be 4, not 2 --
        # this assertion fails against a naive "status != OPEN -> migrate"
        # implementation that invents an outcome for every non-OPEN row.
        self.assertEqual(get_doc.call_count, 2)

        titles = [call.kwargs.get("title", "") for call in log_error.call_args_list]
        skip_titles = [t for t in titles if "no decision equivalent" in t]
        self.assertEqual(
            len(skip_titles), 2, "CLOSED and EXPLAINED must each be logged, not silently dropped"
        )

        summary = log_error.call_args_list[-1]
        self.assertIn("summary", summary.kwargs.get("title", ""))
        self.assertIn("migrated=2", summary.kwargs.get("message", ""))
        self.assertIn("skipped=2", summary.kwargs.get("message", ""))
        self.assertIn("failed=0", summary.kwargs.get("message", ""))

    def test_second_run_creates_no_duplicates(self):
        from dewey_time.patches import migrate_legacy_flag_decisions as patch_mod

        rows = _legacy_rows()[:2]

        # First run: no live decision exists yet for either identity.
        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", return_value=False
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod.frappe, "get_doc"
        ) as get_doc_first, patch.object(patch_mod.frappe, "log_error"):
            patch_mod.execute()
        self.assertEqual(get_doc_first.call_count, 2)

        # Second run: both identities now resolve to a live decision (either
        # written by the first run, or by a fresh decide_flags() call made
        # through the new page in the meantime) -- exists() now returns True.
        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", return_value=True
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod.frappe, "get_doc"
        ) as get_doc_second, patch.object(
            patch_mod.frappe, "log_error"
        ) as log_error_second:
            patch_mod.execute()

        self.assertEqual(
            get_doc_second.call_count,
            0,
            "a re-run must not write a duplicate decision for an identity that already has one",
        )
        summary = log_error_second.call_args_list[-1]
        self.assertIn("migrated=0", summary.kwargs.get("message", ""))

    def test_identity_failure_is_counted_and_does_not_abort(self):
        from dewey_time.patches import migrate_legacy_flag_decisions as patch_mod

        rows = _legacy_rows()[:2]  # APPROVED (will fail), REJECTED (will succeed)

        with patch.object(patch_mod.frappe, "get_all", return_value=rows), patch.object(
            patch_mod.frappe.db, "exists", return_value=False
        ), patch.object(patch_mod.frappe.db, "get_value", return_value="BRANCH-A"), patch.object(
            patch_mod, "flag_identity", side_effect=[ValueError("bad evidence"), "AUTO-hr-emp-00002-2026-07-20-off-shift-punch"]
        ), patch.object(patch_mod.frappe, "get_doc") as get_doc, patch.object(
            patch_mod.frappe, "log_error"
        ) as log_error:
            # Must not raise -- one bad row must never abort the batch.
            patch_mod.execute()

        # Only the second (REJECTED) row made it through to a write.
        self.assertEqual(get_doc.call_count, 1)
        self.assertEqual(get_doc.call_args.args[0]["employee"], "HR-EMP-00002")

        titles = [call.kwargs.get("title", "") for call in log_error.call_args_list]
        self.assertTrue(
            any("flag_identity" in t for t in titles),
            "the unmapped-identity row must be logged, not silently dropped",
        )
        summary = log_error.call_args_list[-1]
        self.assertIn("failed=1", summary.kwargs.get("message", ""))
        self.assertIn("migrated=1", summary.kwargs.get("message", ""))

    def test_registered_in_patches_txt(self):
        """A patch file with no manifest entry never runs (CLAUDE.md constraint 12)."""
        from pathlib import Path

        manifest = Path(__file__).resolve().parents[1] / "patches.txt"
        self.assertIn(
            "dewey_time.patches.migrate_legacy_flag_decisions",
            manifest.read_text(),
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bench --site test_site run-tests --app dewey_time --module dewey_time.tests.test_migrate_legacy_flag_decisions`

Expected: FAIL — every test errors identically with `ModuleNotFoundError: No module named 'dewey_time.patches.migrate_legacy_flag_decisions'`, because `test_registered_in_patches_txt` is the only test that does not import the module, and it fails separately with `AssertionError` since the line has not been added to `patches.txt` yet.

- [ ] **Step 3: Implement the patch**

```python
# dewey_time/patches/migrate_legacy_flag_decisions.py
import frappe

from dewey_time.attendance_engine.flag_identity import evidence_fingerprint, flag_identity

# Legacy Attendance Flag.status values that map onto an Attendance Flag
# Decision outcome. See docs/superpowers/specs/2026-08-05-hr-flag-management-design.md,
# "Retiring the Desk decision path".
_STATUS_TO_OUTCOME = {
    "APPROVED": "EXCUSED",
    "REJECTED": "UPHELD",
}

# CLOSED predates this feature entirely (it was a terminal Desk state with no
# EXCUSED/UPHELD meaning) and EXPLAINED belongs to Spec 2's employee-note flow,
# which does not exist yet -- neither has an Attendance Flag Decision
# equivalent. Inventing one would fabricate an HR judgment nobody made.
_NO_DECISION_EQUIVALENT = {"CLOSED", "EXPLAINED"}


def execute():
    """Best-effort migration of legacy in-place Desk decisions into Attendance
    Flag Decision rows, so this page (not Desk) becomes the single place a
    decision can be read from.

    Why "best-effort" is not hedging, but the honest description of what is
    possible: AUTO Attendance Flag rows are hard-deleted and rebuilt on every
    checkin and every closeout, via raw frappe.db.delete() calls that bypass
    every document hook --
        intraday.py:78    (day_closed=0 rows, scoped to INTRADAY_FLAG_CODES)
        intraday.py:214   (ALL AUTO rows for that employee/date, on any
                            checkin insert or edit)
        closeout.py:295,473,476,696
        schedule_resolver.py:1240,1299-1348 (schedule wizard, not the engine)
    Any status/hr_note/hr_user/hr_decided_at an HR reviewer wrote onto an AUTO
    row before this patch runs is destroyed the moment the engine next
    regenerates that employee's date, with no trace and nothing left for this
    patch to find. The rows below are only the ones that happened to still be
    sitting in the table on the day this patch ran: whatever the deletion
    cycle had not yet reached, plus any HR/EMPLOYEE-sourced rows the engine
    never touches at all.

    A low migrated count on a given site is therefore not evidence this patch
    is broken -- it is evidence of how much the deletion cycle had already
    destroyed before the patch got a chance to run. Do not read the tally
    below as a completeness signal; read it as a snapshot of what survived.

    Idempotent: an identity that already has a live (superseded=0) decision
    -- from a prior run of this same patch, or from a fresh decision made
    through decide_flags() in the meantime -- is skipped, so re-running never
    creates a duplicate.
    """
    rows = frappe.get_all(
        "Attendance Flag",
        filters={"status": ["!=", "OPEN"]},
        fields=[
            "name",
            "employee",
            "attendance_date",
            "flag_code",
            "evidence",
            "status",
            "hr_note",
            "hr_user",
            "hr_decided_at",
        ],
    )

    migrated = 0
    skipped = 0
    failed = 0

    for row in rows:
        name = row.get("name")
        status = row.get("status")

        if status in _NO_DECISION_EQUIVALENT:
            skipped += 1
            frappe.log_error(
                title="migrate_legacy_flag_decisions: no decision equivalent",
                message=(
                    "Attendance Flag {0} has status {1}, which has no Attendance Flag "
                    "Decision outcome. Left as a legacy in-place record; not migrated."
                ).format(name, status),
            )
            continue

        outcome = _STATUS_TO_OUTCOME.get(status)
        if not outcome:
            # Defensive only: Attendance Flag.status has exactly five options
            # (attendance_flag.json:104-108) and every one is handled above.
            # This guards against a future status value being added to the
            # doctype without this patch being updated to match.
            failed += 1
            frappe.log_error(
                title="migrate_legacy_flag_decisions: unmapped status",
                message="Attendance Flag {0} has unrecognised status {1!r}.".format(name, status),
            )
            continue

        try:
            identity = flag_identity(
                employee=row.get("employee"),
                attendance_date=row.get("attendance_date"),
                flag_code=row.get("flag_code"),
                evidence=row.get("evidence"),
            )
        except Exception:
            failed += 1
            frappe.log_error(
                title="migrate_legacy_flag_decisions: flag_identity failed",
                message="Attendance Flag {0}: could not compute flag_identity.\n{1}".format(
                    name, frappe.get_traceback()
                ),
            )
            continue

        if frappe.db.exists("Attendance Flag Decision", {"flag_identity": identity, "superseded": 0}):
            skipped += 1
            continue

        try:
            # employee_branch is denormalised at write time (same reason the
            # doctype carries it at all: cause grouping in get_flag_queue
            # reads it without a join). A per-row lookup here is fine -- this
            # runs once, not on the read hot path the O(1) query budget binds.
            branch = frappe.db.get_value("Employee", row.get("employee"), "branch")

            # decided_by/decided_at are read_only in the Desk form
            # (attendance_flag_decision.json) but that only blocks the form
            # UI -- decide_flags() (flag_decision_api.py) sets these two
            # fields explicitly from frappe.session.user/now_datetime() for
            # every *new* decision, and this migration does the analogous
            # thing for a *historical* one: it uses the original reviewer's
            # identity and timestamp (hr_user/hr_decided_at) rather than
            # whoever happens to run `bench migrate`.
            doc = frappe.get_doc(
                {
                    "doctype": "Attendance Flag Decision",
                    "flag_identity": identity,
                    "employee": row.get("employee"),
                    "attendance_date": row.get("attendance_date"),
                    "flag_code": row.get("flag_code"),
                    "employee_branch": branch,
                    "outcome": outcome,
                    "reason": "OTHER",
                    "note": row.get("hr_note"),
                    "evidence_fingerprint": evidence_fingerprint(row.get("evidence")),
                    "decided_by": row.get("hr_user"),
                    "decided_at": row.get("hr_decided_at"),
                }
            )
            doc.insert(ignore_permissions=True)
        except Exception:
            # Covers, among other things, the doctype's own required-note
            # validation (note is required when reason=OTHER, and this patch
            # always sets reason=OTHER) rejecting a legacy row that was
            # approved/rejected in Desk without an hr_note. That is a real
            # or missing detail from the Desk-era record, not a bug in this
            # patch -- count it as failed and keep going.
            failed += 1
            frappe.log_error(
                title="migrate_legacy_flag_decisions: write failed",
                message="Attendance Flag {0} (identity {1}): could not write Attendance Flag "
                "Decision.\n{2}".format(name, identity, frappe.get_traceback()),
            )
            continue

        migrated += 1

    frappe.log_error(
        title="migrate_legacy_flag_decisions: summary",
        message="migrated={0} skipped={1} failed={2} total={3}".format(
            migrated, skipped, failed, len(rows)
        ),
    )
```

- [ ] **Step 4: Register the patch in `dewey_time/patches.txt`**

```diff
 dewey_time.patches.disable_schedule_naming_server_scripts
 dewey_time.patches.non_primary_site_punch_severity_to_info
+dewey_time.patches.migrate_legacy_flag_decisions
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bench --site test_site run-tests --app dewey_time --module dewey_time.tests.test_migrate_legacy_flag_decisions`

Expected: `OK` — 5 tests pass (`test_approved_maps_to_excused_and_rejected_to_upheld`, `test_closed_and_explained_are_skipped_and_counted`, `test_second_run_creates_no_duplicates`, `test_identity_failure_is_counted_and_does_not_abort`, `test_registered_in_patches_txt`).

- [ ] **Step 6: Commit**

```bash
git add dewey_time/patches/migrate_legacy_flag_decisions.py dewey_time/patches.txt dewey_time/tests/test_migrate_legacy_flag_decisions.py
git commit -m "$(cat <<'EOF'
feat(flag-decisions): migrate surviving in-place Desk decisions

One-off patch: best-effort migrates Attendance Flag rows with status !=
OPEN into Attendance Flag Decision (APPROVED->EXCUSED, REJECTED->UPHELD),
using the same flag_identity/evidence_fingerprint the live queue reads.
CLOSED/EXPLAINED have no decision equivalent and are logged and skipped.
Idempotent by identity; failures are counted and logged, never silently
dropped or allowed to abort the batch.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: End-to-end coverage and final asset build

**Files:**
- Create: `dewey_time/frontend/hr_attendance/e2e/flags.spec.ts`
- Modify: `dewey_time/public/hr_attendance/**` (rebuilt by `npm run build` — generated output, never hand-edited)
- Modify: `dewey_time/www/hr-attendance.html`, `dewey_time/www/hr-schedule.html` (regenerated by `scripts/copy-html-entry.mjs`, which `npm run build` invokes — `package.json:8`)
- Test: `dewey_time/frontend/hr_attendance/e2e/flags.spec.ts` (Playwright, run via `npm run test:e2e`)

**Interfaces:**
- Consumes: the whole contract surface, end to end, as it actually renders — nothing here is mocked at the unit level:
  - `get_flag_queue(start_date, end_date, tier=None, limit=2000) -> {"entries", "counts", "orphans", "alerts", "truncated", "start_date", "end_date"}` (`flag_queue_api.py`) — stubbed per-test as the network response the SPA receives.
  - `decide_flags(identities, outcome, reason, note=None, group_key=None, confirm=None) -> {"ok", "written", "group_key", "errors": [{"flag_identity", "error"}]}` (`flag_decision_api.py`) — stubbed the same way.
  - `types/flags.ts`'s `QueuePayload` / `QueueEntry` (`{kind: "group"} | {kind: "person"}`) / `QueuePerson` / `FlagOut` / `FlagDecision` shapes, reproduced as plain mock JSON (no import — `e2e/fixtures.ts` never imports `src/` types either; the wire shape is the contract, not the TS module).
  - The rendered DOM of `/hr-flags` — `main.tsx`'s route, `HrAppShell.tsx`'s HR-only "Flags" tab, and `ui/FlagQueuePage.tsx` / `FlagQueueList.tsx` / `FlagDecisionPanel.tsx` — built by earlier tasks in this plan. This task does not modify any of them; it is the first thing to exercise their combined output in a browser.
  - `e2e/fixtures.ts`'s `stubFrappe(page)` (unmodified) and Playwright's last-registered-first route dispatch, which lets a per-test `page.route` override one method and `route.fallback()` the rest back to it — the pattern `attendance.spec.ts:49-66` already uses for `get_employee_calendar`.
- Produces: nothing — this is the terminal task in the plan. What it produces is the mergeable branch itself: a green `npm run test:e2e` across both Playwright projects, a green `npm run test:web`, a green backend suite, and the committed `dewey_time/public/hr_attendance/**` + `dewey_time/www/hr-*.html` rebuild Global Constraint 11 requires before any of this ships (CLAUDE.md's Deployment Notes: assets went un-rebuilt from #58 through #74 the last time this was skipped).

---

- [ ] **Step 1: Write `e2e/flags.spec.ts`**

The three copy anchors this file leans on hardest are all quoted directly from the design spec (`docs/superpowers/specs/2026-08-05-hr-flag-management-design.md`), on the theory that every task in this plan reads the same spec even though each only sees its own task section:

- Reason labels ("Approved leave or holiday", …) — spec's "`reason` vocabulary" section states them under a `Labels:` heading, not as illustrative prose.
- The bulk-decide button's live count, `"Excuse 39"` — spec's "Per-member exclusion on group decisions" paragraph.
- The partial-failure message, `"34 of 39 saved — 5 flags changed while you were deciding"` — spec's "Error handling" section, quoted as the literal `AttentionStrip` text.

Everything else this file needs to click through (the reason `combobox`, the exact wording around a page heading) is *not* pinned by the spec, so those locators are a best-effort first guess, exactly like the existing precedent in `e2e/audit-walk.spec.ts:105-106` ("locators may need adjusting at execution time"). Step 2 below is where that gets reconciled against the real DOM.

```typescript
import { test, expect } from "@playwright/test";
import { stubFrappe } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

// `/hr-flags` is not in hooks.py's `website_route_rules` (only `/hr-attendance`
// and `/hr-schedule` are — hooks.py:85-89) and has no `www/hr-flags.html`. That
// gap is real but out of this task's file list; it does not affect these tests
// because Playwright drives Vite's dev server (playwright.config.ts's
// `webServer`), and Vite's SPA fallback serves `index.html` for any path with
// no matching static file — direct navigation to `/hr-flags` works here
// regardless of the Frappe-side routing gap.

test("the flag queue renders groups and person rows with toolbar counts for HR staff", async ({
  page,
}) => {
  const queuePayload = {
    entries: [
      {
        kind: "group",
        group_type: "BRANCH_NO_DEVICE_DATA",
        group_key: "grp-device-siem-reap-2026-08-13",
        branch: "Siem Reap Depot",
        flag_code: null,
        attendance_date: "2026-08-13",
        rank: 140,
        tier: "act",
        members: [
          {
            employee: "EMP-301",
            employee_name: "Thida Sok",
            employee_branch: "Siem Reap Depot",
            attendance_date: "2026-08-13",
            rank: 140,
            tier: "act",
            flags: [
              {
                flag_identity: "AUTO-EMP-301-2026-08-13-attendance-issue-single_checkin",
                flag_code: "ATTENDANCE_ISSUE",
                severity: "WARNING",
                day_closed: 1,
                evidence: { reason: "single_checkin" },
                rank: 140,
                tier: "act",
                decision_state: "undecided",
                decision: null,
              },
            ],
            undecided_count: 1,
          },
          {
            employee: "EMP-302",
            employee_name: "Vireak Chan",
            employee_branch: "Siem Reap Depot",
            attendance_date: "2026-08-13",
            rank: 140,
            tier: "act",
            flags: [
              {
                flag_identity: "AUTO-EMP-302-2026-08-13-attendance-issue-single_checkin",
                flag_code: "ATTENDANCE_ISSUE",
                severity: "WARNING",
                day_closed: 1,
                evidence: { reason: "single_checkin" },
                rank: 140,
                tier: "act",
                decision_state: "undecided",
                decision: null,
              },
            ],
            undecided_count: 1,
          },
        ],
      },
      {
        kind: "group",
        group_type: "ROUTINE_CODE",
        group_key: "grp-routine-LATE_START-2026-08-14",
        branch: null,
        flag_code: "LATE_START",
        attendance_date: "2026-08-14",
        rank: 20,
        tier: "routine",
        members: [
          {
            employee: "EMP-401",
            employee_name: "Leng Ratha",
            employee_branch: "BRANCH-A",
            attendance_date: "2026-08-14",
            rank: 20,
            tier: "routine",
            flags: [
              {
                flag_identity: "AUTO-EMP-401-2026-08-14-late_start",
                flag_code: "LATE_START",
                severity: "WARNING",
                day_closed: 1,
                evidence: { minutes: 12 },
                rank: 20,
                tier: "routine",
                decision_state: "undecided",
                decision: null,
              },
            ],
            undecided_count: 1,
          },
          {
            employee: "EMP-402",
            employee_name: "Sopheak Meas",
            employee_branch: "BRANCH-A",
            attendance_date: "2026-08-14",
            rank: 20,
            tier: "routine",
            flags: [
              {
                flag_identity: "AUTO-EMP-402-2026-08-14-late_start",
                flag_code: "LATE_START",
                severity: "WARNING",
                day_closed: 1,
                evidence: { minutes: 25 },
                rank: 20,
                tier: "routine",
                decision_state: "undecided",
                decision: null,
              },
            ],
            undecided_count: 1,
          },
        ],
      },
      {
        kind: "person",
        employee: "EMP-001",
        employee_name: "Jane Doe",
        employee_branch: "BRANCH-A",
        attendance_date: "2026-08-15",
        rank: 150,
        tier: "act",
        flags: [
          {
            flag_identity: "AUTO-EMP-001-2026-08-15-unnotified_absence",
            flag_code: "UNNOTIFIED_ABSENCE",
            severity: "CRITICAL",
            day_closed: 1,
            evidence: {},
            rank: 150,
            tier: "act",
            decision_state: "undecided",
            decision: null,
          },
        ],
        undecided_count: 1,
      },
    ],
    counts: { open: 6, needs_re_review: 1, decided: 2, people: 5 },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  };

  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_flag_queue")) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: queuePayload }),
    });
  });

  await page.goto("/hr-flags");
  await expect(page).toHaveURL(/\/hr-flags/);
  await expect(page.getByText("Sign in required")).toHaveCount(0);

  // BRANCH_NO_DEVICE_DATA group: the design doc's cause-grouping rule 1
  // requires the branch name in the copy and explicitly forbids a device
  // serial — "Siem Reap Depot" is therefore guaranteed to appear somewhere in
  // this group's card.
  await expect(page.getByText(/Siem Reap Depot/).first()).toBeVisible();

  // ROUTINE_CODE group: same rule's copy example ("168 late starts, 6–20
  // min…") turns on the flag label, formatted through the shared
  // `formatFlagLabel` helper the design doc names explicitly
  // (flagLabels.ts — reused here and again in Test 3).
  await expect(page.getByText(/Late start/i).first()).toBeVisible();

  // Ungrouped person row: headlined by `employee_name` (contract `Person`)
  // and its worst flag's label.
  await expect(page.getByText("Jane Doe").first()).toBeVisible();
  await expect(page.getByText("Did not show up")).toBeVisible();

  // Toolbar counts (design doc, UI section: "Toolbar counts: Open · Explained
  // · Needs re-review · Decided". "Explained" is Spec 2 scope and is not a
  // key on this endpoint's `counts` dict, so it is not asserted here).
  await expect(page.getByText(/\bOpen\b/)).toBeVisible();
  await expect(page.getByText(/needs re-review/i)).toBeVisible();
  await expect(page.getByText(/\bDecided\b/)).toBeVisible();
});

test("a single decision persists after the queue refetches", async ({ page }, testInfo) => {
  // Same rationale as attendance.spec.ts:15-16's day-inspector test: deciding
  // a flag is a click-through interaction whose surface (panel vs. bottom
  // sheet) differs by breakpoint. Test 1 above already covers both projects
  // for plain rendering.
  test.skip(testInfo.project.name === "mobile", "decide interaction is desktop-only");

  const FLAG_IDENTITY = "AUTO-EMP-201-2026-08-13-late_start";
  const undecidedFlag = {
    flag_identity: FLAG_IDENTITY,
    flag_code: "LATE_START",
    severity: "WARNING",
    day_closed: 1,
    evidence: { minutes: 75 },
    rank: 65,
    tier: "review",
    decision_state: "undecided",
    decision: null,
  };
  const decidedFlag = {
    ...undecidedFlag,
    decision_state: "matched",
    decision: {
      name: "AFD-0001",
      outcome: "EXCUSED",
      reason: "APPROVED_LEAVE",
      note: null,
      decided_by: "hr@example.com",
      decided_at: "2026-08-13 09:00:00",
      group_key: "grp-single-0001",
    },
  };

  function personEntry(flag: typeof undecidedFlag, undecidedCount: number) {
    return {
      kind: "person",
      employee: "EMP-201",
      employee_name: "Noor Aziz",
      employee_branch: "BRANCH-A",
      attendance_date: "2026-08-13",
      rank: 65,
      tier: "review",
      flags: [flag],
      undecided_count: undecidedCount,
    };
  }

  const basePayload = {
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  };

  // Stateful mock: the queue reads undecided on the first GET (page load) and
  // decided on every GET after — the second call is the refetch the decide
  // write triggers, per the design doc's "queue refetches" language in Error
  // handling and per `_QUEUE_CACHE_TTL_SECONDS` being invalidated on write.
  let queueCalls = 0;
  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (p.includes("get_flag_queue")) {
      queueCalls += 1;
      const payload =
        queueCalls === 1
          ? { ...basePayload, entries: [personEntry(undecidedFlag, 1)], counts: { open: 1, needs_re_review: 0, decided: 0, people: 1 } }
          : { ...basePayload, entries: [personEntry(decidedFlag, 0)], counts: { open: 0, needs_re_review: 0, decided: 1, people: 1 } };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: payload }),
      });
    }

    if (p.includes("decide_flags")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { ok: true, written: 1, group_key: "grp-single-0001", errors: [] },
        }),
      });
    }

    return route.fallback();
  });

  await page.goto("/hr-flags");
  await expect(page.getByText("Noor Aziz").first()).toBeVisible();

  // Before deciding: neither the outcome word nor the reason label the
  // decision would carry is on the page yet — this is the "undecided" half
  // of the assertion, expressed as absence rather than by guessing the
  // undecided-state copy (which the design doc never quotes literally).
  await expect(page.getByText("Excused")).toHaveCount(0);
  await expect(page.getByText("Approved leave or holiday")).toHaveCount(0);

  await page.getByText("Noor Aziz").first().click();

  // Reason is the closed 7-item vocabulary (contract `REASONS`); its label
  // text is the design doc's own copy, quoted under a `Labels:` heading.
  await page.getByRole("combobox", { name: /reason/i }).click();
  await page.getByRole("option", { name: "Approved leave or holiday" }).click();

  // "Excuse" (optionally with a live count) both sets outcome=EXCUSED and
  // submits — the group-decide precedent for this exact button is "Excuse 39"
  // in the design doc's per-member-exclusion paragraph; for a single flag the
  // count is implicit.
  await page.getByRole("button", { name: /^Excuse\b/ }).click();

  // The write lands and react-query invalidates + refetches — this is the
  // second `get_flag_queue` call our route handler is keyed on.
  await expect(page.getByText("Approved leave or holiday")).toBeVisible();
  await expect(page.getByText("Excused")).toBeVisible();
  expect(queueCalls).toBeGreaterThanOrEqual(2);
});

test("a bulk decision with one stale row reports partial failure, politely", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "group bulk-decide interaction is desktop-only");

  const GROUP_KEY = "grp-routine-LATE_START-2026-08-14-bulk";
  const names = ["Aiko Tan", "Ben Souza", "Cleo Marsh", "Dara Sok", "Elan Rios"];

  function memberFlag(n: number) {
    return {
      flag_identity: `AUTO-EMP-5${n}-2026-08-14-late_start`,
      flag_code: "LATE_START",
      severity: "WARNING",
      day_closed: 1,
      evidence: { minutes: 15 + n },
      rank: 20,
      tier: "routine",
      decision_state: "undecided",
      decision: null,
    };
  }

  function member(n: number, name: string) {
    return {
      employee: `EMP-5${n}`,
      employee_name: name,
      employee_branch: "BRANCH-A",
      attendance_date: "2026-08-14",
      rank: 20,
      tier: "routine",
      flags: [memberFlag(n)],
      undecided_count: 1,
    };
  }

  const members = names.map((name, i) => member(i, name));
  // Two of five rows changed underneath the bulk action (their evidence no
  // longer matches — see the design doc's `evidence_fingerprint` staleness
  // guard) and are reported as errors; the other three still write.
  const staleIdentities = [members[3].flags[0].flag_identity, members[4].flags[0].flag_identity];

  const queuePayload = {
    entries: [
      {
        kind: "group",
        group_type: "ROUTINE_CODE",
        group_key: GROUP_KEY,
        branch: null,
        flag_code: "LATE_START",
        attendance_date: "2026-08-14",
        rank: 20,
        tier: "routine",
        members,
      },
    ],
    counts: { open: 5, needs_re_review: 0, decided: 0, people: 5 },
    orphans: { orphaned_flag_gone: 0, orphaned_evidence_changed: 0 },
    alerts: [],
    truncated: false,
    start_date: "2026-08-09",
    end_date: "2026-08-15",
  };

  await page.route("**/api/method/**", (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (p.includes("get_flag_queue")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: queuePayload }),
      });
    }

    if (p.includes("decide_flags")) {
      // 3 of 5 saved; the other 2 are reported back as errors — this mirrors
      // the design doc's Error handling example almost verbatim ("34 of 39
      // saved — 5 flags changed while you were deciding").
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: {
            ok: false,
            written: 3,
            group_key: GROUP_KEY,
            errors: staleIdentities.map((flag_identity) => ({
              flag_identity,
              error: "Flag no longer matches recorded evidence",
            })),
          },
        }),
      });
    }

    return route.fallback();
  });

  await page.goto("/hr-flags");
  // There is exactly one group entry in this payload, so its own flag-code
  // label ("Late start") is an unambiguous, single-match anchor for the
  // group's card before anything is selected — same locator Test 1 already
  // exercises for the same reason.
  await expect(page.getByText(/Late start/i).first()).toBeVisible();
  await page.getByText(/Late start/i).first().click();

  await page.getByRole("combobox", { name: /reason/i }).click();
  await page.getByRole("option", { name: "Approved leave or holiday" }).click();

  // All 5 members are checked by default (design doc: "Selecting a cause
  // group shows its members with checkboxes, all checked by default"), so
  // the live count on the bulk button reads 5 — "Excuse 5", the same pattern
  // as the design doc's "Excuse 39" example.
  await page.getByRole("button", { name: /Excuse.*5/i }).click();

  await expect(
    page.getByText(/3 of 5 saved.*2 flags changed while you were deciding/)
  ).toBeVisible();

  // Partial failure is Role 2 — AttentionStrip, role="status" — never Role 3
  // — FailureBlock, role="alert" (components/ui/notice.tsx:14-16: "role=
  // 'status' is polite on purpose: stale device data must not interrupt a
  // screen reader mid-sentence"). A write that half-succeeded is exactly that
  // case, not a hard failure, so no role="alert" element should exist at all.
  await expect(page.getByRole("alert")).toHaveCount(0);
});
```

- [ ] **Step 2: Run the new spec alone and reconcile locators against the live DOM**

By the time this task runs, Tasks 1–11 are already merged, so `/hr-flags` and its
queue/decide UI already exist — this is the first test that exercises them together, and
where the best-effort locators from Step 1 (the reason `combobox`'s accessible name, the
`Excuse`-button copy) either match or don't.

Run: `cd dewey_time/frontend/hr_attendance && npx playwright test e2e/flags.spec.ts --project=desktop`

Expected: FAIL — the most likely first failure is a locator timeout on
`page.getByRole("combobox", { name: /reason/i })` or `page.getByRole("button", { name: /^Excuse\b/ })`
in test 2, since those two names are this file's weakest guesses (the reason vocabulary's
*labels* are pinned by the design doc, but the *control* that presents them is not). Playwright's
error output prints the accessibility tree it searched — read the actual accessible name the real
`FlagDecisionPanel` renders and correct the locator text in `flags.spec.ts` to match it. Do not
weaken an assertion (e.g. dropping the `role="alert"` count check, or matching a looser substring
of the partial-failure sentence) to make it pass — only the locator text may change; every
assertion's target concept (branch name in a `BRANCH_NO_DEVICE_DATA` card, the reason label, the
"N of M saved" sentence, the absence of `role="alert"`) is pinned by the contract or the design doc
and stays fixed. Re-run until this command is green before moving on.

- [ ] **Step 3: Run the full e2e suite — no `--project` filter**

Run: `npm run test:e2e` (from `dewey_time/frontend/hr_attendance/`)

Expected: PASS. This runs every spec under `e2e/` across both Playwright projects declared in
`playwright.config.ts:19-21` — `desktop` and `mobile`. A `--project=desktop`-only run has hidden
real mobile breakage in this repo before; it does not satisfy this step. Report the total pass
count the reporter prints (e.g. `"48 passed (1.2m)"`).

- [ ] **Step 4: Run `npm run test:web` and report the delta**

Run: `npm run test:web` (from `dewey_time/frontend/hr_attendance/`)

Expected: PASS, and report the `# tests N` line from node:test's summary. The baseline on this
plan's parent commit (`98df8489`, before any task in this plan) is **336 tests, 336 passing** —
verified directly by running this same command before Task 1 started. The post-plan count must be
336 plus the sum of `test(` call sites across every test file this plan added or touched:
`src/lib/flagDecisionState.test.ts`, `src/lib/flagQueueLabels.test.ts`, `src/ui/flagQueuePage.test.tsx`.
Count them and check the arithmetic:

```bash
grep -c 'test(' \
  dewey_time/frontend/hr_attendance/src/lib/flagDecisionState.test.ts \
  dewey_time/frontend/hr_attendance/src/lib/flagQueueLabels.test.ts \
  dewey_time/frontend/hr_attendance/src/ui/flagQueuePage.test.tsx
```

If the reported total is short of `336 + <that sum>`, a test file landed outside `src/lib/` or
`src/ui/` — Global Constraint 10's glob is not recursive and silently drops it. This is exactly
what Step 8's checklist re-verifies independently below; a mismatch here is the earlier, cheaper
place to catch it.

- [ ] **Step 5: Run the backend suite**

Run: `bench --site <site> run-tests --app dewey_time` (from the bench directory — no bench exists
in this repo; see the `frappe-sandbox` skill for a disposable local one if none is already set up
for this branch)

Expected: PASS, 0 failures, 0 errors. Report the count Frappe's runner prints
(`Ran N tests in Xs — OK`). Unlike Step 4, there is no pre-measured baseline for this command in
this plan section — no bench is present to run it against ahead of time — so just confirm green
and report N.

- [ ] **Step 6: Rebuild the SPA**

Run: `npm run build` (from `dewey_time/frontend/hr_attendance/`)

Expected: exits 0. This runs `vite build --base=/assets/dewey_time/hr_attendance/` followed by
`node scripts/copy-html-entry.mjs` (`package.json:8`), which regenerates
`dewey_time/public/hr_attendance/**` and rewrites the asset-versioned script/style tags into
`dewey_time/www/hr-attendance.html` and `dewey_time/www/hr-schedule.html`
(`scripts/copy-html-entry.mjs:9-12`). Confirm `git status` shows changes under
`dewey_time/public/hr_attendance/` and both `www/hr-*.html` files — CLAUDE.md's Deployment Notes
are explicit that a merged PR touching `frontend/` without a rebuilt `public/hr_attendance/` ships
nothing (assets went un-rebuilt from #58 through #74 the last time this was missed).

- [ ] **Step 7: Commit**

```bash
git add \
  dewey_time/frontend/hr_attendance/e2e/flags.spec.ts \
  dewey_time/public/hr_attendance \
  dewey_time/www/hr-attendance.html \
  dewey_time/www/hr-schedule.html
git commit -m "$(cat <<'EOF'
test(hr-flags): add e2e coverage for the flag queue, rebuild HR SPA assets

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Verification checklist — execute each item and report the actual output, not a restated assertion**

1. **Every new frontend test file lives directly in `src/lib/` or `src/ui/`** (Global Constraint
   10 — the `test:web` glob in `package.json:10` is not recursive):

   ```bash
   find dewey_time/frontend/hr_attendance/src -iname "*flag*test*"
   ```

   Every path in the output must end in exactly `.../src/lib/<name>.test.ts` or
   `.../src/ui/<name>.test.tsx` — none in `services/`, none nested one level deeper. Paste the
   full list.

2. **The `# tests N` count went up by exactly the number of tests this plan added.** Re-state the
   arithmetic from Step 4: baseline `336`, plus the `grep -c 'test('` sum from that step, versus
   the actual post-build `# tests N`. Paste all three numbers; they must reconcile.

3. **`patches.txt` names the new migration patch:**

   ```bash
   grep -n "migrate_legacy_flag_decisions" dewey_time/patches.txt
   ```

   Must return a match (`dewey_time.patches.migrate_legacy_flag_decisions`, appended after the
   existing 20 lines). Paste the match. A patch file that exists on disk but is not registered
   here never runs (Global Constraint 12) — `bench migrate` will silently skip it.

4. **`attendance_flag.json`'s `modified` timestamp was bumped:**

   ```bash
   grep -n '"modified"' dewey_time/dewey_time/doctype/attendance_flag/attendance_flag.json
   ```

   The pre-plan value (verified directly before Task 1 started) was
   `"modified": "2026-07-30 18:00:00.000000"`. The value here must be later than that, or
   `bench migrate` skips the schema reimport and the `search_index` fields Task 4 added never
   apply to a real site (Global Constraint 13 — this is the documented, previously-hit trap the
   `frappe-doctype-modified-reimport` memory note describes, not a hypothetical).

---

