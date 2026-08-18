# Telegram Link Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the whole Telegram link lifecycle — issue, regenerate, unlink — onto the coverage register, and make each operation leave at most one live credential per employee.

**Architecture:** The backend gains a `revoked_at` stamp on `Telegram Link Token`, so minting a link can revoke the employee's outstanding ones and redemption can refuse a superseded one. Redemption grows the guards that stop one employee ending up with two authorised Telegram accounts. The frontend collapses two issuing surfaces into one dialog on the register, reached from a row button that mints nothing on its own.

**Tech Stack:** Frappe v16 (Python), React 19 + TypeScript + Vite, TanStack Query v5, TanStack Table v8, `@lolbikb/dewey-ui` primitives, `react-qr-code`, `tsx --test` (node:test) for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-18-telegram-link-lifecycle-design.md`

## Global Constraints

- `DEFAULT_TTL_HOURS = 24` (was `168`).
- `TOKEN_BYTES = 32` — unchanged.
- Every whitelisted endpoint touched or added here is `@frappe.whitelist(methods=["POST"])` and calls `_require_hr_role()` first.
- Token rows are **never deleted**. Revocation is a stamped field.
- The QR is rendered client-side. The encoded value is the credential and must never reach a hosted QR service.
- Any DocType JSON change **must** bump that JSON's `modified` timestamp, or `bench migrate` skips the schema reimport on this bench.
- `test:web` in `dewey_time/frontend/hr_attendance/package.json` is an explicit per-directory glob list, not a recursive one. A new test directory must be added there or its tests silently never run while the suite still exits 0.
- Playwright must be invoked as `npm --prefix dewey_time/frontend/hr_attendance run test:e2e`. From the repo root it resolves the `adms` install, prints "No tests found" and **still exits 0**.
- Built SPA assets under `dewey_time/public/**` and `dewey_time/www/*.html` are the deployed artifact and must be committed; Frappe Cloud does not build them.
- Report test counts as **deltas** against the previous run, never absolutes.
- Commit trailers on every commit:
  ```
  Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
  Co-authored-by: Claude Opus 5 <noreply@anthropic.com>
  ```

## File Structure

**Backend**

| File | Responsibility |
|---|---|
| `dewey_time/dewey_time/doctype/telegram_link_token/telegram_link_token.json` | Adds `revoked_at`. |
| `dewey_time/telegram/binding.py` | Token lifecycle, redemption guards, the two HR endpoints. Already the security boundary of the feature; nothing new moves in. |
| `dewey_time/tests/test_telegram_binding.py` | All backend coverage. |

**Frontend** (all paths under `dewey_time/frontend/hr_attendance/`)

| File | Responsibility |
|---|---|
| `src/services/telegram.ts` | The two POST calls and their payload types. |
| `src/hooks/useTelegramLink.ts` | Which employee the dialog is open for, the in-flight operation, the invite, the error. |
| `src/ui/telegram/expiry.ts` | `formatCountdown` — pure, no timers. |
| `src/ui/telegram/TelegramLinkQr.tsx` | The QR panel. |
| `src/ui/telegram/TelegramBodies.tsx` | The four portal-free dialog bodies, exported individually so they are SSR-testable. |
| `src/ui/telegram/TelegramDialog.tsx` | The Radix shell, the body switch, and the one countdown interval. |
| `src/ui/schedule-coverage/registerColumns.tsx` | The Telegram cell: badge + one manage button. |
| `src/ui/schedule-coverage/CoverageRegisterPage.tsx` | Owns the hook and the dialog; refreshes the feed after an unlink. |
| `src/ui/AttendanceToolbar.tsx` | Loses its Telegram segment entirely. |

Deleted at Task 8: `src/ui/TelegramLinkDialog.tsx`, `src/hooks/useTelegramInvite.ts`, `src/ui/telegramLinkDialog.test.tsx`.

The bodies are split from the shell for a reason that already bit this codebase: Radix's `DialogContent` resolves its portal container in a layout effect and therefore server-renders to `null`. Under `renderToStaticMarkup` the entire dialog is an empty string, so every assertion against it passes for the wrong reason.

---

## Task 1: `revoked_at`, revocation on mint, and a 24-hour TTL

**Files:**
- Modify: `dewey_time/dewey_time/doctype/telegram_link_token/telegram_link_token.json`
- Modify: `dewey_time/telegram/binding.py:29` (`DEFAULT_TTL_HOURS`), `:69-78` (`_load_token`), `:110-124` (`issue_link_token`)
- Test: `dewey_time/tests/test_telegram_binding.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `binding.IssuedToken` (NamedTuple with fields `token: str`, `expires_at: datetime`); `binding.revoke_outstanding_tokens(employee: str) -> int`; `binding.issue_link_token(employee: str, ttl_hours: int = 24) -> IssuedToken` (**return type changed from `str`**); `_load_token` rows now carry a `revoked_at` key.

- [ ] **Step 1: Add the field to the DocType JSON**

In `telegram_link_token.json`, append `"revoked_at"` to the end of `field_order` (after `"redeemed_by_telegram_user_id"` — keeping the redeemed pair adjacent), and append this object to the end of `fields`:

```json
    {
      "description": "Set when a newer link superseded this one, or when the employee was unlinked. A revoked token can never be redeemed. The row is kept so the audit trail survives.",
      "fieldname": "revoked_at",
      "fieldtype": "Datetime",
      "in_list_view": 1,
      "label": "Revoked At",
      "read_only": 1
    }
```

Then change `"modified": "2026-08-15 12:00:00.000000"` to `"modified": "2026-08-18 12:00:00.000000"`. **Without this bump `bench migrate` skips the schema reimport on this bench and the column never appears.**

- [ ] **Step 2: Write the failing tests**

Append to `dewey_time/tests/test_telegram_binding.py`, after the `TestTokenShape` class:

```python
class TestTokenRevocation(unittest.TestCase):
    """Re-issuing must REPLACE the live credential, not add a second one.

    Without this, every click left another independently redeemable link alive
    until its own expiry, and nothing anywhere listed them.
    """

    def test_issuing_revokes_the_employees_outstanding_tokens_first(self):
        with patch.object(binding, "_store_token"), \
             patch.object(binding, "revoke_outstanding_tokens") as revoke:
            binding.issue_link_token("HR-EMP-00001")
        revoke.assert_called_once_with("HR-EMP-00001")

    def test_revoking_stamps_every_unredeemed_unrevoked_row(self):
        import frappe

        rows = [{"name": "hash-a"}, {"name": "hash-b"}]
        with patch.object(frappe, "get_all", return_value=rows) as get_all, \
             patch.object(frappe.db, "set_value") as set_value:
            count = binding.revoke_outstanding_tokens("HR-EMP-00001")

        self.assertEqual(count, 2)
        self.assertEqual(set_value.call_count, 2)
        # The filters ARE the behaviour: they are what excludes a token that
        # was already redeemed (stamping that would rewrite history) and one
        # already revoked (a no-op write on every re-issue).
        filters = get_all.call_args[1]["filters"]
        self.assertEqual(filters["employee"], "HR-EMP-00001")
        self.assertEqual(filters["redeemed_at"], ["is", "not set"])
        self.assertEqual(filters["revoked_at"], ["is", "not set"])
        for call in set_value.call_args_list:
            self.assertEqual(call[0][2], "revoked_at")

    def test_revoking_a_blank_employee_queries_nothing(self):
        # A blank filter would match the whole table.
        import frappe

        with patch.object(frappe, "get_all", side_effect=AssertionError("must not query")):
            self.assertEqual(binding.revoke_outstanding_tokens("  "), 0)

    def test_the_issued_expiry_is_the_one_that_was_stored(self):
        # Two now_datetime() reads produced two different expiries: the row
        # said one thing and the response said another.
        with patch.object(binding, "_store_token") as store:
            issued = binding.issue_link_token("HR-EMP-00001")
        self.assertEqual(issued.expires_at, store.call_args[1]["expires_at"])
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_telegram_binding -v`
Expected: FAIL — `AttributeError: <module 'dewey_time.telegram.binding'> does not have the attribute 'revoke_outstanding_tokens'`, and `AttributeError: 'str' object has no attribute 'expires_at'`.

- [ ] **Step 4: Implement**

In `dewey_time/telegram/binding.py`:

Add to the imports at the top:

```python
from datetime import datetime
from typing import NamedTuple
```

Change the TTL constant:

```python
DEFAULT_TTL_HOURS = 24
```

Add `"revoked_at"` to the field list in `_load_token`:

```python
    return frappe.db.get_value(
        TOKEN_DT,
        token_hash,
        ["name", "employee", "expires_at", "redeemed_at", "revoked_at"],
        as_dict=True,
    )
```

Add above `issue_link_token`:

```python
class IssuedToken(NamedTuple):
    """The raw token and the expiry that was actually written for it.

    Returned together so `create_link_invite` reports the STORED expiry rather
    than reading `now_datetime()` a second time and reporting a value that
    disagrees with the row it just inserted.
    """

    token: str
    expires_at: datetime


def revoke_outstanding_tokens(employee: str) -> int:
    """Kill every unredeemed, unrevoked token for `employee`. Returns the count.

    This is what makes re-issuing SAFE rather than merely convenient. Without
    it each click minted another independently redeemable credential, all live
    until their own expiry, with nothing anywhere listing them.

    Redeemed rows are excluded rather than stamped: a redeemed token is
    history, and revoking it after the fact would misdescribe what happened.
    """
    employee = (employee or "").strip()
    if not employee:
        # A blank filter matches the whole table.
        return 0

    rows = (
        frappe.get_all(
            TOKEN_DT,
            filters={
                "employee": employee,
                "redeemed_at": ["is", "not set"],
                "revoked_at": ["is", "not set"],
            },
            fields=["name"],
        )
        or []
    )
    stamp = now_datetime()
    for row in rows:
        frappe.db.set_value(TOKEN_DT, row["name"], "revoked_at", stamp)
    return len(rows)
```

Replace the body of `issue_link_token` (keep its existing docstring, and add the paragraph below):

```python
def issue_link_token(employee: str, ttl_hours: int = DEFAULT_TTL_HOURS) -> IssuedToken:
    """Mint a single-use token for `employee`. Returns the RAW token, once.

    Only its SHA-256 reaches the database, so nothing that can read the
    database can redeem on someone's behalf.

    Every previously issued, still-unredeemed token for this employee is
    revoked FIRST. Minting is the only way a link is created, so this is the
    single place that can guarantee "at most one live credential per
    employee" -- and that guarantee is what makes a Regenerate button
    something other than a way to double the exposure.
    """
    employee = (employee or "").strip()
    if not employee:
        frappe.throw("employee is required")

    revoke_outstanding_tokens(employee)

    token = secrets.token_urlsafe(TOKEN_BYTES)
    expires_at = add_to_date(now_datetime(), hours=ttl_hours)
    _store_token(
        token_hash=_hash_token(token),
        employee=employee,
        expires_at=expires_at,
    )
    return IssuedToken(token=token, expires_at=expires_at)
```

- [ ] **Step 4b: Adapt the only caller, or this task commits red**

`create_link_invite` is the sole caller of `issue_link_token` and still treats
its result as a string, so changing the return type breaks it until Task 3.
Make the minimal adaptation here — the refusal, `expires_in_seconds` and the
POST pinning all still belong to Task 3:

```python
    bot = _bot_username()
    issued = issue_link_token(employee)
    return {
        "employee": employee,
        "url": link_url(issued.token, bot),
        # The STORED expiry. This used to recompute add_to_date(now_datetime())
        # a second time, so the value reported was never quite the value on the
        # row that had just been written.
        "expires_at": str(issued.expires_at),
    }
```

- [ ] **Step 5: Update the three existing tests that expect a bare string**

In `TestTokenShape`, `issue_link_token` now returns a NamedTuple:

```python
    def test_token_fits_telegrams_start_payload(self):
        # Telegram's deep-link `start` payload allows 64 chars of
        # [A-Za-z0-9_-]. A 32-byte token base64url-encodes to 43.
        with patch.object(binding, "_store_token"):
            issued = binding.issue_link_token("HR-EMP-00001")
        self.assertLessEqual(len(issued.token), 64)
        self.assertRegex(issued.token, r"^[A-Za-z0-9_-]+$")

    def test_two_tokens_are_never_equal(self):
        with patch.object(binding, "_store_token"):
            a = binding.issue_link_token("HR-EMP-00001")
            b = binding.issue_link_token("HR-EMP-00001")
        self.assertNotEqual(a.token, b.token)

    def test_the_raw_token_is_never_stored(self):
        # Only its SHA-256 goes to the database, so a backup or a support
        # session never hands out a live token.
        with patch.object(binding, "_store_token") as store:
            issued = binding.issue_link_token("HR-EMP-00001")
        stored_hash = store.call_args[1]["token_hash"]
        self.assertNotEqual(stored_hash, issued.token)
        self.assertEqual(stored_hash, binding._hash_token(issued.token))
```

In `TestInvite`, the two tests that patch `issue_link_token` must return the new type:

```python
    def test_invite_returns_a_tappable_url(self):
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "issue_link_token",
                          return_value=binding.IssuedToken("tok123", "2026-08-19 09:00:00")), \
             patch.object(binding, "_bot_username", return_value="dewey_time_bot"):
            invite = binding.create_link_invite("HR-EMP-00001")
        self.assertEqual(invite["url"], "https://t.me/dewey_time_bot?start=tok123")
        self.assertEqual(invite["employee"], "HR-EMP-00001")

    def test_an_invite_link_never_carries_an_at(self):
        # End to end from the setting a person typed to the URL HR copies.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "issue_link_token",
                          return_value=binding.IssuedToken("tok123", "2026-08-19 09:00:00")), \
             patch.object(binding.frappe, "get_cached_value", return_value="@deweytimebot"):
            invite = binding.create_link_invite("HR-EMP-00001")
        self.assertEqual(invite["url"], "https://t.me/deweytimebot?start=tok123")
        self.assertNotIn("@", invite["url"])
```

Also update the stale comment in `test_a_misconfigured_username_does_not_burn_a_token` — it says "its 7-day clock"; change to "its 24-hour clock".

- [ ] **Step 6: Run the full backend module to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_telegram_binding -v`
Expected: PASS. Count rises by **+4** from 37 to 41.

If a test fails with a stale-bytecode symptom, note that macOS keeps a second cache at `~/Library/Caches/com.apple.python` that survives deleting `__pycache__` and ignores `-B`.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/dewey_time/doctype/telegram_link_token/telegram_link_token.json \
        dewey_time/telegram/binding.py dewey_time/tests/test_telegram_binding.py
git commit -m "feat(telegram): minting a link revokes the employee's outstanding ones"
```

---

## Task 2: Redemption fails closed

**Files:**
- Modify: `dewey_time/telegram/binding.py:150-185` (`redeem_link_token`), and add `_revive_link` beside `_create_link`
- Test: `dewey_time/tests/test_telegram_binding.py`

**Interfaces:**
- Consumes: `_load_token` rows carry `revoked_at` (Task 1).
- Produces: `binding._revive_link(*, name: str, employee: str, chat_id: str) -> None`. `redeem_link_token(token, telegram_user_id, chat_id) -> str` keeps its signature.

**Context an implementer needs:** `Telegram Link` autonames `field:telegram_user_id`, so one Telegram account has exactly one row, forever — including after an unlink, which only clears `enabled`. `_existing_link(telegram_user_id)` returns `{name, employee, enabled}` or `None`. `_employee_bound_elsewhere(employee, telegram_user_id)` returns True when some **other** enabled link already points at that employee.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_telegram_binding.py`:

```python
class TestRedeemGuards(unittest.TestCase):
    """Every way one employee could end up with two authorised accounts.

    Each refusal asserts that NO write happened, not merely that something
    raised. A guard that raises for the wrong reason -- or a mock that raises
    before the guard is reached -- satisfies assertRaises alone.

    `_is_expired` is pinned False throughout for the reason the existing
    TestRedeem documents: under the frappe mock `get_datetime` is an identity
    passthrough, so a deleted guard would fall through to the expiry
    comparison and raise a TypeError, and the mutation would survive.
    """

    def _token_doc(self, **overrides):
        doc = {
            "name": "hash",
            "employee": "HR-EMP-00001",
            "expires_at": "2099-01-01 00:00:00",
            "redeemed_at": None,
            "revoked_at": None,
        }
        doc.update(overrides)
        return doc

    def _redeem(self, *, token_doc=None, existing=None, bound_elsewhere=False):
        with patch.object(binding, "_load_token",
                          return_value=token_doc or self._token_doc()), \
             patch.object(binding, "_is_expired", return_value=False), \
             patch.object(binding, "_existing_link", return_value=existing), \
             patch.object(binding, "_employee_bound_elsewhere", return_value=bound_elsewhere), \
             patch.object(binding, "_create_link") as create, \
             patch.object(binding, "_revive_link") as revive, \
             patch.object(binding, "_mark_redeemed") as mark:
            try:
                employee = binding.redeem_link_token("tok", "55501", "77702")
            except Exception:
                employee = None
            return employee, create, revive, mark

    def test_a_revoked_token_is_refused(self):
        employee, create, revive, mark = self._redeem(
            token_doc=self._token_doc(revoked_at="2026-08-18 09:00:00"))
        self.assertIsNone(employee)
        create.assert_not_called()
        revive.assert_not_called()
        mark.assert_not_called()

    def test_an_employee_already_bound_to_another_account_refuses(self):
        employee, create, revive, _ = self._redeem(bound_elsewhere=True)
        self.assertIsNone(employee)
        create.assert_not_called()
        revive.assert_not_called()

    def test_the_same_account_already_bound_here_is_idempotent(self):
        # No second row: Telegram Link autonames on telegram_user_id, so
        # _create_link would raise DuplicateEntryError.
        employee, create, revive, mark = self._redeem(
            existing={"name": "55501", "employee": "HR-EMP-00001", "enabled": 1})
        self.assertEqual(employee, "HR-EMP-00001")
        create.assert_not_called()
        revive.assert_not_called()
        mark.assert_called_once()

    def test_an_account_bound_to_a_different_employee_refuses(self):
        employee, create, revive, _ = self._redeem(
            existing={"name": "55501", "employee": "HR-EMP-00002", "enabled": 1})
        self.assertIsNone(employee)
        create.assert_not_called()
        revive.assert_not_called()

    def test_a_disabled_link_is_revived_rather_than_refused(self):
        # The changed-phone case. A Telegram account is keyed to a phone
        # number, so the same account coming back is the ORDINARY shape of
        # unlink -> re-issue, not an edge case.
        employee, create, revive, mark = self._redeem(
            existing={"name": "55501", "employee": "HR-EMP-00002", "enabled": 0})
        self.assertEqual(employee, "HR-EMP-00001")
        create.assert_not_called()
        self.assertEqual(revive.call_args[1]["name"], "55501")
        self.assertEqual(revive.call_args[1]["employee"], "HR-EMP-00001")
        self.assertEqual(revive.call_args[1]["chat_id"], "77702")
        mark.assert_called_once()

    def test_the_bound_elsewhere_guard_runs_before_the_revive(self):
        # Order, not merely presence. Reviving into an employee who already
        # has another live account is the two-accounts-one-employee failure
        # arriving through the back door.
        employee, create, revive, _ = self._redeem(
            existing={"name": "55501", "employee": "HR-EMP-00002", "enabled": 0},
            bound_elsewhere=True)
        self.assertIsNone(employee)
        revive.assert_not_called()
        create.assert_not_called()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_telegram_binding.TestRedeemGuards -v`
Expected: FAIL — `AttributeError: ... does not have the attribute '_revive_link'`.

- [ ] **Step 3: Implement**

In `dewey_time/telegram/binding.py`, add immediately after `_create_link`:

```python
def _revive_link(*, name: str, employee: str, chat_id: str) -> None:
    """Re-enable a previously unlinked account and point it at `employee`.

    `Telegram Link` autonames `field:telegram_user_id`, so an account's row
    outlives every unlink -- clearing `enabled` is all an unlink does. A
    Telegram account is keyed to a phone number, so "employee got a new phone"
    is usually the SAME account coming back. Without this branch the
    unlink -> re-issue flow would refuse forever for exactly the case it
    exists to serve.

    Deliberately unlike `claim_by_recorded_id`, which refuses a revoked link
    outright. That guard protects the NO-TOKEN path, where nothing but the
    employee reopening the bot is required, and self-restoring there would
    make revocation theatre. A token is HR's explicit, freshly minted
    authorisation to bind this employee -- the thing the recorded-id path
    lacks. The two paths should not agree here.
    """
    frappe.db.set_value(
        LINK_DT,
        name,
        {
            "employee": employee,
            "chat_id": str(chat_id),
            "enabled": 1,
            "linked_at": now_datetime(),
            "linked_via": "token",
        },
    )
```

Then replace everything in `redeem_link_token` from the `if row.get("redeemed_at"):` block's end through the final `return row["employee"]`. The full tail of the function becomes:

```python
    if row.get("redeemed_at"):
        # Idempotent for the SAME Telegram account. Telegram redelivers an
        # update when it does not get a timely 200, so a slow response to
        # /start would otherwise tell the employee "that link didn't work"
        # immediately after telling them they were linked. Redemption by a
        # DIFFERENT account is still refused -- that is a used token, not a
        # retry.
        if str(row.get("redeemed_by_telegram_user_id") or "") == telegram_user_id:
            return row["employee"]
        frappe.throw("This link has already been used. Ask HR for a new one.")
    if row.get("revoked_at"):
        # A newer link superseded this one, or the employee was unlinked.
        frappe.throw("This link is no longer valid. Ask HR for a new one.")
    if _is_expired(row["expires_at"]):
        frappe.throw("This link has expired. Ask HR for a new one.")

    employee = row["employee"]

    # BEFORE the account-level branches below. Reviving an account into an
    # employee who already has another live account is the
    # two-accounts-one-employee failure arriving through the back door, and
    # `employee_for_telegram_user` would authorise both.
    if _employee_bound_elsewhere(employee, telegram_user_id):
        frappe.throw("This employee is already linked to another Telegram account. Ask HR.")

    existing = _existing_link(telegram_user_id)
    if existing:
        if existing.get("enabled"):
            if existing["employee"] == employee:
                # Already correctly bound. A second row is impossible anyway --
                # the autoname would raise DuplicateEntryError -- so the honest
                # outcome is to spend the token and return.
                _mark_redeemed(row["name"], telegram_user_id)
                return employee
            frappe.throw("This Telegram account is already linked. Ask HR.")
        _revive_link(name=existing["name"], employee=employee, chat_id=chat_id)
        _mark_redeemed(row["name"], telegram_user_id)
        return employee

    _create_link(
        employee=employee,
        telegram_user_id=telegram_user_id,
        chat_id=str(chat_id),
    )
    _mark_redeemed(row["name"], telegram_user_id)
    return employee
```

- [ ] **Step 4: Run the module to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_telegram_binding -v`
Expected: PASS. Count rises by **+6** from 41 to 47.

`test_valid_token_creates_the_link_and_returns_the_employee` and `test_a_revoked_link_is_not_silently_restored` must both still pass unmodified. The second is the contrast that makes `_revive_link` legible — if it goes red, the revive branch has leaked into the recorded-id path.

- [ ] **Step 5: Commit**

```bash
git add dewey_time/telegram/binding.py dewey_time/tests/test_telegram_binding.py
git commit -m "fix(telegram): redemption cannot produce two accounts for one employee"
```

---

## Task 3: `create_link_invite` hardening and the `revoke_link` endpoint

**Files:**
- Modify: `dewey_time/telegram/binding.py:297-325` (`create_link_invite`), and add `_live_link_names` + `revoke_link`
- Test: `dewey_time/tests/test_telegram_binding.py`

**Interfaces:**
- Consumes: `IssuedToken`, `revoke_outstanding_tokens` (Task 1).
- Produces:
  - `create_link_invite(employee: str) -> dict` with keys `employee: str`, `url: str`, `expires_at: str`, `expires_in_seconds: int`. Whitelist becomes `methods=["POST"]`.
  - `revoke_link(employee: str) -> dict` with keys `employee: str`, `unlinked: int`, `tokens_revoked: int`. Whitelisted `methods=["POST"]`.
  - `binding._live_link_names(employee: str) -> list[str]`.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_telegram_binding.py`:

```python
class TestInviteRefusesALinkedEmployee(unittest.TestCase):
    def test_an_already_linked_employee_gets_no_new_link(self):
        # The register hides its control for a linked employee; this is the
        # guard that makes that true rather than cosmetic. A stale tab, or any
        # direct call, would otherwise mint a credential that can bind a
        # second account to someone already bound.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=["55501"]), \
             patch.object(binding, "issue_link_token") as issue:
            with self.assertRaises(Exception):
                binding.create_link_invite("HR-EMP-00001")
        issue.assert_not_called()

    def test_the_invite_reports_a_one_day_window(self):
        # An integer duration, not a datetime string: the browser cannot turn
        # a naive site-local datetime into an instant without knowing the
        # site's timezone, and the countdown needs an instant.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=[]), \
             patch.object(binding, "issue_link_token",
                          return_value=binding.IssuedToken("tok123", "2026-08-19 09:00:00")), \
             patch.object(binding, "_bot_username", return_value="dewey_time_bot"):
            invite = binding.create_link_invite("HR-EMP-00001")
        self.assertEqual(invite["expires_in_seconds"], 86400)
        self.assertEqual(invite["expires_at"], "2026-08-19 09:00:00")


class TestRevokeLink(unittest.TestCase):
    def test_revoking_requires_hr(self):
        with patch.object(binding, "_require_hr_role",
                          side_effect=Exception("Not permitted")) as gate, \
             patch.object(binding, "_live_link_names") as names:
            with self.assertRaises(Exception):
                binding.revoke_link("HR-EMP-00001")
        gate.assert_called_once()
        names.assert_not_called()

    def test_revoking_disables_the_link_and_kills_outstanding_tokens(self):
        import frappe

        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=["55501"]), \
             patch.object(binding, "revoke_outstanding_tokens", return_value=2) as tokens, \
             patch.object(frappe.db, "set_value") as set_value:
            result = binding.revoke_link("HR-EMP-00001")

        self.assertEqual(result, {
            "employee": "HR-EMP-00001", "unlinked": 1, "tokens_revoked": 2,
        })
        set_value.assert_called_once_with(binding.LINK_DT, "55501", "enabled", 0)
        tokens.assert_called_once_with("HR-EMP-00001")

    def test_the_row_is_disabled_never_deleted(self):
        # The row and its version history are the audit trail, and the
        # `enabled` field's own description promises they survive the unlink.
        import frappe

        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=["55501"]), \
             patch.object(binding, "revoke_outstanding_tokens", return_value=0), \
             patch.object(frappe.db, "set_value"), \
             patch.object(frappe, "delete_doc", create=True) as delete_doc, \
             patch.object(frappe.db, "delete") as db_delete:
            binding.revoke_link("HR-EMP-00001")
        delete_doc.assert_not_called()
        db_delete.assert_not_called()

    def test_revoking_an_unlinked_employee_is_not_an_error(self):
        # Idempotent on purpose. A second press from a stale tab would
        # otherwise put a red message in front of HR for doing nothing wrong.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=[]), \
             patch.object(binding, "revoke_outstanding_tokens", return_value=0):
            result = binding.revoke_link("HR-EMP-00001")
        self.assertEqual(result["unlinked"], 0)

    def test_revoking_refuses_a_blank_employee(self):
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names") as names:
            with self.assertRaises(Exception):
                binding.revoke_link("  ")
        names.assert_not_called()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest dewey_time.tests.test_telegram_binding -v`
Expected: FAIL — `AttributeError: ... does not have the attribute '_live_link_names'`.

- [ ] **Step 3: Implement**

In `dewey_time/telegram/binding.py`, add above `create_link_invite`:

```python
def _live_link_names(employee: str) -> list[str]:
    """Names of this employee's ENABLED Telegram Link rows."""
    return [
        row["name"]
        for row in frappe.get_all(
            LINK_DT,
            filters={"employee": employee, "enabled": 1},
            fields=["name"],
        )
        or []
    ]
```

Replace the `create_link_invite` decorator and body (keep its existing docstring):

```python
@frappe.whitelist(methods=["POST"])
def create_link_invite(employee: str) -> dict:
    """HR mints a one-time link for one employee.

    HR never sees or types a Telegram chat id -- the id is read off the
    authenticated update when the employee taps the link. That is the whole
    point: a hand-transcribed id has no checksum and no name echoed back, so a
    transposed digit silently sends one person's attendance to another.

    POST-pinned. The response body IS a credential, and a GET would put the
    employee id in the query string of every access log, proxy log and browser
    history entry between here and the bench.
    """
    _require_hr_role()
    employee = (employee or "").strip()
    if not employee:
        frappe.throw("employee is required")

    # The register hides its control for a linked employee; this is what makes
    # that true rather than cosmetic. A stale tab or a direct call would
    # otherwise mint a credential able to bind a SECOND account to someone
    # already bound.
    if _live_link_names(employee):
        frappe.throw(
            f"{employee} is already linked to Telegram. "
            "Unlink first to issue a new link."
        )

    # Resolved BEFORE the token is minted. Written as
    # `link_url(issue_link_token(...), _bot_username())` the mint evaluates
    # first, so every attempt against a misconfigured username left a live
    # token row behind and still returned an error.
    bot = _bot_username()
    issued = issue_link_token(employee)
    return {
        "employee": employee,
        "url": link_url(issued.token, bot),
        # Already correct as of Task 1 Step 4b; only the key below is new here.
        "expires_at": str(issued.expires_at),
        # The TTL by construction, NOT a subtraction of two datetimes. A naive
        # site-local datetime string cannot be turned into an instant by a
        # browser that does not know the site timezone -- and the frappe test
        # mock's get_datetime is an identity passthrough, so datetime
        # arithmetic here would go untested.
        "expires_in_seconds": DEFAULT_TTL_HOURS * 3600,
    }


@frappe.whitelist(methods=["POST"])
def revoke_link(employee: str) -> dict:
    """HR unlinks an employee's Telegram account.

    Idempotent: an employee with no live link returns `unlinked: 0` rather
    than throwing. A second press from a stale tab is not an error, and making
    it one would put a red message in front of HR for doing nothing wrong.
    """
    _require_hr_role()
    employee = (employee or "").strip()
    if not employee:
        frappe.throw("employee is required")

    names = _live_link_names(employee)
    for name in names:
        # `enabled = 0`, never a delete. The row and its version history are
        # the audit trail, and the field's own description promises they
        # survive the unlink.
        frappe.db.set_value(LINK_DT, name, "enabled", 0)

    # An unlink must not leave a live credential behind: a token issued while
    # the employee was unlinked before would otherwise still bind on
    # redemption, undoing the unlink without HR touching anything.
    tokens_revoked = revoke_outstanding_tokens(employee)
    return {
        "employee": employee,
        "unlinked": len(names),
        "tokens_revoked": tokens_revoked,
    }
```

- [ ] **Step 4: Run the module to verify it passes**

Run: `python3 -m unittest dewey_time.tests.test_telegram_binding -v`
Expected: PASS. Count rises by **+7** from 47 to 54.

- [ ] **Step 5: Run the whole backend suite for regressions**

Run: `python3 -m unittest discover -s dewey_time/tests -t . -v 2>&1 | tail -20`
Expected: no new failures. Remember the runner prints a **total**, not a pass count.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/telegram/binding.py dewey_time/tests/test_telegram_binding.py
git commit -m "feat(telegram): refuse a link for the already-linked, and add revoke_link"
```

---

## Task 4: The client service and the dialog's state hook

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/services/telegram.ts`
- Create: `dewey_time/frontend/hr_attendance/src/hooks/useTelegramLink.ts`
- Test: `dewey_time/frontend/hr_attendance/src/services/telegram.test.ts`

**Interfaces:**
- Consumes: `create_link_invite` now returns `expires_in_seconds`; `revoke_link` exists (Task 3).
- Produces:
  - `LinkInvite = { employee: string; url: string; expires_at: string; expires_in_seconds: number }`
  - `LinkRevocation = { employee: string; unlinked: number; tokens_revoked: number }`
  - `revokeLink(employee: string): Promise<LinkRevocation>`
  - `TelegramLinkStatus = "linked" | "id_on_file" | "none"`
  - `TelegramTarget = { employee: string; employeeName: string; status: TelegramLinkStatus }`
  - `useTelegramLink(opts?: { onUnlinked?: () => void }): TelegramLink` where
    ```ts
    type TelegramLink = {
      target: TelegramTarget | null;
      invite: LinkInvite | null;
      error: string | null;
      busy: "issuing" | "revoking" | null;
      openFor: (target: TelegramTarget) => void;
      close: () => void;
      issue: () => void;
      revoke: () => void;
    };
    ```

**Note on `src/hooks/`:** it is **not** in the `test:web` glob and is not covered by unit tests anywhere in this repo. That is why every decidable piece of logic lives in `expiry.ts` (Task 5) and the services layer, and why the hook is kept to state plumbing. Its behaviour is covered end-to-end by the Playwright spec in Task 9.

- [ ] **Step 1: Write the failing test**

Append to `dewey_time/frontend/hr_attendance/src/services/telegram.test.ts`:

```ts
test("revokeLink POSTs, so unlinking never lands in a URL or an access log", async () => {
  // Same reason createLinkInvite is POST: the employee id identifies whose
  // credential is being destroyed, and a GET puts it in every proxy log and
  // browser history entry between here and the bench.
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ message: { employee: "EMP-1", unlinked: 1, tokens_revoked: 0 } }),
    };
  }) as unknown as typeof fetch;

  try {
    const result = await revokeLink("EMP-1");
    assert.equal(result.unlinked, 1);
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].url, "/api/method/dewey_time.telegram.binding.revoke_link");
  assert.doesNotMatch(calls[0].url, /EMP-1/);
});
```

Add `revokeLink` to the file's existing import from `@/services/telegram`. Read the top of `src/services/telegram.test.ts` first and match its existing fetch-stubbing style — if it already has a helper for this, use that instead of the inline stub above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:web`
Expected: FAIL — `revokeLink is not exported`.

- [ ] **Step 3: Implement the service**

In `src/services/telegram.ts`, extend the type and add the second call. Note the corrected comment: the whitelist did **not** pin POST until Task 3.

```ts
export type LinkInvite = {
  employee: string;
  url: string;
  expires_at: string;
  /**
   * Seconds from receipt, not a timestamp.
   *
   * `expires_at` is a naive site-local datetime string. A browser cannot turn
   * that into an instant without knowing the site's timezone, so a countdown
   * driven from it is wrong by whatever the two differ by. A duration needs
   * neither timezone nor a synchronised clock.
   */
  expires_in_seconds: number;
};

