# Mini App Profile Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Mini App's Schedule tab with a Profile tab that shows an employee their own record — biometric enrolment, work details, contact on file, month stats — with the existing week roster kept intact at the bottom.

**Architecture:** A new POST-only `get_my_profile` endpoint beside `get_my_calendar`, projecting Employee and `Employee Biometric Enrollment` through explicit allowlists. A pure `finger_slots` module turns ZKTeco finger indexes into translatable slugs; the register gains a `finger_ids` column that stays empty until the bridge repo starts sending it. The client is a scrolling page composed from a row primitive that omits empty fields, plus the untouched `MySchedulePage` mounted at the bottom.

**Tech Stack:** Frappe v16 (Python 3.14, `unittest`), React 19 + TanStack Query + Tailwind v4, `node:test` via `tsx`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-17-miniapp-profile-tab-design.md`

## Global Constraints

- **Allowlists, never removals.** Every field an employee receives is named in an
  explicit tuple/frozenset and pinned by an **equality** assertion. "Assert X is
  absent" fails open and is not acceptable.
- **`miniapp_auth.employee_from_init_data(init_data)` is the first statement** of
  any whitelisted Mini App endpoint, before range checks or DB reads.
- **`@frappe.whitelist(allow_guest=True, methods=["POST"])`** verbatim — without
  `methods`, Frappe also serves GET and `init_data` lands in access logs.
- **No employee-selecting parameter.** `get_my_profile`'s only parameter is
  `init_data`. Adding one needs its own authorization design.
- **Amber is never `destructive`.** Warnings use `text-amber-500`; red is
  reserved for irreversible actions.
- **Every new string goes in both `EN` and `KM`.** `StringKey = keyof typeof EN`
  makes a missing Khmer key a `tsc` error. Khmer here is literal and unreviewed
  — it joins the outstanding native-speaker review, and every state must read as
  a statement about the RECORD, never a judgement on the person.
- **The DocType's `modified` timestamp must be bumped** when its JSON changes, or
  `bench migrate` skips the schema reimport and the column never appears.
- **Never bare `git stash` / `git stash pop`** — the stash stack is shared with
  other worktrees. Use a WIP commit instead.
- **Commit trailers**, on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
  ```
- **Built assets are the deployed artifact** — but do NOT build in these tasks.
  The branch's final build+commit happens once, at the end, not per task.
- **Check the printed test count rose.** `Ran N tests` for the backend,
  `# tests N` for `tsx --test`. A suite that never ran also reports green.

**Backend test commands.** Local, fast: `python3 -m unittest dewey_time.tests.test_X -v`
(run from the repo root). CI parity: `bench --site <site> run-tests --app dewey_time`.
If a local run behaves impossibly, clear both bytecode caches: `find . -name __pycache__ -exec rm -rf {} +`
and `rm -rf ~/Library/Caches/com.apple.python`.

**Frontend test commands.** `npm run test:web` and `npx tsc --noEmit` from
`dewey_time/frontend/hr_attendance/`. E2E: `npx playwright test e2e/miniapp.spec.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `dewey_time/attendance_engine/finger_slots.py` | **New.** Pure, frappe-free. ZKTeco FID ↔ slug and the stored-string codec. The one place the finger convention lives. |
| `dewey_time/tests/test_finger_slots.py` | **New.** The table, the codec, the fallback. |
| `.../doctype/employee_biometric_enrollment/employee_biometric_enrollment.json` | Gains `finger_ids`. |
| `dewey_time/attendance_engine/enrollment.py` | `finger_ids` through upsert / aggregate / clear. |
| `dewey_time/attendance_engine/enrollment_api.py` | `enrollment_status` returns parsed `finger_ids`. |
| `dewey_time/telegram/miniapp_api.py` | `get_my_profile` + three allowlists + the biometric state machine. |
| `src/miniapp/miniProfile.ts` | **New.** Pure client logic: the finger allowlist, the names-vs-count rule, service length, month stats. |
| `src/miniapp/miniIntl.ts` | `formatServiceLength`, beside `formatWorkedMinutes`. |
| `src/miniapp/MiniLocale.tsx` | `service` on `MiniFormat`. |
| `src/miniapp/miniStrings.ts` | 41 new keys; `tabSchedule` removed in Task 6. |
| `src/miniapp/MiniProfileRow.tsx` | **New.** `ProfileHeading`, `ProfileSection`, and the omit-when-empty rule. |
| `src/miniapp/MyProfilePage.tsx` | **New.** Composes the five blocks. |
| `src/miniapp/useMiniAppSession.ts` | `MiniProfile` type + `useMyProfile`. |
| `src/miniapp/MiniAppShell.tsx` | Tab rename and mount. |
| `src/miniapp/MySchedulePage.tsx` | Padding removed; nothing else. |

---

## Task 1: The finger-slot table

A pure module with no bench behind it, so the one convention most likely to be
wrong is testable in milliseconds and correctable in one place.

**Files:**
- Create: `dewey_time/attendance_engine/finger_slots.py`
- Test: `dewey_time/tests/test_finger_slots.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FINGER_SLUGS: dict[int, str]` — ten entries, keys 0–9
  - `UNKNOWN_SLUG = "other_finger"`
  - `slug_for(fid) -> str`
  - `ids_from_field(value) -> list[int]` — parses the stored `"3,6"`, order preserved
  - `normalize_ids(value) -> list[int]` — a wire value (list or string) sorted and deduped
  - `field_from_ids(value) -> str` — the storage form, `"3,6"`

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_finger_slots.py`:

```python
"""The finger-slot table — the one convention in this feature most likely wrong.

Deliberately imports no frappe mock: finger_slots is frappe-free, and keeping
it that way is what makes this file run in milliseconds.
"""

import unittest

from dewey_time.attendance_engine import finger_slots


class TestSlugFor(unittest.TestCase):
    def test_every_device_slot_has_a_name(self):
        self.assertEqual(
            [finger_slots.slug_for(i) for i in range(10)],
            [
                "left_little", "left_ring", "left_middle", "left_index", "left_thumb",
                "right_thumb", "right_index", "right_middle", "right_ring", "right_little",
            ],
        )

    def test_the_hands_mirror_around_the_thumbs(self):
        # The ordering is the whole point of the table and the single thing most
        # likely to be wrong. A device counts inwards from the left little
        # finger to the left thumb, then outwards from the right thumb. This
        # catches a table someone "tidied" into left-to-right 0..9, which reads
        # perfectly plausible and is wrong on five fingers.
        self.assertEqual(finger_slots.slug_for(4), "left_thumb")
        self.assertEqual(finger_slots.slug_for(5), "right_thumb")
        self.assertEqual(finger_slots.slug_for(0), "left_little")
        self.assertEqual(finger_slots.slug_for(9), "right_little")

    def test_a_slot_the_devices_do_not_have_is_named_rather_than_dropped(self):
        # A fallback, not a drop. The client shows names ONLY when their count
        # equals fingerprint_count, so dropping one strange value would demote a
        # whole correct list back to a bare number.
        for junk in (10, -1, None, "", "x", "3.5", []):
            with self.subTest(value=repr(junk)):
                self.assertEqual(finger_slots.slug_for(junk), "other_finger")

    def test_the_table_has_exactly_ten_slots_and_no_gaps(self):
        self.assertEqual(sorted(finger_slots.FINGER_SLUGS), list(range(10)))
        self.assertEqual(len(set(finger_slots.FINGER_SLUGS.values())), 10)


class TestStoredField(unittest.TestCase):
    def test_the_stored_string_parses_back_to_ints(self):
        self.assertEqual(finger_slots.ids_from_field("3,6"), [3, 6])

    def test_an_empty_field_is_no_fingers_rather_than_an_error(self):
        for empty in (None, "", "   ", ",,"):
            with self.subTest(value=repr(empty)):
                self.assertEqual(finger_slots.ids_from_field(empty), [])

    def test_a_junk_entry_is_skipped_and_the_rest_survive(self):
        # Bridge payloads are wire data. One bad element must not cost the
        # others -- the rule enrollment._coerce_int already follows.
        self.assertEqual(finger_slots.ids_from_field("x, 3 ,,6"), [3, 6])

    def test_writing_dedupes_and_sorts_so_a_row_is_stable(self):
        # The register row is saved on every snapshot. An unstable ordering
        # would rewrite `modified` on hundreds of rows that did not change.
        self.assertEqual(finger_slots.field_from_ids([6, 3, 3]), "3,6")

    def test_writing_nothing_is_an_empty_string_not_the_word_none(self):
        self.assertEqual(finger_slots.field_from_ids(None), "")
        self.assertEqual(finger_slots.field_from_ids([]), "")

    def test_a_wire_value_may_arrive_as_a_string_or_a_list(self):
        self.assertEqual(finger_slots.normalize_ids("6,3"), [3, 6])
        self.assertEqual(finger_slots.normalize_ids([6, "3"]), [3, 6])
        self.assertEqual(finger_slots.normalize_ids(None), [])

    def test_a_round_trip_survives_both_directions(self):
        self.assertEqual(
            finger_slots.ids_from_field(finger_slots.field_from_ids([6, 3])),
            [3, 6],
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m unittest dewey_time.tests.test_finger_slots -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'dewey_time.attendance_engine.finger_slots'`

- [ ] **Step 3: Write the implementation**

Create `dewey_time/attendance_engine/finger_slots.py`:

```python
"""ZKTeco finger indexes, as slugs the Mini App can translate.

A device numbers fingers 0-9, inwards from the left little finger to the left
thumb and then outwards from the right thumb. That integer is meaningless to an
employee and untranslatable -- "FID 6" is the same six characters in Khmer -- so
it is turned into a slug HERE, once, on the server. The Mini App turns a slug
into words.

THE MAPPING IS UNVERIFIED AGAINST A REAL DEVICE. It is the widely-used ZKTeco
ordering, but nothing in this repo confirms it and no data exercises it yet: the
bridge collapses templates to a count before Frappe ever sees them
(frappe-merge.ts:70). Check it against a live enrolment before the bridge side
ships, and correct it here -- being able to correct it in ONE place, in one
language, is the entire reason this mapping is not done in TypeScript.

frappe-free on purpose: no bench behind it, so its tests run in milliseconds and
any module may import it.
"""

from __future__ import annotations

#: FID -> slug. Ten entries, no gaps.
FINGER_SLUGS = {
    0: "left_little",
    1: "left_ring",
    2: "left_middle",
    3: "left_index",
    4: "left_thumb",
    5: "right_thumb",
    6: "right_index",
    7: "right_middle",
    8: "right_ring",
    9: "right_little",
}

#: Anything outside 0-9, or unparseable.
#:
#: A FALLBACK, never a drop. The client shows finger names only when their count
#: equals `fingerprint_count`, so silently dropping one strange value would
#: demote an otherwise correct list back to a bare number.
UNKNOWN_SLUG = "other_finger"


def slug_for(fid) -> str:
    """One device slot as a slug. Never raises."""
    try:
        return FINGER_SLUGS[int(fid)]
    except (TypeError, ValueError, KeyError):
        return UNKNOWN_SLUG


def ids_from_field(value) -> list[int]:
    """Parse the stored "3,6" into [3, 6]. Junk entries are skipped.

    Order is preserved rather than re-sorted: `field_from_ids` already sorts on
    the way in, and sorting again here would hide a writer that did not.
    """
    ids = []
    for part in str(value or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            continue
    return ids


def normalize_ids(value) -> list[int]:
    """A wire value -- a list of ints, or a "3,6" string -- sorted and deduped.

    Both shapes are accepted because the bridge's payload is not settled: it
    sends neither today, and a future version could reasonably send either.
    """
    if isinstance(value, str):
        value = ids_from_field(value)
    seen = set()
    for item in value or []:
        try:
            seen.add(int(item))
        except (TypeError, ValueError):
            continue
    return sorted(seen)


def field_from_ids(value) -> str:
    """The storage form: "3,6", sorted and deduped, or "" for nothing."""
    return ",".join(str(i) for i in normalize_ids(value))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_finger_slots -v`
