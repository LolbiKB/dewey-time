# Telegram Binding and Check-in Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An employee links their Telegram account by tapping a one-time deep link, and from then on receives a Telegram message when they check in or out.

**Architecture:** Two new doctypes hold the identity — a hashed, single-use `Telegram Link Token` issued by HR, and a `Telegram Link` named by the Telegram user id so uniqueness is a primary key rather than a convention. A public webhook authenticated by Telegram's secret-token header redeems tokens. Check-in notifications hang off the existing `Employee Checkin` `after_insert` hook as a queued job, gated on rollout phase and on an enabled link. **No Frappe `User` is created for any employee.**

**Tech Stack:** Frappe/ERPNext/HRMS v16 (Python 3.14 on the sandbox bench), `requests` (already a dependency via `dashboard_auth.py`), Telegram Bot API over HTTPS webhook. No new Python packages.

**Spec:** [`docs/superpowers/specs/2026-08-15-telegram-employee-layer-design.md`](../specs/2026-08-15-telegram-employee-layer-design.md)

**This is plan 1 of 2.** Plan 2 (the Telegram Mini App read surface) depends on the binding this plan creates and is written separately. This plan ships working software on its own: linking plus live check-in notifications, with no Mini App.

## Global Constraints

Copied from the spec. Every task's requirements implicitly include these.

- **No Frappe `User` record is created for any employee, ever.** Identity is a Telegram binding and nothing else.
- **The binding resolver returns an Employee or raises — never a boolean, never `None`.** `is_valid()`-shaped helpers are forbidden: they invite both `if is_valid` typos and forgetting to call them.
- **There is no Frappe permission backstop under this feature.** `frappe.get_all` bypasses permissions, verified on a real bench 2026-08-15. The secret-token check and the binding lookup are the only line of defence.
- **Secrets live in `Password` fields on `Dewey Time Settings`**, read with `get_decrypted_password`. Never in code, never in `site_config` for this feature, never logged.
- **Constant-time comparison** (`hmac.compare_digest`) for every secret comparison.
- **Private chats only.** The bot refuses to act when `chat.type != "private"`.
- **Notifications are gated on `rollout.phase_for_employee(...) == "LIVE"`** and on an enabled `Telegram Link`.
- **Notification content is minimal**: the punch time and the branch. No flags, no lateness, no judgment.
- **Never send synchronously inside a doc event.** `webpush.py` states this rule for this codebase; a Telegram outage must never fail a checkin.
- **Existing `Employee.custom_telegram_chat_id` values are NOT imported, read, or written** by any code in this plan. They are the hand-transcribed ids this design exists to stop trusting.
- **The webhook and the binding resolver are written in the main session, not delegated to a subagent**, per the isolation-predicate rule in `CLAUDE.md`.

## Conventions in this repo

- Tests are `unittest`, under `dewey_time/tests/`, and install a frappe mock first:
  ```python
  from dewey_time.tests.test_closeout import _install_frappe_mock
  _install_frappe_mock()
  ```
  The mock import must come **before** importing the module under test, hence the `# noqa: E402` on that import.
- Run one module fast (no Docker): `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module <module_name>`
- Run the full backend suite (CI parity): `cd dev/sandbox && ./frappe-sandbox test --backend`
- **A green run is not proof tests ran — check the reported count.**
- Background jobs use `frappe.enqueue(dotted_path, queue="short", job_id=..., deduplicate=True, **kwargs)` — see `intraday.py:219-234`.
- A new doctype JSON needs a `modified` timestamp bump to be re-imported by `bench migrate`.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `dewey_time/dewey_time/doctype/telegram_link/telegram_link.json` | The binding. Named by `telegram_user_id`, so uniqueness is the primary key. |
| `dewey_time/dewey_time/doctype/telegram_link_token/telegram_link_token.json` | Single-use, expiring, **hashed** link tokens. |
| `dewey_time/telegram/__init__.py` | Package marker. |
| `dewey_time/telegram/binding.py` | Token issue/redeem and the fail-closed resolver. The security boundary. |
| `dewey_time/telegram/transport.py` | Telegram Bot API calls. The only module that talks to `api.telegram.org`. |
| `dewey_time/telegram/webhook.py` | The `allow_guest` endpoint. Auth, private-chat guard, `/start` dispatch. |
| `dewey_time/telegram/notify.py` | Check-in notification composition and the queued job. |
| `dewey_time/tests/test_telegram_binding.py` | Tests for `binding.py`. |
| `dewey_time/tests/test_telegram_webhook.py` | Tests for `webhook.py`. |
| `dewey_time/tests/test_telegram_notify.py` | Tests for `notify.py`. |

**Modified:**

| Path | Change |
|---|---|
| `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json` | Add `enable_telegram`, `telegram_bot_token`, `telegram_webhook_secret`. |
| `dewey_time/hooks.py` | Add a second `Employee Checkin.after_insert` handler. |

Splitting `binding` / `transport` / `webhook` / `notify` is deliberate: `binding.py` is the security boundary and should be readable in one screen without HTTP or message-formatting noise around it, and `transport.py` being the sole caller of the Telegram API means one place to add rate pacing and one place to stub in tests.

---

### Task 1: Settings fields for the bot credentials

**Files:**
- Modify: `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json`
- Create: `dewey_time/telegram/__init__.py`
- Create: `dewey_time/telegram/transport.py`
- Test: `dewey_time/tests/test_telegram_transport.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `dewey_time.telegram.transport.bot_token() -> str` — raises `frappe.ValidationError` if unset.
  - `dewey_time.telegram.transport.webhook_secret() -> str` — raises `frappe.ValidationError` if unset.
  - `dewey_time.telegram.transport.telegram_enabled() -> bool`
  - `dewey_time.telegram.transport.send_message(chat_id: str, text: str) -> None`

- [ ] **Step 1: Write the failing test**

Create `dewey_time/tests/test_telegram_transport.py`:

```python
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import transport  # noqa: E402


class TestCredentials(unittest.TestCase):
    def test_bot_token_raises_when_unset(self):
        # An unconfigured token must stop the feature dead. The dangerous
        # alternative is HMAC-ing on an empty key, which an attacker who
        # guesses the token is blank can forge against.
        with patch.object(transport, "_secret", return_value=""):
            with self.assertRaises(Exception):
                transport.bot_token()

    def test_bot_token_returns_configured_value(self):
        with patch.object(transport, "_secret", return_value="123:ABC"):
            self.assertEqual(transport.bot_token(), "123:ABC")

    def test_webhook_secret_raises_when_unset(self):
        with patch.object(transport, "_secret", return_value=None):
            with self.assertRaises(Exception):
                transport.webhook_secret()


