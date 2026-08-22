"""Telegram's inbound webhook. PUBLIC -- allow_guest, reachable by anyone.

Authenticated by Telegram's X-Telegram-Bot-Api-Secret-Token header, compared
in constant time. This mirrors the established pattern for guest endpoints in
this app (notify_device_sync_status, notify_device_closeout_status,
notify_enrollment_snapshot, all via bridge_auth.validate_bridge_request) --
but with one important difference: those are server-to-server and can hold an
API key as well. A webhook can only hold this one secret, so it carries the
whole load.

The bot answers two commands. /start with a token payload redeems that token;
bare, it tries the Telegram id already recorded on the Employee record.
/language opens the message-language chooser (two inline buttons, whose
presses arrive back here as callback_query updates). There is deliberately no
/today or /week: the Mini App is the read surface.
"""

import hmac
import json

import frappe

from dewey_time.telegram import binding, transport

SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token"

# Khmer first, English under it. These three are the only messages still sent
# BILINGUALLY: they can all arrive before any language preference exists (two
# of them exist precisely because linking failed), and they are the messages
# most likely to arrive when something has gone wrong -- the worst moment to
# be unreadable. The check-in messages themselves are single-language, chosen
# on the link; see notify._VERBS.
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

# The language chooser. Bilingual BY NECESSITY, unlike everything else the bot
# now sends: this is the one message whose whole job is to ask which language
# the reader reads, so it cannot assume an answer. Two buttons, no "both" --
# the stacked-bilingual format is retired, and Khmer is the default nobody has
# to press anything to get.
LANGUAGE_PROMPT = (
    "តើអ្នកចង់ទទួលសារជាភាសាអ្វី?\n"
    "Which language should your messages arrive in?"
)
LANGUAGE_KEYBOARD = {
    "inline_keyboard": [
        [
            {"text": "ខ្មែរ", "callback_data": "lang:km"},
            {"text": "English", "callback_data": "lang:en"},
        ]
    ]
}
#: The ONLY callback data this webhook acts on. An allowlist, not a parse:
#: Telegram clients can put arbitrary bytes in callback_data, so anything
#: not literally one of these keys selects nothing.
LANGUAGE_CALLBACKS = {"lang:km": "km", "lang:en": "en"}
#: Confirmation in the language just chosen -- the first message that proves
#: the choice took, which is why it is not bilingual.
LANGUAGE_SET_REPLIES = {
    "km": "សារនឹងផ្ញើជាភាសាខ្មែរ។",
    "en": "You'll get your messages in English.",
}

def _secret_ok(supplied) -> bool:
    """Constant-time compare. A missing header rejects rather than skips.

    Compared as BYTES. `hmac.compare_digest` refuses two str arguments unless
    both are ASCII -- it raises TypeError rather than returning False -- and a
    WSGI header value is latin-1 decoded, so any byte in 0x80-0xFF put in this
    header made the comparison raise instead of reject. The endpoint answered
    500 with a traceback rather than 403, to an unauthenticated caller, at
    whatever rate they cared to send. It never granted anything; it just
    stopped being the refusal it was written as.
    """
    if not supplied:
        return False
    return hmac.compare_digest(
        str(supplied).encode("utf-8", "surrogateescape"),
        transport.webhook_secret().encode("utf-8"),
    )


def _is_command(text: str, command: str) -> bool:
    """Is `text` this command? Tolerates the /command@BotName form.

    Telegram's command menu and some clients append the bot's username to a
    tapped command; matching the raw string would make the menu's own entry
    for /language a no-op in exactly those clients.
    """
    first = text.split(maxsplit=1)[0] if text else ""
    return first.split("@", 1)[0].lower() == command


def _handle(update: dict) -> None:
    callback = (update or {}).get("callback_query")
    if callback:
        _handle_language_tap(callback)
        return

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

    # NO SENDER, NO BINDING. Every guard in binding.py is written as
    # `if not telegram_user_id`, and `str(None)` is the five-character string
    # "None" -- truthy, and therefore past all of them. An update with no
    # `from` would reach redeem_link_token as a real-looking account id, spend
    # a single-use token, and leave an enabled link keyed to "None" that no
    # Telegram launch can ever match: the credential burned and the employee
    # told the link did not work. Telegram always sends `from` on a private
    # message, so this is a latent trap rather than a live hole -- and the
    # stringification is in THIS file, so the guard belongs here too.
    if telegram_user_id is None:
        return

    if _is_command(text, "/language"):
        # Offered to anyone who asks, linked or not: the chooser leaks
        # nothing, and a press from an unlinked account changes nothing
        # (binding.set_language refuses without an enabled link).
        transport.send_message(chat_id, LANGUAGE_PROMPT, reply_markup=LANGUAGE_KEYBOARD)
        return

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
            _release_locks(keep=False)
            transport.send_message(chat_id, NEEDS_TOKEN_REPLY)
            return
        _release_locks(keep=True)
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
        _release_locks(keep=False)
        transport.send_message(chat_id, LINK_FAILED_REPLY)
        return

    _release_locks(keep=True)
    _confirm_linked(chat_id)