Expected: PASS, `Ran 11 tests`

- [ ] **Step 5: Verify the guard can fail**

Temporarily swap `4: "left_thumb"` and `5: "right_thumb"` in `FINGER_SLUGS`.
Run the suite. Expected: `test_the_hands_mirror_around_the_thumbs` and
`test_every_device_slot_has_a_name` both FAIL. Revert the swap.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/attendance_engine/finger_slots.py dewey_time/tests/test_finger_slots.py
git commit -m "$(cat <<'EOF'
feat(enrollment): a finger index becomes a slug the app can translate

A ZKTeco device numbers fingers 0-9. That integer cannot be shown to an
employee and cannot be translated, so it is mapped to one of ten slugs on
the server -- in one place, in one language, because the ordering is
unverified against a real device and will need correcting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 2: `finger_ids` through the enrollment register

Storage, ingest, merge, **clear**, and the read seam. The clear path is the
load-bearing half: without it a device wipe zeroes the counts and leaves a stale
finger list, and Profile would render "Right index" beside "Not set up".

**Files:**
- Modify: `dewey_time/dewey_time/doctype/employee_biometric_enrollment/employee_biometric_enrollment.json`
- Modify: `dewey_time/attendance_engine/enrollment.py`
- Modify: `dewey_time/attendance_engine/enrollment_api.py:246-264`
- Test: `dewey_time/tests/test_enrollment_ingest.py`
- Test: `dewey_time/tests/test_enrollment_api.py`

**Interfaces:**
- Consumes: `finger_slots.normalize_ids`, `finger_slots.field_from_ids`,
  `finger_slots.ids_from_field` from Task 1.
- Produces:
  - `upsert_enrollment_row(*, employee, pin=None, is_registered=False, fingerprint_count=None, face_count=None, finger_ids=None, synced_at=None, bridge_env=None) -> str`
  - `enrollment_status(employee) -> dict` now also carries
    `"finger_ids": list[int]`

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_enrollment_ingest.py` (inside the existing
snapshot test class, which already exposes `self.upserts` and `self.cleared`):

```python
    def test_a_snapshot_carrying_finger_slots_stores_them(self):
        self._run([
            {"frappe_employee_id": "EMP-1", "pin": "1", "is_registered": True,
             "fingerprint_count": 2, "finger_ids": [6, 3]},
        ])
        self.assertEqual(self.upserts[0]["finger_ids"], [3, 6])

    def test_a_snapshot_without_finger_slots_stores_none(self):
        # What the bridge sends TODAY. Absent means empty, exactly as an absent
        # count means 0 -- never "leave whatever was there".
        self._run([
            {"frappe_employee_id": "EMP-1", "pin": "1", "is_registered": True,
             "fingerprint_count": 2},
        ])
        self.assertEqual(self.upserts[0]["finger_ids"], [])

    def test_two_pins_for_one_person_union_their_slots(self):
        # Same rule the flags and counts already follow: enrolled on any device
        # is enrolled. Taking the last row's list would drop templates that
        # exist on the other device.
        self._run([
            {"frappe_employee_id": "EMP-1", "pin": "1", "is_registered": True,
             "fingerprint_count": 1, "finger_ids": [6]},
            {"frappe_employee_id": "EMP-1", "pin": "2", "is_registered": True,
             "fingerprint_count": 1, "finger_ids": [3]},
        ])
        self.assertEqual(len(self.upserts), 1)
        self.assertEqual(self.upserts[0]["finger_ids"], [3, 6])
```

Add a new class to the same file:

```python
class TestClearAbsentRowsBlanksFingerSlots(unittest.TestCase):
    """THE STALE-LIST GUARD.

    A row cleared because the device no longer knows this person keeps its pin
    for provenance -- but it must NOT keep its finger list. is_registered goes
    to 0 and the counts go to 0; a surviving "3,6" would have the Mini App
    rendering "Right index, Right thumb" directly beside "Not set up".
    """

    def test_clearing_a_row_also_clears_its_finger_slots(self):
        writes = {}

        def _set_value(doctype, docname, values, **kwargs):
            writes[docname] = values

        with patch.object(mod.frappe.db, "set_value", side_effect=_set_value):
            mod._clear_absent_rows(["EMP-1"], synced_at="2026-08-17 09:00:00",
                                   bridge_env="prod")

        self.assertEqual(writes["EMP-1"]["finger_ids"], "")
        self.assertEqual(writes["EMP-1"]["is_registered"], 0)
        self.assertEqual(writes["EMP-1"]["fingerprint_count"], 0)


class TestUpsertStoresTheFieldForm(unittest.TestCase):
    def test_a_list_of_ids_is_stored_as_the_sorted_string(self):
        # The update path writes by setattr on the fetched doc, so the stored
        # form reads straight off the mock.
        doc = MagicMock()

        with patch.object(mod.frappe.db, "get_value", return_value="EMP-1"), \
             patch.object(mod.frappe, "get_doc", return_value=doc):
            mod.upsert_enrollment_row(
                employee="EMP-1", is_registered=True,
                fingerprint_count=2, finger_ids=[6, 3],
            )

        self.assertEqual(doc.finger_ids, "3,6")

    def test_no_ids_is_stored_as_an_empty_string_not_none(self):
        # The clear path writes "". These two must not diverge, or a row's
        # emptiness would depend on which path last touched it.
        doc = MagicMock()

        with patch.object(mod.frappe.db, "get_value", return_value="EMP-1"), \
             patch.object(mod.frappe, "get_doc", return_value=doc):
            mod.upsert_enrollment_row(employee="EMP-1", is_registered=False)

        self.assertEqual(doc.finger_ids, "")
```

Append to `dewey_time/tests/test_enrollment_api.py`:

```python
class TestEnrollmentStatusFingerSlots(unittest.TestCase):
    def test_the_seam_returns_parsed_ints_not_the_stored_string(self):
        # The stored "3,6" is a storage detail. Every consumer would otherwise
        # re-parse it, and one of them would get it wrong.
        row = {"employee": "EMP-1", "is_registered": 1, "fingerprint_count": 2,
               "face_count": 0, "synced_at": "2026-08-17 06:00:00",
               "finger_ids": "3,6"}
        with patch.object(mod.frappe.db, "get_value", return_value=row), \
             patch.object(mod, "_last_snapshot_at", return_value="2026-08-17 06:00:00"):
            status = mod.enrollment_status("EMP-1")
        self.assertEqual(status["finger_ids"], [3, 6])

    def test_a_row_with_no_slots_yields_an_empty_list_not_none(self):
        row = {"employee": "EMP-1", "is_registered": 1, "fingerprint_count": 2,
               "face_count": 0, "synced_at": None, "finger_ids": None}
        with patch.object(mod.frappe.db, "get_value", return_value=row), \
             patch.object(mod, "_last_snapshot_at", return_value=None):
            status = mod.enrollment_status("EMP-1")
        self.assertEqual(status["finger_ids"], [])

    def test_a_site_without_the_column_yet_does_not_raise(self):
        # bench migrate has not run. Losing one row must not take the tab down.
        with patch.object(mod.frappe.db, "has_column", return_value=False), \
             patch.object(mod.frappe.db, "get_value", return_value=None), \
             patch.object(mod, "_last_snapshot_at", return_value=None):
            status = mod.enrollment_status("EMP-1")
        self.assertEqual(status["finger_ids"], [])
```

Both files already import `MagicMock` and `patch` and alias their module as
`mod` (`test_enrollment_ingest.py:1-8`, `test_enrollment_api.py:1-9`), so these
blocks drop in as written.

- [ ] **Step 2: Run tests to verify they fail**

Run:
```
python3 -m unittest dewey_time.tests.test_enrollment_ingest dewey_time.tests.test_enrollment_api -v
```
Expected: FAIL — `KeyError: 'finger_ids'` on the upsert assertions and
`AssertionError` on the status assertions.

- [ ] **Step 3: Add the DocType field**

In `employee_biometric_enrollment.json`, add `"finger_ids"` to `field_order`
immediately after `"fingerprint_count"`:

```json
 "field_order": [
  "employee",
  "pin",
  "is_registered",
  "column_break_1",
  "fingerprint_count",
  "finger_ids",
  "face_count",
  "synced_at",
  "bridge_env"
 ],
```

Add the field definition immediately after the `fingerprint_count` entry in
`fields`:

```json
  {
   "description": "Comma-separated ZKTeco finger indexes, e.g. \"3,6\". Written by the bridge snapshot; empty until the bridge sends finger_id.",
   "fieldname": "finger_ids",
   "fieldtype": "Small Text",
   "label": "Fingerprint Slots",
   "read_only": 1
  },
```

Bump `modified` — **without this, `bench migrate` skips the reimport and the
column never appears**:

```json
 "modified": "2026-08-17 00:00:00.000000",
```

- [ ] **Step 4: Wire it through `enrollment.py`**

Add the import beside the existing ones:

```python
from dewey_time.attendance_engine import finger_slots
from dewey_time.attendance_engine.bridge_auth import validate_bridge_request
```

In `upsert_enrollment_row`, add the keyword and the value:

```python
def upsert_enrollment_row(
    *,
    employee: str,
    pin=None,
    is_registered: bool = False,
    fingerprint_count=None,
    face_count=None,
    finger_ids=None,
    synced_at=None,
    bridge_env=None,
) -> str:
```

```python
    values = {
        "employee": employee,
        "pin": pin,
        # Frappe Check fields are 0/1. A bool round-trips through the ORM but
        # compares badly in db filters such as {"is_registered": 1}.
        "is_registered": 1 if is_registered else 0,
        "fingerprint_count": _coerce_int(fingerprint_count),
        # Stored sorted and deduped so a snapshot that changed nothing does not
        # rewrite `modified` on hundreds of rows.
        "finger_ids": finger_slots.field_from_ids(finger_ids),
        "face_count": _coerce_int(face_count),
        "synced_at": synced_at,
        "bridge_env": bridge_env,
    }
```

In `_aggregate_by_employee`, the first-seen branch:

```python
            merged[employee] = {
                "frappe_employee_id": employee,
                "pin": user.get("pin"),
                "is_registered": _coerce_bool(user.get("is_registered")),
                "fingerprint_count": _coerce_int(user.get("fingerprint_count")),
                "face_count": _coerce_int(user.get("face_count")),
                "finger_ids": finger_slots.normalize_ids(user.get("finger_ids")),
            }
