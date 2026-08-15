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
    try:
        # bot_token() is INSIDE the try. It throws when the token is unset, and
        # that is reachable in production: enabling Telegram before filling the
        # token in makes every checkin enqueue a job that would otherwise raise
        # here, contradicting this function's "never raises" contract and
        # filling the Error Log with tracebacks instead of one clear FAILED.
        response = requests.post(
            f"{API_BASE}/bot{bot_token()}/sendMessage",
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


def miniapp_url() -> str:
    """Absolute https URL of the Mini App page, or raise.

    Telegram rejects a web_app button whose URL is not https, so a
    misconfiguration must surface here rather than as a button that silently
    never appears.
    """
    url = (frappe.get_cached_value(SETTINGS, SETTINGS, "telegram_miniapp_url") or "").strip()
    if not url.startswith("https://"):
        frappe.throw("Telegram Mini App URL must be set and must be https")
    return url


def send_message_with_webapp_button(chat_id: str, text: str, *, button_text: str, url: str) -> str:
    """send_message, plus an inline button that launches the Mini App."""
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


MENU_BUTTON_TEXT = "My attendance"


def set_default_menu_button(url: str) -> str:
    """Point every user's chat menu button at the Mini App.

    No chat_id, so this sets the DEFAULT button for all users in one call
    rather than per person.

    This is the app's only PERSISTENT entry point. Without it the sole way in
    is the inline button on the link-confirmation message, which scrolls away
    and never comes back -- an employee who closes the app has no route back
    to it.
    """
    try:
        response = requests.post(
            f"{API_BASE}/bot{bot_token()}/setChatMenuButton",
            json={
                "menu_button": {
                    "type": "web_app",
                    "text": MENU_BUTTON_TEXT,
                    "web_app": {"url": url},
                }
            },
            timeout=TIMEOUT_SECONDS,
        )
    except Exception:
        frappe.log_error(title="Telegram menu button failed", message=frappe.get_traceback())
        return FAILED

    if response.status_code != 200:
        frappe.log_error(
            title="Telegram menu button rejected",
            message=f"status={response.status_code} body={response.text[:500]}",
        )
        return FAILED
    return SENT


@frappe.whitelist()
def configure_menu_button() -> dict:
    """HR-run, once, after the Mini App URL is set. Idempotent."""
    from dewey_time.attendance_engine.hr_calendar import _require_hr_role

    _require_hr_role()
    url = miniapp_url()
    return {"status": set_default_menu_button(url), "url": url}