export type LinkRevocation = {
  employee: string;
  unlinked: number;
  tokens_revoked: number;
};

/**
 * Unbind an employee's Telegram account, and kill any link still in flight.
 *
 * POST for the same reason as `createLinkInvite`: the employee id names whose
 * access is being destroyed, and a GET would leave it in every access log,
 * proxy log and browser history entry on the way to the bench.
 */
export function revokeLink(employee: string) {
  return frappeCall<LinkRevocation>(
    "dewey_time.telegram.binding.revoke_link",
    { employee },
    { method: "POST" },
  );
}
```

- [ ] **Step 4: Create the hook**

Create `src/hooks/useTelegramLink.ts`:

```ts
/**
 * Which employee the Telegram dialog is open for, and what it is doing.
 *
 * Replaces `useTelegramInvite`, which existed because two surfaces issued the
 * same credential. Only the coverage register does now, so this hook is not
 * shared -- it is the register's dialog state, and it covers the whole
 * lifecycle rather than just the issuing half.
 */
import { useCallback, useState } from "react";

import {
  createLinkInvite,
  revokeLink,
  type LinkInvite,
} from "@/services/telegram";

export type { LinkInvite };

export type TelegramLinkStatus = "linked" | "id_on_file" | "none";

export type TelegramTarget = {
  employee: string;
  employeeName: string;
  status: TelegramLinkStatus;
};

