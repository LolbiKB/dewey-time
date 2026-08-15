"""Telegram identity: token issue, token redemption, and the resolver.

THE SECURITY BOUNDARY OF THIS FEATURE.

There is no Frappe permission backstop underneath. `frappe.get_all` bypasses
permissions -- verified on a real bench 2026-08-15 -- so a Guest-context
request reads whatever the caller asks for. What stops it is this module and
the webhook's secret check. Nothing else.

Everything here fails closed: `employee_for_telegram_user` returns an Employee
id or raises, and never a boolean. A boolean invites both `if is_valid` typos
and forgetting to call it at all; a function whose only non-raising outcome is
an authorized Employee cannot be accidentally ignored.
"""

import hashlib
import secrets

import frappe
from frappe.utils import add_to_date, get_datetime, now_datetime

from dewey_time.attendance_engine.hr_calendar import _require_hr_role

LINK_DT = "Telegram Link"
TOKEN_DT = "Telegram Link Token"
SETTINGS = "Dewey Time Settings"

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


def _is_expired(expires_at) -> bool:
    """Extracted so the redemption branch is testable on its own.

    Inlining the comparison would make the expiry test pass by raising a
    TypeError under the test mock (whose get_datetime is the identity
    function) rather than by exercising the branch -- a test that stays green
    through a deleted guard.
    """
    return get_datetime(expires_at) < now_datetime()


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
        # Idempotent for the SAME Telegram account. Telegram redelivers an
        # update when it does not get a timely 200, so a slow response to
        # /start would otherwise tell the employee "that link didn't work"
        # immediately after telling them they were linked. Redemption by a
        # DIFFERENT account is still refused -- that is a used token, not a
        # retry.
        if str(row.get("redeemed_by_telegram_user_id") or "") == telegram_user_id:
            return row["employee"]
        frappe.throw("This link has already been used. Ask HR for a new one.")
    if _is_expired(row["expires_at"]):
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


def _bot_username() -> str:
    username = (frappe.get_cached_value(SETTINGS, SETTINGS, "telegram_bot_username") or "").strip()
    if not username:
        frappe.throw("Telegram bot username is not configured")
    return username


@frappe.whitelist()
def create_link_invite(employee: str) -> dict:
    """HR mints a one-time link for one employee.

    HR never sees or types a Telegram chat id -- the id is read off the
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
