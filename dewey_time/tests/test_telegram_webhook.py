import json
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
        # Added to a group, the bot must not reply -- one add-to-group would
        # otherwise leak a person's attendance to their colleagues.
        with patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(chat_type="group"))
        redeem.assert_not_called()
        send.assert_not_called()

    def test_supergroup_is_ignored_too(self):
        # Telegram has several non-private chat types; the guard is an
        # allowlist of "private", not a denylist of "group".
        with patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(chat_type="supergroup"))
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
        # First message: the confirmation. (The language chooser follows it.)
        self.assertIn("linked", send.call_args_list[0][0][1].lower())

    def test_failed_redemption_replies_without_leaking_why(self):
        with patch.object(webhook.binding, "redeem_link_token",
                          side_effect=Exception("token expired at 2026-01-01")), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))

        reply = send.call_args[0][1]
        self.assertNotIn("2026-01-01", reply)
        self.assertIn("HR", reply)

    def test_bare_start_explains_how_to_link_when_no_id_is_recorded(self):
        # The ordinary case for most of the roster. `claim_by_recorded_id`
        # refusing is not a fault, so the reply is the same instruction as
        # before and nothing is logged as an error.
        with patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.binding, "claim_by_recorded_id",
                          side_effect=Exception("no recorded id")), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start"))
        redeem.assert_not_called()
        self.assertIn("HR", send.call_args[0][1])

    def test_bare_start_binds_an_employee_whose_id_is_on_file(self):
        # The whole point of the no-token path: opening the bot IS the flow.
        with patch.object(webhook.binding, "claim_by_recorded_id",
                          return_value="HR-EMP-00001") as claim, \
             patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start"))
        redeem.assert_not_called(), "a bare /start has no token to redeem"
        self.assertEqual(claim.call_args[0][0], "55501", "the id comes off the update")
        self.assertEqual(claim.call_args[0][1], "77702")
        self.assertIn("linked", send.call_args_list[0][0][1].lower())

    def test_a_token_start_never_takes_the_recorded_id_path(self):
        # The two paths must not blur: a token names ONE employee, and falling
        # back to the recorded id would bind a different one than the link HR
        # sent was for.
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001"), \
             patch.object(webhook.binding, "claim_by_recorded_id") as claim, \
             patch.object(webhook.transport, "send_message"):
            webhook._handle(_update(text="/start tok123"))
        claim.assert_not_called()

    def test_a_failed_token_does_not_fall_back_to_the_recorded_id(self):
        # An expired or already-used token must fail as a token. Falling
        # through would silently bind via a different rule than the one the
        # employee was handed.
        with patch.object(webhook.binding, "redeem_link_token",
                          side_effect=Exception("expired")), \
             patch.object(webhook.binding, "claim_by_recorded_id") as claim, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start tok123"))
        claim.assert_not_called()
        self.assertIn("didn't work", send.call_args[0][1])

    def test_whitespace_only_payload_is_treated_as_bare(self):
        # "/start   " must not be redeemed as a token made of spaces.
        with patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.binding, "claim_by_recorded_id",
                          side_effect=Exception("none")), \
             patch.object(webhook.transport, "send_message"):
            webhook._handle(_update(text="/start   "))
        redeem.assert_not_called()

    def test_unknown_text_is_ignored_silently(self):
        with patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="hello there"))
        send.assert_not_called()

    def test_an_update_with_no_message_is_ignored(self):
        # Telegram sends edited_message, callback_query and others to the same
        # webhook. None of them should reach the redemption path.
        with patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle({"edited_message": {"text": "/start abc"}})
        redeem.assert_not_called()
        send.assert_not_called()