class TestSendMessage(unittest.TestCase):
    def test_send_message_posts_to_the_bot_api(self):
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = {"ok": True}
            transport.send_message("55501", "Checked in 07:58")

        url = post.call_args[0][0]
        self.assertIn("https://api.telegram.org/bot123:ABC/sendMessage", url)
        self.assertEqual(post.call_args[1]["json"]["chat_id"], "55501")
        self.assertEqual(post.call_args[1]["json"]["text"], "Checked in 07:58")

    def test_blocked_recipient_is_reported_not_raised(self):
        # Telegram returns 403 when a user blocks the bot. That is a normal
        # end state, not an error to retry forever.
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 403
            post.return_value.json.return_value = {"ok": False, "description": "bot was blocked"}
            self.assertEqual(transport.send_message("55501", "hi"), transport.BLOCKED)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_transport`
Expected: FAIL — `ModuleNotFoundError: No module named 'dewey_time.telegram'`

- [ ] **Step 3: Add the settings fields**

In `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json`, append these three entries to `field_order` (after `"last_enrollment_snapshot_at"`):

```json
    "telegram_section",
    "enable_telegram",
    "telegram_bot_token",
    "telegram_webhook_secret"
```

and append these to the `fields` array:

```json
    {
      "fieldname": "telegram_section",
      "fieldtype": "Section Break",
      "label": "Telegram"
    },
    {
      "default": "0",
      "fieldname": "enable_telegram",
      "fieldtype": "Check",
      "label": "Enable Telegram"
    },
    {
      "fieldname": "telegram_bot_token",
      "fieldtype": "Password",
      "label": "Telegram Bot Token"
    },
    {
      "fieldname": "telegram_webhook_secret",
      "fieldtype": "Password",
      "label": "Telegram Webhook Secret"
    }
```

Then bump the file's `"modified"` value to `"2026-08-15 12:00:00.000000"` — **without this, `bench migrate` skips the schema reimport and the fields never appear.**

- [ ] **Step 4: Create the package marker**

Create `dewey_time/telegram/__init__.py` as an empty file.

- [ ] **Step 5: Write the transport module**

Create `dewey_time/telegram/transport.py`:

```python
"""The only module that talks to api.telegram.org.

Sole caller by design: one place to add rate pacing, one place to stub in
tests, and one place where the bot token is read.
"""

import frappe
import requests
from frappe.utils.password import get_decrypted_password

SETTINGS = "Dewey Time Settings"
API_BASE = "https://api.telegram.org"
TIMEOUT_SECONDS = 20

#: send_message outcomes. Returned rather than raised: a blocked recipient is a
#: normal end state that the caller resolves by disabling the link.
SENT = "sent"
BLOCKED = "blocked"
FAILED = "failed"


def _secret(fieldname: str):
    return get_decrypted_password(SETTINGS, SETTINGS, fieldname, raise_exception=False)


def telegram_enabled() -> bool:
    return bool(frappe.get_cached_value(SETTINGS, SETTINGS, "enable_telegram"))


def bot_token() -> str:
    """The bot token, or raise. Never returns an empty string.

    An unset token must stop the feature dead rather than let callers HMAC on
    an empty key — a hole an attacker can forge against once they guess the
    token is blank.
    """
    token = (_secret("telegram_bot_token") or "").strip()
    if not token:
        frappe.throw("Telegram bot token is not configured")
    return token


def webhook_secret() -> str:
    """The webhook secret, or raise. Same reasoning as bot_token()."""
    secret = (_secret("telegram_webhook_secret") or "").strip()
    if not secret:
        frappe.throw("Telegram webhook secret is not configured")
    return secret


