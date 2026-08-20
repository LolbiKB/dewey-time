"""The only module that talks to api.telegram.org.

Sole caller by design: one place to add rate pacing, one place to stub in
tests, and one place where the bot token is read.
"""

from __future__ import annotations

import re

import frappe
import requests
from frappe.utils import get_url
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


#: The bot token sits in the PATH of every Bot API URL, and `requests` reports
#: the URL it failed against inside the exception it raises. So an unreachable
#: api.telegram.org turns the token into an ordinary-looking error string --
#: and that string then travels to the two places chosen for wide readability:
#: the `diagnostics()` response body, which any HR user can read, and the Error
#: Log, which persists into every backup. A DNS blip is enough; no attacker is
#: required, and the outage is precisely when someone runs diagnostics.
#:
#: Matches the token's own shape (`<digits>:<base64url>`) inside a /bot path,
#: which is the only form it takes on the wire.
_TOKEN_IN_URL = re.compile(r"/bot\d+:[A-Za-z0-9_-]+")


def scrub_token(text: object) -> str:
    """Any string leaving this module, with the bot token removed.

    Applied at the EXIT -- every `return` and every `log_error` -- rather than
    at the point each message is built, so a future error path cannot forget
    it. The scrub is deliberately narrow: it removes the credential and leaves
    the rest of the message intact, because an error with the cause stripped
    out is the reason nobody would notice this was here.
    """
    return _TOKEN_IN_URL.sub("/bot<redacted>", str(text))


#: Telegram's own constraint on secret_token: 1-256 chars of A-Z, a-z, 0-9,
#: underscore and hyphen. Anything else makes setWebhook fail with "secret
#: token contains unallowed characters" -- notably a trailing newline picked
#: up when copying the value out of a terminal, or `openssl rand -base64`,
#: which emits +, / and =.
SECRET_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{1,256}$")


