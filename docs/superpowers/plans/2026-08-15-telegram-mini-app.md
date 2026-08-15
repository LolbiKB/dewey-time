# Telegram Mini App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An employee opens a button in the Telegram bot and sees their own day timeline, week, and shift schedule — authenticated by the Telegram binding, with no Frappe `User` and no login.

**Architecture:** Telegram's `initData` is HMAC-validated server-side, resolved through the existing `Telegram Link` to an Employee, and served a **narrowed allowlist projection** of the calendar payload. The frontend is a **second Vite config inside `frontend/hr_attendance`** — same `src/`, same `node_modules`, its own entry HTML and its own `outDir` — so the existing timeline components are imported unchanged while the Mini App ships its own small bundle instead of the 1.0MB HR one.

**Tech Stack:** Frappe/ERPNext/HRMS v16, Python `hmac`/`hashlib` (no new packages), Vite 2-config build, React 19 + existing dewey-ui components, Telegram Web App SDK loaded from `telegram.org`.

**Spec:** [`docs/superpowers/specs/2026-08-15-telegram-employee-layer-design.md`](../specs/2026-08-15-telegram-employee-layer-design.md)

**This is plan 2 of 2.** Plan 1 (`2026-08-15-telegram-binding-and-notifications.md`) is complete and merged into this branch — the `Telegram Link` doctype, `binding.employee_for_telegram_user`, `transport.bot_token`, and the webhook all exist and are relied on here.

## Global Constraints

Carried from the spec and from plan 1. Every task's requirements implicitly include these.

- **No Frappe `User` record is created for any employee, ever.**
- **The Mini App endpoint takes no employee-selecting parameter.** The Employee is resolved from the verified Telegram identity, never from anything the caller supplies.
- **The projection is an allowlist, not a denylist.** New fields on the calendar payload default to hidden.
- **`initData` validation returns an Employee or raises — never a boolean.**
- **There is no Frappe permission backstop.** `frappe.get_all` bypasses permissions (verified on a real bench 2026-08-15), so the `initData` check and the binding lookup are the only line of defence, not the first.
- **Constant-time comparison** (`hmac.compare_digest`) for the `initData` hash.
- **Flags are not shown.** No `flags[]`, no evidence, no flag names, no `grace_minutes`.
- **`get_employee_calendar`'s behaviour and payload must not change.** Its existing tests are the guard for the extraction in Task 1.
- **Secrets stay in `Password` fields** on `Dewey Time Settings`, read via `get_decrypted_password`.
- **Tasks 2 and 3 are written in the main session, not delegated to a subagent**, per the isolation-predicate rule in `CLAUDE.md`.

## Conventions in this repo

- Python tests are `unittest` under `dewey_time/tests/`, and install the frappe mock **before** importing the module under test:
  ```python
  from dewey_time.tests.test_closeout import _install_frappe_mock
  _install_frappe_mock()
  ```