def send_message(chat_id: str, text: str) -> str:
    """Send one message. Returns SENT, BLOCKED or FAILED — never raises.

    Callers are background jobs whose failure must not surface anywhere near a
    checkin write, so transport errors are reported as values.
    """
    url = f"{API_BASE}/bot{bot_token()}/sendMessage"
    try:
        response = requests.post(
            url,
            json={"chat_id": chat_id, "text": text},
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

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_transport`
Expected: PASS, 5 tests. **Confirm the count is 5** — a glob that matches nothing also exits 0.

- [ ] **Step 7: Commit**

```bash
git add dewey_time/telegram/__init__.py dewey_time/telegram/transport.py \
        dewey_time/tests/test_telegram_transport.py \
        dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json
git commit -m "feat(telegram): bot credentials in settings, and the send transport"
```

---

### Task 2: The two doctypes

**Files:**
- Create: `dewey_time/dewey_time/doctype/telegram_link/telegram_link.json`
- Create: `dewey_time/dewey_time/doctype/telegram_link/__init__.py`
- Create: `dewey_time/dewey_time/doctype/telegram_link/telegram_link.py`
- Create: `dewey_time/dewey_time/doctype/telegram_link_token/telegram_link_token.json`
- Create: `dewey_time/dewey_time/doctype/telegram_link_token/__init__.py`
- Create: `dewey_time/dewey_time/doctype/telegram_link_token/telegram_link_token.py`

**Interfaces:**
- Consumes: nothing.
- Produces: doctypes `Telegram Link` and `Telegram Link Token`, consumed by Task 3.

`Telegram Link` is named `field:telegram_user_id`, so **one Telegram account cannot bind to two employees** — the constraint is the primary key, not application code. `Telegram Link Token` is named `field:token_hash` for the same reason: a token can only be redeemed once because there is only one row.

The Desk list view of `Telegram Link` is HR's "who is bound" surface, and toggling `enabled` is the unlink. Both come free with the doctype — no separate UI task.

- [ ] **Step 1: Create the Telegram Link doctype JSON**

Create `dewey_time/dewey_time/doctype/telegram_link/telegram_link.json`:

```json
{
  "actions": [],
  "allow_copy": 0,
  "allow_guest_to_view": 0,
  "allow_import": 0,
  "autoname": "field:telegram_user_id",
  "creation": "2026-08-15 12:00:00.000000",
  "custom": 0,
  "doctype": "DocType",
  "document_type": "System",
  "editable_grid": 1,
  "engine": "InnoDB",
  "field_order": [
    "telegram_user_id",
    "employee",
    "chat_id",
    "enabled",
    "linked_at",
    "linked_via"
  ],
  "fields": [
    {
      "fieldname": "telegram_user_id",
      "fieldtype": "Data",
      "in_list_view": 1,
      "label": "Telegram User ID",
      "reqd": 1,
      "unique": 1
    },
    {
      "fieldname": "employee",
      "fieldtype": "Link",
      "in_list_view": 1,
      "label": "Employee",
      "options": "Employee",
      "reqd": 1
    },
    {
      "fieldname": "chat_id",
      "fieldtype": "Data",
      "label": "Chat ID",
      "reqd": 1
    },
    {
      "default": "1",
      "fieldname": "enabled",
      "fieldtype": "Check",
      "in_list_view": 1,
      "label": "Enabled"
    },
    {
      "fieldname": "linked_at",
      "fieldtype": "Datetime",
      "label": "Linked At",
      "read_only": 1
    },
    {
      "fieldname": "linked_via",
      "fieldtype": "Select",
      "label": "Linked Via",
      "options": "token\nhr_manual",
      "read_only": 1
    }
  ],
  "index_web_pages_for_search": 0,
  "links": [],
  "modified": "2026-08-15 12:00:00.000000",
  "modified_by": "Administrator",
  "module": "Dewey Time",
  "name": "Telegram Link",
  "naming_rule": "By fieldname",
  "owner": "Administrator",
  "permissions": [
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

`track_changes: 1` is deliberate — a binding change is exactly the thing you want a version history for when someone reports receiving another person's notifications.

- [ ] **Step 2: Create the Telegram Link controller**

Create `dewey_time/dewey_time/doctype/telegram_link/__init__.py` (empty), and `dewey_time/dewey_time/doctype/telegram_link/telegram_link.py`:

```python
import frappe
from frappe.model.document import Document


class TelegramLink(Document):
    def validate(self):
        # Defence in depth behind the primary key: an employee with two
        # Telegram accounts bound would make "which chat do we notify"
        # ambiguous, and the answer would be arbitrary.
        existing = frappe.db.get_value(
            "Telegram Link",
            {"employee": self.employee, "enabled": 1, "name": ["!=", self.name or ""]},
            "name",
        )
        if existing and self.enabled:
            frappe.throw(
                f"{self.employee} is already linked to Telegram account {existing}. "
                "Disable that link first."
            )
```

- [ ] **Step 3: Create the Telegram Link Token doctype JSON**

Create `dewey_time/dewey_time/doctype/telegram_link_token/telegram_link_token.json`:

```json
{
  "actions": [],
  "allow_copy": 0,
  "allow_guest_to_view": 0,
  "allow_import": 0,
  "autoname": "field:token_hash",
  "creation": "2026-08-15 12:00:00.000000",
  "custom": 0,
  "doctype": "DocType",
  "document_type": "System",
  "editable_grid": 1,
  "engine": "InnoDB",
  "field_order": [
    "token_hash",
    "employee",
    "expires_at",
    "redeemed_at",
    "redeemed_by_telegram_user_id"
  ],
  "fields": [
    {
      "description": "SHA-256 of the issued token. The token itself is never stored.",
      "fieldname": "token_hash",
      "fieldtype": "Data",
      "label": "Token Hash",
      "reqd": 1,
      "unique": 1
    },
    {
      "fieldname": "employee",
      "fieldtype": "Link",
      "in_list_view": 1,
      "label": "Employee",
      "options": "Employee",
      "reqd": 1
    },
    {
      "fieldname": "expires_at",
      "fieldtype": "Datetime",
      "in_list_view": 1,
      "label": "Expires At",
      "reqd": 1
    },
    {
      "fieldname": "redeemed_at",
      "fieldtype": "Datetime",
      "in_list_view": 1,
      "label": "Redeemed At",
      "read_only": 1
    },
    {
      "fieldname": "redeemed_by_telegram_user_id",
      "fieldtype": "Data",
      "label": "Redeemed By Telegram User ID",
      "read_only": 1
    }
  ],
  "index_web_pages_for_search": 0,
  "links": [],
  "modified": "2026-08-15 12:00:00.000000",
  "modified_by": "Administrator",
  "module": "Dewey Time",
  "name": "Telegram Link Token",
  "naming_rule": "By fieldname",
  "owner": "Administrator",
  "permissions": [
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
  "track_changes": 0
}
```

Storing only the SHA-256 means a database read — a backup, a support session, a compromised sandbox restore — never hands out live tokens.

- [ ] **Step 4: Create the token controller**

Create `dewey_time/dewey_time/doctype/telegram_link_token/__init__.py` (empty), and `dewey_time/dewey_time/doctype/telegram_link_token/telegram_link_token.py`:

```python
from frappe.model.document import Document


class TelegramLinkToken(Document):
    pass
```

- [ ] **Step 5: Migrate and verify both doctypes exist**

Run:

```bash
docker exec sandbox-bench-1 bash -lc \
  'cd ~/frappe-bench && bench --site test_site migrate'
```

Then verify both exist:

```bash
docker exec sandbox-bench-1 bash -lc \
  'cd ~/frappe-bench && bench --site test_site execute frappe.db.exists \
   --kwargs "{\"dt\":\"DocType\",\"dn\":\"Telegram Link\"}"'
docker exec sandbox-bench-1 bash -lc \
  'cd ~/frappe-bench && bench --site test_site execute frappe.db.exists \
   --kwargs "{\"dt\":\"DocType\",\"dn\":\"Telegram Link Token\"}"'
```

Expected: each prints the doctype name. An empty result means the JSON's
`modified` timestamp was not bumped and `bench migrate` skipped the import.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/dewey_time/doctype/telegram_link dewey_time/dewey_time/doctype/telegram_link_token
git commit -m "feat(telegram): Telegram Link and Telegram Link Token doctypes"
```

---

### Task 3: Token issue/redeem and the fail-closed resolver

This task is the security boundary. **Write it in the main session — do not delegate it to a subagent** (`CLAUDE.md`, isolation predicates).

**Files:**
- Create: `dewey_time/telegram/binding.py`
- Test: `dewey_time/tests/test_telegram_binding.py`

**Interfaces:**
- Consumes: doctypes `Telegram Link`, `Telegram Link Token` (Task 2).
- Produces:
  - `issue_link_token(employee: str, ttl_hours: int = 168) -> str` — the raw token, returned once and never stored.
  - `link_url(token: str, bot_username: str) -> str`
  - `redeem_link_token(token: str, telegram_user_id: str, chat_id: str) -> str` — returns the Employee id, or raises.
  - `employee_for_telegram_user(telegram_user_id: str) -> str` — returns the Employee id, or raises. **Never returns a boolean or `None`.**
  - `TOKEN_BYTES = 32`

- [ ] **Step 1: Write the failing tests**

Create `dewey_time/tests/test_telegram_binding.py`:

```python
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import binding  # noqa: E402


class TestTokenShape(unittest.TestCase):
    def test_token_fits_telegrams_start_payload(self):
        # Telegram's deep-link `start` payload allows 64 chars of
        # [A-Za-z0-9_-]. A 32-byte token base64url-encodes to 43.
        with patch.object(binding, "_store_token"):
            token = binding.issue_link_token("HR-EMP-00001")
        self.assertLessEqual(len(token), 64)
        self.assertRegex(token, r"^[A-Za-z0-9_-]+$")

    def test_two_tokens_are_never_equal(self):
        with patch.object(binding, "_store_token"):
            a = binding.issue_link_token("HR-EMP-00001")
            b = binding.issue_link_token("HR-EMP-00001")
        self.assertNotEqual(a, b)

    def test_the_raw_token_is_never_stored(self):
        # Only its SHA-256 goes to the database, so a backup or a support
        # session never hands out a live token.
        with patch.object(binding, "_store_token") as store:
            token = binding.issue_link_token("HR-EMP-00001")
        stored_hash = store.call_args[1]["token_hash"]
        self.assertNotEqual(stored_hash, token)
        self.assertEqual(stored_hash, binding._hash_token(token))

    def test_link_url_is_a_telegram_deep_link(self):
        self.assertEqual(
            binding.link_url("abc123", "dewey_time_bot"),
            "https://t.me/dewey_time_bot?start=abc123",
        )


class TestResolverFailsClosed(unittest.TestCase):
    def test_unknown_telegram_user_raises(self):
        with patch.object(binding.frappe.db, "get_value", return_value=None):
            with self.assertRaises(Exception):
                binding.employee_for_telegram_user("99999")

    def test_disabled_link_raises(self):
        # The filter must include enabled=1. Without it an unlinked person
        # keeps reading their record after HR revokes access.
        with patch.object(binding.frappe.db, "get_value", return_value=None) as gv:
            with self.assertRaises(Exception):
                binding.employee_for_telegram_user("55501")
        self.assertEqual(gv.call_args[0][1]["enabled"], 1)

    def test_resolver_returns_the_employee_id_not_a_boolean(self):
        with patch.object(binding.frappe.db, "get_value", return_value="HR-EMP-00001"):
            self.assertEqual(binding.employee_for_telegram_user("55501"), "HR-EMP-00001")

    def test_blank_telegram_user_id_raises(self):
        with self.assertRaises(Exception):
            binding.employee_for_telegram_user("")


class TestRedeem(unittest.TestCase):
    def _token_doc(self, **overrides):
        doc = {
            "name": "hash",
            "employee": "HR-EMP-00001",
            "expires_at": "2099-01-01 00:00:00",
            "redeemed_at": None,
        }
        doc.update(overrides)
        return doc

    def test_unknown_token_raises(self):
        with patch.object(binding, "_load_token", return_value=None):
            with self.assertRaises(Exception):
                binding.redeem_link_token("nope", "55501", "55501")

    def test_already_redeemed_token_raises(self):
        with patch.object(binding, "_load_token",
                          return_value=self._token_doc(redeemed_at="2026-08-01 00:00:00")):
            with self.assertRaises(Exception):
                binding.redeem_link_token("tok", "55501", "55501")

    def test_expired_token_raises(self):
        with patch.object(binding, "_load_token",
                          return_value=self._token_doc(expires_at="2000-01-01 00:00:00")):
            with self.assertRaises(Exception):
                binding.redeem_link_token("tok", "55501", "55501")

    def test_valid_token_creates_the_link_and_returns_the_employee(self):
        with patch.object(binding, "_load_token", return_value=self._token_doc()), \
             patch.object(binding, "_create_link") as create, \
             patch.object(binding, "_mark_redeemed"):
            employee = binding.redeem_link_token("tok", "55501", "77702")

        self.assertEqual(employee, "HR-EMP-00001")
        self.assertEqual(create.call_args[1]["employee"], "HR-EMP-00001")
        self.assertEqual(create.call_args[1]["telegram_user_id"], "55501")
        self.assertEqual(create.call_args[1]["chat_id"], "77702")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_binding`
Expected: FAIL — `ModuleNotFoundError: No module named 'dewey_time.telegram.binding'`

- [ ] **Step 3: Write the binding module**

Create `dewey_time/telegram/binding.py`:

```python
"""Telegram identity: token issue, token redemption, and the resolver.

THE SECURITY BOUNDARY OF THIS FEATURE.

There is no Frappe permission backstop underneath. `frappe.get_all` bypasses
permissions — verified on a real bench 2026-08-15 — so a Guest-context request
reads whatever the caller asks for. What stops it is this module and the
webhook's secret check. Nothing else.

Everything here fails closed: `employee_for_telegram_user` returns an Employee
id or raises, and never a boolean. A boolean invites both `if is_valid` typos
and forgetting to call it at all; a function whose only non-raising outcome is
an authorized Employee cannot be accidentally ignored.
"""

import hashlib
import secrets

import frappe
from frappe.utils import add_to_date, get_datetime, now_datetime

LINK_DT = "Telegram Link"
TOKEN_DT = "Telegram Link Token"

#: 32 bytes -> 43 base64url chars, inside Telegram's 64-char `start` payload
#: limit of [A-Za-z0-9_-].
TOKEN_BYTES = 32
DEFAULT_TTL_HOURS = 168  # 7 days


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _store_token(*, token_hash: str, employee: str, expires_at) -> None:
    doc = frappe.new_doc(TOKEN_DT)
    doc.token_hash = token_hash
    doc.employee = employee
    doc.expires_at = expires_at
    doc.insert(ignore_permissions=True)


def _load_token(token_hash: str):
    if not frappe.db.exists(TOKEN_DT, token_hash):
        return None
    return frappe.db.get_value(
        TOKEN_DT,
        token_hash,
        ["name", "employee", "expires_at", "redeemed_at"],
        as_dict=True,
    )


def _mark_redeemed(token_hash: str, telegram_user_id: str) -> None:
    frappe.db.set_value(
        TOKEN_DT,
        token_hash,
        {
            "redeemed_at": now_datetime(),
            "redeemed_by_telegram_user_id": telegram_user_id,
        },
    )


def _create_link(*, employee: str, telegram_user_id: str, chat_id: str) -> None:
    doc = frappe.new_doc(LINK_DT)
    doc.telegram_user_id = telegram_user_id
    doc.employee = employee
    doc.chat_id = chat_id
    doc.enabled = 1
    doc.linked_at = now_datetime()
    doc.linked_via = "token"
    doc.insert(ignore_permissions=True)


def issue_link_token(employee: str, ttl_hours: int = DEFAULT_TTL_HOURS) -> str:
    """Mint a single-use token for `employee`. Returns the RAW token, once.

    Only its SHA-256 reaches the database, so nothing that can read the
    database can redeem on someone's behalf.
    """
    employee = (employee or "").strip()
    if not employee:
        frappe.throw("employee is required")

    token = secrets.token_urlsafe(TOKEN_BYTES)
    _store_token(
        token_hash=_hash_token(token),
        employee=employee,
        expires_at=add_to_date(now_datetime(), hours=ttl_hours),
    )
    return token


def link_url(token: str, bot_username: str) -> str:
    return f"https://t.me/{bot_username}?start={token}"


def redeem_link_token(token: str, telegram_user_id: str, chat_id: str) -> str:
    """Bind a Telegram account to an Employee. Returns the Employee id or raises.

    `telegram_user_id` comes off the authenticated Telegram update, never from
    anything the sender chose.
    """
    token = (token or "").strip()
    telegram_user_id = str(telegram_user_id or "").strip()
    if not token or not telegram_user_id:
        frappe.throw("Invalid link request")

    row = _load_token(_hash_token(token))
    if not row:
        frappe.throw("This link is not valid. Ask HR for a new one.")
    if row.get("redeemed_at"):
        frappe.throw("This link has already been used. Ask HR for a new one.")
    if get_datetime(row["expires_at"]) < now_datetime():
        frappe.throw("This link has expired. Ask HR for a new one.")

    _create_link(
        employee=row["employee"],
        telegram_user_id=telegram_user_id,
        chat_id=str(chat_id),
    )
    _mark_redeemed(row["name"], telegram_user_id)
    return row["employee"]


def employee_for_telegram_user(telegram_user_id: str) -> str:
    """The Employee bound to this Telegram account, or raise.

    NEVER returns a boolean and never returns None. See the module docstring.
    """
    telegram_user_id = str(telegram_user_id or "").strip()
    if not telegram_user_id:
        frappe.throw("Not permitted", frappe.PermissionError)

    employee = frappe.db.get_value(
        LINK_DT,
        {"telegram_user_id": telegram_user_id, "enabled": 1},
        "employee",
    )
    if not employee:
        frappe.throw("Not permitted", frappe.PermissionError)
    return employee
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_binding`
Expected: PASS, 12 tests. **Confirm the count is 12.**

- [ ] **Step 5: Mutation-test the resolver**

Manually delete `"enabled": 1` from the `get_value` filter in `employee_for_telegram_user`, re-run the module, and confirm `test_disabled_link_raises` **fails**. Restore it. Then delete the `if row.get("redeemed_at")` branch, re-run, and confirm `test_already_redeemed_token_raises` **fails**. Restore it.

A test that stays green through a deleted guard is not protecting anything — see the notes in `outageExcusePanel.test.tsx` about exactly this trap.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/telegram/binding.py dewey_time/tests/test_telegram_binding.py
git commit -m "feat(telegram): fail-closed binding resolver and single-use link tokens"
```

---

### Task 4: The webhook

Also the security boundary. **Write it in the main session — do not delegate.**

**Files:**
- Create: `dewey_time/telegram/webhook.py`
- Test: `dewey_time/tests/test_telegram_webhook.py`

**Interfaces:**
- Consumes: `binding.redeem_link_token`, `transport.webhook_secret`, `transport.send_message` (Tasks 1, 3).
- Produces: `dewey_time.telegram.webhook.telegram_webhook()` — a whitelisted `allow_guest` POST endpoint.

- [ ] **Step 1: Write the failing tests**

Create `dewey_time/tests/test_telegram_webhook.py`:

```python
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import webhook  # noqa: E402


def _update(text="/start tok", chat_type="private", user_id=55501):
    return {
        "message": {
            "text": text,
            "chat": {"id": 77702, "type": chat_type},
            "from": {"id": user_id},
        }
    }


class TestSecret(unittest.TestCase):
    def test_wrong_secret_is_refused(self):
        with patch.object(webhook.transport, "webhook_secret", return_value="right"):
            self.assertFalse(webhook._secret_ok("wrong"))

    def test_absent_secret_is_refused(self):
        # The classic bypass shape: a missing header must reject, not skip.
        with patch.object(webhook.transport, "webhook_secret", return_value="right"):
            self.assertFalse(webhook._secret_ok(None))
            self.assertFalse(webhook._secret_ok(""))

    def test_matching_secret_is_accepted(self):
        with patch.object(webhook.transport, "webhook_secret", return_value="right"):
            self.assertTrue(webhook._secret_ok("right"))


class TestPrivateChatsOnly(unittest.TestCase):
    def test_group_chat_is_ignored(self):
        # Added to a group, the bot must not reply — one add-to-group would
        # otherwise leak a person's attendance to their colleagues.
        with patch.object(webhook, "_secret_ok", return_value=True), \
             patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(chat_type="group"))
        redeem.assert_not_called()
        send.assert_not_called()


class TestStartCommand(unittest.TestCase):
    def test_start_with_token_redeems_and_confirms(self):
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001") as redeem, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))

        self.assertEqual(redeem.call_args[0][0], "abc123")
        # The Telegram user id must come off the update, not the message text.
        self.assertEqual(redeem.call_args[0][1], "55501")
        self.assertIn("linked", send.call_args[0][1].lower())

    def test_failed_redemption_replies_without_leaking_why(self):
        with patch.object(webhook.binding, "redeem_link_token",
                          side_effect=Exception("token expired at 2026-01-01")), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))

        reply = send.call_args[0][1]
        self.assertNotIn("2026-01-01", reply)
        self.assertIn("HR", reply)

    def test_bare_start_explains_how_to_link(self):
        with patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start"))
        redeem.assert_not_called()
        self.assertIn("HR", send.call_args[0][1])

    def test_unknown_text_is_ignored_silently(self):
        with patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="hello there"))
        send.assert_not_called()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_webhook`
Expected: FAIL — `ModuleNotFoundError: No module named 'dewey_time.telegram.webhook'`

- [ ] **Step 3: Write the webhook module**

Create `dewey_time/telegram/webhook.py`:

```python
"""Telegram's inbound webhook. PUBLIC — allow_guest, reachable by anyone.

Authenticated by Telegram's X-Telegram-Bot-Api-Secret-Token header, compared
in constant time. This mirrors the established pattern for guest endpoints in
this app (notify_device_sync_status, notify_device_closeout_status,
notify_enrollment_snapshot, all via bridge_auth.validate_bridge_request) — but
with one important difference: those are server-to-server and can hold an API
key as well. A webhook can only hold this one secret, so it carries the whole
load.

The bot's only command is /start <token>. There is deliberately no /today or
/week: the Mini App is the read surface.
"""

import hmac
import json

import frappe

from dewey_time.telegram import binding, transport

SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token"

LINKED_REPLY = "You're linked. You'll get a message here when you check in or out."
LINK_FAILED_REPLY = "That link didn't work. Please ask HR for a new one."
NEEDS_TOKEN_REPLY = "To connect your account, use the link or QR code HR gave you."


def _secret_ok(supplied) -> bool:
    """Constant-time compare. A missing header rejects rather than skips."""
    if not supplied:
        return False
    return hmac.compare_digest(str(supplied), transport.webhook_secret())


def _handle(update: dict) -> None:
    message = (update or {}).get("message") or {}
    chat = message.get("chat") or {}

    # Private chats only. In a group, one add would leak a person's
    # attendance to everyone in it.
    if chat.get("type") != "private":
        return

    chat_id = chat.get("id")
    telegram_user_id = (message.get("from") or {}).get("id")
    text = (message.get("text") or "").strip()

    if not text.startswith("/start"):
        return

    parts = text.split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        transport.send_message(chat_id, NEEDS_TOKEN_REPLY)
        return

    try:
        binding.redeem_link_token(parts[1].strip(), str(telegram_user_id), str(chat_id))
    except Exception:
        # Never echo the reason: it distinguishes "expired" from "never
        # existed" for someone probing tokens.
        frappe.log_error(title="Telegram link redemption failed",
                         message=frappe.get_traceback())
        transport.send_message(chat_id, LINK_FAILED_REPLY)
        return

    transport.send_message(chat_id, LINKED_REPLY)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def telegram_webhook():
    """Telegram calls this. Returns 200 with an empty body in every case.

    Telegram retries non-200 responses, so a handler error must not become a
    retry storm — failures are logged and swallowed.
    """
    if not _secret_ok(frappe.get_request_header(SECRET_HEADER)):
        raise frappe.PermissionError

    try:
        # get_data(), NOT frappe.request.get_json() and NOT frappe.form_dict.
        # Frappe parses a JSON body into form_dict for whitelisted methods,
        # which flattens the nesting Telegram's update relies on; werkzeug
        # caches the raw body, so reading it here is safe after Frappe has
        # already read the stream.
        _handle(json.loads(frappe.request.get_data(as_text=True) or "{}"))
    except Exception:
        frappe.log_error(title="Telegram webhook error", message=frappe.get_traceback())
    return {}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_webhook`
Expected: PASS, 8 tests. **Confirm the count is 8.**

- [ ] **Step 5: Mutation-test the guards**

Change `if not supplied: return False` to `if not supplied: return True` and confirm `test_absent_secret_is_refused` **fails**. Restore. Delete the `chat.get("type") != "private"` guard and confirm `test_group_chat_is_ignored` **fails**. Restore.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/telegram/webhook.py dewey_time/tests/test_telegram_webhook.py
git commit -m "feat(telegram): secret-authenticated webhook with /start linking"
```

---

### Task 5: Check-in notifications

**Files:**
- Create: `dewey_time/telegram/notify.py`
- Modify: `dewey_time/hooks.py` (the `Employee Checkin` `doc_events` block)
- Test: `dewey_time/tests/test_telegram_notify.py`

**Interfaces:**
- Consumes: `transport.send_message`, `transport.telegram_enabled` (Task 1); `Telegram Link` (Task 2); `rollout.phase_for_employee` (existing, `attendance_engine/rollout.py:117`).
- Produces:
  - `on_employee_checkin_after_insert(doc, method=None)` — the hook entry point.
  - `send_checkin_notification(employee: str, checkin_name: str) -> str` — the queued job.
  - `compose(log_type: str, punch_time, branch: str | None) -> str`

- [ ] **Step 1: Write the failing tests**

Create `dewey_time/tests/test_telegram_notify.py`:

```python
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import notify  # noqa: E402


class TestCompose(unittest.TestCase):
    def test_in_punch_names_the_time_and_branch(self):
        text = notify.compose("IN", "2026-08-14 07:58:00", "DIS Iconic")
        self.assertIn("07:58", text)
        self.assertIn("DIS Iconic", text)

    def test_out_punch_reads_as_a_checkout(self):
        self.assertIn("out", notify.compose("OUT", "2026-08-14 17:02:00", "ISBB").lower())

    def test_missing_branch_still_produces_a_message(self):
        text = notify.compose("IN", "2026-08-14 07:58:00", None)
        self.assertIn("07:58", text)
        self.assertNotIn("None", text)

    def test_no_judgment_language(self):
        # The notification says what happened, never what it means. Lateness
        # is HR's determination and it is not final at punch time.
        text = notify.compose("IN", "2026-08-14 09:45:00", "DIS Iconic")
        for word in ("late", "early", "flag", "violation", "absent"):
            self.assertNotIn(word, text.lower())


class TestGating(unittest.TestCase):
    def test_no_send_when_telegram_is_disabled(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=False), \
             patch.object(notify.transport, "send_message") as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        send.assert_not_called()

    def test_no_send_for_an_unlinked_employee(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value=None), \
             patch.object(notify.transport, "send_message") as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        send.assert_not_called()

    def test_no_send_when_the_branch_is_not_live(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "1", "name": "1"}), \
             patch.object(notify, "_checkin", return_value={
                 "log_type": "IN", "time": "2026-08-14 07:58:00",
                 "custom_device_branch": "DIS Iconic"}), \
             patch.object(notify.rollout, "phase_for_employee", return_value="TESTING"), \
             patch.object(notify.transport, "send_message") as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        send.assert_not_called()

    def test_live_and_linked_sends(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "55501"}), \
             patch.object(notify, "_checkin", return_value={
                 "log_type": "IN", "time": "2026-08-14 07:58:00",
                 "custom_device_branch": "DIS Iconic"}), \
             patch.object(notify.rollout, "phase_for_employee", return_value="LIVE"), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.SENT) as send:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        self.assertEqual(send.call_args[0][0], "77702")

    def test_a_blocked_recipient_disables_the_link(self):
        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify, "_link_for", return_value={"chat_id": "77702", "name": "55501"}), \
             patch.object(notify, "_checkin", return_value={
                 "log_type": "IN", "time": "2026-08-14 07:58:00",
                 "custom_device_branch": "DIS Iconic"}), \
             patch.object(notify.rollout, "phase_for_employee", return_value="LIVE"), \
             patch.object(notify.transport, "send_message",
                          return_value=notify.transport.BLOCKED), \
             patch.object(notify, "_disable_link") as disable:
            notify.send_checkin_notification("HR-EMP-00001", "CKIN-1")
        disable.assert_called_once_with("55501")