```

…and the duplicate branch, as a UNION — the same rule as OR-the-flags:

```python
        current["face_count"] = max(
            current["face_count"], _coerce_int(user.get("face_count"))
        )
        # UNION, not replace. Enrolled on any device is enrolled, so a template
        # that exists only on the other device is still one of this person's
        # fingers -- taking the last row's list would silently drop it.
        current["finger_ids"] = finger_slots.normalize_ids(
            current["finger_ids"] + finger_slots.normalize_ids(user.get("finger_ids"))
        )
```

In `_clear_absent_rows`, extend the update dict and its docstring:

```python
            {
                "is_registered": 0,
                "fingerprint_count": 0,
                "face_count": 0,
                # Cleared with the counts, and this is the load-bearing one: a
                # surviving "3,6" beside is_registered=0 would have the Mini App
                # naming two fingers directly under the words "Not set up".
                "finger_ids": "",
                "synced_at": synced_at,
                "bridge_env": bridge_env,
            },
```

In the snapshot loop that calls `upsert_enrollment_row` (around line 329), pass
it through:

```python
            fingerprint_count=entry["fingerprint_count"],
            face_count=entry["face_count"],
            finger_ids=entry["finger_ids"],
```

- [ ] **Step 5: Return it from the read seam**

In `enrollment_api.py`, add the import and widen `enrollment_status`:

```python
from dewey_time.attendance_engine import finger_slots
```

```python
    fields = ["employee", "is_registered", "fingerprint_count", "face_count", "synced_at"]
    # Guarded, like _identity guards the Khmer name pair: a site whose migrate
    # has not run yet would make the whole select raise, taking the Profile tab
    # down to lose one optional row.
    if frappe.db.has_column(ENROLLMENT_DOCTYPE, "finger_ids"):
        fields.append("finger_ids")

    row = frappe.db.get_value(
        ENROLLMENT_DOCTYPE,
        {"employee": employee},
        fields,
        as_dict=True,
    )
    return {
        "employee": employee,
        "is_registered": bool(row and row.get("is_registered")),
        "fingerprint_count": int((row or {}).get("fingerprint_count") or 0),
        "face_count": int((row or {}).get("face_count") or 0),
        # PARSED here, not at each consumer: "3,6" is a storage detail and every
        # caller re-parsing it is one caller getting it wrong.
        "finger_ids": finger_slots.ids_from_field((row or {}).get("finger_ids")),
        "synced_at": (row or {}).get("synced_at"),
        "last_snapshot_at": _last_snapshot_at(),
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
```
python3 -m unittest dewey_time.tests.test_enrollment_ingest dewey_time.tests.test_enrollment_api dewey_time.tests.test_finger_slots -v
```
Expected: PASS. Note the totals — both files gain tests.

- [ ] **Step 7: Verify the stale-list guard can fail**

Delete the `"finger_ids": ""` line from `_clear_absent_rows`. Run
`python3 -m unittest dewey_time.tests.test_enrollment_ingest -v`. Expected:
`test_clearing_a_row_also_clears_its_finger_slots` FAILS with `KeyError`.
Restore the line.

- [ ] **Step 8: Run the full backend suite**

Run: `python3 -m unittest discover -s dewey_time/tests -t . -v 2>&1 | tail -5`
Expected: no new failures, and `Ran N tests` higher than before this task.

- [ ] **Step 9: Commit**

```bash
git add dewey_time/dewey_time/doctype/employee_biometric_enrollment/employee_biometric_enrollment.json \
        dewey_time/attendance_engine/enrollment.py \
        dewey_time/attendance_engine/enrollment_api.py \
        dewey_time/tests/test_enrollment_ingest.py \
        dewey_time/tests/test_enrollment_api.py
git commit -m "$(cat <<'EOF'
feat(enrollment): the register can hold which fingers, and can forget them

The bridge does not send finger slots yet, so this column stays empty. It
is added now with its whole lifecycle -- ingest, union across duplicate
PINs, and clearing -- because adding the storage without the clear is what
produces a row reading "Right index" beside "Not set up" the first time
somebody's templates are wiped at the device.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 3: The `get_my_profile` endpoint

**Files:**
- Modify: `dewey_time/telegram/miniapp_api.py`
- Test: `dewey_time/tests/test_telegram_miniapp_api.py`

**Interfaces:**
- Consumes: `finger_slots.slug_for` (Task 1), `enrollment_api.enrollment_status`
  returning `finger_ids: list[int]` (Task 2), the existing `_identity(employee)`.
- Produces: `get_my_profile(init_data: str) -> dict` at the dotted path
  `dewey_time.telegram.miniapp_api.get_my_profile`, with exactly these keys:
  `employee`, `employee_name`, `khmer_name`, `designation`, `image`,
  `department`, `employment_type`, `date_of_joining`, `branch`,
  `reports_to_name`, `cell_number`, `personal_email`, `biometric`.
  `biometric` has exactly `state`, `fingers`, `fingerprint_count`, `face`,
  `checked_at`.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_telegram_miniapp_api.py`:

```python
#: An Employee row as the DB would hand it back, including columns this app
#: must never ship. All three of these live on the real Employee doctype.
EMPLOYEE_ROW = {
    "employee_name": "Sok Dara",
    "designation": "Cashier",
    "image": "/files/dara.jpg",
    "custom_khmer_last_name": "សុខ",
    "custom_khmer_first_name": "ដារា",
    "department": "Retail",
    "employment_type": "Full-time",
    "date_of_joining": "2024-03-12",
    "branch": "DIS Iconic",
    "cell_number": "012 345 678",
    "personal_email": "dara.sok@gmail.com",
    "reports_to": "HR-EMP-00002",
    "date_of_birth": "1994-02-02",
    "passport_number": "N1234567",
    "salary_mode": "Bank",
}

ENROLLED = {
    "employee": "HR-EMP-00001",
    "is_registered": True,
    "fingerprint_count": 2,
    "face_count": 0,
    "finger_ids": [3, 6],
    "synced_at": "2026-08-17 06:00:00",
    "last_snapshot_at": "2026-08-17 06:05:00",
}


class _ProfileHarness(unittest.TestCase):
    """Drive get_my_profile with the DB and the enrolment seam stubbed out."""

    def _profile(self, row=None, status=None, has_column=None):
        row = EMPLOYEE_ROW if row is None else row
        status = ENROLLED if status is None else status
        self.asked_for = []

        def _get_value(doctype, name, fields, as_dict=False):
            if doctype != "Employee":
                return None
            if as_dict:
                self.asked_for.append(tuple(fields))
                return {k: row[k] for k in fields if k in row}
            # The single-field reads: reports_to, then the manager's name.
            if fields == "reports_to":
                return row.get("reports_to")
            if fields == "employee_name":
                return "Chan Sophea"
            return None

        column = (lambda _dt, field: True) if has_column is None else has_column

        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00001"), \
             patch.object(miniapp_api.enrollment_api, "enrollment_status",
                          return_value=status), \
             patch.object(miniapp_api.frappe.db, "get_value", side_effect=_get_value), \
             patch.object(miniapp_api.frappe.db, "has_column", side_effect=column):
            return miniapp_api.get_my_profile("initdata")


class TestProfileSignatureGuard(unittest.TestCase):
    def test_the_endpoint_accepts_no_employee_selecting_parameter(self):
        # The same property, and the same reason, as get_my_calendar's guard:
        # this dies to a reasonable-looking edit adding `employee=None` for a
        # manager view, not to an attack. Resolving another employee needs its
        # own authorization design, not a new parameter.
        params = set(inspect.signature(miniapp_api.get_my_profile).parameters)
        self.assertEqual(params, {"init_data"})

    def test_both_endpoints_are_post_only(self):
        src = (
            pathlib.Path(__file__).resolve().parents[1]
            / "telegram" / "miniapp_api.py"
        ).read_text()
        self.assertEqual(
            src.count('@frappe.whitelist(allow_guest=True, methods=["POST"])'), 2
        )


class TestProfileProjection(_ProfileHarness):
    def test_the_key_set_is_exactly_the_allowlist(self):
        self.assertEqual(
            set(self._profile()),
            {
                "employee", "employee_name", "khmer_name", "designation", "image",
                "department", "employment_type", "date_of_joining", "branch",
                "reports_to_name", "cell_number", "personal_email", "biometric",
            },
        )

    def test_the_select_never_asks_for_a_field_outside_the_allowlist(self):
        # Stronger than checking the response: this fails if someone widens the
        # query "just to have it", before anything renders it.
        self._profile()
        asked = {field for fields in self.asked_for for field in fields}
        for forbidden in ("date_of_birth", "passport_number", "salary_mode"):
            self.assertNotIn(forbidden, asked)

    def test_a_field_added_to_employee_later_is_hidden_by_default(self):
        row = dict(EMPLOYEE_ROW, custom_disciplinary_note="final warning")
        self.assertNotIn("custom_disciplinary_note", self._profile(row=row))

    def test_the_manager_is_named_and_never_identified(self):
        # A docname is another employee's identifier. The name is the answer to
        # "who do I tell if I'm sick"; the id is not.
        profile = self._profile()
        self.assertEqual(profile["reports_to_name"], "Chan Sophea")
        self.assertNotIn("reports_to", profile)

    def test_no_manager_is_none_rather_than_an_error(self):
        row = dict(EMPLOYEE_ROW, reports_to=None)
        self.assertIsNone(self._profile(row=row)["reports_to_name"])

    def test_an_empty_field_is_none_so_the_client_can_drop_the_row(self):
        row = dict(EMPLOYEE_ROW, department="", personal_email=None)
        profile = self._profile(row=row)
        self.assertIsNone(profile["department"])
        self.assertIsNone(profile["personal_email"])

    def test_a_site_missing_columns_still_answers(self):
        # Mid-migration. Losing one row is acceptable; raising is not.
        profile = self._profile(has_column=lambda _dt, field: field == "branch")
        self.assertEqual(profile["branch"], "DIS Iconic")
        self.assertIsNone(profile["employment_type"])
        self.assertIsNone(profile["reports_to_name"])


class TestProfileBiometric(_ProfileHarness):
    def test_the_biometric_key_set_is_exactly_the_allowlist(self):
        self.assertEqual(
            set(self._profile()["biometric"]),
            {"state", "fingers", "fingerprint_count", "face", "checked_at"},
        )

    def test_never_heard_from_the_bridge_is_not_the_same_as_not_enrolled(self):
        # THE HONESTY GUARD. enrollment_status returns last_snapshot_at
        # precisely so these two can be told apart. Telling somebody they are
        # not set up when the truth is our snapshot is missing is the same
        # failure as showing a provisional flag.
        status = dict(ENROLLED, is_registered=True, last_snapshot_at=None)
        self.assertEqual(self._profile(status=status)["biometric"]["state"], "unknown")

    def test_a_snapshot_that_does_not_know_this_person_is_not_enrolled(self):
        status = dict(ENROLLED, is_registered=False, fingerprint_count=0, finger_ids=[])
        self.assertEqual(
            self._profile(status=status)["biometric"]["state"], "not_enrolled"
        )

    def test_a_snapshot_that_knows_them_is_enrolled(self):
        self.assertEqual(self._profile()["biometric"]["state"], "enrolled")

    def test_the_device_integers_are_translated_and_never_shipped(self):
        bio = self._profile()["biometric"]
        self.assertEqual(bio["fingers"], ["left_index", "right_index"])

    def test_a_slot_the_table_does_not_know_is_named_not_dropped(self):
        # Dropping would make len(fingers) < fingerprint_count, and the client
        # then shows a bare number instead of the names it does have.
        status = dict(ENROLLED, finger_ids=[3, 99], fingerprint_count=2)
        self.assertEqual(
            self._profile(status=status)["biometric"]["fingers"],
            ["left_index", "other_finger"],
        )

    def test_face_is_a_yes_or_no_and_never_a_count(self):
        self.assertIs(self._profile()["biometric"]["face"], False)
        status = dict(ENROLLED, face_count=1)
        self.assertIs(self._profile(status=status)["biometric"]["face"], True)

    def test_checked_at_prefers_this_persons_own_snapshot_time(self):
        self.assertEqual(
            self._profile()["biometric"]["checked_at"], "2026-08-17 06:00:00"
        )

    def test_checked_at_falls_back_to_the_bridges_last_contact(self):
        # "When did we last hear about you" is the better answer; "when did we
        # last hear at all" is the weaker one that is still true.
        status = dict(ENROLLED, synced_at=None)
        self.assertEqual(
            self._profile(status=status)["biometric"]["checked_at"],
            "2026-08-17 06:05:00",
        )


class TestProfileAuth(_ProfileHarness):
    def test_auth_runs_before_any_read(self):
        calls = []
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          side_effect=lambda _d: (calls.append("auth"), "HR-EMP-00001")[1]), \
             patch.object(miniapp_api.enrollment_api, "enrollment_status",
                          side_effect=lambda _e: (calls.append("enrol"), ENROLLED)[1]), \
             patch.object(miniapp_api.frappe.db, "get_value",
                          side_effect=lambda *a, **k: (calls.append("db"), None)[1]), \
             patch.object(miniapp_api.frappe.db, "has_column", return_value=True):
            miniapp_api.get_my_profile("initdata")
        self.assertEqual(calls[0], "auth")

    def test_a_rejected_initdata_never_reaches_the_database(self):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          side_effect=Exception("nope")), \
             patch.object(miniapp_api.frappe.db, "get_value") as get_value:
            with self.assertRaises(Exception):
                miniapp_api.get_my_profile("forged")
        get_value.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_telegram_miniapp_api -v`
Expected: FAIL with `AttributeError: module ... has no attribute 'get_my_profile'`

- [ ] **Step 3: Write the implementation**

In `miniapp_api.py`, widen the import line:

```python
from dewey_time.attendance_engine import enrollment_api, finger_slots, hr_calendar
```

Add the allowlists after `DECISION_KEYS`:

```python
#: Employee fields an employee may see about their own record.
#:
#: An ALLOWLIST for the same reason DAY_KEYS is one. This doctype also carries
#: date_of_birth, passport_number and salary fields; written as removals, the
#: next one added for an HR need would reach every phone with nothing failing.
PROFILE_FIELDS = ("department", "employment_type", "date_of_joining", "branch")

#: Their own contact details, so they can see what HR will actually be dialling.
#: A separate tuple from PROFILE_FIELDS only so the PII reads as PII at a glance.
CONTACT_FIELDS = ("cell_number", "personal_email")


def _employee_row(employee: str, fields: tuple) -> dict:
    """Read only the columns this site actually has.

    An unknown column makes the whole select raise, which would take the Profile
    tab down to lose one optional row. `_identity` already guards the Khmer pair
    this way and hr_calendar.py:346 guards `employment_type` for the same reason.
    """
    present = [field for field in fields if frappe.db.has_column("Employee", field)]
    if not present:
        return {}
    return frappe.db.get_value("Employee", employee, present, as_dict=True) or {}


def _reports_to_name(employee: str):
    """The manager's NAME.

    Never the docname. That is another employee's identifier, and "who do I tell
    if I'm sick" is answered by a name. A dangling link yields None rather than
    raising -- Employee records get deleted and this row is optional.
    """
    if not frappe.db.has_column("Employee", "reports_to"):
        return None
    manager = frappe.db.get_value("Employee", employee, "reports_to")
    if not manager:
        return None
    return frappe.db.get_value("Employee", manager, "employee_name") or None


def _biometric(employee: str) -> dict:
    """Enrolment, as THREE states rather than two.

    "Not enrolled" and "we have never heard from the bridge" are different
    facts. `enrollment_status` returns last_snapshot_at precisely so they can be
    told apart -- its own docstring says so -- and telling somebody they are not
    set up when the truth is that our snapshot is missing is the same failure as
    showing a provisional flag: the app stating something it does not know.
    """
    status = enrollment_api.enrollment_status(employee)
    last_snapshot = status.get("last_snapshot_at")
    if not last_snapshot:
        state = "unknown"
    elif status.get("is_registered"):
        state = "enrolled"
    else:
        state = "not_enrolled"

    return {
        "state": state,
        # SLUGS, never the device's integers -- see finger_slots for why the
        # mapping is here and not in TypeScript. Empty today: the bridge
        # collapses templates to a count before Frappe sees them.
        "fingers": [finger_slots.slug_for(fid) for fid in status.get("finger_ids") or []],
        "fingerprint_count": int(status.get("fingerprint_count") or 0),
        # A yes/no, not a count. Nobody enrols two faces, and a number invites
        # the reader to wonder what the other one is.
        "face": bool(status.get("face_count") or 0),
        "checked_at": status.get("synced_at") or last_snapshot,
    }
```

Add the endpoint at the end of the module:

```python
# POST-only for the same reason get_my_calendar is: a GET would carry init_data
# -- the whole authentication credential -- in the query string.
@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_my_profile(init_data: str) -> dict:
    """The employee's own record, resolved from their Telegram binding.

    A SEPARATE endpoint rather than more keys on get_my_calendar. That one is
    fetched once per range -- a day for Today, a week for the roster, a month
    for the stats -- and none of this changes between them, so bundling would
    ship the whole record three times a launch. One function holding two
    allowlists is also one careless edit away from widening both.
    """
    # FIRST, before any read. Same property as get_my_calendar.
    employee = miniapp_auth.employee_from_init_data(init_data)

    fields = PROFILE_FIELDS + CONTACT_FIELDS
    row = _employee_row(employee, fields)
    # `or None` so an empty string reaches the client as null: the client drops
    # a row with no value, and "" would render an empty line under a label.
    picked = {key: row.get(key) or None for key in fields}

    return {
        "employee": employee,
        **_identity(employee),
        **picked,
        "reports_to_name": _reports_to_name(employee),
        "biometric": _biometric(employee),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest dewey_time.tests.test_telegram_miniapp_api -v`
Expected: PASS. Note the total rose by 20.

- [ ] **Step 5: Verify the allowlist guard can fail**

Change `picked` to `**row` in the return dict. Run the suite. Expected:
`test_the_key_set_is_exactly_the_allowlist` and
`test_a_field_added_to_employee_later_is_hidden_by_default` both FAIL.
Restore `**picked`.

Then change `state = "unknown"` to `state = "not_enrolled"`. Expected:
`test_never_heard_from_the_bridge_is_not_the_same_as_not_enrolled` FAILS.
Restore.

- [ ] **Step 6: Run the full backend suite**

Run: `python3 -m unittest discover -s dewey_time/tests -t . 2>&1 | tail -5`
Expected: no new failures; `Ran N tests` higher than after Task 2.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/telegram/miniapp_api.py dewey_time/tests/test_telegram_miniapp_api.py
git commit -m "$(cat <<'EOF'
feat(miniapp): an endpoint for the employee's own record

get_my_profile sits beside get_my_calendar with its own allowlist rather
than adding keys to it: the calendar is fetched once per range and none of
this changes between them, and one function holding two allowlists is one
edit away from widening both.

Enrolment is three states, not two. "Not set up" and "we have never heard
from the bridge" are different facts, and saying the first when the second
is true is the same failure as showing a provisional flag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 4: Client strings and pure profile logic

No components yet — the table, the rules, and the words, all testable without a
DOM.

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/miniapp/miniProfile.ts`
- Create: `dewey_time/frontend/hr_attendance/src/miniapp/miniProfile.test.ts`
- Modify: `src/miniapp/miniStrings.ts`
- Modify: `src/miniapp/miniIntl.ts`
- Modify: `src/miniapp/MiniLocale.tsx`

**Interfaces:**
- Consumes: `finger_slots.py`'s `FINGER_SLUGS` + `UNKNOWN_SLUG` (Task 1) — read
  out of the Python by the parity test, never copied. `dayFacts`,
  `totalWorkedMinutes` from `miniDay.ts`; `flagCount` from `miniFlags.ts`.
- Produces:
  - `type BiometricState = "enrolled" | "not_enrolled" | "unknown"`
  - `type Biometric = { state; fingers: string[]; fingerprint_count: number; face: boolean; checked_at?: string | null }`
  - `KNOWN_FINGER_SLUGS: string[]`
  - `fingerKeys(bio) -> StringKey[] | null`
  - `biometricStateKey(state) -> StringKey`
  - `biometricBodyKey(state) -> StringKey | null`
  - `parseDateOnly(value) -> Date | null`
  - `serviceLength(joined, today) -> { years: number; months: number } | null`
  - `monthStats(days, today) -> { daysWorked: number; minutes: number | null; flags: number }`
  - `formatServiceLength(locale, service, units)` in `miniIntl.ts`
  - `fmt.service(service)` on `MiniFormat`

- [ ] **Step 1: Add the strings**

In `miniStrings.ts`, add to `EN` (keep `tabSchedule` for now — Task 6 removes
it):

```ts
  tabProfile: "Profile",

  // Profile sections
  sectionRecord: "Your record",
  sectionBiometric: "Fingerprint & face",
  sectionContact: "Contact HR has for you",
  sectionMonth: "{month} so far",
  sectionRoster: "Your roster",

  // Profile row labels
  labelEmployeeId: "Employee ID",
  labelDepartment: "Department",
  labelEmployment: "Employment",
  labelJoined: "Joined",
  labelReportsTo: "Reports to",
  labelStatus: "Status",
  labelFingers: "Fingers",
  labelFace: "Face",
  labelDevicesAt: "Devices at",
  labelLastChecked: "Last checked",
  labelPhone: "Phone",
  labelEmail: "Email",

  // Enrolment. A statement about the DEVICES, never about the person: it is
  // the devices that do not know them, not the person who failed to do
  // something. "Not checked yet" is a third state on purpose — see
  // miniapp_api._biometric.
  bioEnrolled: "Set up",
  bioNotEnrolled: "Not set up",
  bioUnknown: "Not checked yet",
  bioNotEnrolledBody:
    "The fingerprint devices don't know you yet. Ask HR to enrol you, or you'll be marked absent.",
  bioUnknownBody:
    "We haven't heard from the fingerprint devices yet, so we can't tell you either way.",
  bioRecorded: "{n} recorded",

  // Month stats
  statDaysWorked: "days worked",
  statHours: "hours",
  statToCheck: "to check",

  contactReadOnly: "Wrong? Tell HR — this page can't change it.",

  unitYear: "y",
  unitMonth: "mo",

  loadingProfile: "Loading your record…",
  errorProfile: "Couldn't load your record.",

  // The ten device slots, plus the fallback. See finger_slots.py — the server
  // owns the FID→slug mapping and these are the words for the slugs.
  fingerLeftLittle: "Left little",
  fingerLeftRing: "Left ring",
  fingerLeftMiddle: "Left middle",
  fingerLeftIndex: "Left index",
  fingerLeftThumb: "Left thumb",
  fingerRightThumb: "Right thumb",
  fingerRightIndex: "Right index",
  fingerRightMiddle: "Right middle",
  fingerRightRing: "Right ring",
  fingerRightLittle: "Right little",
  fingerOther: "Another finger",
```

Add the matching keys to `KM`, in the same order:

```ts
  tabProfile: "ប្រវត្តិរូប",

  sectionRecord: "កំណត់ត្រារបស់អ្នក",
  sectionBiometric: "ស្នាមម្រាមដៃ និងមុខ",
  sectionContact: "ទំនាក់ទំនងដែល HR មាន",
  sectionMonth: "{month} រហូតមកដល់ពេលនេះ",
  sectionRoster: "កាលវិភាគរបស់អ្នក",

  labelEmployeeId: "លេខសម្គាល់បុគ្គលិក",
  labelDepartment: "ផ្នែក",
  labelEmployment: "ប្រភេទការងារ",
  labelJoined: "ចូលធ្វើការ",
  labelReportsTo: "ស្ថិតក្រោមការគ្រប់គ្រងរបស់",
  labelStatus: "ស្ថានភាព",
  labelFingers: "ម្រាមដៃ",
  labelFace: "មុខ",
  labelDevicesAt: "ម៉ាស៊ីននៅ",
  labelLastChecked: "ពិនិត្យចុងក្រោយ",
  labelPhone: "ទូរស័ព្ទ",
  labelEmail: "អ៊ីមែល",

  bioEnrolled: "បានចុះឈ្មោះ",
  bioNotEnrolled: "មិនទាន់បានចុះឈ្មោះ",
  bioUnknown: "មិនទាន់បានពិនិត្យ",
  bioNotEnrolledBody:
    "ម៉ាស៊ីនស្នាមម្រាមដៃមិនទាន់ស្គាល់អ្នកនៅឡើយទេ។ សូមប្រាប់ HR ឱ្យចុះឈ្មោះអ្នក បើមិនដូច្នេះទេ អ្នកនឹងត្រូវបានកត់ត្រាថាអវត្តមាន។",
  bioUnknownBody:
    "យើងមិនទាន់ទទួលបានព័ត៌មានពីម៉ាស៊ីនស្នាមម្រាមដៃនៅឡើយទេ ដូច្នេះយើងមិនអាចប្រាប់អ្នកបានទេ។",
  bioRecorded: "បានកត់ត្រា {n}",

  statDaysWorked: "ថ្ងៃធ្វើការ",
  statHours: "ម៉ោង",
  statToCheck: "ត្រូវពិនិត្យ",

  contactReadOnly: "ខុសមែនទេ? សូមប្រាប់ HR — ទំព័រនេះមិនអាចកែបានទេ។",

  unitYear: "ឆ្នាំ",
  unitMonth: "ខែ",

  loadingProfile: "កំពុងផ្ទុកកំណត់ត្រារបស់អ្នក…",
  errorProfile: "មិនអាចផ្ទុកកំណត់ត្រារបស់អ្នកបានទេ។",

  fingerLeftLittle: "កូនដៃឆ្វេង",
  fingerLeftRing: "ម្រាមនាងឆ្វេង",
  fingerLeftMiddle: "ម្រាមកណ្តាលឆ្វេង",
  fingerLeftIndex: "ម្រាមចង្អុលឆ្វេង",
  fingerLeftThumb: "មេដៃឆ្វេង",
  fingerRightThumb: "មេដៃស្តាំ",
  fingerRightIndex: "ម្រាមចង្អុលស្តាំ",
  fingerRightMiddle: "ម្រាមកណ្តាលស្តាំ",
  fingerRightRing: "ម្រាមនាងស្តាំ",
  fingerRightLittle: "កូនដៃស្តាំ",
  fingerOther: "ម្រាមដៃផ្សេងទៀត",
```

- [ ] **Step 2: Write the failing tests**

Create `src/miniapp/miniProfile.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  biometricBodyKey, biometricStateKey, fingerKeys, KNOWN_FINGER_SLUGS,
  monthStats, parseDateOnly, serviceLength, type Biometric,
} from "@/miniapp/miniProfile";
import type { Day } from "@/types/calendar";

