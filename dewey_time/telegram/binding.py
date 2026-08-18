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
import re
import secrets
from datetime import datetime
from typing import NamedTuple

import frappe
from frappe.utils import add_to_date, get_datetime, now_datetime

from dewey_time.attendance_engine.hr_calendar import _require_hr_role

LINK_DT = "Telegram Link"
TOKEN_DT = "Telegram Link Token"
SETTINGS = "Dewey Time Settings"

#: 32 bytes -> 43 base64url chars, inside Telegram's 64-char `start` payload
#: limit of [A-Za-z0-9_-].
TOKEN_BYTES = 32
DEFAULT_TTL_HOURS = 24

#: Telegram's rule for a username: 5-32 of [A-Za-z0-9_]. Bot usernames also
#: end in "bot", which is NOT enforced here -- that is Telegram's rule to
#: change, and refusing a name Telegram itself issued would be worse than the
#: dead link this check exists to prevent.
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{5,32}$")

#: Every form of the bot's profile address that can be pasted into the
#: username field. Longest first, so "https://t.me/" is not left as "//t.me/"
#: by an earlier partial match.
_PROFILE_PREFIXES = (
    "https://t.me/",
    "http://t.me/",
    "https://telegram.me/",
    "http://telegram.me/",
    "t.me/",
    "telegram.me/",
)


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
        ["name", "employee", "expires_at", "redeemed_at", "revoked_at"],
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