class TestHook(unittest.TestCase):
    def test_the_hook_enqueues_rather_than_sending(self):
        # A Telegram outage must never fail or slow a checkin write.
        doc = type("D", (), {"employee": "HR-EMP-00001", "name": "CKIN-1"})()
        with patch.object(notify.frappe, "enqueue") as enqueue, \
             patch.object(notify.transport, "send_message") as send:
            notify.on_employee_checkin_after_insert(doc)
        send.assert_not_called()
        self.assertEqual(
            enqueue.call_args[0][0],
            "dewey_time.telegram.notify.send_checkin_notification",
        )

    def test_a_checkin_without_an_employee_enqueues_nothing(self):
        doc = type("D", (), {"employee": "", "name": "CKIN-1"})()
        with patch.object(notify.frappe, "enqueue") as enqueue:
            notify.on_employee_checkin_after_insert(doc)
        enqueue.assert_not_called()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_notify`
Expected: FAIL — `ModuleNotFoundError: No module named 'dewey_time.telegram.notify'`

- [ ] **Step 3: Write the notify module**

Create `dewey_time/telegram/notify.py`:

```python
"""Check-in/out notifications over Telegram.

Queued, never synchronous: webpush.py already states the rule for this
codebase, and a Telegram outage must never fail a checkin write.

Content is deliberately minimal — the punch time and the branch. No lateness,
no flags, no judgment. At punch time the engine's determination is provisional
(intraday re-inserts AUTO flags on every checkin), so anything evaluative here
would be both premature and frequently wrong.

RATE LIMITS. Telegram allows roughly 30 messages/second overall and one per
second per chat. Neither is paced explicitly here, deliberately:

- Per-chat is not reachable. One employee produces one message per punch, and
  nobody punches twice in a second in a way that matters.
- Global is bounded incidentally by the `short` queue's worker concurrency —
  each job makes one synchronous POST with a 20s timeout, so a handful of
  workers cannot approach 30/s.

That second one is a happy accident of the deployment, not a designed
guarantee. If worker concurrency is raised, or if notifications are ever sent
in a loop rather than one job per punch, this needs a real token bucket.
Telegram answers 429 with a `retry_after`, so the symptom would be a burst of
FAILED results in the Error Log rather than silent loss.
"""

