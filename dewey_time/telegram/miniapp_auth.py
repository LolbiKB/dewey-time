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
    #
    # keep_blank_values so the credential is not MALLEABLE. Without it an
    # empty-valued field is dropped before the check string is built, so
    # `...&hash=H` and `...&injected=&hash=H` are the same message to this
    # function and both validate against the one signature Telegram issued.
    # Nothing downstream reads a field beyond `user` and `auth_date` today, so
    # there is no exploit to demonstrate -- and that is exactly why it is worth
    # closing now rather than after somebody reads a `start_param` out of these
    # pairs and inherits an attacker-appended value that passed validation.
    # And it cannot break a launch that works today. Telegram's algorithm
    # excludes exactly one field from its check string -- `hash` -- so a field
    # it sends empty is a field it SIGNED empty: dropping it here builds a
    # different string and rejects, which is the bug in the other direction.
    # Keeping blanks makes this a faithful copy of the PAIRS Telegram signed.
    try:
        raw = parse_qsl(init_data, strict_parsing=True, keep_blank_values=True)
    except Exception:
        _reject()

    # AND NO KEY TWICE. `dict()` is last-wins, so a duplicate is silently
    # discarded before the check string is built: prefixing a captured launch
    # with `user=<anything>&` -- or with `hash=junk&` -- leaves a check string
    # byte-identical to the genuine one, and both validate. Measured.
    #
    # Not exploitable through THIS function, whose own last-wins read lands on
    # the genuine value. It becomes exploitable the moment anything re-parses
    # the same string with first-wins semantics, which is the common default:
    # `new URLSearchParams(initData).get("user")` returns the FIRST copy. So
    # what is being bought is not raw-string uniqueness -- the algorithm signs
    # a decoded pair set, and ordering and percent-encoding variants can never
    # be pinned down -- but an unambiguous pair set, so that no second reader
    # of a string this function certified can derive a different one.
    #
    # Telegram never sends a key twice, so this rejects nothing legitimate.
    if len({key for key, _ in raw}) != len(raw):
        _reject()
    pairs = dict(raw)

    supplied = pairs.pop("hash", None)
    if not supplied:
        # Missing must REJECT, not skip. This is the bypass shape.
        _reject()
    # ASCII, before it reaches compare_digest. That function REFUSES two str
    # arguments unless both are ASCII -- it raises TypeError rather than
    # returning False -- so `hash=%C3%A9` made this boundary answer 500 with a
    # traceback instead of the PermissionError it is written to answer with.
    # It never granted anything; it stopped being a refusal.
    if not str(supplied).isascii():
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