def _release_locks(*, keep: bool) -> None:
    """End the transaction before a single byte goes to api.telegram.org.

    Both bind paths now take a SELECT ... FOR UPDATE on the Employee row, and
    Frappe holds a transaction -- and therefore that lock -- until the request
    ends. The reply that follows is a `requests.post` at a 20-second timeout,
    twice over on the success path, so without this the Employee row is locked
    across up to forty seconds of somebody else's network: HR saving that
    employee, an Issue, an Unlink, and Telegram's own redelivery all queue
    behind a third party being slow.

    `keep=True` commits a binding that succeeded, which is also the truthful
    order: the binding is DONE at that point, the message is a notification
    about it, and a notification that fails must not take the binding with it.

    `keep=False` is the REFUSAL path, and it is the one easy to forget. It
    wrote nothing -- but both paths can reach their refusal AFTER taking the
    lock, so "nothing was written" is not the same as "nothing is held".
    """
    if keep:
        frappe.db.commit()
    else:
        frappe.db.rollback()


def _handle_language_tap(callback: dict) -> None:
    """A press on the language chooser's inline buttons.

    THE AUTHORISATION IS THE PRESSER'S OWN AUTHENTICATED TELEGRAM ID -- the
    same identity every Mini App request rides on -- and the only row a press
    can ever change is that account's own enabled link. The callback data
    chooses WHICH language, never WHOSE: it is looked up in an allowlist, so
    forged data (any Telegram client can send arbitrary callback bytes at the
    bot) selects nothing and is dropped.
    """
    callback_id = callback.get("id")
    if callback_id:
        # Answered FIRST, whatever the data: an unacknowledged press leaves
        # the button spinning client-side until Telegram times it out, and a
        # refusal below must look like nothing, not like a hang.
        transport.answer_callback_query(callback_id)

    language = LANGUAGE_CALLBACKS.get(str(callback.get("data") or "").strip())
    if not language:
        return

    telegram_user_id = (callback.get("from") or {}).get("id")
    # The same "None" trap as the message path above. Harmless here -- no link
    # is keyed to that string, so set_language would refuse -- but a guard that
    # only holds because the lookup happens to miss is not a guard.
    if telegram_user_id is None:
        return
    try:
        chat_id = binding.set_language(str(telegram_user_id), language)
    except Exception:
        # No enabled link -- a revoked account pressing a button on an old
        # chooser message, or an account that never linked. Deliberately
        # silent and undistinguished, like the bare-/start refusals: the
        # reasons would tell someone probing which accounts exist.
        return
    # set_language SAVED, so this request holds row locks on that link until
    # it ends. Same reasoning as the bind paths, smaller blast radius.
    _release_locks(keep=True)
    transport.send_message(chat_id, LANGUAGE_SET_REPLIES[language])


def _confirm_linked(chat_id) -> None:
    """Tell them they're linked, then ask which language. Both binding paths.

    No inline button into the Mini App any more. The bot's Main Mini App
    button and its chat menu button are permanent and always in reach, where
    this one scrolled out of the chat and never came back -- it was carrying
    the app's discoverability at the exact moment it was least able to.

    The language chooser rides here because linking is the one moment every
    employee is certainly looking at the chat. It scrolling away later is
    fine: Khmer is the default, and /language reopens it from the command
    menu for the minority who want English.
    """
    transport.send_message(chat_id, LINKED_REPLY)
    transport.send_message(chat_id, LANGUAGE_PROMPT, reply_markup=LANGUAGE_KEYBOARD)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def telegram_webhook():
    """Telegram calls this. Returns 200 with an empty body in every case.

    Telegram retries non-200 responses, so a handler error must not become a
    retry storm -- failures are logged and swallowed.
    """
    # Wrapped, so that nothing the secret check itself can raise leaves here as
    # a 500. It is the one statement in this function outside the try below,
    # and it reads an attacker-supplied header: `PermissionError` is the answer
    # to a bad secret AND to a secret check that could not run.
    try:
        ok = _secret_ok(frappe.get_request_header(SECRET_HEADER))
    except Exception:
        ok = False
    if not ok:
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