def webhook_secret() -> str:
    """The webhook secret, or raise. Same reasoning as bot_token().

    Validated against Telegram's character set here rather than left to fail
    at setWebhook time. A secret Telegram will not accept is a secret it can
    never send, so every update would 403 against a value sitting in Settings
    looking perfectly fine -- the failure surfaces three steps from its cause.
    """
    secret = (_secret("telegram_webhook_secret") or "").strip()
    if not secret:
        frappe.throw("Telegram webhook secret is not configured")
    if not SECRET_TOKEN_RE.match(secret):
        frappe.throw(
            "Telegram webhook secret must be 1-256 characters of A-Z, a-z, 0-9, "
            "underscore or hyphen. Generate one with: "
            "python3 -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )
    return secret


def send_message(chat_id: str, text: str, reply_markup: dict | None = None) -> str:
    """Send one message. Returns SENT, BLOCKED or FAILED -- never raises.

    Callers are background jobs whose failure must not surface anywhere near a
    checkin write, so transport errors are reported as values.

    `reply_markup` is passed through verbatim when given (the language chooser
    sends an inline keyboard); omitted entirely otherwise, so the ordinary
    check-in message stays the plain-text shape it has always been on the wire.
    """
    payload: dict = {"chat_id": chat_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    try:
        # bot_token() is INSIDE the try. It throws when the token is unset, and
        # that is reachable in production: enabling Telegram before filling the
        # token in makes every checkin enqueue a job that would otherwise raise
        # here, contradicting this function's "never raises" contract and
        # filling the Error Log with tracebacks instead of one clear FAILED.
        response = requests.post(
            f"{API_BASE}/bot{bot_token()}/sendMessage",
            json=payload,
            timeout=TIMEOUT_SECONDS,
        )
    except Exception:
        frappe.log_error(
            title="Telegram send failed", message=scrub_token(frappe.get_traceback())
        )
        return FAILED

    if response.status_code == 403:
        return BLOCKED
    if response.status_code != 200:
        frappe.log_error(
            title="Telegram send rejected",
            message=scrub_token(f"status={response.status_code} body={response.text[:500]}"),
        )
        return FAILED
    return SENT


def answer_callback_query(callback_query_id: str) -> str:
    """Acknowledge a button press. Returns SENT or FAILED -- never raises.

    Telegram clients show a spinner on a pressed inline button until the bot
    answers the callback query; without this call the press LOOKS ignored for
    up to a minute even when it was acted on instantly. The acknowledgement is
    silent (no toast text) -- whatever the press means is said in the chat by
    the caller, where it persists.

    A stale press (Telegram expires callback ids after a while, and redelivers
    old updates after webhook downtime) answers 400 here; that is logged like
    any rejection but the caller treats it as noise, because the press it
    acknowledges no longer has a spinner to clear.
    """
    try:
        response = requests.post(
            f"{API_BASE}/bot{bot_token()}/answerCallbackQuery",
            json={"callback_query_id": callback_query_id},
            timeout=TIMEOUT_SECONDS,
        )
    except Exception:
        frappe.log_error(
            title="Telegram callback answer failed",
            message=scrub_token(frappe.get_traceback()),
        )
        return FAILED

    if response.status_code != 200:
        frappe.log_error(
            title="Telegram callback answer rejected",
            message=scrub_token(f"status={response.status_code} body={response.text[:500]}"),
        )
        return FAILED
    return SENT


#: Where the Mini App is served from. One place, because the fallback below
#: and the diagnostics both need to agree with the route that actually exists.
MINIAPP_ROUTE = "/hr-me"


def miniapp_url() -> str:
    """Absolute https URL of the Mini App page, or raise.

    DERIVED BY DEFAULT, and that is the fix for a real outage rather than a
    convenience. The Settings field was the only source, with no default, and
    every caller wraps this in a try that falls back to a plain message -- so
    an empty field produced a bot with no button ANYWHERE, permanently, with
    nothing to see but "Telegram Mini App button unavailable" in the Error
    Log. Nobody reads the Error Log to find out why a button is missing.

    The site already knows its own address, and the route is this app's own,
    so there is nothing for a human to look up. The field stays as an
    OVERRIDE, for a site reached at a different hostname than `get_url`
    reports -- behind a proxy, or on a vanity domain.

    Still https-only either way. Telegram rejects a web_app button whose URL
    is not https, and a site running on plain http would otherwise trade a
    visible misconfiguration for an invisible one.
    """
    override = (frappe.get_cached_value(SETTINGS, SETTINGS, "telegram_miniapp_url") or "").strip()
    url = override or (get_url(MINIAPP_ROUTE) or "").strip()
    if not url.startswith("https://"):
        frappe.throw(
            "Telegram Mini App URL must be https. Set 'Telegram Mini App URL' in "
            f"Dewey Time Settings; the site resolved to {url or '(nothing)'}."
        )
    return url


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
        frappe.log_error(
            title="Telegram menu button failed", message=scrub_token(frappe.get_traceback())
        )
        return FAILED

    if response.status_code != 200:
        frappe.log_error(
            title="Telegram menu button rejected",
            message=scrub_token(f"status={response.status_code} body={response.text[:500]}"),
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


#: The inbound endpoint's own path. Derived rather than configured for the
#: same reason the Mini App URL now is: it is this app's own route, and a
#: field for it is a field to get wrong.
WEBHOOK_PATH = "/api/method/dewey_time.telegram.webhook.telegram_webhook"


def webhook_url() -> str:
    """Absolute https URL Telegram should deliver updates to."""
    url = (get_url(WEBHOOK_PATH) or "").strip()
    if not url.startswith("https://"):
        frappe.throw(f"The webhook URL must be https; the site resolved to {url or '(nothing)'}.")
    return url


def set_webhook(url: str, secret: str) -> str:
    """Tell Telegram where to deliver updates. Idempotent.

    WITHOUT THIS NOTHING INBOUND EXISTS. The handler, the constant-time secret
    check and both binding paths were all written and none of them had ever
    run, because Telegram had never been told the endpoint was there. `/start`
    went nowhere, no Telegram Link was ever created, and every employee was
    therefore "unlinked" -- which the notifier reports as a normal rollout
    state rather than as a fault, so nothing looked broken anywhere.

    `allowed_updates` is narrowed to exactly the two shapes `_handle` reads:
    messages, and callback_query for the language chooser's buttons.
    edited_message and the rest stay unrequested -- asking for them is asking
    Telegram to spend deliveries on updates we drop. NOTE the flip side: this
    list lives on Telegram's servers, so adding a shape here does nothing for
    a deployed bot until `setup_telegram` is re-run against it.
    """
    try:
        response = requests.post(
            f"{API_BASE}/bot{bot_token()}/setWebhook",
            json={
                "url": url,
                "secret_token": secret,
                "allowed_updates": ["message", "callback_query"],
            },
            timeout=TIMEOUT_SECONDS,
        )
    except Exception:
        frappe.log_error(
            title="Telegram setWebhook failed", message=scrub_token(frappe.get_traceback())
        )
        return FAILED

    if response.status_code != 200:
        frappe.log_error(
            title="Telegram setWebhook rejected",
            message=scrub_token(f"status={response.status_code} body={response.text[:500]}"),
        )
        return FAILED
    return SENT


#: The bot's command menu. /language is here because the chooser message it
#: reopens scrolls out of the chat like any other -- the command menu is the
#: only persistent route back to it. /start is deliberately unlisted: it is
#: the deep-link carrier, and the people who should send it arrive holding a
#: link that sends it for them.
BOT_COMMANDS = [{"command": "language", "description": "ភាសា · Language"}]


def set_bot_commands() -> str:
    """Register the bot's command menu with Telegram. Idempotent."""
    try:
        response = requests.post(
            f"{API_BASE}/bot{bot_token()}/setMyCommands",
            json={"commands": BOT_COMMANDS},
            timeout=TIMEOUT_SECONDS,
        )
    except Exception:
        frappe.log_error(
            title="Telegram commands failed", message=scrub_token(frappe.get_traceback())
        )
        return FAILED

    if response.status_code != 200:
        frappe.log_error(
            title="Telegram commands rejected",
            message=scrub_token(f"status={response.status_code} body={response.text[:500]}"),
        )
        return FAILED
    return SENT


@frappe.whitelist()
def setup_telegram() -> dict:
    """Everything that has to be told to Telegram once, in one call.

    Three separate pieces of state live on Telegram's servers rather than in
    this site, and no deploy can touch any of them: where to deliver updates
    (and WHICH update shapes -- callback_query included, or the language
    chooser's buttons spin forever), what the chat menu button opens, and the
    command menu. Each was once a one-time manual step, one of which was never
    written at all -- so this is the call that makes a fresh bot work, and
    re-running it is harmless. Re-run it after any deploy that changes what
    the webhook handles.

    Not in `after_migrate`: it needs a bot token and a webhook secret, and a
    site that has neither would either fail the migrate or log a confusing
    error on every deploy.
    """
    from dewey_time.attendance_engine.hr_calendar import _require_hr_role

    _require_hr_role()
    hook = webhook_url()
    app = miniapp_url()
    return {
        "webhook": {"status": set_webhook(hook, webhook_secret()), "url": hook},
        "menu_button": {"status": set_default_menu_button(app), "url": app},
        "commands": {"status": set_bot_commands()},
    }


def _get(method: str) -> dict:
    """One GET against the Bot API, reported rather than raised."""
    try:
        response = requests.get(f"{API_BASE}/bot{bot_token()}/{method}", timeout=TIMEOUT_SECONDS)
    except Exception as exc:
        return {"ok": False, "error": scrub_token(f"{type(exc).__name__}: {exc}")}
    try:
        return response.json()
    except ValueError:
        return {
            "ok": False,
            "error": scrub_token(f"status={response.status_code} body={response.text[:200]}"),
        }


@frappe.whitelist()
def diagnostics(employee: str | None = None) -> dict:
    """Why is there no button? Answered in one call.

    Every Mini App entry point fails SILENTLY by design -- notify.py and the
    webhook both catch a missing URL and fall back to a plain message, because
    a notification must never be lost to a broken button. That is right, and
    it is also why a misconfiguration here is invisible: the bot keeps working
    perfectly, minus the one thing you were looking for.

    So this asks Telegram itself rather than reading our own settings back:

      getMe             -- is the token real, and which bot is it
      getWebhookInfo    -- is the webhook registered, and is it erroring
      getChatMenuButton -- is the persistent entry point actually a web_app,
                           and pointed where we think

    It also reports the check-in notification's own gates, which are a
    separate question with separate silent failures: pass an `employee` to
    test one person's link and rollout phase.

    NO SECRETS ARE RETURNED, only whether each is set. The token and webhook
    secret are the whole security of this integration; a diagnostic that
    printed them would put them in a browser's network log to save one glance
    at Settings.
    """
    from dewey_time.attendance_engine.hr_calendar import _require_hr_role
    # Imported here rather than at module scope: this module's whole point is
    # that it is the only one talking to api.telegram.org, and notify imports
    # it. A top-level import back would make that circular.
    from dewey_time.telegram import notify

    _require_hr_role()

    report: dict = {
        "enabled": telegram_enabled(),
        "bot_token_set": bool((_secret("telegram_bot_token") or "").strip()),
        "webhook_secret_set": bool((_secret("telegram_webhook_secret") or "").strip()),
        "miniapp_url_override": (
            frappe.get_cached_value(SETTINGS, SETTINGS, "telegram_miniapp_url") or ""
        ).strip() or None,
        "site_url": get_url(MINIAPP_ROUTE),
    }
    try:
        report["miniapp_url"] = miniapp_url()
    except Exception as exc:
        report["miniapp_url"] = None
        report["miniapp_url_error"] = scrub_token(exc)

    # Why no check-in notification, which is a different question from why no
    # button and has its own four silent gates. See notify.delivery_gates.
    try:
        report["notifications"] = notify.delivery_gates(employee)
    except Exception as exc:
        report["notifications"] = {"error": scrub_token(exc)}

    if not report["bot_token_set"]:
        # Everything below needs the token. Saying so beats three identical
        # "Telegram bot token is not configured" errors.
        report["note"] = "No bot token, so nothing could be asked of Telegram."
        return report

    me = _get("getMe")
    report["bot"] = (me.get("result") or {}).get("username") if me.get("ok") else me

    # The configured username against the bot the TOKEN actually reaches.
    #
    # These are two independent settings that must name the same bot: the
    # token decides who sends the messages, the username builds the invite
    # deep link. Nothing else compares them, and a mismatch is silent on both
    # sides -- messages arrive normally while every invite link opens "user
    # not found", which reads as a binding fault rather than a typo.
    from dewey_time.telegram import binding

    configured = binding.normalise_bot_username(
        frappe.get_cached_value(SETTINGS, SETTINGS, "telegram_bot_username")
    )
    actual = report["bot"] if isinstance(report["bot"], str) else None
    report["invite_username"] = configured or None
    if configured and actual and configured.lower() != actual.lower():
        report["invite_username_mismatch"] = actual

    hook = _get("getWebhookInfo").get("result") or {}
    allowed = hook.get("allowed_updates")
    report["webhook"] = {
        "url": hook.get("url") or None,
        "pending": hook.get("pending_update_count"),
        # The two fields that explain a bot which "does nothing": Telegram
        # records the last delivery failure here and nowhere else.
        "last_error": hook.get("last_error_message"),
        "last_error_date": hook.get("last_error_date"),
        # The field that explains dead chooser buttons and NOTHING else does.
        # allowed_updates lives on Telegram's servers: a deploy that taught
        # the webhook callback_query changes nothing until setup_telegram is
        # re-run, and Telegram DISCARDS filtered updates -- no pending count,
        # no last_error, employees tapping a spinner that times out while
        # every other line of this report reads healthy. Absent means
        # Telegram's default (everything but chat_member), so presses arrive.
        "allowed_updates": allowed,
        "delivers_button_presses": allowed is None or "callback_query" in allowed,
    }

    menu = _get("getChatMenuButton").get("result") or {}
    report["menu_button"] = {
        "type": menu.get("type"),
        "text": menu.get("text"),
        "url": (menu.get("web_app") or {}).get("url"),
        # `commands` is Telegram's DEFAULT. Seeing it here means
        # configure_menu_button has never been run against this bot, which is
        # the difference between "no persistent way in" and "one tap".
        "is_miniapp": menu.get("type") == "web_app",
    }

    # The registered command menu -- Telegram-side state again, so it is
    # ASKED rather than assumed. "language" missing here means
    # set_bot_commands has never run against this bot and /language is
    # undiscoverable for everyone already linked.
    listed = _get("getMyCommands").get("result") or []
    report["commands"] = {
        "listed": [c.get("command") for c in listed if isinstance(c, dict)],
    }
    return report