export type TelegramLink = {
  target: TelegramTarget | null;
  invite: LinkInvite | null;
  error: string | null;
  busy: "issuing" | "revoking" | null;
  openFor: (target: TelegramTarget) => void;
  close: () => void;
  issue: () => void;
  revoke: () => void;
};

export function useTelegramLink(opts?: { onUnlinked?: () => void }): TelegramLink {
  const [target, setTarget] = useState<TelegramTarget | null>(null);
  const [invite, setInvite] = useState<LinkInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"issuing" | "revoking" | null>(null);

  // Reset FIRST, before anything awaits. Leaving the previous employee's link
  // on screen while the next one loads is how someone sends the wrong person a
  // credential that binds their Telegram account to the wrong record.
  const openFor = useCallback((next: TelegramTarget) => {
    setInvite(null);
    setError(null);
    setBusy(null);
    setTarget(next);
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    setInvite(null);
    setError(null);
    setBusy(null);
  }, []);

  const issue = useCallback(() => {
    if (!target) return;
    const employee = target.employee;
    setInvite(null);
    setError(null);
    setBusy("issuing");
    void (async () => {
      try {
        setInvite(await createLinkInvite(employee));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not issue a link");
      } finally {
        setBusy(null);
      }
    })();
  }, [target]);

  const revoke = useCallback(() => {
    if (!target) return;
    const employee = target.employee;
    setError(null);
    setBusy("revoking");
    void (async () => {
      try {
        await revokeLink(employee);
        // Locally, not by refetching: the dialog must show the unlinked state
        // immediately, and the feed refresh below is a network round trip the
        // person standing at the screen should not have to wait through.
        setTarget((current) =>
          current && current.employee === employee
            ? { ...current, status: "none" }
            : current,
        );
        opts?.onUnlinked?.();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not unlink");
      } finally {
        setBusy(null);
      }
    })();
  }, [target, opts]);

  return { target, invite, error, busy, openFor, close, issue, revoke };
}
```

- [ ] **Step 5: Run the tests and the typechecker**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:web`
Expected: PASS, **+1** test.