class TestLinkConfirmation(unittest.TestCase):
    """The confirmation is plain text; the language chooser follows it.

    The confirmation used to carry an inline button into the Mini App, and
    that button was the app's discoverability at the exact moment it was least
    able to carry it: the confirmation scrolls out of the chat and never comes
    back. The bot's Main Mini App button and its chat menu button are
    permanent, so this message is text again -- and the SECOND message, the
    language chooser, is allowed its buttons precisely because scrolling away
    is fine for it: Khmer is the default, and /language reopens it.
    """

    def test_a_successful_link_is_confirmed_in_plain_text(self):
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001"), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))
        confirmation = send.call_args_list[0]
        self.assertIn("linked", confirmation[0][1].lower())
        self.assertNotIn("reply_markup", confirmation[1])

    def test_the_confirmation_does_not_depend_on_the_mini_app_url(self):
        # It used to: an unset URL made the button path throw, and the reply
        # only survived because of a fallback. There is nothing left to fail,
        # so a broken Mini App URL cannot touch the one message that tells an
        # employee their account is bound.
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001"), \
             patch.object(webhook.transport, "miniapp_url",
                          side_effect=AssertionError("must not be consulted")), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))
        self.assertIn("linked", send.call_args_list[0][0][1].lower())

    def test_a_failed_link_is_not_confirmed(self):
        # Negative control. Without it, moving the confirmation outside the
        # success path would go unnoticed and tell someone whose token was
        # rejected that they are linked.
        with patch.object(webhook.binding, "redeem_link_token",
                          side_effect=Exception("bad token")), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))
        self.assertNotIn("linked", send.call_args[0][1].lower())

    def test_a_successful_link_is_followed_by_the_language_chooser(self):
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001"), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))
        self.assertEqual(send.call_count, 2)
        chooser = send.call_args_list[1]
        self.assertEqual(chooser[0][1], webhook.LANGUAGE_PROMPT)
        self.assertEqual(chooser[1]["reply_markup"], webhook.LANGUAGE_KEYBOARD)

    def test_a_failed_link_gets_no_chooser(self):
        # Asking an unlinkable account to pick a language would imply the
        # link worked.
        with patch.object(webhook.binding, "redeem_link_token",
                          side_effect=Exception("bad token")), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))
        self.assertEqual(send.call_count, 1)
        self.assertNotIn("reply_markup", send.call_args[1])


class TestLanguageCommand(unittest.TestCase):
    """/language: the persistent route back to the chooser."""

    def test_it_sends_the_two_button_chooser(self):
        with patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/language"))
        args, kwargs = send.call_args
        self.assertEqual(args[0], 77702)
        # Bilingual BY NECESSITY: the one message whose whole job is to ask
        # which language the reader reads cannot assume an answer.
        self.assertIn("ភាសា", args[1])
        self.assertIn("language", args[1].lower())
        buttons = [b for row in kwargs["reply_markup"]["inline_keyboard"] for b in row]
        self.assertEqual([b["callback_data"] for b in buttons],
                         ["lang:km", "lang:en"])

    def test_two_buttons_and_no_both(self):
        # Two by decision: the stacked-bilingual format is retired, and a
        # "both" button would quietly bring it back.
        buttons = [b for row in webhook.LANGUAGE_KEYBOARD["inline_keyboard"]
                   for b in row]
        self.assertEqual(len(buttons), 2)

    def test_every_button_is_in_the_callback_allowlist(self):
        # The chooser and the handler are two constants that must agree; a
        # button whose data the allowlist does not know would render, press,
        # and silently do nothing.
        for row in webhook.LANGUAGE_KEYBOARD["inline_keyboard"]:
            for button in row:
                self.assertIn(button["callback_data"], webhook.LANGUAGE_CALLBACKS)

    def test_the_command_menu_form_with_the_bot_name_works(self):
        # Telegram's command menu appends @BotName in some clients; the menu's
        # own entry for /language must not be a no-op there.
        with patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/language@dewey_time_bot"))
        self.assertEqual(send.call_args[1]["reply_markup"], webhook.LANGUAGE_KEYBOARD)

    def test_it_is_ignored_outside_private_chats(self):
        with patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/language", chat_type="group"))
        send.assert_not_called()

    def test_language_with_a_payload_is_still_the_chooser_not_a_setter(self):
        # "/language en" must not become an undocumented text path around the
        # buttons -- the allowlisted callback is the only setter.
        with patch.object(webhook.binding, "set_language") as set_language, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/language en"))
        set_language.assert_not_called()
        self.assertEqual(send.call_args[1]["reply_markup"], webhook.LANGUAGE_KEYBOARD)


