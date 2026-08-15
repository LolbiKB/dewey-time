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
    an empty key -- a hole an attacker can forge against once they guess the
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
    """Send one message. Returns SENT, BLOCKED or FAILED -- never raises.

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