Run: `npm --prefix dewey_time/frontend/hr_attendance run typecheck`
Expected: clean. `src/ui/TelegramLinkDialog.tsx` and `src/hooks/useTelegramInvite.ts` still exist and still compile; they are deleted in Task 8.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/services/telegram.ts \
        dewey_time/frontend/hr_attendance/src/services/telegram.test.ts \
        dewey_time/frontend/hr_attendance/src/hooks/useTelegramLink.ts
git commit -m "feat(telegram): a client hook for the whole link lifecycle"
```

---

## Task 5: The countdown formatter, the QR panel, and the test glob

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/ui/telegram/expiry.ts`
- Create: `dewey_time/frontend/hr_attendance/src/ui/telegram/expiry.test.ts`
- Create: `dewey_time/frontend/hr_attendance/src/ui/telegram/TelegramLinkQr.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/telegram/telegramLinkQr.test.tsx`
- Modify: `dewey_time/frontend/hr_attendance/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatCountdown(secondsRemaining: number): string`; `<TelegramLinkQr url={string} />`.

- [ ] **Step 1: Add the glob entry and the dependency**

In `dewey_time/frontend/hr_attendance/package.json`, append two patterns to the **end** of the `test:web` script value:

```
src/ui/telegram/*.test.ts src/ui/telegram/*.test.tsx
```