- Run one Python module fast: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module <name>`
- Full Python suite: `cd dev/sandbox && ./frappe-sandbox test --backend` — **baseline after plan 1 is 886 OK (24 skipped). Check the count, not the word OK.**
- Web unit tests: `cd dewey_time/frontend/hr_attendance && npm run test:web` — glob-based, so **it exits 0 when it matches nothing. Read the count.**
- Typecheck: `npm run typecheck`.
- A DocType JSON's `modified` must move **forward** or `bench migrate` skips the reimport. Plan 1 shipped this bug; the current value in `dewey_time_settings.json` is `2026-08-18 00:00:00.000000`, so any bump must exceed it.
- Built assets ARE the deployed artifact and MUST be committed — Frappe Cloud never builds these SPAs.

## Build hazards this plan must respect

Read `frontend/hr_attendance/scripts/copy-html-entry.mjs` before touching the build. Two failure modes there are silent and already bit this repo once:

- Tailwind's `@source "../node_modules/@lolbikb/dewey-ui/dist"` is a **filesystem glob**. With no `node_modules` in the worktree, Tailwind scans nothing, emits a stylesheet missing every dewey-ui class, and **exits 0**. `copy-html-entry.mjs` guards this with a `MIN_CSS_BYTES` floor. The Mini App build needs its own floor.
- `check-fonts.mjs` fails the build if the woff2 assets stop being emitted.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `dewey_time/telegram/miniapp_auth.py` | `initData` HMAC validation → Employee. Security boundary. |
| `dewey_time/telegram/miniapp_api.py` | `get_my_calendar` and the allowlist projection. |
| `dewey_time/tests/test_telegram_miniapp_auth.py` | Tests for the validator. |
| `dewey_time/tests/test_telegram_miniapp_api.py` | Tests for the projection and the signature guard. |
| `dewey_time/www/hr-me.html` | Generated entry page (written by the build). |
| `dewey_time/www/hr-me.py` | Page controller — csrf + boot, mirroring `hr-attendance.py`. |
| `dewey_time/utils/sync_miniapp_assets.py` | Publishes `public/miniapp` into `sites/assets`, mirroring `sync_adms_assets.py`. |
| `frontend/hr_attendance/vite.miniapp.config.ts` | Second Vite config: own entry, own `outDir`. |
| `frontend/hr_attendance/index.miniapp.html` | Mini App HTML entry, loads the Telegram SDK. |
| `frontend/hr_attendance/scripts/copy-miniapp-html.mjs` | Copies built HTML to `www/hr-me.html`, with a CSS floor guard. |
| `frontend/hr_attendance/src/miniapp/main.tsx` | Mini App React entry. |
| `frontend/hr_attendance/src/miniapp/MiniAppShell.tsx` | Thin shell: three tabs, no HR chrome. |
| `frontend/hr_attendance/src/miniapp/useMiniAppSession.ts` | Reads `initData`, calls the API. |
| `frontend/hr_attendance/src/miniapp/MyDayPage.tsx` | Day timeline. |
| `frontend/hr_attendance/src/miniapp/MyWeekPage.tsx` | Week view. |
| `frontend/hr_attendance/src/miniapp/MySchedulePage.tsx` | Assigned shift schedule. |
| `frontend/hr_attendance/src/miniapp/*.test.tsx` | Component tests (picked up by the existing `test:web` glob). |

**Modified:**

| Path | Change |
|---|---|
| `dewey_time/attendance_engine/hr_calendar.py:531`–EOF | Extract `build_employee_calendar`; `get_employee_calendar` keeps its gate and delegates. |
| `dewey_time/telegram/webhook.py` | Offer the Mini App button after a successful link. |
| `dewey_time/hooks.py` | `website_route_rules` for `/hr-me`; `after_migrate` gains the miniapp asset sync. |
| `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json` | Add `telegram_miniapp_url`. Bump `modified` past `2026-08-18`. |
| `frontend/hr_attendance/package.json` | `build:miniapp` script. |

**Nothing moves.** The spec estimated "~2,900 lines relocating"; that was wrong. A second Vite *config* in the same project shares `src/` and `node_modules`, so `DayCell`, `PlannedWeekCanvas`, `TimelineAxis`, `DayChips`, `PlannedDayColumn` and their ~2,000 lines of `lib/` dependencies are imported with the existing `@/` alias, unchanged and untouched.

---

### Task 1: Extract a reusable calendar builder

Behaviour-preserving refactor. `get_employee_calendar` is ~270 lines running from `hr_calendar.py:531` to end of file, with `_require_calendar_access(employee)` as its first statement and the whole payload inlined beneath. Because this design creates no Frappe `User`, nothing can ever satisfy that gate, so `get_my_calendar` cannot call the function at all.

**Files:**
- Modify: `dewey_time/attendance_engine/hr_calendar.py:531`–EOF
- Test: `dewey_time/tests/test_hr_calendar.py` (existing — the guard)

**Interfaces:**
- Consumes: nothing new.
- Produces: `build_employee_calendar(employee: str, start_date: str, end_date: str) -> dict` — the full HR payload, **no permission check inside**.

- [ ] **Step 1: Record the current payload as a characterization test**

Before moving a line. Add to `dewey_time/tests/test_hr_calendar.py`:

```python
class TestBuilderExtractionIsBehaviourPreserving(unittest.TestCase):
    def test_the_gated_api_and_the_builder_return_the_same_payload(self):
        # The extraction's whole contract. If these ever diverge, HR's calendar
        # and the employee's are being built by different code.
        from dewey_time.attendance_engine import hr_calendar

        with patch.object(hr_calendar, "_require_calendar_access"):
            gated = hr_calendar.get_employee_calendar(
                "HR-EMP-00001", "2026-08-10", "2026-08-11"
            )
        direct = hr_calendar.build_employee_calendar(
            "HR-EMP-00001", "2026-08-10", "2026-08-11"
        )
        self.assertEqual(gated, direct)

    def test_the_gate_still_runs_on_the_whitelisted_api(self):
        # The extraction must not take the permission check with it.
        from dewey_time.attendance_engine import hr_calendar

        with patch.object(hr_calendar, "_require_calendar_access") as gate:
            hr_calendar.get_employee_calendar("HR-EMP-00001", "2026-08-10", "2026-08-11")
        gate.assert_called_once_with("HR-EMP-00001")

    def test_the_builder_does_not_check_permissions(self):
        # It is called from a context that has already authorized differently.
        # A gate here would make the Mini App path impossible again.
        from dewey_time.attendance_engine import hr_calendar

        with patch.object(hr_calendar, "_require_calendar_access") as gate:
            hr_calendar.build_employee_calendar(
                "HR-EMP-00001", "2026-08-10", "2026-08-11"
            )
        gate.assert_not_called()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_hr_calendar`
Expected: FAIL — `AttributeError: module has no attribute 'build_employee_calendar'`

- [ ] **Step 3: Perform the extraction**

In `hr_calendar.py`, replace the `def get_employee_calendar(...)` header and its gate with these two definitions, leaving **every line of the body below unchanged and at the same indentation**:

```python
@frappe.whitelist()
def get_employee_calendar(employee: str, start_date: str, end_date: str):
    """
    HR calendar range API (MVP):
    - checkins bucketed per day
    - computed first/last + gross minutes (simple heuristic)
    - flags per day (chips)
    - shift context per day (when assigned)
    """
    _require_calendar_access(employee)
    return build_employee_calendar(employee, start_date, end_date)


def build_employee_calendar(employee: str, start_date: str, end_date: str):
    """The payload, with NO permission check.

    Split out of get_employee_calendar so a caller that has authorized by some
    other means can reach it. The Telegram Mini App is that caller: it creates
    no Frappe User, so _require_calendar_access -- which resolves identity via
    frappe.session.user -> Employee.user_id -- can never pass for it.

    Callers are responsible for authorization. There are exactly two:
    get_employee_calendar above (HR or self, via _require_calendar_access) and
    telegram/miniapp_api.get_my_calendar (via a verified Telegram binding).
    """
    start = getdate(start_date)
    end = getdate(end_date)
    ...  # the remaining ~265 lines, moved verbatim
```

Do not reformat, reorder, or "tidy" the moved body. The characterization test compares payloads, not source.

- [ ] **Step 4: Run to verify it passes**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_hr_calendar`
Expected: PASS, including the three new tests.

- [ ] **Step 5: Run the full suite**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend`
Expected: PASS at **889** (886 baseline + 3 new). The calendar is read by the HR SPA, the flag queue and the engine, so the full suite is the real gate for this refactor.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/attendance_engine/hr_calendar.py dewey_time/tests/test_hr_calendar.py
git commit -m "refactor(calendar): extract build_employee_calendar from the gated API"
```

---

### Task 2: `initData` validation

**Write this in the main session — do not delegate** (`CLAUDE.md`, isolation predicates). A defect here serves any unauthenticated caller the whole workforce's attendance, and there is no permission layer underneath to catch it.

**Files:**
- Create: `dewey_time/telegram/miniapp_auth.py`
- Test: `dewey_time/tests/test_telegram_miniapp_auth.py`

**Interfaces:**
- Consumes: `transport.bot_token()`, `binding.employee_for_telegram_user()` (plan 1).
- Produces:
  - `employee_from_init_data(init_data: str) -> str` — returns the Employee id, or raises. Never a boolean, never `None`.
  - `MAX_AUTH_AGE_SECONDS = 86400`

- [ ] **Step 1: Write the failing tests**

Create `dewey_time/tests/test_telegram_miniapp_auth.py`:

```python
import hashlib
import hmac
import json
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import miniapp_auth  # noqa: E402

BOT_TOKEN = "123456:TEST-TOKEN"


def sign(fields: dict, token: str = BOT_TOKEN) -> str:
    """Build a correctly signed initData string, the way Telegram does."""
    check = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    digest = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields, "hash": digest})


def valid_fields(user_id=55501, auth_date=None):
    return {
        "auth_date": str(int(auth_date if auth_date is not None else time.time())),
        "query_id": "AAF",
        "user": json.dumps({"id": user_id, "first_name": "Test"}),
    }


class TestSignature(unittest.TestCase):
    def test_a_correctly_signed_payload_resolves_to_its_employee(self):
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN), \
             patch.object(miniapp_auth.binding, "employee_for_telegram_user",
                          return_value="HR-EMP-00001") as resolve:
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(valid_fields())),
                "HR-EMP-00001",
            )
        # Resolved from the SIGNED user id, never from anything else in the request.
        self.assertEqual(resolve.call_args[0][0], "55501")

    def test_a_tampered_field_is_rejected(self):
        # Re-sign a legitimate payload, then swap the user id without re-signing:
        # the exact attack this check exists to stop.
        signed = sign(valid_fields(user_id=55501))
        forged = signed.replace("55501", "99999")
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN):
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data(forged)

    def test_a_payload_signed_with_another_token_is_rejected(self):
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN):
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data(sign(valid_fields(), token="999:OTHER"))

    def test_an_absent_hash_is_rejected_not_skipped(self):
        # The classic bypass shape. Missing must reject, never fall through.
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN):
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data(urlencode(valid_fields()))

    def test_an_empty_init_data_is_rejected(self):
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN):
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data("")


class TestFreshness(unittest.TestCase):
    def test_stale_init_data_is_rejected(self):
        # Without this, captured initData is a permanent credential. It is the
        # one failure here that is completely invisible when it is missing:
        # everything works, and every test still passes.
        old = time.time() - miniapp_auth.MAX_AUTH_AGE_SECONDS - 60
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN):
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data(sign(valid_fields(auth_date=old)))

    def test_recent_init_data_is_accepted(self):
        recent = time.time() - 60
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN), \
             patch.object(miniapp_auth.binding, "employee_for_telegram_user",
                          return_value="HR-EMP-00001"):
            self.assertEqual(
                miniapp_auth.employee_from_init_data(sign(valid_fields(auth_date=recent))),
                "HR-EMP-00001",
            )

    def test_a_missing_auth_date_is_rejected(self):
        fields = valid_fields()
        del fields["auth_date"]
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN):
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data(sign(fields))


class TestUserField(unittest.TestCase):
    def test_a_payload_with_no_user_is_rejected(self):
        fields = valid_fields()
        del fields["user"]
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN):
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data(sign(fields))

    def test_unparseable_user_json_is_rejected(self):
        fields = valid_fields()
        fields["user"] = "{not json"
        with patch.object(miniapp_auth.transport, "bot_token", return_value=BOT_TOKEN):
            with self.assertRaises(Exception):
                miniapp_auth.employee_from_init_data(sign(fields))
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_miniapp_auth`
Expected: FAIL — `ImportError: cannot import name 'miniapp_auth'`

- [ ] **Step 3: Write the validator**

Create `dewey_time/telegram/miniapp_auth.py`:

```python
"""Telegram Mini App initData validation.

THE SECURITY BOUNDARY OF THE MINI APP.

There is no Frappe permission backstop beneath this. `frappe.get_all` bypasses
permissions -- verified on a real bench 2026-08-15 -- so if this function is
wrong, or is skipped, an unauthenticated caller reads the workforce's
attendance. It is the only line of defence, not the first.

Fails closed by construction: returns an Employee id or raises. Never a
boolean, never None.

The algorithm is Telegram's, and each step matters:
  secret_key = HMAC_SHA256(key=b"WebAppData", msg=bot_token)
  data_check_string = "\\n".join(sorted "key=value", excluding `hash`)
  expected = HMAC_SHA256(key=secret_key, msg=data_check_string)
Note the key/message order in the first line -- it is the reverse of the
intuitive reading, and getting it backwards makes nothing validate (which at
least fails loudly).
"""

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

import frappe

from dewey_time.telegram import binding, transport

#: How long a launch stays usable. Telegram's own guidance for validating
#: initData on the server. Without this, captured initData is a permanent
#: credential -- and unlike a wrong signature, a missing freshness check is
#: completely invisible: every test still passes.
MAX_AUTH_AGE_SECONDS = 86400  # 24 hours


def _reject():
    frappe.throw("Not permitted", frappe.PermissionError)


def employee_from_init_data(init_data: str) -> str:
    """Verify Telegram's initData and return the bound Employee, or raise."""
    if not init_data:
        _reject()

    # strict_parsing so a malformed string raises rather than silently
    # yielding a short pair list that then fails the hash check for the
    # wrong reason.
    try:
        pairs = dict(parse_qsl(init_data, strict_parsing=True))
    except Exception:
        _reject()

    supplied = pairs.pop("hash", None)
    if not supplied:
        # Missing must REJECT, not skip. This is the bypass shape.
        _reject()

    check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret_key = hmac.new(b"WebAppData", transport.bot_token().encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, supplied):
        _reject()

    auth_date = pairs.get("auth_date")
    if not auth_date:
        _reject()
    try:
        age = time.time() - int(auth_date)
    except (TypeError, ValueError):
        _reject()
    if age > MAX_AUTH_AGE_SECONDS:
        _reject()

    raw_user = pairs.get("user")
    if not raw_user:
        _reject()
    try:
        telegram_user_id = json.loads(raw_user).get("id")
    except Exception:
        _reject()
    if not telegram_user_id:
        _reject()

    # The signature proves this id came from Telegram. The binding decides
    # whose record it is; a valid signature alone authorizes nothing.
    return binding.employee_for_telegram_user(str(telegram_user_id))
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_miniapp_auth`
Expected: PASS, 11 tests. **Confirm the count is 11.**

- [ ] **Step 5: Mutation-test every guard**

Each of these must fail at least one test. Apply, run, restore:

| Mutation | Must fail |
|---|---|
| `if not supplied:` → `if False:` | the absent-hash test |
| delete the `compare_digest` rejection | tampered + wrong-token tests |
| delete the `age > MAX_AUTH_AGE_SECONDS` rejection | the stale test |
| swap the HMAC key order to `hmac.new(transport.bot_token().encode(), b"WebAppData", ...)` | the valid-payload test |
| `str(telegram_user_id)` → a literal `"55501"` | nothing today — **add a test if so** |

The last row is the point of the exercise: if a mutation survives, the test suite has a hole. Fix the suite, not the table.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/telegram/miniapp_auth.py dewey_time/tests/test_telegram_miniapp_auth.py
git commit -m "feat(miniapp): initData HMAC validation, fail-closed"
```

---

### Task 3: `get_my_calendar` and the allowlist projection

**Also the security boundary — write in the main session, do not delegate.**

**Files:**
- Create: `dewey_time/telegram/miniapp_api.py`
- Test: `dewey_time/tests/test_telegram_miniapp_api.py`

**Interfaces:**
- Consumes: `miniapp_auth.employee_from_init_data` (Task 2); `hr_calendar.build_employee_calendar` (Task 1).
- Produces: `get_my_calendar(init_data: str, start_date: str, end_date: str) -> dict` — whitelisted, `allow_guest=True`. **No employee parameter.**

- [ ] **Step 1: Write the failing tests**

Create `dewey_time/tests/test_telegram_miniapp_api.py`:

```python
import inspect
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import miniapp_api  # noqa: E402

# A full HR payload, including everything an employee must never receive.
HR_PAYLOAD = {
    "employee": "HR-EMP-00001",
    "is_clock_based": False,
    "device_sync": [
        {"device_sn": "CK92218010001", "last_error": "timeout", "pending_count": 3}
    ],
    "days": [
        {
            "date": "2026-08-14",
            "shift": {
                "shift_assigned": True,
                "shift_type": "FT_Standard",
                "start_time": "08:00:00",
                "end_time": "17:00:00",
                "grace_minutes": 15,
                "lunch_start": "12:00:00",
                "lunch_end": "13:00:00",
            },
            "holiday": None,
            "leave": {"on_leave": False},
            "observed_lunch": None,
            "checkins": [
                {
                    "name": "EMP-CKIN-1",
                    "time": "2026-08-14 07:58:00",
                    "log_type": "IN",
                    "device_id": "ZK-A4-014",
                    "custom_device_branch": "DIS Iconic",
                }
            ],
            "flags": [
                {
                    "name": "AUTO-emp-1-2026-08-14-late-start",
                    "flag_code": "LATE_START",
                    "evidence": {"first_in": "07:58"},
                }
            ],
        }
    ],
}


class TestSignatureGuard(unittest.TestCase):
    def test_the_endpoint_accepts_no_employee_selecting_parameter(self):
        # THE MOST IMPORTANT TEST IN THIS MODULE.
        #
        # The endpoint is safe today because an attacker cannot name a victim --
        # there is no field to put one in. That property will not die to an
        # attack; it will die to a reasonable-looking edit, when someone
        # building the manager view adds `employee=None` so a supervisor can
        # see their team. Every other test here would still pass, because they
        # all exercise the employee's own path.
        #
        # If you are here because this test failed: resolving an employee from
        # a caller-supplied parameter needs its own authorization design, not a
        # new parameter. Do not delete this test to make it pass.
        params = set(inspect.signature(miniapp_api.get_my_calendar).parameters)
        self.assertEqual(params, {"init_data", "start_date", "end_date"})


class TestProjection(unittest.TestCase):
    def _narrowed(self):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00001"), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar",
                          return_value=HR_PAYLOAD):
            return miniapp_api.get_my_calendar("initdata", "2026-08-14", "2026-08-14")

    def test_the_day_key_set_is_exactly_the_allowlist(self):
        # Equality, NOT "device_sync is absent". An absence assertion passes
        # forever while a newly added field leaks; equality fails the moment
        # the payload grows, which is the alarm the allowlist exists to raise.
        day = self._narrowed()["days"][0]
        self.assertEqual(
            set(day),
            {"date", "shift", "checkins", "holiday", "leave", "observed_lunch"},
        )

    def test_the_top_level_key_set_is_exactly_the_allowlist(self):
        self.assertEqual(set(self._narrowed()), {"employee", "days"})

    def test_the_shift_block_drops_grace_minutes(self):
        # grace_minutes tells an employee exactly how late they can be before
        # the system notices. That is HR policy, not employee-facing data.
        shift = self._narrowed()["days"][0]["shift"]
        self.assertEqual(
            set(shift),
            {"shift_assigned", "shift_type", "start_time", "end_time",
             "lunch_start", "lunch_end"},
        )

    def test_each_checkin_is_narrowed_too(self):
        # A top-level allowlist alone would pass device_id and
        # custom_device_branch straight through inside the punch objects.
        checkin = self._narrowed()["days"][0]["checkins"][0]
        self.assertEqual(set(checkin), {"time", "log_type"})

    def test_no_flags_reach_the_employee(self):
        # Intraday deletes and re-inserts AUTO flags on every checkin, so an
        # employee watching them would see provisional judgments appear and
        # vanish all day.
        payload = self._narrowed()
        self.assertNotIn("flags", payload["days"][0])
        self.assertNotIn("LATE_START", repr(payload))
        self.assertNotIn("AUTO-emp-1", repr(payload))

    def test_no_device_internals_reach_the_employee(self):
        payload = repr(self._narrowed())
        self.assertNotIn("CK92218010001", payload)
        self.assertNotIn("last_error", payload)
        self.assertNotIn("ZK-A4-014", payload)


class TestAuth(unittest.TestCase):
    def test_the_employee_comes_from_initdata_not_the_request(self):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00007") as auth, \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar",
                          return_value=HR_PAYLOAD) as build:
            miniapp_api.get_my_calendar("thedata", "2026-08-14", "2026-08-14")
        auth.assert_called_once_with("thedata")
        self.assertEqual(build.call_args[0][0], "HR-EMP-00007")

    def test_a_rejected_initdata_never_reaches_the_builder(self):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          side_effect=Exception("Not permitted")), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar") as build:
            with self.assertRaises(Exception):
                miniapp_api.get_my_calendar("bad", "2026-08-14", "2026-08-14")
        build.assert_not_called()

    def test_the_range_is_bounded(self):
        # An unbounded range would let one launch pull the employee's whole
        # history in a single query.
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00001"), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar"):
            with self.assertRaises(Exception):
                miniapp_api.get_my_calendar("d", "2020-01-01", "2026-08-14")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_miniapp_api`
Expected: FAIL — `ImportError: cannot import name 'miniapp_api'`

- [ ] **Step 3: Write the endpoint**

Create `dewey_time/telegram/miniapp_api.py`:

```python
"""The Mini App's only read endpoint.

Two properties carry this module, and both are structural rather than vigilant:

1. It takes NO employee-selecting parameter. An attacker cannot name a victim
   because there is no field to put one in. test_the_endpoint_accepts_no_
   employee_selecting_parameter guards that, and exists because the property
   will die to a reasonable future edit rather than to an attack.

2. The projection is an ALLOWLIST. Written as removals it would fail open --
   a field added to the calendar builder for an HR need would reach every
   employee silently, with no test failing. Built this way, a new field is
   hidden by default and exposing it is a deliberate edit.
"""

import frappe
from frappe.utils import date_diff, getdate

from dewey_time.attendance_engine import hr_calendar
from dewey_time.telegram import miniapp_auth

#: One launch cannot pull more than this. Wide enough for a month view,
#: narrow enough that it is not a history export.
MAX_RANGE_DAYS = 62

DAY_KEYS = ("date", "shift", "checkins", "holiday", "leave", "observed_lunch")
SHIFT_KEYS = (
    "shift_assigned",
    "shift_type",
    "start_time",
    "end_time",
    "lunch_start",
    "lunch_end",
)
#: NOT device_id and NOT custom_device_branch -- those are HR's. A top-level
#: allowlist alone would pass them through inside each punch.
CHECKIN_KEYS = ("time", "log_type")


def _pick(source, keys):
    return {k: source[k] for k in keys if k in (source or {})}


def narrow(payload: dict) -> dict:
    """Project the HR calendar payload down to what an employee may see."""
    days = []
    for day in payload.get("days") or []:
        narrowed = _pick(day, DAY_KEYS)
        if "shift" in narrowed:
            narrowed["shift"] = _pick(day.get("shift"), SHIFT_KEYS)
        narrowed["checkins"] = [
            _pick(c, CHECKIN_KEYS) for c in (day.get("checkins") or [])
        ]
        days.append(narrowed)
    return {"employee": payload.get("employee"), "days": days}


@frappe.whitelist(allow_guest=True)
def get_my_calendar(init_data: str, start_date: str, end_date: str) -> dict:
    """The employee's own calendar, resolved from their Telegram binding.

    allow_guest because no Frappe User exists for these callers. The initData
    signature and the binding are the entire authorization -- see
    miniapp_auth's module docstring.
    """
    employee = miniapp_auth.employee_from_init_data(init_data)

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be on or after start_date")
    if date_diff(end, start) > MAX_RANGE_DAYS:
        frappe.throw(f"Range is limited to {MAX_RANGE_DAYS} days")

    return narrow(hr_calendar.build_employee_calendar(employee, str(start), str(end)))
```

- [ ] **Step 4: Add `date_diff` to the test mock**

`frappe.utils` in `test_closeout._install_frappe_mock` is a real `ModuleType`, so a missing attribute is a hard `ImportError`. Beside the existing `utils_mod.add_to_date`:

```python
    utils_mod.date_diff = lambda end, start: 0
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_miniapp_api`
Expected: PASS, 10 tests. **Confirm the count is 10.**

Note `test_the_range_is_bounded` needs `date_diff` to return a real difference — override it in that test with `patch.object(miniapp_api, "date_diff", return_value=2417)` rather than loosening the shared mock.

- [ ] **Step 6: Mutation-test the projection**

Remove `"observed_lunch"` from `DAY_KEYS` → the day key-set test must fail. Add `"grace_minutes"` to `SHIFT_KEYS` → the shift test must fail. Add `"device_id"` to `CHECKIN_KEYS` → the checkin test must fail. Restore each.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/telegram/miniapp_api.py dewey_time/tests/test_telegram_miniapp_api.py dewey_time/tests/test_closeout.py
git commit -m "feat(miniapp): get_my_calendar with an allowlist projection and a signature guard"
```

---

### Task 4: The bot offers the Mini App

**Files:**
- Modify: `dewey_time/telegram/transport.py` (add `send_message_with_webapp_button`)
- Modify: `dewey_time/telegram/webhook.py` (use it on successful link)
- Modify: `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json`
- Test: `dewey_time/tests/test_telegram_webhook.py` (extend)

**Interfaces:**
- Consumes: `transport.send_message` (plan 1).
- Produces: `transport.send_message_with_webapp_button(chat_id, text, button_text, url) -> str`; `transport.miniapp_url() -> str`.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_telegram_webhook.py`:

```python
class TestMiniAppButton(unittest.TestCase):
    def test_a_successful_link_offers_the_mini_app(self):
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001"), \
             patch.object(webhook.transport, "miniapp_url",
                          return_value="https://site/hr-me"), \
             patch.object(webhook.transport,
                          "send_message_with_webapp_button") as button:
            webhook._handle(_update(text="/start abc123"))
        self.assertEqual(button.call_args[1]["url"], "https://site/hr-me")

    def test_an_unconfigured_mini_app_url_still_confirms_the_link(self):
        # The binding succeeded. Failing to offer a button must not make the
        # employee think linking failed.
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001"), \
             patch.object(webhook.transport, "miniapp_url",
                          side_effect=Exception("not configured")), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))
        self.assertIn("linked", send.call_args[0][1].lower())
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_webhook`
Expected: FAIL — `AttributeError: ... has no attribute 'miniapp_url'`

- [ ] **Step 3: Add the transport helpers**

Append to `dewey_time/telegram/transport.py`:

```python
def miniapp_url() -> str:
    """Absolute https URL of the Mini App page, or raise.

    Telegram requires https and rejects a web_app button otherwise, so a
    misconfiguration must surface here rather than as a silent no-button.
    """
    url = (frappe.get_cached_value(SETTINGS, SETTINGS, "telegram_miniapp_url") or "").strip()
    if not url.startswith("https://"):
        frappe.throw("Telegram Mini App URL must be set and must be https")
    return url


def send_message_with_webapp_button(chat_id: str, text: str, *, button_text: str, url: str) -> str:
    """send_message, plus a keyboard button that launches the Mini App."""
    try:
        response = requests.post(
            f"{API_BASE}/bot{bot_token()}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                "reply_markup": {
                    "inline_keyboard": [[{"text": button_text, "web_app": {"url": url}}]]
                },
            },
            timeout=TIMEOUT_SECONDS,
        )
    except Exception:
        frappe.log_error(title="Telegram send failed", message=frappe.get_traceback())
        return FAILED

    if response.status_code == 403:
        return BLOCKED
    if response.status_code != 200:
        frappe.log_error(
            title="Telegram send rejected",
            message=f"status={response.status_code} body={response.text[:500]}",
        )
        return FAILED
    return SENT
```

- [ ] **Step 4: Use it on a successful link**

In `dewey_time/telegram/webhook.py`, add the constant beside the other replies:

```python
OPEN_BUTTON_TEXT = "Open my attendance"
```

and replace the final line of `_handle` (`transport.send_message(chat_id, LINKED_REPLY)`) with:

```python
    # Offer the Mini App, but never let that failure look like a link failure:
    # the binding is already written and the employee is linked either way.
    try:
        transport.send_message_with_webapp_button(
            chat_id, LINKED_REPLY, button_text=OPEN_BUTTON_TEXT, url=transport.miniapp_url()
        )
    except Exception:
        frappe.log_error(
            title="Telegram Mini App button unavailable", message=frappe.get_traceback()
        )
        transport.send_message(chat_id, LINKED_REPLY)
```

- [ ] **Step 5: Add the settings field**

In `dewey_time_settings.json`, add `"telegram_miniapp_url"` to `field_order` after `"telegram_webhook_secret"`, and to `fields`:

```json
    {
      "description": "Absolute https URL of the Mini App page, e.g. https://<site>/hr-me",
      "fieldname": "telegram_miniapp_url",
      "fieldtype": "Data",
      "label": "Telegram Mini App URL"
    }
```

Set `"modified"` to `"2026-08-19 00:00:00.000000"` — it **must exceed** the current `2026-08-18`, or `bench migrate` skips the reimport and the field never appears. Plan 1 shipped exactly this bug; a freshly provisioned sandbox cannot catch it, so check the value rather than trusting a green migrate.

- [ ] **Step 6: Run to verify it passes**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_webhook`
Expected: PASS, 12 tests.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/telegram/transport.py dewey_time/telegram/webhook.py \
        dewey_time/tests/test_telegram_webhook.py \
        dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json
git commit -m "feat(miniapp): the bot offers a launch button after linking"
```

---

### Task 5: The Mini App build and its Frappe page

**Files:**
- Create: `frontend/hr_attendance/vite.miniapp.config.ts`, `index.miniapp.html`, `scripts/copy-miniapp-html.mjs`, `src/miniapp/main.tsx`
- Create: `dewey_time/www/hr-me.py`, `dewey_time/utils/sync_miniapp_assets.py`
- Modify: `frontend/hr_attendance/package.json`, `dewey_time/hooks.py`
- Test: `dewey_time/tests/test_hr_me_route_wiring.py`

**Interfaces:**
- Consumes: `get_my_calendar` (Task 3).
- Produces: the route `/hr-me`, the bundle at `public/miniapp/assets/index.js`.

The Mini App is a **second Vite config in the existing project**, not a new project and not a second entry in the existing config. The existing config hardcodes `entryFileNames: "assets/index.js"`, and `sync_hr_attendance_assets._hr_attendance_bundle_ok` checks that exact path, so a second entry would collide and reach into the deploy path. A second config shares `src/` and `node_modules` — so `@/ui/DayCell` and its ~2,000 lines of `lib/` dependencies are imported unchanged — while emitting a separate, much smaller bundle.

- [ ] **Step 1: Write the route-wiring test**

Create `dewey_time/tests/test_hr_me_route_wiring.py`:

```python
import os
import unittest

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TestHrMeRouteWiring(unittest.TestCase):
    def test_the_page_controller_exists(self):
        self.assertTrue(os.path.isfile(os.path.join(APP_ROOT, "www", "hr-me.py")))

    def test_the_route_rules_cover_the_spa_path(self):
        # Without a <path:app_path> rule a client-side route 404s on reload,
        # which in a Mini App webview looks like the app is broken.
        with open(os.path.join(APP_ROOT, "hooks.py"), encoding="utf-8") as handle:
            hooks = handle.read()
        self.assertIn('"from_route": "/hr-me"', hooks)
        self.assertIn('"from_route": "/hr-me/<path:app_path>"', hooks)

    def test_the_asset_sync_runs_after_migrate(self):
        # Frappe Cloud never builds these SPAs, so the committed bundle has to
        # be republished into sites/assets on every migrate or the page 404s.
        with open(os.path.join(APP_ROOT, "hooks.py"), encoding="utf-8") as handle:
            hooks = handle.read()
        self.assertIn("sync_miniapp_assets", hooks)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_hr_me_route_wiring`
Expected: FAIL on all three.

- [ ] **Step 3: Create the page controller**

Create `dewey_time/www/hr-me.py` — identical in shape to `www/hr-attendance.py`:

```python
import frappe
from frappe.utils import get_system_timezone

no_cache = 1


def get_context(context):
    csrf_token = frappe.sessions.get_csrf_token()
    frappe.db.commit()

    context.update({"csrf_token": csrf_token, "boot": get_boot()})
    return context


def get_boot():
    return frappe._dict(
        {
            "frappe_version": frappe.__version__,
            "site_name": frappe.local.site,
            "read_only_mode": frappe.flags.read_only,
            "system_timezone": get_system_timezone(),
        }
    )
```

- [ ] **Step 4: Create the Vite config**

Create `frontend/hr_attendance/vite.miniapp.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// A SECOND CONFIG, not a second entry in vite.config.ts. That file pins
// entryFileNames to "assets/index.js", and sync_hr_attendance_assets checks
// that exact path, so adding an entry there would collide and reach into the
// deploy path. Sharing src/ and node_modules means @/ui/* imports work
// unchanged while this build emits its own, far smaller bundle.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/assets/dewey_time/miniapp/",
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    outDir: path.resolve(__dirname, "../../public/miniapp"),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2015",
    rollupOptions: {
      input: path.resolve(__dirname, "index.miniapp.html"),
      output: {
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? "";
          if (name.endsWith(".css")) return "assets/index.css";
          return "assets/[name][extname]";
        },
      },
    },
  },
});
```

- [ ] **Step 5: Create the HTML entry**

Create `frontend/hr_attendance/index.miniapp.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>My Attendance</title>
    <!-- Telegram's SDK, which is what puts initData on window.Telegram.WebApp.
         It must be a plain script tag from telegram.org: Telegram does not
         inject it, and bundling a copy is unsupported. -->
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/miniapp/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create the React entry**

Create `frontend/hr_attendance/src/miniapp/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@/lib/queryClient";
import { ErrorBoundary } from "@/components/error-boundary";
import { MiniAppShell } from "@/miniapp/MiniAppShell";
import "@/index.css";

// Tell Telegram the webview is ready and let it size to the sheet. Safe to
// call when absent: the app is also openable as a plain page for debugging.
window.Telegram?.WebApp?.ready?.();
window.Telegram?.WebApp?.expand?.();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MiniAppShell />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
```

Add the global type in `frontend/hr_attendance/src/miniapp/telegram.d.ts`:

```ts
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
        colorScheme?: "light" | "dark";
      };
    };
  }
}
export {};
```

- [ ] **Step 7: Create the HTML copier with its own CSS floor**

Create `frontend/hr_attendance/scripts/copy-miniapp-html.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../../..");
const builtHtml = path.join(appRoot, "public/miniapp/index.miniapp.html");
const builtCss = path.join(appRoot, "public/miniapp/assets/index.css");
const target = path.join(appRoot, "www/hr-me.html");

// Same trap as copy-html-entry.mjs: Tailwind's @source for dewey-ui is a
// filesystem glob, so with no node_modules it scans nothing, emits a
// stylesheet with none of the design system's classes, and EXITS 0. That
// bundle is the deployed artifact. This app's surface is smaller than the HR
// console's, so the floor is lower -- but it is not zero.
const MIN_CSS_BYTES = 40_000;

if (!fs.existsSync(builtHtml)) {
  console.error(`Build output not found: ${builtHtml}`);
  process.exit(1);
}

const cssBytes = fs.existsSync(builtCss) ? fs.statSync(builtCss).size : 0;
if (cssBytes < MIN_CSS_BYTES) {
  console.error(
    `miniapp index.css is ${cssBytes} bytes, under the ${MIN_CSS_BYTES} byte floor.\n` +
      `Most likely cause: no node_modules at frontend/hr_attendance, so Tailwind's @source glob matched nothing.\n` +
      `Fix the install and rebuild; do NOT commit this bundle.`,
  );
  process.exit(1);
}

let html = fs.readFileSync(builtHtml, "utf8");
// Frappe renders www/*.html as Jinja, so the csrf token goes in here the way
// the HR pages do it.
html = html.replace(
  "</head>",
  '  <script>window.csrf_token = "{{ frappe.session.csrf_token }}";</script>\n  </head>',
);
fs.writeFileSync(target, html);
console.log(`Wrote ${target} (css ${cssBytes} bytes)`);
```

- [ ] **Step 8: Add the build script**

In `frontend/hr_attendance/package.json`, add to `scripts`:

```json
    "build:miniapp": "vite build --config vite.miniapp.config.ts && node scripts/copy-miniapp-html.mjs",
```

- [ ] **Step 9: Create the asset sync**

Create `dewey_time/utils/sync_miniapp_assets.py` as a copy of `dewey_time/utils/sync_adms_assets.py` with `BUNDLE = "miniapp"` and the function names `sync_miniapp_assets` / `force_sync_miniapp_assets`. Read that file and mirror it exactly — it already handles the symlink-deletion hazard documented in `docs/HR_ATTENDANCE_DEPLOY.md`.

- [ ] **Step 10: Wire the routes and the sync**

In `dewey_time/hooks.py`, add to `website_route_rules`:

```python
    {"from_route": "/hr-me/<path:app_path>", "to_route": "hr-me"},
    {"from_route": "/hr-me", "to_route": "hr-me"},
```

and to `after_migrate`:

```python
    "dewey_time.utils.sync_miniapp_assets.sync_miniapp_assets",
```

- [ ] **Step 11: Build and verify the page loads**

```bash
cd dewey_time/frontend/hr_attendance && npm run build:miniapp
ls -la ../../public/miniapp/assets/
```

Expected: `index.js` and `index.css` present, and **`index.js` is far smaller than the HR bundle's ~1.0MB** — that size difference is the entire reason for a second config. Record both sizes in the commit message.

- [ ] **Step 12: Run the route tests and the full suite**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_hr_me_route_wiring` → PASS, 3 tests.
Then: `cd dev/sandbox && ./frappe-sandbox test --backend` → PASS.

- [ ] **Step 13: Commit, including the built bundle**

```bash
git add frontend/hr_attendance/vite.miniapp.config.ts \
        frontend/hr_attendance/index.miniapp.html \
        frontend/hr_attendance/scripts/copy-miniapp-html.mjs \
        frontend/hr_attendance/src/miniapp frontend/hr_attendance/package.json \
        dewey_time/www/hr-me.py dewey_time/www/hr-me.html \
        dewey_time/utils/sync_miniapp_assets.py dewey_time/hooks.py \
        dewey_time/public/miniapp dewey_time/tests/test_hr_me_route_wiring.py
git commit -m "feat(miniapp): second Vite config, /hr-me page and asset sync"
```

The bundle under `dewey_time/public/miniapp` **must** be committed. Frappe Cloud never builds these SPAs.

---

### Task 6: The three views

**Files:**
- Create: `src/miniapp/MiniAppShell.tsx`, `useMiniAppSession.ts`, `MyDayPage.tsx`, `MyWeekPage.tsx`, `MySchedulePage.tsx`
- Create: `src/miniapp/miniAppSession.test.ts`, `src/miniapp/miniAppShell.test.tsx`

**Interfaces:**
- Consumes: `get_my_calendar` (Task 3). Existing components, all imported unchanged via the `@/` alias:
  - `DayCell` from `@/ui/DayTimeline` — **note the export name does not match the filename**
  - `PlannedWeekCanvas`, `PlannedDayColumn`, `DayChips`, `TimelineAxis`, `WeekCanvasFrame`, `AppTooltip` from `@/ui/*`
  - `plannedDaysFromSchedule`, `plannedBlocksForDay`, type `PlannedDay` from `@/lib/plannedDays`
  - `resolveWeekTimelineWindow` from `@/lib/weekTimelineWindow` — **not** `@/lib/timelineAxis`, which only exports the `AxisWindow` type and the axis maths
  - `@/lib/attendancePunches`, `@/lib/shiftTimeline`, `@/lib/attendanceTime`, `@/lib/utils`
- Produces: the rendered Mini App.

- [ ] **Step 1: Write the failing session test**

Create `frontend/hr_attendance/src/miniapp/miniAppSession.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { initDataFromTelegram, MISSING_INIT_DATA } from "@/miniapp/useMiniAppSession";

test("initData is read from the Telegram SDK, never from the URL", () => {
  // A URL-supplied value would be attacker-controllable: anyone could paste a
  // captured launch into a browser. Only the SDK's copy is trusted.
  const w = { Telegram: { WebApp: { initData: "auth_date=1&hash=abc" } } } as never;
  assert.equal(initDataFromTelegram(w), "auth_date=1&hash=abc");
});

test("a page opened outside Telegram reports it rather than calling the API", () => {
  // Opening /hr-me in a plain browser must say so, not fire an unauthenticated
  // request and render a permission error.
  assert.equal(initDataFromTelegram({} as never), MISSING_INIT_DATA);
  assert.equal(initDataFromTelegram({ Telegram: { WebApp: {} } } as never), MISSING_INIT_DATA);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd dewey_time/frontend/hr_attendance && npm run test:web`
Expected: FAIL — cannot resolve `@/miniapp/useMiniAppSession`.

- [ ] **Step 3: Write the session hook**

Create `frontend/hr_attendance/src/miniapp/useMiniAppSession.ts`:

```ts
import { useQuery } from "@tanstack/react-query";

/** Sentinel for "this page is not running inside Telegram". */
export const MISSING_INIT_DATA = "";