/** The server's half of the finger allowlist, read out of the Python. */
function serverSlugs(): string[] {
  const src = readFileSync(
    new URL("../../../attendance_engine/finger_slots.py", import.meta.url),
    "utf8",
  );
  const table = /FINGER_SLUGS\s*=\s*\{([\s\S]*?)\}/.exec(src);
  assert.ok(table, "FINGER_SLUGS not found — has finger_slots.py moved?");
  const unknown = /UNKNOWN_SLUG\s*=\s*"([a-z_]+)"/.exec(src);
  assert.ok(unknown, "UNKNOWN_SLUG not found");
  return [
    ...[...table[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!),
    unknown[1]!,
  ];
}

const bio = (over: Partial<Biometric> = {}): Biometric => ({
  state: "enrolled", fingers: [], fingerprint_count: 0, face: false, ...over,
});

test("names are shown only when they account for every template", () => {
  // THE HONESTY GUARD. Two names beside a count of three states something
  // false about the third.
  assert.deepEqual(
    fingerKeys(bio({ fingers: ["left_index", "right_index"], fingerprint_count: 2 })),
    ["fingerLeftIndex", "fingerRightIndex"],
  );
  assert.equal(
    fingerKeys(bio({ fingers: ["left_index"], fingerprint_count: 3 })),
    null,
  );
});

test("no names at all is today's real state, not a failure", () => {
  // The bridge collapses templates to a count before Frappe sees them, so
  // `fingers` is empty for every employee until that changes.
  assert.equal(fingerKeys(bio({ fingers: [], fingerprint_count: 2 })), null);
  assert.equal(fingerKeys(undefined), null);
});

test("a slug this app has no word for renders as a finger, not as a crash", () => {
  assert.deepEqual(
    fingerKeys(bio({ fingers: ["left_index", "sixth_finger"], fingerprint_count: 2 })),
    ["fingerLeftIndex", "fingerOther"],
  );
});

test("the client and server halves of the finger table are the same list", () => {
  // READ OUT OF THE PYTHON, not copied from it. A comment asking the next
  // editor to keep two lists in step is not a guard — the server could gain a
  // slug and this would still pass, and that slug would reach a phone as a
  // blank finger name.
  assert.deepEqual(
    [...KNOWN_FINGER_SLUGS].sort(),
    serverSlugs().sort(),
    "finger_slots.FINGER_SLUGS and miniProfile.FINGER_TEXT have drifted",
  );
});

test("each state has a label, and only the two that need explaining have a body", () => {
  assert.equal(biometricStateKey("enrolled"), "bioEnrolled");
  assert.equal(biometricStateKey("not_enrolled"), "bioNotEnrolled");
  assert.equal(biometricStateKey("unknown"), "bioUnknown");
  assert.equal(biometricBodyKey("enrolled"), null);
  assert.equal(biometricBodyKey("not_enrolled"), "bioNotEnrolledBody");
  assert.equal(biometricBodyKey("unknown"), "bioUnknownBody");
});

test("a date-only string parses at local midnight, not UTC", () => {
  // new Date("2024-03-12") is UTC, and east of Greenwich that is the 11th
  // locally — which would show the wrong joining date and a service length one
  // day short across a birthday. The e2e suite hit the same trap on day keys.
  const d = parseDateOnly("2024-03-12")!;
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 12);
  assert.equal(parseDateOnly(""), null);
  assert.equal(parseDateOnly("not a date"), null);
});