import frappe
from frappe.utils import get_datetime, getdate

from dewey_time.attendance_engine import rollout
from dewey_time.telegram import transport

LINK_DT = "Telegram Link"


def compose(log_type: str, punch_time, branch) -> str:
    stamp = get_datetime(punch_time).strftime("%H:%M")
    verb = "Checked out" if str(log_type or "").upper() == "OUT" else "Checked in"
    if branch:
        return f"{verb} {stamp} · {branch}"
    return f"{verb} {stamp}"


def _link_for(employee: str):
    return frappe.db.get_value(
        LINK_DT,
        {"employee": employee, "enabled": 1},
        ["name", "chat_id"],
        as_dict=True,
    )


def _checkin(checkin_name: str):
    return frappe.db.get_value(
        "Employee Checkin",
        checkin_name,
        ["log_type", "time", "custom_device_branch"],
        as_dict=True,
    )


def _disable_link(link_name: str) -> None:
    frappe.db.set_value(LINK_DT, link_name, "enabled", 0)


def send_checkin_notification(employee: str, checkin_name: str) -> str:
    """Queued job. Returns a short status string for the job log."""
    if not transport.telegram_enabled():
        return "disabled"

    link = _link_for(employee)
    if not link:
        # Unlinked is the normal state during rollout, not an error.
        return "unlinked"

    row = _checkin(checkin_name)
    if not row:
        return "no-checkin"

    if rollout.phase_for_employee(
        employee=employee, attendance_date=getdate(row["time"])
    ) != rollout.LIVE:
        return "not-live"

    result = transport.send_message(
        link["chat_id"],
        compose(row["log_type"], row["time"], row.get("custom_device_branch")),
    )
    if result == transport.BLOCKED:
        # The user blocked the bot. That is a decision, not a fault — stop
        # sending rather than retrying forever.
        _disable_link(link["name"])
    return result