export type MiniDay = {
  date: string;
  shift?: {
    shift_assigned?: boolean;
    shift_type?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    lunch_start?: string | null;
    lunch_end?: string | null;
  };
  checkins: { time: string; log_type: string | null }[];
  holiday?: { description?: string; weekly_off?: boolean } | null;
  leave?: { on_leave?: boolean; leave_type?: string | null } | null;
  observed_lunch?: unknown;
};

export type MiniCalendar = { employee: string; days: MiniDay[] };

/** Only the SDK's copy is trusted. A URL-supplied value would let anyone
 *  replay a captured launch by pasting it into a browser. */
export function initDataFromTelegram(w: Window): string {
  return w?.Telegram?.WebApp?.initData || MISSING_INIT_DATA;
}

async function fetchCalendar(
  initData: string,
  startDate: string,
  endDate: string,
): Promise<MiniCalendar> {
  const response = await fetch(
    "/api/method/dewey_time.telegram.miniapp_api.get_my_calendar",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": (window as { csrf_token?: string }).csrf_token ?? "",
      },
      body: JSON.stringify({
        init_data: initData,
        start_date: startDate,
        end_date: endDate,
      }),
    },
  );
  if (!response.ok) throw new Error(`calendar request failed: ${response.status}`);
  return (await response.json()).message as MiniCalendar;
}