test("service length counts whole months, not calendar months", () => {
  assert.deepEqual(
    serviceLength("2024-03-12", new Date(2026, 7, 17)), { years: 2, months: 5 },
  );
  // One day short of the anniversary is still the month before.
  assert.deepEqual(
    serviceLength("2024-03-18", new Date(2026, 2, 17)), { years: 1, months: 11 },
  );
  assert.deepEqual(
    serviceLength("2026-08-17", new Date(2026, 7, 17)), { years: 0, months: 0 },
  );
});

test("service length refuses to invent a past for a missing or future date", () => {
  assert.equal(serviceLength(null, new Date(2026, 7, 17)), null);
  assert.equal(serviceLength("2027-01-01", new Date(2026, 7, 17)), null);
});

const worked = (date: string, flags: unknown[] = []): Day => ({
  date,
  shift: {
    shift_assigned: true, shift_type: "FT", start_time: "08:00:00",
    end_time: "17:00:00", lunch_start: "12:00:00", lunch_end: "13:00:00",
  },
  first_in: `${date} 08:00:00`,
  last_out: `${date} 12:00:00`,
  checkins: [
    { time: `${date} 08:00:00`, log_type: "IN" },
    { time: `${date} 12:00:00`, log_type: "OUT" },
  ],
  flags,
}) as unknown as Day;

const off = (date: string): Day =>
  ({ date, shift: { shift_assigned: false }, checkins: [], flags: [] }) as unknown as Day;

test("the month stats count worked days, their minutes and their flags", () => {
  const today = new Date(2026, 7, 17);
  const stats = monthStats(
    [worked("2026-08-03"), worked("2026-08-04", [{ flag_code: "LATE_START" }]), off("2026-08-05")],
    today,
  );
  assert.equal(stats.daysWorked, 2);
  assert.equal(stats.minutes, 8 * 60);
  assert.equal(stats.flags, 1);
});

test("an empty month is zero days rather than a crash or a dash of hours", () => {
  const stats = monthStats([], new Date(2026, 7, 17));
  assert.equal(stats.daysWorked, 0);
  assert.equal(stats.minutes, null);
  assert.equal(stats.flags, 0);
});

