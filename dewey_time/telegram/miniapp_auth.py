"""Telegram Mini App initData validation.

THE SECURITY BOUNDARY OF THE MINI APP.

There is no Frappe permission backstop beneath this. `frappe.get_all` bypasses
permissions -- verified on a real bench 2026-08-15 -- so if this function is
wrong, or is skipped, an unauthenticated caller reads the workforce's
attendance. It is the only line of defence, not the first.

Fails closed by construction: returns an Employee id or raises. Never a
boolean, never None.

The algorithm is Telegram's, and each step matters:

    secret_key        = HMAC_SHA256(key=b"WebAppData", msg=bot_token)
    data_check_string = "\\n".join(sorted "key=value" pairs, excluding `hash`)
    expected          = HMAC_SHA256(key=secret_key, msg=data_check_string)

Note the key/message order on the first line -- it is the reverse of the
intuitive reading. Getting it backwards makes nothing validate, which at least
fails loudly; the dangerous mistakes here are the ones that make the check not
run at all.
"""

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

import frappe

from dewey_time.telegram import binding, transport

#: How long a launch stays usable. Without this, captured initData is a
#: permanent credential -- and unlike a wrong signature, a missing freshness
#: check is invisible: the app works and every other test still passes.
MAX_AUTH_AGE_SECONDS = 86400  # 24 hours


def _reject():
    frappe.throw("Not permitted", frappe.PermissionError)


def employee_from_init_data(init_data: str) -> str:
    """Verify Telegram's initData and return the bound Employee, or raise."""
    if not init_data:
        _reject()

    # strict_parsing so a malformed string raises here rather than silently
    # yielding a short pair list that then fails the hash check for the wrong
    # reason -- which would look identical to a forgery in the logs.
    try:
        pairs = dict(parse_qsl(init_data, strict_parsing=True))
    except Exception:
        _reject()

    supplied = pairs.pop("hash", None)
    if not supplied:
        # Missing must REJECT, not skip. This is the bypass shape.
        _reject()

    check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret_key = hmac.new(
        b"WebAppData", transport.bot_token().encode(), hashlib.sha256
    ).digest()
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
    # Deleting this check is an EQUIVALENT mutation, verified: json.loads(None)
    # raises TypeError, which the except below turns into the same rejection.
    # Kept because an explicit refusal of a missing field reads better than
    # relying on a parse error, but do not go hunting for the test that kills
    # it -- there isn't one, and there cannot be.
    if not raw_user:
        _reject()
    try:
        telegram_user_id = json.loads(raw_user).get("id")
    except Exception:
        _reject()
    if not telegram_user_id:
        _reject()

    # The signature proves this id came from Telegram, and nothing more. The
    # binding decides whose record it is; a valid signature alone authorizes
    # no one.
    return binding.employee_for_telegram_user(str(telegram_user_id))