export function useMiniAppCalendar(startDate: string, endDate: string) {
  const initData = initDataFromTelegram(window);
  return useQuery({
    queryKey: ["mini-calendar", startDate, endDate],
    enabled: initData !== MISSING_INIT_DATA,
    queryFn: () => fetchCalendar(initData, startDate, endDate),
  });
}
```

- [ ] **Step 4: Write the shell test**

Create `frontend/hr_attendance/src/miniapp/miniAppShell.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { OutsideTelegramNotice, MiniTabBar } from "@/miniapp/MiniAppShell";

test("outside Telegram the app explains itself instead of erroring", () => {
  const html = renderToStaticMarkup(<OutsideTelegramNotice />);
  assert.match(html, /Telegram/);
});

test("the shell offers exactly the three employee views", () => {
  // No HR tabs. This is not the HR console with things hidden; it is a
  // different surface that happens to share components.
  const html = renderToStaticMarkup(<MiniTabBar active="day" onSelect={() => {}} />);
  for (const label of ["Today", "Week", "Schedule"]) assert.match(html, new RegExp(label));
  for (const forbidden of ["Flags", "Coverage", "Import"]) {
    assert.doesNotMatch(html, new RegExp(forbidden));
  }
});
```

- [ ] **Step 5: Write the shell and the three pages**

Create `frontend/hr_attendance/src/miniapp/MiniAppShell.tsx`:

```tsx
import { useState } from "react";