test("only codes the employee has words for are counted as to-check", () => {
  // Same function behind this number as behind the Today tab's pill, so the
  // two can never disagree about how many there are.
  const stats = monthStats(
    [worked("2026-08-03", [{ flag_code: "UNKNOWN_DEVICE_BRANCH" }])],
    new Date(2026, 7, 17),
  );
  assert.equal(stats.flags, 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run, from `dewey_time/frontend/hr_attendance/`:
`npx tsx --test src/miniapp/miniProfile.test.ts`
Expected: FAIL — cannot resolve `@/miniapp/miniProfile`.

- [ ] **Step 4: Write `miniProfile.ts`**

```ts
/**
 * The Profile tab's facts, as pure functions.
 *
 * No React, no locale, no `window` — everything here is (data) -> data, so it
 * is testable without a DOM and cannot format a date in the wrong language by
 * accident. Words are `StringKey`s the caller looks up; formatting lives in
 * miniIntl.
 */
import { dayFacts, totalWorkedMinutes } from "@/miniapp/miniDay";
import { flagCount } from "@/miniapp/miniFlags";
import type { StringKey } from "@/miniapp/miniStrings";
import type { Day } from "@/types/calendar";

export type BiometricState = "enrolled" | "not_enrolled" | "unknown";

export type Biometric = {
  state: BiometricState;
  /** Slugs from finger_slots.py. Empty until the bridge sends finger_id. */
  fingers: string[];
  fingerprint_count: number;
  face: boolean;
  checked_at?: string | null;
};

/**
 * The client half of the finger allowlist.
 *
 * The server (`finger_slots.FINGER_SLUGS`) decides what a device index means;
 * this decides what the words are. `miniProfile.test.ts` reads the Python and
 * keeps the two in step, because a comment asking the next editor to do it is
 * not a guard.
 */
const FINGER_TEXT: Record<string, StringKey> = {
  left_little: "fingerLeftLittle",
  left_ring: "fingerLeftRing",
  left_middle: "fingerLeftMiddle",
  left_index: "fingerLeftIndex",
  left_thumb: "fingerLeftThumb",
  right_thumb: "fingerRightThumb",
  right_index: "fingerRightIndex",
  right_middle: "fingerRightMiddle",
  right_ring: "fingerRightRing",
  right_little: "fingerRightLittle",
  other_finger: "fingerOther",
};

export const KNOWN_FINGER_SLUGS = Object.keys(FINGER_TEXT);

/**
 * The named fingers, or null when a number is the only honest answer.
 *
 * Names are shown ONLY when they account for every template. Two names beside
 * a count of three states something false about the third, and there is no way
 * to render "and one more" that does not read as a bug.
 *
 * Null is the ORDINARY case today: the bridge collapses templates to a count
 * before Frappe ever sees them, so `fingers` is empty for everyone.
 */
export function fingerKeys(bio: Biometric | undefined): StringKey[] | null {
  const fingers = bio?.fingers ?? [];
  if (!fingers.length) return null;
  if (fingers.length !== bio?.fingerprint_count) return null;
  return fingers.map((slug) => FINGER_TEXT[slug] ?? "fingerOther");
}

export function biometricStateKey(state: BiometricState): StringKey {
  if (state === "enrolled") return "bioEnrolled";
  if (state === "not_enrolled") return "bioNotEnrolled";
  return "bioUnknown";
}

/** The line under the state, for the two states that need explaining. */
export function biometricBodyKey(state: BiometricState): StringKey | null {
  if (state === "not_enrolled") return "bioNotEnrolledBody";
  if (state === "unknown") return "bioUnknownBody";
  return null;
}

/**
 * "2024-03-12" at LOCAL midnight.
 *
 * `new Date("2024-03-12")` is parsed as UTC, and east of Greenwich that is the
 * 11th locally — a joining date off by one and a service length that flips a
 * day early. The e2e suite hit the same trap building day keys.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whole years and months since joining. Null when unknown or in the future. */
export function serviceLength(
  joined: string | null | undefined,
  today: Date,
): { years: number; months: number } | null {
  const start = parseDateOnly(joined);
  if (!start || start > today) return null;
  let months =
    (today.getFullYear() - start.getFullYear()) * 12 +
    (today.getMonth() - start.getMonth());
  // Not there yet this month: the 12th to the 11th is eleven months, not one.
  if (today.getDate() < start.getDate()) months -= 1;
  if (months < 0) return null;
  return { years: Math.floor(months / 12), months: months % 12 };
}

export type MonthStats = {
  daysWorked: number;
  /** Null when nothing is known, which `fmt.worked` renders as a dash. */
  minutes: number | null;
  flags: number;
};

/**
 * The month's three numbers, from days already fetched.
 *
 * `flagCount` rather than `day.flags.length`: it is the same function behind
 * the Today tab's pill, so this number and that one cannot disagree about how
 * many flags an employee has — which is exactly how the HR flag-queue header
 * once ended up contradicting the rows beneath it.
 */
export function monthStats(days: Day[], today: Date): MonthStats {
  const facts = days.map((day) => dayFacts(day, parseDateOnly(day.date) ?? today, today));
  return {
    daysWorked: facts.filter((fact) => fact.tone === "worked").length,
    minutes: totalWorkedMinutes(facts),
    flags: days.reduce((sum, day) => sum + flagCount(day), 0),
  };
}
```

- [ ] **Step 5: Add the service-length formatter**

Append to `miniIntl.ts`:

```ts
/**
 * "2y 5mo", or "២ ឆ្នាំ ៥ ខែ".
 *
 * Composed exactly the way formatWorkedMinutes composes hours and minutes,
 * including the space-before-unit rule: Khmer separates the number from its
 * word, English does not, and driving that off the LOCALE rather than off the
 * unit strings keeps "2y" from becoming "2 y" the day somebody edits the
 * English table.
 */
export function formatServiceLength(
  locale: Locale,
  service: { years: number; months: number } | null,
  units: { year: string; month: string },
): string | null {
  if (!service) return null;
  const digits = digitsFor(locale);
  const join = locale === "km" ? " " : "";
  const years = `${digits(String(service.years))}${join}${units.year}`;
  const months = `${digits(String(service.months))}${join}${units.month}`;
  if (!service.years) return months;
  return service.months ? `${years} ${months}` : years;
}
```

In `MiniLocale.tsx`, add to the `MiniFormat` type:

```ts
  /** Length of service, in the reader's language. */
  service: (service: { years: number; months: number } | null) => string | null;
```

…and to the `useFormat` object, importing `formatServiceLength` alongside the
other `miniIntl` imports:

```ts
      service: (service) =>
        formatServiceLength(locale, service, { year: t("unitYear"), month: t("unitMonth") }),
```

- [ ] **Step 6: Run tests to verify they pass**

Run, from `dewey_time/frontend/hr_attendance/`:
```
npx tsx --test src/miniapp/miniProfile.test.ts && npx tsc --noEmit
```
Expected: PASS, `# pass 12`, and a clean typecheck.

- [ ] **Step 7: Verify the two guards can fail**

Change `if (fingers.length !== bio?.fingerprint_count) return null;` to
`if (false) return null;`. Expected: "names are shown only when they account
for every template" FAILS. Restore.

Add `"sixth_finger"` to `FINGER_TEXT` pointing at `"fingerOther"`. Expected:
"the client and server halves of the finger table are the same list" FAILS.
Remove it.

- [ ] **Step 8: Run the whole web suite**

Run: `npm run test:web 2>&1 | tail -5`
Expected: no failures; the total rose by 12.

- [ ] **Step 9: Commit**

```bash
git add src/miniapp/miniProfile.ts src/miniapp/miniProfile.test.ts \
        src/miniapp/miniStrings.ts src/miniapp/miniIntl.ts src/miniapp/MiniLocale.tsx
git commit -m "$(cat <<'EOF'
feat(miniapp): the profile's facts, as pure functions and words

Finger names are shown only when they account for every template — two
names beside a count of three states something false about the third — so
today, with the bridge sending no slots at all, every employee correctly
sees a number.

The client half of the finger table is compared against finger_slots.py by
reading the Python, the way the flag allowlist already is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 5: The Profile page

**Files:**
- Create: `src/miniapp/MiniProfileRow.tsx`
- Create: `src/miniapp/MyProfilePage.tsx`
- Create: `src/miniapp/myProfilePage.test.tsx`
- Modify: `src/miniapp/useMiniAppSession.ts`

**Interfaces:**
- Consumes: everything Task 4 produced; `get_my_profile` from Task 3;
  `MySchedulePage`, `MiniState`, `useT`, `useFormat`, `useMiniAppCalendar`.
- Produces:
  - `type MiniProfile` and `useMyProfile()` in `useMiniAppSession.ts`
  - `ProfileHeading`, `ProfileSection`, `type ProfileRowData` in `MiniProfileRow.tsx`
  - `MyProfilePage({ today?, offset?, onOffsetChange? })` in `MyProfilePage.tsx`

- [ ] **Step 1: Add the query hook**

In `useMiniAppSession.ts`, add the import and the type/hook:

```ts
import type { Biometric } from "@/miniapp/miniProfile";
```

```ts
/** What get_my_profile returns. Every field but `employee` and `biometric` is
 *  nullable by contract: HR records are unevenly filled, and the page drops a
 *  row rather than rendering a dash. */
export type MiniProfile = {
  employee: string;
  employee_name?: string | null;
  khmer_name?: string | null;
  designation?: string | null;
  image?: string | null;
  department?: string | null;
  employment_type?: string | null;
  date_of_joining?: string | null;
  branch?: string | null;
  reports_to_name?: string | null;
  cell_number?: string | null;
  personal_email?: string | null;
  biometric: Biometric;
};

async function fetchProfile(initData: string): Promise<MiniProfile> {
  const response = await fetch(
    "/api/method/dewey_time.telegram.miniapp_api.get_my_profile",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": window.csrf_token ?? "",
      },
      body: JSON.stringify({ init_data: initData }),
    },
  );
  if (!response.ok) {
    throw new Error(`profile request failed: ${response.status}`);
  }
  return (await response.json()).message as MiniProfile;
}

export function useMyProfile() {
  const initData = initDataFromTelegram(window);
  return useQuery({
    queryKey: ["mini-profile"],
    enabled: initData !== MISSING_INIT_DATA,
    queryFn: () => fetchProfile(initData),
    // NO POLL, unlike the calendar. That one polls because it makes a claim
    // about the present ("In") that goes false while somebody walks to the
    // terminal. Nothing here changes during a session, and polling an
    // unchanging record on an employee's mobile data buys nothing.
  });
}
```

- [ ] **Step 2: Write the failing render tests**

Create `src/miniapp/myProfilePage.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProfileHeading, ProfileSection } from "@/miniapp/MiniProfileRow";

test("a row with no value is dropped rather than dashed", () => {
  // A dash reads as data the app failed to load. An absent row reads as a
  // field HR has not filled, which is what it is.
  const html = renderToStaticMarkup(
    <ProfileSection
      title="Your record"
      rows={[
        { label: "Department", value: "Retail" },
        { label: "Reports to", value: null },
        { label: "Employment", value: "" },
        { label: "Branch", value: undefined },
      ]}
    />,
  );
  assert.match(html, /Department/);
  assert.match(html, /Retail/);
  assert.doesNotMatch(html, /Reports to/);
  assert.doesNotMatch(html, /Employment/);
  assert.doesNotMatch(html, /—/);
});

test("a section whose every row was dropped renders nothing at all", () => {
  // Not an empty bordered box under a heading, which reads as broken.
  const html = renderToStaticMarkup(
    <ProfileSection
      title="Contact HR has for you"
      rows={[{ label: "Phone", value: null }, { label: "Email", value: "" }]}
    />,
  );
  assert.equal(html, "");
});

test("a section with no rows but a child still renders", () => {
  // The month stats are a grid, not rows.
  const html = renderToStaticMarkup(
    <ProfileSection title="August so far">
      <span>12 days worked</span>
    </ProfileSection>,
  );
  assert.match(html, /12 days worked/);
  assert.match(html, /August so far/);
});