so the script reads:

```json
"test:web": "tsx --test src/lib/*.test.ts src/brand/*.test.ts src/brand/*.test.tsx src/pwa/*.test.ts src/pwa/*.test.tsx src/components/*.test.tsx src/components/ui/*.test.tsx src/services/*.test.ts src/ui/*.test.tsx src/miniapp/*.test.ts src/miniapp/*.test.tsx src/ui/telegram/*.test.ts src/ui/telegram/*.test.tsx",
```

**This glob is an explicit per-directory list, not recursive.** Omit it and every test in Tasks 5 and 6 never runs while the suite still exits 0.

Then install the QR library:

```bash
npm --prefix dewey_time/frontend/hr_attendance install react-qr-code
```

Confirm it landed in `dependencies` (not `devDependencies`) and note the resolved version. If the install fails or the package pulls transitive runtime dependencies, **stop and report** — the fallback is `qrcode-generator`, and swapping it is a decision for the controller, not the implementer. A hosted QR service is not an option at any price: the encoded value is the credential.

- [ ] **Step 2: Write the failing tests**

Create `src/ui/telegram/expiry.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { formatCountdown } from "@/ui/telegram/expiry";

test("above an hour the seconds are dropped as noise", () => {
  assert.equal(formatCountdown(86_400), "24h 0m");
  assert.equal(formatCountdown(3_601), "1h 0m");
});

test("exactly one hour still reads as hours, not as 60m", () => {
  // The boundary. `> 3600` here would print "60m 0s", which reads as a bug.
  assert.equal(formatCountdown(3_600), "1h 0m");
});

test("below an hour the seconds are the point", () => {
  // This is the window where HR decides whether to send this link or
  // regenerate, so a minute-only display would hide the decision.
  assert.equal(formatCountdown(3_599), "59m 59s");
  assert.equal(formatCountdown(72), "1m 12s");
  assert.equal(formatCountdown(9), "0m 9s");
});

test("zero and past-zero are Expired, never a negative duration", () => {
  // A dead credential must never render as a live one. Negative input is
  // reachable: a laptop that slept past the deadline wakes with one.
  assert.equal(formatCountdown(0), "Expired");
  assert.equal(formatCountdown(-5), "Expired");
  assert.equal(formatCountdown(-86_400), "Expired");
});
```

Create `src/ui/telegram/telegramLinkQr.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TelegramLinkQr } from "@/ui/telegram/TelegramLinkQr";

const URL_A = "https://t.me/dewey_time_bot?start=Xk3_9pQ-rT7wLmZ2aB4cD6eF8gH0iJkL";
const URL_B = "https://t.me/dewey_time_bot?start=ZZZZ9pQ-rT7wLmZ2aB4cD6eF8gH0iJkL";

test("the code is drawn as inline SVG, not fetched from anywhere", () => {
  // The encoded value IS the credential. A hosted QR service would hand every
  // issued link to a third party, and it would look identical on screen.
  const html = renderToStaticMarkup(<TelegramLinkQr url={URL_A} />);
  assert.match(html, /<svg/);
  // Anything that would make the browser go and FETCH the code. Not a bare
  // /https?:/ match — the svg element carries its own
  // xmlns="http://www.w3.org/2000/svg" and would fail that for no reason.
  assert.doesNotMatch(html, /<img|\ssrc=|xlink:href=/);
});

test("the url is actually encoded, not merely accepted", () => {
  // Guards the failure that renders perfectly: a `value` prop left unwired
  // draws a valid QR of the wrong thing, and nobody can read a QR by eye.
  const a = renderToStaticMarkup(<TelegramLinkQr url={URL_A} />);
  const b = renderToStaticMarkup(<TelegramLinkQr url={URL_B} />);
  assert.notEqual(a, b);
});

test("the code stays dark-on-white regardless of theme", () => {
  // An inverted QR fails to scan on many phone cameras, and the failure reads
  // as "the code doesn't work" rather than as a theming bug.
  const html = renderToStaticMarkup(<TelegramLinkQr url={URL_A} />);
  assert.match(html, /fill="#ffffff"/i);
  assert.match(html, /fill="#000000"/i);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:web`
Expected: FAIL — `Cannot find module '@/ui/telegram/expiry'`.

If instead the suite passes with an unchanged count, the glob edit in Step 1 did not take — fix that before continuing.

- [ ] **Step 4: Implement**

Create `src/ui/telegram/expiry.ts`:

```ts
/**
 * Countdown formatting for a link that is a live credential.
 *
 * A pure function of one number, deliberately. The interval that produces the
 * number lives in the dialog; everything that decides what HR reads lives here,
 * where it is testable without timers, fake clocks or a rendered component.
 */
export function formatCountdown(secondsRemaining: number): string {
  // Negative is reachable, not defensive: a laptop that slept past the
  // deadline wakes up with one, and "-3h 12m" would read as a live link.
  if (secondsRemaining <= 0) return "Expired";

  const total = Math.floor(secondsRemaining);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  // `>=`, not `>`: at exactly 3600 the minute form prints "60m 0s".
  if (total >= 3600) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}
```

Create `src/ui/telegram/TelegramLinkQr.tsx`:

```tsx
/**
 * The link as a scannable code.
 *
 * Rendered in the browser and sent nowhere: the encoded value IS the
 * credential, so a hosted QR service would hand every issued link to a third
 * party while looking identical on screen.
 *
 * Dark modules on white in BOTH themes. An inverted QR fails to scan on a lot
 * of phone cameras, and it fails in the worst place -- in front of the
 * employee, reading as "the code doesn't work" rather than as a theming bug.
 * That is why the panel sets its own background instead of inheriting the
 * dialog's.
 */
import QRCode from "react-qr-code";

export function TelegramLinkQr(props: { url: string }) {
  return (
    <div className="flex justify-center rounded-lg bg-white p-4">
      <QRCode
        value={props.url}
        size={200}
        level="M"
        bgColor="#ffffff"
        fgColor="#000000"
        title="QR code for the Telegram link"
      />
    </div>
  );
}
```

- [ ] **Step 5: Run the tests and the typechecker**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:web`
Expected: PASS, **+7** tests. Confirm the printed total rose by exactly 7 — a flat total means the glob is still wrong.

Run: `npm --prefix dewey_time/frontend/hr_attendance run typecheck`
Expected: clean. If `react-qr-code` has no bundled types, **stop and report** rather than adding a `.d.ts` shim.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/frontend/hr_attendance/package.json \
        dewey_time/frontend/hr_attendance/package-lock.json \
        dewey_time/frontend/hr_attendance/src/ui/telegram/
git commit -m "feat(telegram): a countdown formatter and a client-side QR panel"
```

---