def _create_link(
    *, employee: str, telegram_user_id: str, chat_id: str, linked_via: str = "token"
) -> None:
    doc = frappe.new_doc(LINK_DT)
    doc.telegram_user_id = telegram_user_id
    doc.employee = employee
    doc.chat_id = chat_id
    doc.enabled = 1
    doc.linked_at = now_datetime()
    doc.linked_via = linked_via
    doc.insert(ignore_permissions=True)


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

    `get_doc`/`save`, NOT `frappe.db.set_value`, for two reasons that both
    matter here. `set_value` writes straight to SQL: it skips
    `TelegramLink.validate`, which is the check that stops one employee
    holding two enabled links, and it writes no Version row even though the
    doctype is `track_changes: 1`. Reviving a credential is exactly the event
    that audit exists to record.
    """
    doc = frappe.get_doc(LINK_DT, name)
    doc.employee = employee
    doc.chat_id = str(chat_id)
    doc.enabled = 1
    doc.linked_at = now_datetime()
    doc.linked_via = "token"
    doc.save(ignore_permissions=True)


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


def normalise_bot_username(raw) -> str:
    """The bare username, out of whatever form it was configured in.

    "@deweytimebot" is how Telegram DISPLAYS a username -- in the profile, in
    BotFather's reply, in every mention -- so it is the form a person copies.
    Pasted straight into Settings it produced
    `https://t.me/@deweytimebot?start=...`, and the deep link is the one place
    the @ is not allowed: Telegram answers that with "user not found". The
    employee sees a broken link, HR sees a link they successfully created, and
    nothing anywhere records a fault.

    The field's description already asks for the bare name, and that was not
    enough -- which is the usual fate of a description. So accept what people
    actually paste: the @ form, the profile URL, either with stray whitespace.
    """
    text = str(raw or "").strip()
    lowered = text.lower()
    for prefix in _PROFILE_PREFIXES:
        if lowered.startswith(prefix):
            text = text[len(prefix):]
            break
    # A pasted profile URL can carry a trailing slash or a query of its own.
    text = text.split("?", 1)[0].split("/", 1)[0]
    return text.strip().lstrip("@").strip()


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
    if row.get("revoked_at"):
        # A newer link superseded this one, or the employee was unlinked.
        frappe.throw("This link is no longer valid. Ask HR for a new one.")
    if _is_expired(row["expires_at"]):
        frappe.throw("This link has expired. Ask HR for a new one.")

    employee = row["employee"]

    # BEFORE the account-level branches below, and LOAD-BEARING rather than
    # belt-and-braces. `TelegramLink.validate` already refuses a second enabled
    # link for one employee, but it only runs on the document API -- so it
    # covers `_create_link` (which inserts) and would NOT have covered a
    # `db.set_value` revive. `_revive_link` now saves through the document API
    # too, which restores that backstop; this check is the one that gives the
    # caller a legible reason instead of a controller throw, and the one that
    # stops the revive being attempted at all.
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


#: The Employee column a prior Telegram notifier left behind, holding a numeric
#: Telegram user id. THIS APP DOES NOT INSTALL IT, so every read is behind a
#: has_column check -- the same guard coverage_api uses for the same field.
TELEGRAM_ID_FIELD = "custom_telegram_chat_id"


def _existing_link(telegram_user_id: str):
    """The link row for this Telegram account, enabled or not, or None.

    `Telegram Link` autonames `field:telegram_user_id`, so the account id IS
    the document name -- one row per Telegram account, by construction.
    """
    if not frappe.db.exists(LINK_DT, telegram_user_id):
        return None
    return frappe.db.get_value(
        LINK_DT, telegram_user_id, ["name", "employee", "enabled"], as_dict=True
    )


def _employees_with_recorded_id(telegram_user_id: str) -> list[str]:
    """ACTIVE employees whose recorded Telegram id is exactly this one.

    Active only, and that is a guard rather than a tidy-up: a leaver whose id
    is still on their record could otherwise walk back in by messaging the bot
    and keep reading their own attendance after leaving. Coverage filters the
    same way, so the register never offered them either.
    """
    if not frappe.db.has_column("Employee", TELEGRAM_ID_FIELD):
        return []
    rows = (
        frappe.get_all(
            "Employee",
            filters={TELEGRAM_ID_FIELD: telegram_user_id, "status": "Active"},
            fields=["name"],
        )
        or []
    )
    return [row["name"] for row in rows]


def _employee_bound_elsewhere(employee: str, telegram_user_id: str) -> bool:
    """Is this Employee already bound to some OTHER Telegram account?"""
    return bool(
        frappe.get_all(
            LINK_DT,
            filters={
                "employee": employee,
                "enabled": 1,
                "telegram_user_id": ["!=", telegram_user_id],
            },
            fields=["name"],
            limit_page_length=1,
        )
    )


def claim_by_recorded_id(telegram_user_id: str, chat_id: str) -> str:
    """Bind using the Telegram id already recorded on the Employee record.

    The no-token path. A prior notifier wrote numeric Telegram user ids onto
    `Employee.custom_telegram_chat_id` for part of the roster; those people can
    bind by opening the bot, with no link for HR to issue and nothing to
    forward or expire.

    WHAT IS BEING TRUSTED, exactly: that the recorded id belongs to the person
    it is recorded against. Possession of the account is proved -- the id comes
    off the authenticated update, not from anything the sender typed -- so the
    only way this binds the wrong person is if the wrong id was recorded. That
    is the same trust the token path places in HR sending the link to the right
    person, except this one is auditable after the fact and correctable in the
    Employee record.

    Every ambiguous case REFUSES rather than guessing. Refusing costs one
    token link; guessing hands someone another employee's attendance history,
    check-in times and branch locations, and nothing downstream would notice.
    """
    telegram_user_id = str(telegram_user_id or "").strip()
    if not telegram_user_id:
        frappe.throw("Invalid link request")

    existing = _existing_link(telegram_user_id)
    if existing:
        if not existing.get("enabled"):
            # A REVOKED link must stay revoked. Without this, disabling a link
            # would be undone by the employee simply reopening the bot, which
            # makes revocation theatre -- and revocation is the only lever HR
            # has when a phone is lost or someone leaves.
            frappe.throw("This account cannot be linked automatically.")
        # Idempotent. Telegram redelivers an update when it does not get a
        # timely 200, so the same bare /start can arrive twice.
        return existing["employee"]

    matches = _employees_with_recorded_id(telegram_user_id)
    if len(matches) != 1:
        # Zero: nobody recorded this id -- they need a link from HR.
        # Two or more: the column has no unique constraint, so a duplicated id
        # is possible, and there is no safe way to choose between them.
        frappe.throw("This account cannot be linked automatically.")

    employee = matches[0]
    if _employee_bound_elsewhere(employee, telegram_user_id):
        # Someone is already bound to this employee. Either the recorded id is
        # stale, or two accounts are claiming one person; both want a human.
        frappe.throw("This account cannot be linked automatically.")

    _create_link(
        employee=employee,
        telegram_user_id=telegram_user_id,
        chat_id=str(chat_id),
        linked_via="recorded_id",
    )
    return employee


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
    username = normalise_bot_username(
        frappe.get_cached_value(SETTINGS, SETTINGS, "telegram_bot_username")
    )
    if not username:
        frappe.throw("Telegram bot username is not configured")
    # REFUSED RATHER THAN INTERPOLATED. Anything that is not a username makes a
    # link that cannot resolve, and a link that cannot resolve fails in the
    # worst possible place: a week later, in a chat, to the employee, with the
    # token already spent and no error anywhere HR would look. An exception in
    # front of the person clicking "Create link" is the cheap version of the
    # same discovery.
    if not _USERNAME_RE.match(username):
        frappe.throw(
            f"Telegram bot username {username!r} is not a valid username. "
            "Expected 5-32 letters, digits or underscores, e.g. dewey_time_bot."
        )
    return username


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


@frappe.whitelist(methods=["POST"])
def create_link_invite(employee: str) -> dict:
    """HR mints a one-time link for one employee.

    HR never sees or types a Telegram chat id -- the id is read off the
    authenticated update when the employee taps the link. That is the whole
    point: a hand-transcribed id has no checksum and no name echoed back, so a
    transposed digit silently sends one person's attendance to another.

    POST-pinned. The response body IS a credential, and a GET would put the
    employee id in the query string of every access log, proxy log and browser
    history entry between here and the bench. The client half of that
    agreement has always sent POST; until now nothing made the server insist.
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
        # The STORED expiry. This used to recompute add_to_date(now_datetime())
        # a second time, so the value reported was never quite the value on the
        # row that had just been written.
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
        #
        # Through the document API, NOT `frappe.db.set_value`. Versions are
        # written by `Document.save()`; `set_value` goes straight to SQL. This
        # doctype is `track_changes: 1`, and clearing the checkbox by hand in
        # the desk -- the path this endpoint replaces -- records who revoked
        # the credential and when. Writing it programmatically must not be the
        # version that quietly stops recording that.
        doc = frappe.get_doc(LINK_DT, name)
        doc.enabled = 0
        doc.save(ignore_permissions=True)

    # An unlink must not leave a live credential behind: a token issued while
    # the employee was unlinked before would otherwise still bind on
    # redemption, undoing the unlink without HR touching anything.
    tokens_revoked = revoke_outstanding_tokens(employee)
    return {
        "employee": employee,
        "unlinked": len(names),
        "tokens_revoked": tokens_revoked,
    }