def _tap(data="lang:en", user_id=55501, callback_id="cbq-1"):
    return {
        "callback_query": {
            "id": callback_id,
            "data": data,
            "from": {"id": user_id},
            "message": {"chat": {"id": 77702, "type": "private"}},
        }
    }


class TestLanguageTap(unittest.TestCase):
    """A press on the chooser's buttons, arriving as callback_query.

    The authorisation model under test: the DATA picks which language, the
    authenticated identity picks whose link, and nothing in the payload can
    point the write at anyone else's row.
    """

    def test_a_valid_press_sets_the_pressers_own_language(self):
        with patch.object(webhook.binding, "set_language",
                          return_value="77702") as set_language, \
             patch.object(webhook.transport, "answer_callback_query") as answer, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_tap(data="lang:en"))
        set_language.assert_called_once_with("55501", "en")
        answer.assert_called_once_with("cbq-1")
        # Confirmed to the BOUND chat, in the language just chosen -- the
        # first message that proves the choice took.
        self.assertEqual(send.call_args[0][0], "77702")
        self.assertEqual(send.call_args[0][1], webhook.LANGUAGE_SET_REPLIES["en"])

    def test_the_khmer_press_confirms_in_khmer(self):
        with patch.object(webhook.binding, "set_language", return_value="77702"), \
             patch.object(webhook.transport, "answer_callback_query"), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_tap(data="lang:km"))
        self.assertEqual(send.call_args[0][1], webhook.LANGUAGE_SET_REPLIES["km"])
        self.assertIn("ខ្មែរ", send.call_args[0][1])

    def test_the_identity_comes_off_the_update_never_the_data(self):
        # set_language returns "88801" while the callback's own message sits
        # in chat 77702: the confirmation must follow the BINDING's answer,
        # not the untrusted payload. Resolving the destination from the
        # callback message would confirm into whatever chat the pressed
        # chooser happened to be in -- and without this assertion that
        # regression passed, because the happy-path test's two ids coincide.
        with patch.object(webhook.binding, "set_language",
                          return_value="88801") as set_language, \
             patch.object(webhook.transport, "answer_callback_query"), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_tap(data="lang:km", user_id=99999))
        set_language.assert_called_once_with("99999", "km")
        self.assertEqual(send.call_args[0][0], "88801")

    def test_forged_callback_data_selects_nothing(self):
        # Any Telegram client can send arbitrary bytes as callback_data; the
        # allowlist is the whole parse. The press is still answered -- a
        # refusal must look like nothing, not like a hang.
        for data in ("lang:both", "lang:xx", "", None, "employee=HR-EMP-1",
                     "LANG:EN", "lang:en junk"):
            with self.subTest(data=data):
                with patch.object(webhook.binding, "set_language") as set_language, \
                     patch.object(webhook.transport, "answer_callback_query") as answer, \
                     patch.object(webhook.transport, "send_message") as send:
                    webhook._handle(_tap(data=data))
                set_language.assert_not_called()
                send.assert_not_called()
                answer.assert_called_once_with("cbq-1")

    def test_lang_en_with_surrounding_whitespace_still_counts(self):
        # .strip() on the data is a nicety, not a hole: the stripped value
        # still has to equal an allowlist key exactly.
        with patch.object(webhook.binding, "set_language",
                          return_value="77702") as set_language, \
             patch.object(webhook.transport, "answer_callback_query"), \
             patch.object(webhook.transport, "send_message"):
            webhook._handle(_tap(data=" lang:en "))
        set_language.assert_called_once_with("55501", "en")

    def test_an_unlinked_or_revoked_presser_is_answered_but_unconfirmed(self):
        # binding.set_language refuses without an enabled link; the webhook
        # stays silent about why, exactly like the bare-/start refusals.
        with patch.object(webhook.binding, "set_language",
                          side_effect=Exception("Not permitted")), \
             patch.object(webhook.transport, "answer_callback_query") as answer, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_tap(data="lang:en"))
        answer.assert_called_once_with("cbq-1")
        send.assert_not_called()

    def test_a_callback_update_never_reaches_the_binding_paths(self):
        # callback_query and message are disjoint branches; a press must not
        # fall through to redemption with its data as a token.
        with patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.binding, "claim_by_recorded_id") as claim, \
             patch.object(webhook.binding, "set_language", return_value="77702"), \
             patch.object(webhook.transport, "answer_callback_query"), \
             patch.object(webhook.transport, "send_message"):
            webhook._handle(_tap(data="lang:km"))
        redeem.assert_not_called()
        claim.assert_not_called()