## Task 6: The dialog and its four bodies

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/ui/telegram/TelegramBodies.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/telegram/TelegramDialog.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/ui/telegram/telegramBodies.test.tsx`

**Interfaces:**
- Consumes: `formatCountdown` and `TelegramLinkQr` (Task 5); `LinkInvite`, `TelegramLink`, `TelegramLinkStatus` (Task 4).
- Produces:
  - `<TelegramNotLinkedBody status={TelegramLinkStatus} onIssue={() => void} />`
  - `<TelegramInviteBody invite={LinkInvite} secondsRemaining={number | null} onRegenerate={() => void} />`
  - `<TelegramLinkedBody onUnlink={() => void} />`
  - `<TelegramUnlinkConfirm employeeName={string} onCancel={() => void} onConfirm={() => void} />`
  - `<TelegramDialog link={TelegramLink} />`

**Why the bodies are separate:** Radix's `DialogContent` resolves its portal container in a layout effect and server-renders to `null`. Under `renderToStaticMarkup` the whole dialog is an empty string, so every assertion against `TelegramDialog` itself would pass for the wrong reason. The bodies are portal-free and are where the tests point.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/telegram/telegramBodies.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TelegramInviteBody,
  TelegramLinkedBody,
  TelegramNotLinkedBody,
  TelegramUnlinkConfirm,
} from "@/ui/telegram/TelegramBodies";

const INVITE = {
  employee: "HR-EMP-00001",
  url: "https://t.me/dewey_time_bot?start=Xk3_9pQ-rT7wLmZ2aB4cD6eF8gH0iJkL",
  expires_at: "2026-08-19 09:00:00",
  expires_in_seconds: 86_400,
};

const noop = () => {};

test("the link input is readOnly rather than disabled, so it stays selectable", () => {
  // navigator.clipboard needs a secure context. When it is unavailable,
  // selecting the text by hand is the only fallback -- and a disabled input
  // cannot be selected.
  const html = renderToStaticMarkup(
    <TelegramInviteBody invite={INVITE} secondsRemaining={86_400} onRegenerate={noop} />,
  );
  assert.match(html, /readonly=""/i);
  assert.doesNotMatch(html, /<input[^>]*\sdisabled=""/);
  assert.match(html, /t\.me\/dewey_time_bot/);
});

test("the issued body warns that the link is live, and shows the time left", () => {
  // It is a credential on screen: whoever opens it first gets bound to this
  // employee's record. HR should not have to infer that.
  const html = renderToStaticMarkup(
    <TelegramInviteBody invite={INVITE} secondsRemaining={86_400} onRegenerate={noop} />,
  );
  assert.match(html, /bound to their record instead/);
  assert.match(html, /24h 0m/);
});

test("an expired link shows neither the URL nor the QR", () => {
  // THE state a static "Expires 2026-08-19 09:00:00" can never reach. A dead
  // credential that still renders as a live one is worse than no display at
  // all: HR sends it, and the employee gets a link that silently fails.
  const html = renderToStaticMarkup(
    <TelegramInviteBody invite={INVITE} secondsRemaining={0} onRegenerate={noop} />,
  );
  assert.doesNotMatch(html, /t\.me/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /expired/i);
});

test("an id on file is reported as already bindable without a link", () => {
  // claim_by_recorded_id is live in the webhook today: a bare /start binds
  // these employees. Nothing currently tells HR, so they issue links people
  // do not need.
  const html = renderToStaticMarkup(
    <TelegramNotLinkedBody status="id_on_file" onIssue={noop} />,
  );
  assert.match(html, /\/start/);
});

test("an employee with nothing on file is not told to try /start", () => {
  // The mirror. Telling them to open the bot would send them to a refusal.
  const html = renderToStaticMarkup(
    <TelegramNotLinkedBody status="none" onIssue={noop} />,
  );
  assert.doesNotMatch(html, /\/start/);
});

test("a linked employee is offered Unlink and never Issue", () => {
  // Issuing for someone already bound is refused by the API; offering it here
  // would be an error message dressed as a button.
  const html = renderToStaticMarkup(<TelegramLinkedBody onUnlink={noop} />);
  assert.match(html, /Unlink/);
  assert.doesNotMatch(html, /Issue link/);
});

test("the unlink confirm names the employee and states what is lost", () => {
  const html = renderToStaticMarkup(
    <TelegramUnlinkConfirm employeeName="Aaron Wells" onCancel={noop} onConfirm={noop} />,
  );
  assert.match(html, /Aaron Wells/);
  assert.match(html, /Mini App/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:web`
Expected: FAIL — `Cannot find module '@/ui/telegram/TelegramBodies'`.

- [ ] **Step 3: Implement the bodies**

Create `src/ui/telegram/TelegramBodies.tsx`:

```tsx
/**
 * The Telegram dialog's bodies, exported one by one.
 *
 * Split from the dialog shell because Radix's DialogContent resolves its
 * portal container in a layout effect and therefore server-renders to null.
 * Under renderToStaticMarkup the whole dialog is an empty string, so every
 * assertion aimed at it passes for the wrong reason. These are portal-free.
 */
import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TelegramLinkQr } from "@/ui/telegram/TelegramLinkQr";
import { formatCountdown } from "@/ui/telegram/expiry";
import type { LinkInvite } from "@/services/telegram";
import type { TelegramLinkStatus } from "@/hooks/useTelegramLink";

/** The warning is the point of showing the raw link at all. */
const LIVE_WARNING =
  "Anyone who opens this link before the employee does will be bound to their " +
  "record instead, so send it to them directly rather than to a group.";

export function TelegramNotLinkedBody(props: {
  status: TelegramLinkStatus;
  onIssue: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        A link binds the first Telegram account that opens it to this
        employee&rsquo;s record. It works once and expires after 24 hours.
      </p>
      {/* Only for id_on_file. claim_by_recorded_id is live in the webhook, so
          these employees can already bind themselves — and until now nothing
          told HR that, so they issued links nobody needed. */}
      {props.status === "id_on_file" ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          This employee has a Telegram ID on file. They can link by opening the
          bot and sending <span className="font-mono">/start</span> — no link
          needed. Issue one only if that fails.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{LIVE_WARNING}</p>
      <Button type="button" onClick={props.onIssue} className="self-start">
        Issue link
      </Button>
    </div>
  );
}

export function TelegramInviteBody(props: {
  invite: LinkInvite;
  secondsRemaining: number | null;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(props.invite.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  // `!== null && <= 0`, not a bare falsy check: null means the first tick has
  // not landed yet, which is not the same as expired and must not render as it.
  const expired = props.secondsRemaining !== null && props.secondsRemaining <= 0;

  if (expired) {
    return (
      <div className="flex flex-col gap-3">
        <p className="py-2 text-sm text-muted-foreground">
          This link has expired. Issue a new one to send to the employee.
        </p>
        <Button type="button" onClick={props.onRegenerate} className="self-start">
          Regenerate
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <TelegramLinkQr url={props.invite.url} />
      <div className="flex items-center gap-2">
        {/* readOnly, not disabled: a disabled input cannot be selected, and
            selecting the text by hand is the fallback when the clipboard API
            is unavailable (it needs a secure context). */}
        <input
          readOnly
          value={props.invite.url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs text-foreground"
        />
        <Button type="button" variant="outline" onClick={copy} className="shrink-0">
          {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {props.secondsRemaining === null
          ? "Expires in 24 hours."
          : `Expires in ${formatCountdown(props.secondsRemaining)}.`}{" "}
        {LIVE_WARNING}
      </p>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={props.onRegenerate}>
          Regenerate
        </Button>
        <span className="text-xs text-muted-foreground">
          The link above stops working.
        </span>
      </div>
    </div>
  );
}

export function TelegramLinkedBody(props: { onUnlink: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        This employee is linked to Telegram. They receive check-in messages and
        can open the Mini App.
      </p>
      <Button
        type="button"
        variant="destructive"
        onClick={props.onUnlink}
        className="self-start"
      >
        Unlink
      </Button>
    </div>
  );
}

/**
 * The confirm, in place rather than as a second dialog.
 *
 * There is no alert-dialog primitive in this design system, and stacking Radix
 * dialogs brings focus-trap problems that are not worth taking on for one
 * two-button question.
 */
export function TelegramUnlinkConfirm(props: {
  employeeName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground">
        Unlink {props.employeeName}? They lose Mini App access and check-in
        messages until a new link is issued and opened.
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={props.onConfirm}>
          Unlink
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement the shell**

Create `src/ui/telegram/TelegramDialog.tsx`:

```tsx
/**
 * The one place the Telegram link lifecycle is operated.
 *
 * Opening it mints nothing. The row button used to issue a live credential on
 * a single stray click, with no confirmation anywhere -- this dialog is where
 * that became a deliberate act.
 */
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TelegramInviteBody,
  TelegramLinkedBody,
  TelegramNotLinkedBody,
  TelegramUnlinkConfirm,
} from "@/ui/telegram/TelegramBodies";
import type { TelegramLink } from "@/hooks/useTelegramLink";