def on_employee_checkin_after_insert(doc, method=None):
    employee = (getattr(doc, "employee", "") or "").strip()
    if not employee:
        return

    frappe.enqueue(
        "dewey_time.telegram.notify.send_checkin_notification",
        queue="short",
        job_id=f"dewey_time-tg-notify-{doc.name}"[:140],
        deduplicate=True,
        employee=employee,
        checkin_name=doc.name,
    )
```

- [ ] **Step 4: Register the hook**

In `dewey_time/hooks.py`, change the `Employee Checkin` entry inside `doc_events` from:

```python
    "Employee Checkin": {
        "after_insert": "dewey_time.attendance_engine.intraday.on_employee_checkin_after_insert",
        "on_update": "dewey_time.attendance_engine.intraday.on_employee_checkin_on_update",
    },
```

to:

```python
    "Employee Checkin": {
        # A list, not a string: the flag engine and the Telegram notifier both
        # care about a new punch and neither should be nested inside the other.
        "after_insert": [
            "dewey_time.attendance_engine.intraday.on_employee_checkin_after_insert",
            "dewey_time.telegram.notify.on_employee_checkin_after_insert",
        ],
        "on_update": "dewey_time.attendance_engine.intraday.on_employee_checkin_on_update",
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_notify`
Expected: PASS, 10 tests. **Confirm the count is 10.**

- [ ] **Step 6: Verify the hook fires on a real bench**

```bash
docker exec sandbox-bench-1 bash -lc 'cd ~/frappe-bench && bench --site test_site migrate'
```

Then confirm both handlers are registered:

```bash
docker exec sandbox-bench-1 bash -lc \
  'cd ~/frappe-bench && bench --site test_site execute frappe.get_hooks \
   --kwargs "{\"hook\":\"doc_events\"}" 2>&1 | grep -A3 "Employee Checkin"'
```

Expected: both `intraday.on_employee_checkin_after_insert` and `telegram.notify.on_employee_checkin_after_insert` appear.

- [ ] **Step 7: Run the full backend suite for regressions**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend`
Expected: PASS. The `Employee Checkin` hook change touches the engine's hottest write path, so a green full suite is the gate here, not the module suite. **Check the count against the pre-change baseline.**

- [ ] **Step 8: Commit**

```bash
git add dewey_time/telegram/notify.py dewey_time/tests/test_telegram_notify.py dewey_time/hooks.py
git commit -m "feat(telegram): queued check-in notifications, gated on rollout and link"
```

---

### Task 6: HR issues a link, and the operator runbook

**Files:**
- Modify: `dewey_time/telegram/binding.py` (add one whitelisted method)
- Test: `dewey_time/tests/test_telegram_binding.py` (extend)
- Create: `docs/TELEGRAM_RUNBOOK.md`

**Interfaces:**
- Consumes: `issue_link_token`, `link_url` (Task 3).
- Produces: `dewey_time.telegram.binding.create_link_invite(employee: str) -> dict` — whitelisted, HR-only, returns `{"employee", "url", "expires_at"}`.

- [ ] **Step 1: Write the failing tests**

Append to `dewey_time/tests/test_telegram_binding.py`:

```python
class TestInvite(unittest.TestCase):
    def test_invite_requires_hr(self):
        with patch.object(binding, "_require_hr_role",
                          side_effect=Exception("Not permitted")) as gate:
            with self.assertRaises(Exception):
                binding.create_link_invite("HR-EMP-00001")
        gate.assert_called_once()

    def test_invite_returns_a_tappable_url(self):
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "issue_link_token", return_value="tok123"), \
             patch.object(binding, "_bot_username", return_value="dewey_time_bot"):
            invite = binding.create_link_invite("HR-EMP-00001")
        self.assertEqual(invite["url"], "https://t.me/dewey_time_bot?start=tok123")
        self.assertEqual(invite["employee"], "HR-EMP-00001")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_binding`
Expected: FAIL — `AttributeError: module 'dewey_time.telegram.binding' has no attribute 'create_link_invite'`

- [ ] **Step 3: Add the invite endpoint**

Add to `dewey_time/telegram/binding.py` — the import at the top, then the functions at the end:

```python
from dewey_time.attendance_engine.hr_calendar import _require_hr_role
```

```python
def _bot_username() -> str:
    username = (frappe.get_cached_value(
        "Dewey Time Settings", "Dewey Time Settings", "telegram_bot_username"
    ) or "").strip()
    if not username:
        frappe.throw("Telegram bot username is not configured")
    return username


@frappe.whitelist()
def create_link_invite(employee: str) -> dict:
    """HR mints a one-time link for one employee.

    HR never sees or types a Telegram chat id — the id is read off the
    authenticated update when the employee taps the link. That is the whole
    point: a hand-transcribed id has no checksum and no name echoed back, so a
    transposed digit silently sends one person's attendance to another.
    """
    _require_hr_role()
    employee = (employee or "").strip()
    if not employee:
        frappe.throw("employee is required")

    token = issue_link_token(employee)
    return {
        "employee": employee,
        "url": link_url(token, _bot_username()),
        "expires_at": str(add_to_date(now_datetime(), hours=DEFAULT_TTL_HOURS)),
    }
```

- [ ] **Step 4: Add the bot username setting**

In `dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json`, add `"telegram_bot_username"` to `field_order` immediately after `"enable_telegram"`, and add to `fields`:

```json
    {
      "description": "Without the @, e.g. dewey_time_bot",
      "fieldname": "telegram_bot_username",
      "fieldtype": "Data",
      "label": "Telegram Bot Username"
    }
```

Bump `"modified"` to `"2026-08-15 13:00:00.000000"`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd dev/sandbox && ./frappe-sandbox test --backend --fast --module test_telegram_binding`
Expected: PASS, 14 tests. **Confirm the count is 14.**

- [ ] **Step 6: Write the operator runbook**

Create `docs/TELEGRAM_RUNBOOK.md`:

```markdown
# Telegram employee layer — operator runbook

## One-time setup

1. Create the bot with @BotFather. Keep the token.
2. Generate a webhook secret: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`
3. In Desk → Dewey Time Settings → Telegram, fill in **Telegram Bot Token**,
   **Telegram Webhook Secret**, and **Telegram Bot Username** (no `@`).
   Leave **Enable Telegram** OFF until step 5.
4. Register the webhook with Telegram:

   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<site>/api/method/dewey_time.telegram.webhook.telegram_webhook" \
     -d "secret_token=<WEBHOOK SECRET>"
   ```

   Verify: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` — `url`
   correct, `last_error_message` empty, `pending_update_count` low.
5. Turn **Enable Telegram** on.

The token and secret are `Password` fields — they are encrypted at rest and
never appear in the SPA, in logs, or in an error message.

## Linking one employee

Desk → run `dewey_time.telegram.binding.create_link_invite` with the employee
id, or call it from the HR console. It returns a `https://t.me/...?start=...`
URL. Send that link to the employee, or print it as a QR on their onboarding
slip. It is **single-use and expires in 7 days**.

Nobody types a chat id at any point. That is deliberate: a Telegram chat id is
an opaque number with no checksum, so a mistyped one silently delivers an
employee's attendance to a stranger.

## Who is linked

Desk → Telegram Link. The list is the roster of bound accounts.

## Unlinking

Set **Enabled** to 0 on that employee's Telegram Link. Notifications stop
immediately and the resolver refuses the account. The row is kept, with its
version history, so the audit trail survives the unlink.

Do this the moment someone reports receiving messages that are not theirs, and
before investigating.

## Rollout

Notifications only fire for employees whose branch is **LIVE** in
Dewey Time Branch Rollout. To pilot, set one branch live and link a handful of
people there. Everyone else receives nothing regardless of link state.

## When someone blocks the bot

Telegram returns 403 and the link is disabled automatically. Re-linking needs
a fresh invite.
```

- [ ] **Step 7: Commit**

```bash
git add dewey_time/telegram/binding.py dewey_time/tests/test_telegram_binding.py \
        dewey_time/dewey_time/doctype/dewey_time_settings/dewey_time_settings.json \
        docs/TELEGRAM_RUNBOOK.md
git commit -m "feat(telegram): HR link invites, and the operator runbook"
```

---

## Verification before the branch is finished

- [ ] Full backend suite green with a count at or above the pre-branch baseline: `cd dev/sandbox && ./frappe-sandbox test --backend`
- [ ] `bench migrate` clean on the sandbox, with both new doctypes present.
- [ ] End-to-end on the sandbox against a real bot: issue an invite, tap the link, confirm a `Telegram Link` row appears with `linked_via=token`, insert an `Employee Checkin` for that employee on a LIVE branch, and confirm the message arrives.
- [ ] Confirm the bot ignores a group chat by adding it to one and sending `/start`.
- [ ] Confirm no code path reads or writes `Employee.custom_telegram_chat_id`:
      `grep -rn "custom_telegram_chat_id" dewey_time/telegram/` returns nothing.

## Out of scope for this plan

The Mini App (plan 2): the calendar builder extraction, `get_my_calendar` with
its allowlist projection, `initData` validation, the separate Vite entry, and
the three views. Also out, permanently for v1: bot text commands beyond
`/start`, flags in any employee-facing surface, anything LOA, the manager
surface, and importing `custom_telegram_chat_id`.