class TestThePublicEntrypointRefusesBeforeItActs(unittest.TestCase):
    """`telegram_webhook` itself, not `_secret_ok`.

    Every existing test exercised the helper or `_handle`. Nothing called the
    allow_guest endpoint that Telegram -- and anyone else who knows the URL --
    actually reaches, so deleting the secret check from it left the whole suite
    green.
    """

    def test_a_wrong_secret_raises_and_the_update_is_never_handled(self):
        with patch.object(webhook.frappe, "get_request_header", return_value="wrong"), \
             patch.object(webhook.transport, "webhook_secret", return_value="right"), \
             patch.object(webhook, "_handle") as handle:
            with self.assertRaises(webhook.frappe.PermissionError):
                webhook.telegram_webhook()
        # The refusal must come BEFORE any work: a 403 that still processed the
        # update would be no protection at all.
        handle.assert_not_called()

    def test_a_missing_header_raises_rather_than_skipping_the_check(self):
        # The bypass shape: absent must reject, not wave through.
        with patch.object(webhook.frappe, "get_request_header", return_value=None), \
             patch.object(webhook.transport, "webhook_secret", return_value="right"), \
             patch.object(webhook, "_handle") as handle:
            with self.assertRaises(webhook.frappe.PermissionError):
                webhook.telegram_webhook()
        handle.assert_not_called()

    def test_the_right_secret_lets_the_update_through(self):
        # Without this the two tests above would also pass on an endpoint that
        # rejected everything.
        update = {"message": {"chat": {"id": 55501, "type": "private"}, "text": "/start"}}

        class _Req:
            @staticmethod
            def get_data(as_text=False):
                return json.dumps(update)

        with patch.object(webhook.frappe, "get_request_header", return_value="right"), \
             patch.object(webhook.transport, "webhook_secret", return_value="right"), \
             patch.object(webhook.frappe, "request", _Req), \
             patch.object(webhook, "_handle") as handle:
            self.assertEqual(webhook.telegram_webhook(), {})
        handle.assert_called_once_with(update)

    def test_a_handler_failure_is_swallowed_so_telegram_does_not_retry(self):
        class _Req:
            @staticmethod
            def get_data(as_text=False):
                return "{}"

        with patch.object(webhook.frappe, "get_request_header", return_value="right"), \
             patch.object(webhook.transport, "webhook_secret", return_value="right"), \
             patch.object(webhook.frappe, "request", _Req), \
             patch.object(webhook.frappe, "log_error"), \
             patch.object(webhook, "_handle", side_effect=RuntimeError("boom")):
            self.assertEqual(webhook.telegram_webhook(), {})