export function TelegramDialog(props: { link: TelegramLink }) {
  const { target, invite, error, busy, close, issue, revoke } = props.link;
  const open = target !== null;

  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  // The deadline is pinned ONCE, from the duration the server sent, at the
  // moment the invite lands. Recomputing it on render would restart the clock
  // on every keystroke elsewhere in the tree.
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  useEffect(() => {
    if (!invite) {
      setDeadlineMs(null);
      setSecondsRemaining(null);
      return;
    }
    setDeadlineMs(Date.now() + invite.expires_in_seconds * 1000);
  }, [invite]);

  // Gated on `open` and torn down on close, on a new deadline, and on reaching
  // zero. An interval left running behind a closed dialog is the mirror of the
  // Mini App's frozen clock -- both are the same class of mistake, and this one
  // keeps a timer alive for the life of the page.
  useEffect(() => {
    if (!open || deadlineMs === null) return;
    let id = 0;
    const tick = () => {
      const left = Math.max(0, Math.round((deadlineMs - Date.now()) / 1000));
      setSecondsRemaining(left);
      if (left <= 0) window.clearInterval(id);
    };
    tick();
    id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, deadlineMs]);

  // The confirm is transient UI, not state worth surviving a close.
  useEffect(() => {
    if (!open) setConfirmingUnlink(false);
  }, [open]);

  function body() {
    if (!target) return null;
    if (error) {
      return <p className="py-6 text-center text-sm text-destructive">{error}</p>;
    }
    if (busy === "issuing") {
      return <p className="py-6 text-center text-sm text-muted-foreground">Issuing a link…</p>;
    }
    if (busy === "revoking") {
      return <p className="py-6 text-center text-sm text-muted-foreground">Unlinking…</p>;
    }
    if (invite) {
      return (
        <TelegramInviteBody
          invite={invite}
          secondsRemaining={secondsRemaining}
          onRegenerate={issue}
        />
      );
    }
    if (confirmingUnlink) {
      return (
        <TelegramUnlinkConfirm
          employeeName={target.employeeName}
          onCancel={() => setConfirmingUnlink(false)}
          onConfirm={() => {
            setConfirmingUnlink(false);
            revoke();
          }}
        />
      );
    }
    if (target.status === "linked") {
      return <TelegramLinkedBody onUnlink={() => setConfirmingUnlink(true)} />;
    }
    return <TelegramNotLinkedBody status={target.status} onIssue={issue} />;
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Telegram{target ? ` — ${target.employeeName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Send the link to the employee, or let them scan it. It works once
            and expires after 24 hours.
          </DialogDescription>
        </DialogHeader>
        {body()}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run the tests and the typechecker**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:web`
Expected: PASS, **+7** tests.

Run: `npm --prefix dewey_time/frontend/hr_attendance run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/ui/telegram/
git commit -m "feat(telegram): one dialog for issue, regenerate and unlink"
```

---

## Task 7: Wire the register to the new dialog

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/schedule-coverage/registerColumns.tsx:1-16` (imports), `:165-169` (signature), `:337-388` (the Telegram cell)
- Modify: `dewey_time/frontend/hr_attendance/src/ui/schedule-coverage/CoverageRegisterPage.tsx:17-18`, `:589-634`
- Test: `dewey_time/frontend/hr_attendance/src/ui/coverageRegister.test.tsx:2296-2360`

**Interfaces:**
- Consumes: `useTelegramLink`, `TelegramTarget` (Task 4); `TelegramDialog` (Task 6).
- Produces: `registerColumns(onOpen, onAddSchedule, onManageTelegram)` — the third parameter is **renamed** from `onIssueLink` and keeps the type `(row: RegisterRow) => void`.

**Context:** wherever `CoverageRegisterView` forwards `onIssueLink` down to `registerColumns`, that prop is renamed too. Grep for `onIssueLink` and change every occurrence; there are call sites in `CoverageRegisterPage.tsx` and in the test file's `renderRow` helper.

- [ ] **Step 1: Write the failing tests**

In `src/ui/coverageRegister.test.tsx`, replace the whole "The Telegram column" section (the `issueLinkButton` helper and the four tests that follow it) with:

```tsx
/** The Telegram cell's manage-button props, or null when it draws none. */
function manageButton(row: RegisterRow) {
  const { elements } = renderRow(row);
  return findProps<{ onClick?: () => void; "aria-label"?: string }>(
    elements.telegram,
    (props) => typeof props["aria-label"] === "string"
      && props["aria-label"].startsWith("Manage Telegram"),
  );
}

test("each Telegram state renders its own badge wording", () => {
  // Exhaustive on purpose: an unhandled state renders an empty badge, which
  // reads as "linked" to nobody and as a rendering bug to everybody.
  const seen = (["linked", "id_on_file", "none"] as const).map(
    (telegram) => renderRow({ ...BASE_ROW, telegram }).html.telegram,
  );
  assert.match(seen[0], />Linked</);
  assert.match(seen[1], />ID on file</);
  assert.match(seen[2], />Not linked</);
});

test("an unknown Telegram state is an em dash with nothing to press", () => {
  // No feed vouched for the fact, so there is nothing to manage. Offering a
  // button would put someone on a to-do list built from a failed query.
  const html = renderRow({ ...BASE_ROW, telegram: null }).html.telegram;
  assert.match(html, /—/);
  assert.equal(manageButton({ ...BASE_ROW, telegram: null }), null);
});

test("every known Telegram state offers a manage button wired to its own row", () => {
  // Including "linked": that row is where Unlink lives now, and unlink ->
  // re-issue is the changed-phone flow.
  for (const telegram of ["linked", "id_on_file", "none"] as const) {
    const row = { ...BASE_ROW, telegram };
    let managed: RegisterRow | null = null;
    const { elements } = renderRow(row, noop, noop, (r) => { managed = r; });
    const button = findProps<{ onClick?: () => void; "aria-label"?: string }>(
      elements.telegram,
      (props) => typeof props["aria-label"] === "string"
        && props["aria-label"].startsWith("Manage Telegram"),
    );
    assert.ok(button, `${telegram} must offer a manage button`);
    button.onClick?.();
    assert.equal(managed, row, `${telegram} must pass its own row`);
  }
});

test("the manage button names the employee it would act on", () => {
  // A page of buttons all called "Manage Telegram" gives a screen-reader user
  // nothing to choose between, and what is being chosen is whose credential
  // gets minted or destroyed.
  const button = manageButton({ ...BASE_ROW, telegram: "none" });
  assert.equal(button?.["aria-label"], `Manage Telegram for ${BASE_ROW.employee_name}`);
});
```

Read the existing test at line ~2352 ("the Issue link button names the employee it would issue for") before deleting it, and confirm the replacement above covers the same property.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:web`
Expected: FAIL — `manageButton(...)` returns `null`; the cell still renders `aria-label="Issue a Telegram link for …"`.

- [ ] **Step 3: Update the column**

In `registerColumns.tsx`, add `LinkIcon` to the lucide import:

```tsx
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, LinkIcon, SendIcon } from "lucide-react";
```

Rename the third parameter:

```tsx
export function registerColumns(
  onOpen: (row: RegisterRow) => void,
  onAddSchedule: (row: RegisterRow) => void,
  onManageTelegram: (row: RegisterRow) => void,
): ColumnDef<RegisterRow, unknown>[] {
```

Replace the `telegram` column's `cell` with:

```tsx
      cell: ({ row }) => {
        const value = row.original.telegram;
        if (value === null) return "—";
        return (
          <span className="flex items-center gap-1.5">
            <Badge variant={TELEGRAM_VARIANT[value]}>{TELEGRAM_LABELS[value]}</Badge>
            {/* Drawn for EVERY known state, "linked" included: that row is
                where Unlink lives, and unlink -> re-issue is the changed-phone
                flow. It used to be hidden there because the only action was
                issuing, which would have rebound the record to whoever opened
                the new link.

                Pressing this mints nothing. It opens a dialog. The old
                one-click issue put a live credential on screen from a stray
                click with no confirmation anywhere.

                Icon-only, and that is a width decision with a measurement
                behind it. As a text button this cell was 195px — as wide as
                Biometric — and the table had no slack to give it: the Employee
                column was already pinned at its 185px floor, so the 39px this
                column took came straight out of the name stack and pushed the
                Khmer name's 200px threshold from a 1330 viewport to well past
                1340. Khmer names on an ordinary laptop is a deliberate,
                measured behaviour (see the Employee cell's own note); a
                Telegram column is not worth spending it. */}
            <AppTooltip content="Manage Telegram" side="bottom">
              <Button
                size="sm"
                variant="ghost"
                className="size-7 shrink-0 p-0"
                onClick={() => onManageTelegram(row.original)}
                // Named per row. A page of buttons all called "Manage
                // Telegram" gives a screen-reader user nothing to choose
                // between, and what is being chosen is whose credential gets
                // minted or destroyed.
                aria-label={`Manage Telegram for ${row.original.employee_name}`}
              >
                {value === "linked" ? (
                  <LinkIcon className="size-3.5" aria-hidden="true" />
                ) : (
                  <SendIcon className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </AppTooltip>
          </span>
        );
      },
```

- [ ] **Step 4: Update the page**

In `CoverageRegisterPage.tsx`, replace the two imports at lines 17-18:

```tsx
import { useTelegramLink } from "@/hooks/useTelegramLink";
import { TelegramDialog } from "@/ui/telegram/TelegramDialog";
```

Replace the `telegramInvite` block (lines ~589-598) with:

```tsx
  // The one control on this page that WRITES. Everything else navigates or
  // narrows; this mints and destroys credentials, so it stays in the routed
  // component beside the dialog that operates them rather than travelling
  // into the view.
  //
  // `refresh` on unlink and not on issue: unlinking changes the badge, issuing
  // does not — nobody is linked until the token is redeemed, which happens on
  // the employee's phone, minutes or hours later.
  const telegram = useTelegramLink({ onUnlinked: refresh });
  // `telegram.openFor`, NOT `telegram`. The hook returns a fresh object every
  // render, so depending on the whole thing gives this callback a new identity
  // every render — which invalidates the view's `registerColumns` memo, and
  // TanStack resets column state whenever the columns reference changes.
  // `openFor` is `useCallback(..., [])` and is stable.
  const openTelegram = telegram.openFor;
  const handleManageTelegram = useCallback(
    (row: RegisterRow) => {
      openTelegram({
        employee: row.id,
        employeeName: row.employee_name,
        // `?? "none"` is unreachable — the cell draws no button for a null
        // state — but the target type has no room for "we don't know", and
        // guessing "linked" here would offer Unlink for an unknown state.
        status: row.telegram ?? "none",
      });
    },
    [openTelegram],
  );
```

Replace the `onIssueLink={handleIssueLink}` prop on `<CoverageRegisterView>` with `onManageTelegram={handleManageTelegram}`, rename the prop in `CoverageRegisterView`'s own props type and in its `registerColumns(...)` call, and replace the trailing `<TelegramLinkDialog>` block with:

```tsx
      <TelegramDialog link={telegram} />
```

Delete the now-unused `const [invitee, setInvitee] = useState<string | null>(null);` and check whether `useState` is still imported for something else before removing the import.

- [ ] **Step 5: Run the tests, typecheck and build**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:web`
Expected: PASS. The Telegram-column section goes from 5 tests to 4, so the total moves by **−1**.

Run: `npm --prefix dewey_time/frontend/hr_attendance run typecheck`
Expected: clean.

Run: `npm --prefix dewey_time/frontend/hr_attendance run build`
Expected: clean. Do **not** commit the built assets yet — Task 9 does that once, after the last source change.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/frontend/hr_attendance/src/ui/schedule-coverage/ \
        dewey_time/frontend/hr_attendance/src/ui/coverageRegister.test.tsx
git commit -m "feat(telegram): the register row opens a manage dialog instead of minting"
```

---

## Task 8: Remove the toolbar surface and delete the dead files

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/ui/AttendanceToolbar.tsx:24-25`, `:66-68`, `:116-120`, `:227-236`
- Delete: `dewey_time/frontend/hr_attendance/src/ui/TelegramLinkDialog.tsx`
- Delete: `dewey_time/frontend/hr_attendance/src/hooks/useTelegramInvite.ts`
- Delete: `dewey_time/frontend/hr_attendance/src/ui/telegramLinkDialog.test.tsx`

**Interfaces:**
- Consumes: nothing new. Task 7 moved the register off the old components, so both are now unreferenced.
- Produces: nothing. This task only removes.

- [ ] **Step 1: Remove the toolbar's Telegram segment**

In `src/ui/AttendanceToolbar.tsx`:

Delete these two import lines (24-25):

```tsx
import { TelegramLinkButton, TelegramLinkDialog } from "@/ui/TelegramLinkDialog";
import { useTelegramInvite } from "@/hooks/useTelegramInvite";
```

Delete the hook call and its comment (66-68):

```tsx
  // Shared with the coverage register, which issues the same credential from
  // any row. See useTelegramInvite for the reset-before-fetch rule.
  const telegramInvite = useTelegramInvite();
```

Delete the divider and button (116-120):

```tsx
            <div className="w-px shrink-0 self-stretch bg-border" aria-hidden="true" />
            <TelegramLinkButton
              disabled={!selectedEmployee || props.employeeLoading === true}
              onClick={() => selectedEmployee && telegramInvite.issue(selectedEmployee.id)}
            />
```

Delete the dialog and its comment (227-236):

```tsx
      {/* Inside <header> but outside the control group: Radix portals it to
          the body, so its position in the tree costs no layout. */}
      <TelegramLinkDialog ... />
```

**Keep** `selectedEmployee` and the `hrStaff` fragment — `WeeklyScheduleSummary` still uses both.

- [ ] **Step 2: Verify nothing still references the old modules**

Run:

```bash
grep -rn "useTelegramInvite\|TelegramLinkButton\|TelegramLinkDialog" \
  dewey_time/frontend/hr_attendance/src dewey_time/frontend/hr_attendance/e2e
```

Expected: **no output**. Any hit means Task 7 left a call site behind — fix it before deleting anything.

- [ ] **Step 3: Delete the dead files**

```bash
git rm dewey_time/frontend/hr_attendance/src/ui/TelegramLinkDialog.tsx \
       dewey_time/frontend/hr_attendance/src/hooks/useTelegramInvite.ts \
       dewey_time/frontend/hr_attendance/src/ui/telegramLinkDialog.test.tsx
```

- [ ] **Step 4: Run the tests, typecheck and build**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:web`
Expected: PASS. The six tests in `telegramLinkDialog.test.tsx` are gone, so the total moves by **−6**. Their surviving properties were re-asserted against the new bodies in Task 6.

Run: `npm --prefix dewey_time/frontend/hr_attendance run typecheck`
Expected: clean. An unused-import error in `AttendanceToolbar.tsx` means a deletion was missed.

Run: `npm --prefix dewey_time/frontend/hr_attendance run build`
Expected: clean.

- [ ] **Step 5: Check the toolbar's own tests**

Run:

```bash
grep -rln "AttendanceToolbar" dewey_time/frontend/hr_attendance/src/**/*.test.tsx \
                              dewey_time/frontend/hr_attendance/e2e/*.spec.ts
```

Any test asserting a three-segment control group or counting the toolbar's dividers needs updating to two segments. If a Playwright spec measures the toolbar's width or row count, re-run it rather than reasoning about the number — Tailwind v4's variant ordering makes a correct-looking class string a possible no-op, and layout claims in this repo are settled by measurement.

- [ ] **Step 6: Commit**

```bash
git add -A dewey_time/frontend/hr_attendance/src
git commit -m "refactor(telegram): one surface issues links, and it is the register"
```

---

## Task 9: End-to-end coverage and the built assets

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/e2e/fixtures.ts:537-542`
- Modify: `dewey_time/frontend/hr_attendance/e2e/coverage-register.spec.ts:888-950`
- Modify: `dewey_time/public/**`, `dewey_time/www/*.html` (build output)

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: nothing further.

- [ ] **Step 1: Update the API stub**

In `e2e/fixtures.ts`, extend the `create_link_invite` branch and add a `revoke_link` branch beside it:

```ts
    } else if (p.includes("create_link_invite")) {
      message = {
        employee: "EMP-002",
        url: "https://t.me/dewey_time_bot?start=e2etoken",
        expires_at: "2026-08-19 12:00:00",
        expires_in_seconds: 86400,
      };
    } else if (p.includes("revoke_link")) {
      message = { employee: "EMP-001", unlinked: 1, tokens_revoked: 0 };
```

- [ ] **Step 2: Replace the two Telegram specs**

In `e2e/coverage-register.spec.ts`, replace the two existing Telegram tests (the one at ~line 900 and the one at ~line 929) with these three. Keep the section comment above them, updated:

```ts
/**
 * The Telegram column, and the only control on this page that WRITES.
 *
 * Everything the node suite can see about this column it already checks — the
 * three badges, the button's presence and its aria-label. What it structurally
 * cannot see is the round trip: the dialog's body sits behind Radix's
 * `DialogContent`, which resolves its portal container in a layout effect and
 * therefore server-renders to null. Under `renderToStaticMarkup` the whole
 * dialog is an empty string, so a button wired to nothing, a request that
 * never fires and a link that never reaches the screen would all stay green
 * there.
 */
test("the Telegram column reports each state, and every known one can be managed", async ({ page }) => {
  await stubFrappe(page);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  const rowFor = (name: string) => bodyRows(page).filter({ hasText: name });

  // Jane Doe is bound — and now HAS a button, because unlinking lives there.
  await expect(rowFor("Jane Doe")).toContainText("Linked");
  await expect(
    rowFor("Jane Doe").getByRole("button", { name: /^Manage Telegram/ }),
  ).toBeVisible();

  await expect(rowFor("Priya Nair")).toContainText("ID on file");
  await expect(
    rowFor("Priya Nair").getByRole("button", { name: /^Manage Telegram/ }),
  ).toBeVisible();

  // Tom O'Brien's state never arrived. An absent fact is an em dash and offers
  // nothing to press — guessing "Not linked" here would put him on a to-do
  // list built from a failed query.
  await expect(
    rowFor("Tom O'Brien").getByRole("button", { name: /^Manage Telegram/ }),
  ).toHaveCount(0);
});

test("opening the dialog mints nothing; issuing shows the link, the QR and the countdown", async ({ page }) => {
  const posted: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("create_link_invite")) posted.push(req.url());
  });

  await stubFrappe(page);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  await bodyRows(page)
    .filter({ hasText: "Aaron Wells" })
    .getByRole("button", { name: "Manage Telegram for Aaron Wells" })
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Aaron Wells");

  // THE point of the manage dialog: opening it is not a write. The old row
  // button minted a live credential on a stray click, with no confirmation.
  await expect(dialog.getByRole("button", { name: "Issue link" })).toBeVisible();
  expect(posted).toHaveLength(0);

  await dialog.getByRole("button", { name: "Issue link" }).click();

  await expect(dialog.getByRole("textbox")).toHaveValue(
    "https://t.me/dewey_time_bot?start=e2etoken",
  );
  // Rendered in the page, not fetched: the encoded value is the credential.
  await expect(dialog.locator("svg").first()).toBeVisible();
  // 86400s from receipt. Asserted as a shape, not a literal — a second of
  // wall-clock between the stub and the tick would make "24h 0m" flaky.
  await expect(dialog).toContainText(/Expires in 2[34]h \d+m/);
  await expect(dialog).toContainText("before the employee does");
  expect(posted).toHaveLength(1);
});