test("a zero is a value, not an absence", () => {
  // `0` and `false` are falsy and would vanish under a naive truthiness check.
  const html = renderToStaticMarkup(
    <ProfileSection title="x" rows={[{ label: "Fingers", value: 0 }]} />,
  );
  assert.match(html, /Fingers/);
});

test("a heading is a heading, so the page has structure for a screen reader", () => {
  const html = renderToStaticMarkup(<ProfileHeading>Your roster</ProfileHeading>);
  assert.match(html, /<h2[^>]*>Your roster<\/h2>/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test src/miniapp/myProfilePage.test.tsx`
Expected: FAIL — cannot resolve `@/miniapp/MiniProfileRow`.

- [ ] **Step 4: Write `MiniProfileRow.tsx`**

```tsx
/**
 * The Profile tab's rows, and the omit-when-empty rule they all share.
 *
 * A thin HR record renders four rows, not nine rows of "—". A dash reads as
 * data the app failed to load; an absent row reads as a field nobody filled in,
 * which is what it is. The rule lives HERE rather than at each call site
 * because it is exactly the kind of thing one of fifteen call sites forgets —
 * and the forgotten one is the row that reads "Reports to —" to somebody with
 * no manager.
 *
 * Rows are DATA, not children, for the same reason: a section can only decide
 * whether it is empty if it can see its rows' values, and a `<ProfileRow>`
 * element that will render null is still a truthy child.
 */
import type { ReactNode } from "react";

export type ProfileRowData = { label: string; value: ReactNode };

/** Present unless it is genuinely nothing. `0` and `false` are values. */
function hasValue(value: ReactNode): boolean {
  return value !== null && value !== undefined && value !== "";
}

export function ProfileHeading(props: { children: ReactNode }) {
  return (
    <h2 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {props.children}
    </h2>
  );
}

export function ProfileSection(props: {
  title: string;
  rows?: ProfileRowData[];
  children?: ReactNode;
}) {
  const rows = (props.rows ?? []).filter((row) => hasValue(row.value));
  if (!rows.length && !props.children) return null;

  return (
    <section>
      <ProfileHeading>{props.title}</ProfileHeading>
      <div className="overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline gap-3 border-b border-border px-3 py-2 last:border-b-0"
          >
            <span className="shrink-0 text-xs text-muted-foreground">{row.label}</span>
            <span className="min-w-0 flex-1 break-words text-right text-[13px] text-foreground">
              {row.value}
            </span>
          </div>
        ))}
        {props.children}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test src/miniapp/myProfilePage.test.tsx`
Expected: PASS, `# pass 5`.

- [ ] **Step 6: Write `MyProfilePage.tsx`**

```tsx
/**
 * What HR's record says about you, and what the devices know.
 *
 * READ-ONLY, every block. The Employee doctype is HR's to edit and this app has
 * no write endpoint at all; the contact block says so in words rather than
 * offering a field that would fail.
 *
 * The roster at the bottom is MySchedulePage, mounted unchanged. It is the only
 * surface in this app that pages FORWARD — the calendar sheet is
 * `disabled={{ after: today }}` — so it survived the tab it used to own.
 */
import { endOfMonth, format, startOfMonth } from "date-fns";

import { parseDateTimeLocal } from "@/lib/attendanceTime";
import { useFormat, useT } from "@/miniapp/MiniLocale";
import { MiniState } from "@/miniapp/MiniState";
import {
  biometricBodyKey, biometricStateKey, fingerKeys, monthStats, parseDateOnly,
  serviceLength,
} from "@/miniapp/miniProfile";
import { ProfileHeading, ProfileSection } from "@/miniapp/MiniProfileRow";
import { MySchedulePage } from "@/miniapp/MySchedulePage";
import { useMiniAppCalendar, useMyProfile } from "@/miniapp/useMiniAppSession";

function Stat(props: { value: string; label: string; amber?: boolean }) {
  return (
    <div className="flex-1 border-r border-border px-2 py-2.5 text-center last:border-r-0">
      <p
        className={
          props.amber
            ? "text-lg font-semibold tabular-nums text-amber-500"
            : "text-lg font-semibold tabular-nums text-foreground"
        }
      >
        {props.value}
      </p>
      <p className="text-[10px] text-muted-foreground">{props.label}</p>
    </div>
  );
}

export function MyProfilePage(props: {
  today?: Date;
  offset?: number;
  onOffsetChange?: (next: number) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const today = props.today ?? new Date();
  const profile = useMyProfile();
  // The SAME key MiniCalendarSheet uses for the current month, so on a launch
  // where the calendar has already been opened this costs nothing.
  const month = useMiniAppCalendar(
    format(startOfMonth(today), "yyyy-MM-dd"),
    format(endOfMonth(today), "yyyy-MM-dd"),
  );

  if (profile.isLoading) return <MiniState>{t("loadingProfile")}</MiniState>;
  if (profile.isError || !profile.data) return <MiniState>{t("errorProfile")}</MiniState>;

  const me = profile.data;
  const bio = me.biometric;
  const fingers = fingerKeys(bio);
  const service = fmt.service(serviceLength(me.date_of_joining, today));
  const bodyKey = biometricBodyKey(bio.state);
  const stats = monthStats(month.data?.days ?? [], today);
  const joined = parseDateOnly(me.date_of_joining);
  const checked = bio.checked_at ? parseDateTimeLocal(bio.checked_at) : null;

  return (
    <div className="flex flex-col gap-4 p-3">
      <ProfileSection
        title={t("sectionRecord")}
        rows={[
          // Latin, never converted to Khmer digits: an employee id is a name,
          // not a quantity. Same rule MiniIdentity follows.
          { label: t("labelEmployeeId"), value: me.employee },
          { label: t("labelDepartment"), value: me.department },
          { label: t("labelEmployment"), value: me.employment_type },
          {
            label: t("labelJoined"),
            value: joined ? (
              <>
                {fmt.date(joined, "d MMM yyyy")}
                {service ? (
                  <span className="block text-[11px] text-muted-foreground">{service}</span>
                ) : null}
              </>
            ) : null,
          },
          { label: t("labelReportsTo"), value: me.reports_to_name },
        ]}
      />

      <ProfileSection
        title={t("sectionBiometric")}
        rows={[
          { label: t("labelStatus"), value: t(biometricStateKey(bio.state)) },
          {
            // Only when we actually know. A finger count under "Not checked
            // yet" would contradict the line above it.
            label: t("labelFingers"),
            value:
              bio.state !== "enrolled"
                ? null
                : fingers
                  ? fingers.map((key) => t(key)).join(", ")
                  : bio.fingerprint_count
                    ? t("bioRecorded").replace("{n}", fmt.digits(String(bio.fingerprint_count)))
                    : null,
          },
          {
            label: t("labelFace"),
            value:
              bio.state === "enrolled"
                ? t(bio.face ? "bioEnrolled" : "bioNotEnrolled")
                : null,
          },
          // The branch, never a device serial or PIN: where the machines that
          // know this person are, not which machine.
          { label: t("labelDevicesAt"), value: me.branch },
          {
            label: t("labelLastChecked"),
            value: checked && !Number.isNaN(checked.getTime())
              ? `${fmt.date(checked, "d MMM")} · ${fmt.punch(bio.checked_at) ?? ""}`
              : null,
          },
        ]}
      >
        {bodyKey ? (
          <p className="px-3 py-2 text-[12px] leading-snug text-muted-foreground">
            {t(bodyKey)}
          </p>
        ) : null}
      </ProfileSection>

      <ProfileSection
        title={t("sectionContact")}
        rows={[
          { label: t("labelPhone"), value: me.cell_number },
          { label: t("labelEmail"), value: me.personal_email },
        ]}
      />
      {me.cell_number || me.personal_email ? (
        <p className="-mt-3 px-1 text-[11px] text-muted-foreground">
          {t("contactReadOnly")}
        </p>
      ) : null}

      <ProfileSection title={t("sectionMonth").replace("{month}", fmt.date(today, "LLLL"))}>
        <div className="flex">
          <Stat
            value={fmt.digits(String(stats.daysWorked))}
            label={t("statDaysWorked")}
          />
          <Stat value={fmt.worked(stats.minutes) ?? "—"} label={t("statHours")} />
          <Stat
            value={fmt.digits(String(stats.flags))}
            label={t("statToCheck")}
            amber={stats.flags > 0}
          />
        </div>
      </ProfileSection>

      <section>
        <ProfileHeading>{t("sectionRoster")}</ProfileHeading>
        <MySchedulePage
          today={today}
          offset={props.offset}
          onOffsetChange={props.onOffsetChange}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck and run the web suite**

Run: `npx tsc --noEmit && npm run test:web 2>&1 | tail -5`
Expected: clean typecheck; the total rose by 5.

- [ ] **Step 8: Verify the omit rule can fail**

In `hasValue`, change the body to `return Boolean(value);`. Run
`npx tsx --test src/miniapp/myProfilePage.test.tsx`. Expected: "a zero is a
value, not an absence" FAILS. Restore.

- [ ] **Step 9: Commit**

```bash
git add src/miniapp/MiniProfileRow.tsx src/miniapp/MyProfilePage.tsx \
        src/miniapp/myProfilePage.test.tsx src/miniapp/useMiniAppSession.ts
git commit -m "$(cat <<'EOF'
feat(miniapp): the Profile page

Rows are data rather than children so a section can tell whether it is
empty: a thin HR record renders four rows, not nine rows of a dash, and a
block whose every row was dropped renders nothing rather than an empty box
under a heading.

The roster is MySchedulePage mounted unchanged. Not polled, unlike the
calendar — that polls because it claims something about the present, and
none of this changes while somebody is looking at it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Task 6: Swap the tab

**Files:**
- Modify: `src/miniapp/MiniAppShell.tsx:34-52`, `:297-310`
- Modify: `src/miniapp/MySchedulePage.tsx:131-152`
- Modify: `src/miniapp/miniStrings.ts` (remove `tabSchedule`)
- Test: `src/miniapp/miniAppShell.test.tsx`
- Test: `e2e/miniapp.spec.ts`

**Interfaces:**
- Consumes: `MyProfilePage` from Task 5.
- Produces: `MiniTab = "day" | "profile"`. Nothing later depends on this.

- [ ] **Step 1: Write the failing tests**

In `miniAppShell.test.tsx`, replace the existing "the shell offers exactly the
two employee views" test with:

```tsx
test("the shell offers exactly the two employee views", () => {
  // Not the HR console with things hidden — a different surface that happens
  // to share components. An HR tab appearing here is a scope failure, not a
  // styling one, and that half of this test is the load-bearing half.
  //
  // Two, not three. "Week" was replaced by the calendar sheet; "Schedule" was
  // replaced by Profile, which kept the roster inside it.
  const html = renderToStaticMarkup(<MiniTabBar active="day" onSelect={() => {}} />);
  for (const label of ["Today", "Profile"]) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /Week/);
  assert.doesNotMatch(html, /Schedule/);
  for (const forbidden of ["Flags", "Coverage", "Import", "Biometric"]) {
    assert.doesNotMatch(html, new RegExp(forbidden));
  }
});
```

Update the `aria-current` test, which passes `active="schedule"`:

```tsx
test("the active tab is marked for assistive tech, not only coloured", () => {
  const html = renderToStaticMarkup(<MiniTabBar active="profile" onSelect={() => {}} />);
  assert.match(html, /aria-current="page"/);
});
```

Add, importing `isMiniTab` from the shell:

```tsx
test("a tab key from a previous version is rejected rather than trusted", () => {
  // Someone whose last session ended on Schedule has "schedule" in
  // CloudStorage. The guard is the whole migration: an unknown value is
  // refused and the shell falls back to Today. This is the second time it has
  // earned that — "week" went the same way.
  assert.equal(isMiniTab("profile"), true);
  assert.equal(isMiniTab("day"), true);
  assert.equal(isMiniTab("schedule"), false);
  assert.equal(isMiniTab("week"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/miniapp/miniAppShell.test.tsx`
Expected: FAIL — the bar still renders "Schedule", and `isMiniTab` is not
exported/returns true for `"schedule"`.

- [ ] **Step 3: Rename the tab in the shell**

In `MiniAppShell.tsx`:

```tsx
export type MiniTab = "day" | "profile";

/** Guards what comes back out of CloudStorage — it is data, not a promise. */
export function isMiniTab(value: string): value is MiniTab {
  return value === "day" || value === "profile";
}

// TWO TABS. "Week" was the first casualty — the calendar sheet answered its
// question at four times the density from inside Today. "Schedule" is the
// second: it answered "when am I working", which is one of several questions
// about an employee's own record, and Profile answers the rest while keeping
// that roster whole at the bottom of itself.
//
// A reader whose last session ended on either has a stale key in CloudStorage.
// Neither needs a migration — `isMiniTab` rejects an unknown value and the
// shell falls back to "day", which is the reason that guard exists.
const TABS = [
  { key: "day", label: "tabToday" },
  { key: "profile", label: "tabProfile" },
] as const satisfies readonly { key: MiniTab; label: StringKey }[];
```

Replace the import and the mount:

```tsx
import { MyProfilePage } from "@/miniapp/MyProfilePage";
```

```tsx
        ) : (
          <MyProfilePage offset={weekOffset} onOffsetChange={setWeekOffset} />
        )}
```

Update the `weekOffset` comment, which still says "the Schedule tab":

```tsx
  /** Which week the Profile tab's roster is showing, relative to today's. */
  const [weekOffset, setWeekOffset] = useState(0);
```

- [ ] **Step 4: Remove the page padding from `MySchedulePage`**

Profile now supplies it. Change all three wrappers from
`className="flex flex-col gap-3 p-3"` to `className="flex flex-col gap-3"` —
the loading branch, the error branch, and the main return. Nothing else in that
file changes.

- [ ] **Step 5: Remove the dead string**

Delete `tabSchedule` from both `EN` and `KM` in `miniStrings.ts`. `tsc` proves
nothing still reads it.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx tsc --noEmit && npm run test:web 2>&1 | tail -5`
Expected: clean typecheck, no failures.

- [ ] **Step 7: Add the e2e coverage**

In `e2e/miniapp.spec.ts`, extend `openMiniApp` to stub the new endpoint. Add
this route beside the existing `get_my_calendar` one, and add
`profile?: Record<string, unknown> | null` to the `opts` type:

```ts
  await page.route("**/api/method/dewey_time.telegram.miniapp_api.get_my_profile", async (route) => {
    // The narrowed shape miniapp_api.get_my_profile produces — never a richer
    // one. A fixture the server cannot send lets the page read a field that
    // does not exist in production.
    await route.fulfill({
      json: {
        message: opts.profile === undefined
          ? {
              employee: "HR-EMP-00042",
              employee_name: "Sok Dara",
              khmer_name: "សុខ ដារា",
              designation: "Cashier",
              image: null,
              department: "Retail",
              employment_type: "Full-time",
              date_of_joining: "2024-03-12",
              branch: "DIS Iconic",
              reports_to_name: "Chan Sophea",
              cell_number: "012 345 678",
              personal_email: "dara.sok@gmail.com",
              biometric: {
                state: "enrolled",
                fingers: [],
                fingerprint_count: 2,
                face: false,
                checked_at: "2026-08-17 06:00:00",
              },
            }
          : opts.profile,
      },
    });
  });
```

Add the tests:

```ts
test("the Profile tab shows the record, the devices and the roster", async ({ page }) => {
  await openMiniApp(page);
  await page.getByRole("button", { name: "Profile" }).click();

  await expect(page.getByText("Retail")).toBeVisible();
  await expect(page.getByText("Chan Sophea")).toBeVisible();
  // No names yet — the bridge sends no slots, so the count is the honest form.
  await expect(page.getByText("2 recorded")).toBeVisible();
  await expect(page.getByText("Your roster")).toBeVisible();
});

test("the roster inside Profile still pages forward past today", async ({ page }) => {
  // The reason the dated roster survived the tab it used to own: the calendar
  // sheet is disabled={{ after: today }}, so this is the app's only
  // forward-looking surface. An assertion that the button merely EXISTS would
  // pass against a WeekNav rendered with forwardLimit — the range label has to
  // actually move.
  await openMiniApp(page);
  await page.getByRole("button", { name: "Profile" }).click();

  const next = page.getByRole("button", { name: "Next week" });
  await expect(next).toBeEnabled();

  const label = page.getByText("This week");
  await expect(label).toBeVisible();
  await next.click();
  await expect(label).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to this week" })).toBeVisible();
});

test("a device that does not know you says so, and says why it matters", async ({ page }) => {
  await openMiniApp(page, {
    profile: {
      employee: "HR-EMP-00311",
      employee_name: "Kim Veasna",
      khmer_name: null, designation: null, image: null,
      department: null, employment_type: null,
      date_of_joining: "2026-08-02", branch: null,
      reports_to_name: null, cell_number: null, personal_email: null,
      biometric: {
        state: "not_enrolled", fingers: [], fingerprint_count: 0,
        face: false, checked_at: "2026-08-17 06:00:00",
      },
    },
  });
  await page.getByRole("button", { name: "Profile" }).click();

  await expect(page.getByText("Not set up")).toBeVisible();
  await expect(page.getByText(/marked absent/)).toBeVisible();
  // A thin record drops whole blocks rather than dashing them.
  await expect(page.getByText("Contact HR has for you")).toHaveCount(0);
  await expect(page.getByText("Reports to")).toHaveCount(0);
});

test("never having heard from the devices is not the same as not enrolled", async ({ page }) => {
  await openMiniApp(page, {
    profile: {
      employee: "HR-EMP-00311", employee_name: "Kim Veasna",
      khmer_name: null, designation: null, image: null,
      department: null, employment_type: null, date_of_joining: null,
      branch: null, reports_to_name: null, cell_number: null, personal_email: null,
      biometric: {
        state: "unknown", fingers: [], fingerprint_count: 0,
        face: false, checked_at: null,
      },
    },
  });
  await page.getByRole("button", { name: "Profile" }).click();

  await expect(page.getByText("Not checked yet")).toBeVisible();
  await expect(page.getByText(/can't tell you either way/)).toBeVisible();
  await expect(page.getByText("Not set up")).toHaveCount(0);
});
```

The "pages forward" assertion depends on `WeekNav`'s actual button
accessible names — open `src/miniapp/MiniWeekNav.tsx` and use the real ones
rather than the regex above if they differ.

- [ ] **Step 8: Run the e2e suite**

Run: `npx playwright test e2e/miniapp.spec.ts`
Expected: PASS, 4 more tests than before.

- [ ] **Step 9: Run everything**

```
npx tsc --noEmit
npm run test:web 2>&1 | tail -5
npx playwright test e2e/miniapp.spec.ts e2e/flags.spec.ts
cd ../../.. && python3 -m unittest discover -s dewey_time/tests -t . 2>&1 | tail -5
```
Expected: all green, all totals up on the pre-branch numbers.

- [ ] **Step 10: Build and commit the deployed assets**

The built SPA IS the deployed artifact — Frappe Cloud never builds it.

```bash
cd dewey_time/frontend/hr_attendance && npm run build && cd -
git status --short dewey_time/public dewey_time/www
```
Expected: modified files under `dewey_time/public/**` and `dewey_time/www/*.html`.

```bash
git add src/miniapp/MiniAppShell.tsx src/miniapp/MySchedulePage.tsx \
        src/miniapp/miniStrings.ts src/miniapp/miniAppShell.test.tsx \
        e2e/miniapp.spec.ts dewey_time/public dewey_time/www
git commit -m "$(cat <<'EOF'
feat(miniapp): Profile replaces the Schedule tab

The roster moves inside it whole, still paging forward — it is the only
surface in this app that can reach a future date, because the calendar
sheet is past-only.

A stale "schedule" in CloudStorage needs no migration: isMiniTab rejects an
unknown value and the shell falls back to Today, which is the second time
that guard has done this job.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
EOF
)"
```

---

## Self-review

**Spec coverage.** Every spec section maps to a task: the tab replacement and
CloudStorage migration → Task 6; the roster staying dated and forward-paging →
Tasks 5 and 6; the new endpoint and its three allowlists → Task 3; the three
biometric states → Task 3; finger names built now and the ingest clear path →
Tasks 1 and 2; server-maps/client-names → Tasks 1 and 4; names-only-when-they-
account-for-every-template → Task 4; absolute last-checked → Task 5;
omit-empty-fields → Task 5; no PIN or serial → Task 5's biometric rows; the copy
table → Task 4. All 30 spec test guards appear as steps.

**Two deviations from the spec, both deliberate:**

1. The spec named `MiniProfileRow.tsx`'s export as a row component. It is a
   `ProfileSection` taking rows as **data** instead — a `<ProfileRow>` that
   renders null is still a truthy child, so a section built from children cannot
   tell whether it is empty, and the "whole block disappears" requirement would
   have been unimplementable.
2. `formatServiceLength` lives in `miniIntl.ts`, not `miniProfile.ts`. Locale
   formatting belongs beside `formatWorkedMinutes`, and it keeps `miniProfile.ts`
   locale-free and testable in one language.

**`MyProfilePage` has no component-level test, deliberately.** It is
query-driven — `useMyProfile` plus `useMiniAppCalendar` — and `node:test` in
this repo has no DOM: every existing miniapp component test either exercises a
pure function or `renderToStaticMarkup`s a prop-driven component. Standing up a
`QueryClientProvider` and a fetch stub to assert on markup would test the mock.
The page's logic lives in `miniProfile.ts` (Task 4, 12 tests) and its rendering
rules in `MiniProfileRow` (Task 5, 5 tests); the three whole-page states — full,
sparse, unknown — are covered by e2e in Task 6, which is the level that has a
browser.

**All accessible names used in e2e are verified**, not guessed: `Next week` and
`Back to this week` come from `MiniWeekNav.tsx:30,45` via `miniStrings.ts:64-65`.

**Open question carried from the spec.** If `reports_to` or `personal_email` are
empty for most of the live roster, those rows are dead weight — they degrade
correctly either way, so this does not block implementation, but it is worth a
look at the data before Task 5.