class TestAnUpdateWithNoSenderBindsNothing(unittest.TestCase):
    """`str(None)` is the five-character string "None", and it is truthy.

    Every emptiness guard in binding.py is written `if not telegram_user_id`,
    and the stringification happens HERE, in this file -- so an update with no
    `from` arrives there looking like a real account id and walks past all of
    them. It would spend a single-use token and leave an enabled link keyed to
    "None" that no Telegram launch can ever match: the credential burned, and
    the employee told the link did not work.

    Telegram always sends `from` on a private message, so this is a latent
    trap rather than a live hole. It is pinned because the thing that makes it
    latent is a property of Telegram's payloads, not of this code.
    """

    @staticmethod
    def _senderless(text="/start tok"):
        return {"message": {"text": text, "chat": {"id": 77702, "type": "private"}}}

    def test_a_token_is_not_spent_by_a_senderless_update(self):
        with patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(self._senderless())
        redeem.assert_not_called()
        send.assert_not_called()

    def test_the_no_token_path_refuses_it_too(self):
        with patch.object(webhook.binding, "claim_by_recorded_id") as claim, \
             patch.object(webhook.transport, "send_message"):
            webhook._handle(self._senderless(text="/start"))
        claim.assert_not_called()

    def test_a_senderless_language_tap_changes_nothing(self):
        with patch.object(webhook.binding, "set_language") as set_language, \
             patch.object(webhook.transport, "answer_callback_query"), \
             patch.object(webhook.transport, "send_message"):
            webhook._handle({"callback_query": {"id": "cbq-1", "data": "lang:en"}})
        set_language.assert_not_called()

    def test_an_ordinary_update_still_binds(self):
        # The inversion: without this the two above would also pass if the
        # guard refused everything.
        with patch.object(webhook.binding, "redeem_link_token") as redeem, \
             patch.object(webhook.transport, "send_message"):
            webhook._handle(_update())
        redeem.assert_called_once()


class TestTheSecretCheckRefusesRatherThanRaising(unittest.TestCase):
    """A header value is attacker-supplied, and this is the only statement in
    the endpoint outside its try/except.

    `hmac.compare_digest` refuses two str arguments unless both are ASCII --
    TypeError, not False -- and a WSGI header is latin-1 decoded, so any byte
    in 0x80-0xFF made the public webhook answer 500 with a logged traceback
    instead of 403. Never a bypass; it just stopped being the refusal it was
    written as, at whatever rate an unauthenticated caller cared to send.
    """

    def test_a_non_ascii_header_is_refused(self):
        with patch.object(webhook.transport, "webhook_secret", return_value="right"):
            self.assertFalse(webhook._secret_ok("wrongé"))

    def test_the_matching_secret_still_matches_through_the_byte_compare(self):
        with patch.object(webhook.transport, "webhook_secret", return_value="right"):
            self.assertTrue(webhook._secret_ok("right"))

    def test_nothing_the_check_raises_escapes_the_endpoint(self):
        # Even a secret that cannot be READ -- an unconfigured site, where
        # transport.webhook_secret() throws -- must answer PermissionError.
        # It was reachable before anything else in this function ran.
        #
        # ASSERTED ON THE TYPE THAT COMES OUT, not on assertRaises alone: the
        # shared frappe mock sets `frappe.PermissionError = Exception`, so
        # `assertRaises(frappe.PermissionError)` is satisfied by the very
        # RuntimeError this guard exists to convert. Deleting the try/except
        # left the whole suite green while that was the only assertion.
        import frappe

        with patch.object(webhook.transport, "webhook_secret",
                          side_effect=RuntimeError("not configured")), \
             patch.object(frappe, "log_error"), \
             patch.object(frappe.db, "commit"), \
             patch.object(frappe, "get_request_header", return_value="anything"):
            with self.assertRaises(Exception) as caught:
                webhook.telegram_webhook()
        self.assertNotIsInstance(
            caught.exception, RuntimeError,
            "the lookup's own error must be converted, not re-raised",
        )

    def test_a_secret_that_cannot_be_read_leaves_a_record(self):
        # A permanent 403 to every Telegram delivery is a deployment fault, and
        # silence is the worst way to report one. COMMITTED, because the
        # PermissionError ends the request and would otherwise take the entry
        # with it -- the trap the redemption path fell into.
        import frappe

        calls = []
        with patch.object(webhook.transport, "webhook_secret",
                          side_effect=RuntimeError("not configured")), \
             patch.object(frappe, "log_error",
                          side_effect=lambda **kw: calls.append("log")), \
             patch.object(frappe.db, "commit", side_effect=lambda: calls.append("commit")), \
             patch.object(frappe, "get_request_header", return_value="anything"):
            with self.assertRaises(Exception):
                webhook.telegram_webhook()
        self.assertEqual(calls, ["log", "commit"])