test("unlinking takes two presses and lands back on Issue link", async ({ page }) => {
  const posted: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("revoke_link")) posted.push(req.url());
  });

  await stubFrappe(page);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  await bodyRows(page)
    .filter({ hasText: "Jane Doe" })
    .getByRole("button", { name: "Manage Telegram for Jane Doe" })
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Issue link" })).toHaveCount(0);

  // First press is the confirm, not the deed.
  await dialog.getByRole("button", { name: "Unlink" }).click();
  await expect(dialog).toContainText("Jane Doe");
  await expect(dialog).toContainText("Mini App");
  expect(posted).toHaveLength(0);

  await dialog.getByRole("button", { name: "Unlink" }).click();
  expect(posted).toHaveLength(1);

  // Unlink -> issue is one continuous flow: the changed-phone case, end to end.
  await expect(dialog.getByRole("button", { name: "Issue link" })).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `npm --prefix dewey_time/frontend/hr_attendance run test:e2e`
Expected: PASS, with a real count near 250. **The `--prefix` is mandatory** — from the repo root Playwright resolves the `adms` install, prints "No tests found" and still exits 0.

`e2e/employee-identity.spec.ts:285` is known-flaky and has failed locally while passing in CI. If it fails, re-run that spec alone before treating it as a regression, and report it either way rather than folding it into this change.

- [ ] **Step 4: Build and commit the deployed assets**

Run: `npm --prefix dewey_time/frontend/hr_attendance run build`
Expected: clean.

```bash
git status --short dewey_time/public dewey_time/www
git add dewey_time/public dewey_time/www dewey_time/frontend/hr_attendance/e2e
git commit -m "test(telegram): the manage-dialog round trip, and the built assets"
```

Frappe Cloud never builds these SPAs — an uncommitted `dewey_time/public/**` means the deployed app keeps the old bundle while the Python side has the new API.

- [ ] **Step 5: Full-suite verification**

```bash
npm --prefix dewey_time/frontend/hr_attendance run test:web
npm --prefix dewey_time/frontend/hr_attendance run typecheck
python3 -m unittest discover -s dewey_time/tests -t . 2>&1 | tail -5
```

Net frontend unit-test delta across the whole plan: **+8** (+1 service, +7 expiry/QR, +7 bodies, −1 register column, −6 deleted dialog file). Net backend delta: **+17** (37 → 54).

- [ ] **Step 6: Post-merge bench step**

`telegram_link_token.json` changed, so the deployed bench needs a **Migrate**, not only a Deploy. Live assets updating is evidence of a Deploy alone, and a missing `revoked_at` column would make every `revoke_outstanding_tokens` call raise — which surfaces as "issuing a link is broken", not as a schema problem. Flag this to the human at handoff.
