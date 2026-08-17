"""Telegram's inbound webhook. PUBLIC -- allow_guest, reachable by anyone.

Authenticated by Telegram's X-Telegram-Bot-Api-Secret-Token header, compared
in constant time. This mirrors the established pattern for guest endpoints in
this app (notify_device_sync_status, notify_device_closeout_status,
notify_enrollment_snapshot, all via bridge_auth.validate_bridge_request) --
but with one important difference: those are server-to-server and can hold an
API key as well. A webhook can only hold this one secret, so it carries the
whole load.

The bot's only command is /start. With a token payload it redeems that token;
bare, it tries the Telegram id already recorded on the Employee record. There
is deliberately no /today or /week: the Mini App is the read surface.
"""

import hmac
import json

import frappe

from dewey_time.telegram import binding, transport

SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token"

# Khmer first, English under it, for the reason notify.compose gives: the
# language Telegram reports is the language of someone's PHONE, and guessing
# wrong sends an unreadable message to the person least able to report it.
# These three are also the messages most likely to arrive when something has
# gone wrong, which is the worst moment to be unreadable.
LINKED_REPLY = (
    "អ្នកបានភ្ជាប់គណនីរួចរាល់។ យើងនឹងផ្ញើសារនៅពេលអ្នកចូល ឬចេញ។\n"
    "You're linked. You'll get a message here when you check in or out."
)
LINK_FAILED_REPLY = (
    "តំណនេះមិនដំណើរការទេ។ សូមសុំតំណថ្មីពីផ្នែកធនធានមនុស្ស។\n"
    "That link didn't work. Please ask HR for a new one."
)
NEEDS_TOKEN_REPLY = (
    "ដើម្បីភ្ជាប់គណនី សូមប្រើតំណ ឬ QR code ដែលផ្នែកធនធានមនុស្សបានផ្ដល់ជូន។\n"
    "To connect your account, use the link or QR code HR gave you."
)

def _secret_ok(supplied) -> bool:
    """Constant-time compare. A missing header rejects rather than skips."""
    if not supplied:
        return False
    return hmac.compare_digest(str(supplied), transport.webhook_secret())


def _handle(update: dict) -> None:
    message = (update or {}).get("message") or {}
    chat = message.get("chat") or {}

    # An allowlist of "private", not a denylist of "group": Telegram has
    # several non-private chat types, and in any of them one add would leak a
    # person's attendance to everyone present.
    if chat.get("type") != "private":
        return

    chat_id = chat.get("id")
    telegram_user_id = (message.get("from") or {}).get("id")
    text = (message.get("text") or "").strip()

    if not text.startswith("/start"):
        return

    parts = text.split(maxsplit=1)
    payload = parts[1].strip() if len(parts) > 1 else ""

    if not payload:
        # A BARE /start. Part of the roster already has a numeric Telegram id
        # recorded against their Employee record by an earlier notifier, and
        # those people need no link at all -- opening the bot is the whole
        # flow. Everyone else falls through to the same instruction as before.
        try:
            binding.claim_by_recorded_id(str(telegram_user_id), str(chat_id))
        except Exception:
            # Deliberately NOT logged as an error and deliberately not
            # distinguished in the reply. Most bare /start messages are from
            # people with no recorded id, which is the ordinary case and not a
            # fault; and the refusal reasons -- no match, duplicate id, revoked
            # link -- would tell someone probing ids which ones exist.
            transport.send_message(chat_id, NEEDS_TOKEN_REPLY)
            return
        _confirm_linked(chat_id)
        return

    try:
        binding.redeem_link_token(payload, str(telegram_user_id), str(chat_id))
    except Exception:
        # Never echo the reason: it distinguishes "expired" from "never
        # existed" for someone probing tokens.
        frappe.log_error(
            title="Telegram link redemption failed", message=frappe.get_traceback()
        )
        transport.send_message(chat_id, LINK_FAILED_REPLY)
        return

    _confirm_linked(chat_id)


def _confirm_linked(chat_id) -> None:
    """Tell them they're linked. Shared by both binding paths.

    No inline button any more. The bot's Main Mini App button and its chat
    menu button are permanent and always in reach, where this one scrolled out
    of the chat and never came back -- it was carrying the app's discoverability
    at the exact moment it was least able to.
    """
    transport.send_message(chat_id, LINKED_REPLY)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def telegram_webhook():
    """Telegram calls this. Returns 200 with an empty body in every case.

    Telegram retries non-200 responses, so a handler error must not become a
    retry storm -- failures are logged and swallowed.
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