class TestTheBindingIsCommittedBeforeTelegramIsCalled(unittest.TestCase):
    """Both bind paths now hold a SELECT ... FOR UPDATE on the Employee row.

    Frappe holds a transaction until the request ends, and the confirmation
    that follows is two `requests.post` calls at a 20-second timeout each. So
    without a commit between them, an Employee row -- shared with HR's own
    saves, with Issue and with Unlink -- is locked across up to forty seconds
    of a third party being slow.
    """

    def _order(self, update, *, bind_raises=False):
        calls = []
        import frappe

        def bind(*_a):
            calls.append("bind")
            if bind_raises:
                raise RuntimeError("nope")
            return "HR-EMP-00001"

        with patch.object(frappe.db, "commit", side_effect=lambda: calls.append("commit")), \
             patch.object(frappe.db, "rollback", side_effect=lambda: calls.append("rollback")), \
             patch.object(webhook.transport, "send_message",
                          side_effect=lambda *a, **kw: calls.append("send")), \
             patch.object(frappe, "log_error", side_effect=lambda **kw: calls.append("log")), \
             patch.object(webhook.binding, "redeem_link_token", side_effect=bind), \
             patch.object(webhook.binding, "claim_by_recorded_id", side_effect=bind):
            webhook._handle(update)
        return calls

    def test_the_token_path_commits_between_binding_and_sending(self):
        self.assertEqual(self._order(_update())[:3], ["bind", "commit", "send"])

    def test_the_no_token_path_commits_too(self):
        self.assertEqual(
            self._order(_update(text="/start"))[:3], ["bind", "commit", "send"],
        )

    def test_a_refusal_rolls_back_BEFORE_it_records_why(self):
        # THE EASY ONE TO FORGET, twice over. The refusal wrote nothing -- but
        # both paths can reach their refusal AFTER taking the Employee lock, so
        # "nothing was written" is not "nothing is held". Rolled back, not
        # committed: a commit here would claim something happened.
        #
        # AND THE ROLLBACK GOES FIRST. `log_error` inserts an Error Log row in
        # this transaction, so rolling back after it destroys the entry -- and
        # the reply on this path is deliberately non-descriptive, which makes
        # that row the only record anywhere of why a link failed. The first
        # version of this fix had them the other way round and no test could
        # tell, because this helper patched log_error out entirely.
        self.assertEqual(
            self._order(_update(), bind_raises=True),
            ["bind", "rollback", "log", "send"],
        )

    def test_the_no_token_refusal_releases_too(self):
        # No log on this one, and that is deliberate upstream: most bare
        # /start messages are from people with no recorded id, which is the
        # ordinary case and not a fault.
        self.assertEqual(
            self._order(_update(text="/start"), bind_raises=True),
            ["bind", "rollback", "send"],
        )


class TestTheLanguageTapReleasesToo(unittest.TestCase):
    """`set_language` writes through the document API, so the press holds row
    locks on that link until the request ends — and the confirmation that
    follows is another 20-second `requests.post`.

    Smaller blast radius than the bind paths (the row is the presser's own
    link, not an Employee row HR contends for), which is exactly why it was
    the one call site the first fix left unpinned.
    """

    def _order(self, *, raises=False):
        import frappe

        calls = []

        def set_language(*_a):
            calls.append("save")
            if raises:
                raise RuntimeError("no enabled link")
            return "77702"

        with patch.object(frappe.db, "commit", side_effect=lambda: calls.append("commit")), \
             patch.object(frappe.db, "rollback", side_effect=lambda: calls.append("rollback")), \
             patch.object(webhook.transport, "answer_callback_query"), \
             patch.object(webhook.transport, "send_message",
                          side_effect=lambda *a, **kw: calls.append("send")), \
             patch.object(webhook.binding, "set_language", side_effect=set_language):
            webhook._handle({"callback_query": {
                "id": "cbq-1", "data": "lang:en", "from": {"id": 55501},
            }})
        return calls

    def test_a_successful_press_commits_before_confirming(self):
        self.assertEqual(self._order(), ["save", "commit", "send"])

    def test_a_refused_press_rolls_back_and_says_nothing(self):
        self.assertEqual(self._order(raises=True), ["save", "rollback"])