import { MyDayPage } from "@/miniapp/MyDayPage";
import { MySchedulePage } from "@/miniapp/MySchedulePage";
import { MyWeekPage } from "@/miniapp/MyWeekPage";
import { initDataFromTelegram, MISSING_INIT_DATA } from "@/miniapp/useMiniAppSession";
import { cn } from "@/lib/utils";

export type MiniTab = "day" | "week" | "schedule";

const TABS: { key: MiniTab; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "Week" },
  { key: "schedule", label: "Schedule" },
];

export function OutsideTelegramNotice() {
  return (
    <div className="p-6 text-center text-sm text-muted-foreground">
      Open this page from the Dewey Time bot in Telegram.
    </div>
  );
}

export function MiniTabBar(props: { active: MiniTab; onSelect: (tab: MiniTab) => void }) {
  return (
    <nav className="flex shrink-0 border-t border-border">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => props.onSelect(tab.key)}
          className={cn(
            "flex-1 py-3 text-sm font-medium",
            props.active === tab.key ? "text-primary" : "text-muted-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function MiniAppShell() {
  const [tab, setTab] = useState<MiniTab>("day");

  if (initDataFromTelegram(window) === MISSING_INIT_DATA) {
    return <OutsideTelegramNotice />;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "day" ? <MyDayPage /> : tab === "week" ? <MyWeekPage /> : <MySchedulePage />}
      </main>
      <MiniTabBar active={tab} onSelect={setTab} />
    </div>
  );
}
```

`MyDayPage.tsx`, `MyWeekPage.tsx` and `MySchedulePage.tsx` each call `useMiniAppCalendar` for their range and render with the existing components — `DayCell` from `@/ui/DayTimeline` for the day, `PlannedWeekCanvas` + `plannedDaysFromSchedule` for the week and the schedule. **Read `src/ui/App.tsx` for how the HR page feeds those same components**; the prop shapes are identical, only the data source and the surrounding chrome differ.

- [ ] **Step 6: Run the web tests and the typecheck**

Run: `cd dewey_time/frontend/hr_attendance && npm run test:web`
Expected: PASS. **Read the reported count** — the glob exits 0 when it matches nothing.
Run: `npm run typecheck` → clean.

- [ ] **Step 7: Rebuild and commit the bundle**

```bash
cd dewey_time/frontend/hr_attendance && npm run build:miniapp
cd ../../.. && git add dewey_time/frontend/hr_attendance/src/miniapp dewey_time/public/miniapp dewey_time/www/hr-me.html
git commit -m "feat(miniapp): day, week and schedule views over the narrowed payload"
```

---

## Verification before the branch is finished

- [ ] Full Python suite green, count reconciled: 886 (plan 1) + Task 1's 3 + Task 2's 11 + Task 3's 10 + Task 4's 2 + Task 5's 3 = **915**.
- [ ] `npm run test:web` green **with a count**, and `npm run typecheck` clean.
- [ ] `bench migrate` clean; `telegram_miniapp_url` present in Dewey Time Settings — **check the field, not just a green migrate**, since a backward `modified` fails silently.
- [ ] The Mini App bundle is committed and materially smaller than the HR bundle.
- [ ] Signature guard: `get_my_calendar` still accepts exactly `init_data`, `start_date`, `end_date`.
- [ ] End-to-end in real Telegram: tap the bot's button, confirm the three views render the employee's own data, and confirm no device serial, flag or `grace_minutes` appears anywhere in the response (check the network tab, not the UI).
- [ ] Open `/hr-me` in a plain browser and confirm it shows the outside-Telegram notice rather than firing a request.

## Out of scope

Manager views of any kind. Leave requests. Writes of any kind — this app is read-only. Bot text commands beyond `/start`. Flags, evidence, device data or `grace_minutes` in any employee-facing surface. Push notifications (the existing `webpush.py` stays inert).
