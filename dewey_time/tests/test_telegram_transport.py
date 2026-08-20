import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import transport  # noqa: E402


class TestCredentials(unittest.TestCase):
    def test_bot_token_raises_when_unset(self):
        # An unconfigured token must stop the feature dead. The dangerous
        # alternative is HMAC-ing on an empty key, which an attacker who
        # guesses the token is blank can forge against.
        with patch.object(transport, "_secret", return_value=""):
            with self.assertRaises(Exception):
                transport.bot_token()

    def test_bot_token_returns_configured_value(self):
        with patch.object(transport, "_secret", return_value="123:ABC"):
            self.assertEqual(transport.bot_token(), "123:ABC")

    def test_webhook_secret_raises_when_unset(self):
        with patch.object(transport, "_secret", return_value=None):
            with self.assertRaises(Exception):
                transport.webhook_secret()


class TestSendMessage(unittest.TestCase):
    def test_send_message_posts_to_the_bot_api(self):
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = {"ok": True}
            transport.send_message("55501", "Checked in 07:58")

        url = post.call_args[0][0]
        self.assertIn("https://api.telegram.org/bot123:ABC/sendMessage", url)
        self.assertEqual(post.call_args[1]["json"]["chat_id"], "55501")
        self.assertEqual(post.call_args[1]["json"]["text"], "Checked in 07:58")

    def test_blocked_recipient_is_reported_not_raised(self):
        # Telegram returns 403 when a user blocks the bot. That is a normal
        # end state, not an error to retry forever.
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 403
            post.return_value.json.return_value = {"ok": False, "description": "bot was blocked"}
            self.assertEqual(transport.send_message("55501", "hi"), transport.BLOCKED)

    def test_a_reply_markup_is_passed_through_verbatim(self):
        keyboard = {"inline_keyboard": [[{"text": "ខ្មែរ", "callback_data": "lang:km"}]]}
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            transport.send_message("55501", "pick one", reply_markup=keyboard)
        self.assertEqual(post.call_args[1]["json"]["reply_markup"], keyboard)

    def test_a_plain_message_carries_no_reply_markup_key(self):
        # The ordinary check-in message must stay the shape it has always
        # been on the wire -- not grow a null field Telegram then interprets.
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            transport.send_message("55501", "hi")
        self.assertNotIn("reply_markup", post.call_args[1]["json"])


class TestAnswerCallbackQuery(unittest.TestCase):
    def test_it_acknowledges_the_press_by_id(self):
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            self.assertEqual(transport.answer_callback_query("cbq-1"), transport.SENT)
        self.assertIn("answerCallbackQuery", post.call_args[0][0])
        self.assertEqual(post.call_args[1]["json"], {"callback_query_id": "cbq-1"})

    def test_a_stale_press_is_reported_not_raised(self):
        # Telegram answers 400 for an expired callback id -- redelivered old
        # updates after webhook downtime produce exactly this, and it must not
        # take the handler down.
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.frappe, "log_error"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 400
            post.return_value.text = "Bad Request: query is too old"
            self.assertEqual(transport.answer_callback_query("cbq-1"), transport.FAILED)

    def test_a_transport_fault_is_reported_not_raised(self):
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.frappe, "log_error"), \
             patch.object(transport.requests, "post", side_effect=OSError("down")):
            self.assertEqual(transport.answer_callback_query("cbq-1"), transport.FAILED)


class TestMiniAppUrl(unittest.TestCase):
    def test_a_plain_http_url_is_refused(self):
        # Telegram rejects a web_app button whose URL is not https, so a
        # misconfiguration must surface here rather than as a silent no-button.
        with patch.object(transport.frappe, "get_cached_value",
                          return_value="http://site/hr-me"):
            with self.assertRaises(Exception):
                transport.miniapp_url()

    def test_an_unset_url_falls_back_to_the_site(self):
        # THE FIX FOR A REAL OUTAGE. Every caller wraps miniapp_url() in a try
        # that degrades to a plain message, so an empty Settings field produced
        # a bot with no button anywhere, permanently, and nothing to see but an
        # Error Log entry. The site knows its own address and the route is this
        # app's own, so there is nothing for a human to look up.
        with patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://dewey.example/hr-me") as url:
            self.assertEqual(transport.miniapp_url(), "https://dewey.example/hr-me")
        url.assert_called_once_with(transport.MINIAPP_ROUTE)

    def test_the_configured_url_overrides_the_site(self):
        # The field survives as an override, for a site reached at a different
        # hostname than get_url reports -- a proxy, or a vanity domain.
        with patch.object(transport.frappe, "get_cached_value",
                          return_value=" https://vanity.example/hr-me "), \
             patch.object(transport, "get_url", return_value="https://internal/hr-me"):
            self.assertEqual(transport.miniapp_url(), "https://vanity.example/hr-me")

    def test_a_plain_http_site_is_still_refused(self):
        # The fallback must not trade a visible misconfiguration for an
        # invisible one: a dev site on http would otherwise silently produce a
        # URL Telegram rejects.
        with patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="http://localhost:8000/hr-me"):
            with self.assertRaises(Exception):
                transport.miniapp_url()

    def test_an_https_url_is_returned(self):
        with patch.object(transport.frappe, "get_cached_value",
                          return_value=" https://site/hr-me "):
            self.assertEqual(transport.miniapp_url(), "https://site/hr-me")


class TestMenuButton(unittest.TestCase):
    def test_it_sets_the_default_button_for_every_user(self):
        # No chat_id in the payload: one call covers everyone, rather than a
        # per-employee call nobody would remember to make.
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            transport.set_default_menu_button("https://site/hr-me")

        body = post.call_args[1]["json"]
        self.assertIn("setChatMenuButton", post.call_args[0][0])
        self.assertNotIn("chat_id", body)
        self.assertEqual(body["menu_button"]["type"], "web_app")
        self.assertEqual(body["menu_button"]["web_app"]["url"], "https://site/hr-me")

    def test_configure_requires_hr_and_uses_the_configured_url(self):
        # `_require_hr_role` is patched explicitly rather than left to the
        # shared frappe mock. Without this the test passes only when some
        # earlier test module has already granted HR roles on that mock, and
        # fails whenever this file is run on its own.
        with patch("dewey_time.attendance_engine.hr_calendar._require_hr_role"), \
             patch.object(transport, "miniapp_url", return_value="https://site/hr-me"), \
             patch.object(transport, "set_default_menu_button",
                          return_value=transport.SENT) as setter:
            result = transport.configure_menu_button()
        setter.assert_called_once_with("https://site/hr-me")
        self.assertEqual(result["status"], transport.SENT)

    def test_a_rejection_is_reported_not_raised(self):
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 400
            post.return_value.text = "Bad Request: BUTTON_URL_INVALID"
            self.assertEqual(
                transport.set_default_menu_button("https://site/hr-me"), transport.FAILED
            )


class TestWebhookSecretFormat(unittest.TestCase):
    """Telegram rejects a secret_token outside [A-Za-z0-9_-]{1,256}.

    Caught in the wild: setWebhook answered "Bad Request: secret token
    contains unallowed characters". Validating here turns that into an error
    at the point the value is read, rather than three steps away at
    registration -- or worse, a silent 403 on every update if the bad value is
    left in Settings.
    """

    def test_a_urlsafe_token_is_accepted(self):
        with patch.object(transport, "_secret", return_value="Xk3_9pQ-rT7wLmZ2aB4cD6eF8gH0iJkL"):
            self.assertTrue(transport.webhook_secret())

    def test_a_trailing_newline_from_a_terminal_copy_is_stripped(self):
        # .strip() already handles this, and it is the single most likely way
        # to get the error, so it is worth pinning rather than assuming.
        with patch.object(transport, "_secret", return_value="abc123\n"):
            self.assertEqual(transport.webhook_secret(), "abc123")

    def test_base64_padding_and_slashes_are_refused(self):
        # `openssl rand -base64 32` emits +, / and = -- an easy substitution
        # for the documented generator, and all three are disallowed.
        for bad in ("ab+cd/ef==", "abc+def", "abc/def", "abcdef="):
            with patch.object(transport, "_secret", return_value=bad):
                with self.assertRaises(Exception, msg=f"{bad!r} should be refused"):
                    transport.webhook_secret()

    def test_an_internal_space_or_newline_is_refused(self):
        for bad in ("abc def", "abc\ndef", "abc\tdef"):
            with patch.object(transport, "_secret", return_value=bad):
                with self.assertRaises(Exception, msg=f"{bad!r} should be refused"):
                    transport.webhook_secret()

    def test_the_error_says_how_to_generate_a_good_one(self):
        # An operator hitting this is mid-setup and should not have to go
        # looking for the runbook.
        with patch.object(transport, "_secret", return_value="bad+secret"):
            with self.assertRaises(Exception) as ctx:
                transport.webhook_secret()
        self.assertIn("token_urlsafe", str(ctx.exception))


class TestDiagnostics(unittest.TestCase):
    """Why is there no button? Answered in one call rather than by reading the
    Error Log, which is where every Mini App entry point fails silently."""

    def _hr(self):
        return patch("dewey_time.attendance_engine.hr_calendar._require_hr_role")

    def test_it_never_returns_the_secrets_themselves(self):
        # The token and the webhook secret are the whole security of this
        # integration. A diagnostic that printed them would put them in a
        # browser's network log to save one glance at Settings.
        with self._hr(), \
             patch.object(transport, "_secret", return_value="123:SUPERSECRET"), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch.object(transport, "_get", return_value={"ok": True, "result": {}}):
            report = transport.diagnostics()

        self.assertNotIn("SUPERSECRET", repr(report))
        self.assertTrue(report["bot_token_set"])
        self.assertTrue(report["webhook_secret_set"])

    def test_it_reports_the_resolved_url_and_where_it_came_from(self):
        with self._hr(), \
             patch.object(transport, "_secret", return_value=""), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"):
            report = transport.diagnostics()

        self.assertIsNone(report["miniapp_url_override"])
        self.assertEqual(report["miniapp_url"], "https://site/hr-me")
        # No token, so nothing was asked of Telegram -- and it says so rather
        # than reporting three identical credential errors.
        self.assertIn("note", report)
        self.assertNotIn("menu_button", report)

    def test_a_default_menu_button_is_reported_as_not_the_mini_app(self):
        # Telegram's default is type "commands". Seeing that is the difference
        # between "no persistent way in" and "one tap" -- and it is the state
        # of any bot where configure_menu_button was never run.
        def answer(method):
            if method == "getChatMenuButton":
                return {"ok": True, "result": {"type": "commands"}}
            return {"ok": True, "result": {}}

        with self._hr(), \
             patch.object(transport, "_secret", return_value="123:ABC"), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch.object(transport, "_get", side_effect=answer):
            report = transport.diagnostics()

        self.assertFalse(report["menu_button"]["is_miniapp"])
        self.assertEqual(report["menu_button"]["type"], "commands")

    def _getme(self, username):
        def answer(method):
            if method == "getMe":
                return {"ok": True, "result": {"username": username}}
            return {"ok": True, "result": {}}

        return answer

    def test_a_username_that_names_a_different_bot_than_the_token_is_flagged(self):
        # Two independent settings that must name the same bot: the TOKEN
        # decides who sends the messages, the USERNAME builds the invite deep
        # link. A mismatch is silent on both sides -- notifications arrive
        # normally while every invite link opens "user not found" -- and
        # nothing else in this report compares them.
        with self._hr(), \
             patch.object(transport, "_secret", return_value="123:ABC"), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value="old_bot"), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch.object(transport, "_get", side_effect=self._getme("dewey_time_bot")):
            report = transport.diagnostics()

        self.assertEqual(report["invite_username"], "old_bot")
        self.assertEqual(report["invite_username_mismatch"], "dewey_time_bot")

    def test_the_at_form_is_not_reported_as_a_mismatch(self):
        # "@dewey_time_bot" IS the same bot -- it is how Telegram displays the
        # name. Comparing it raw would raise an alarm on a setting that now
        # works, and send someone editing the one field that is correct.
        with self._hr(), \
             patch.object(transport, "_secret", return_value="123:ABC"), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value="@Dewey_Time_Bot"), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch.object(transport, "_get", side_effect=self._getme("dewey_time_bot")):
            report = transport.diagnostics()

        self.assertEqual(report["invite_username"], "Dewey_Time_Bot")
        self.assertNotIn("invite_username_mismatch", report)

    def test_the_webhook_last_error_is_surfaced(self):
        # Telegram records the last delivery failure here and nowhere else, so
        # a bot that "does nothing" is explained by this field or by no field.
        def answer(method):
            if method == "getWebhookInfo":
                return {"ok": True, "result": {
                    "url": "https://site/api/method/x",
                    "pending_update_count": 7,
                    "last_error_message": "Wrong response from the webhook: 403 Forbidden",
                }}
            return {"ok": True, "result": {}}

        with self._hr(), \
             patch.object(transport, "_secret", return_value="123:ABC"), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch.object(transport, "_get", side_effect=answer):
            report = transport.diagnostics()

        self.assertEqual(report["webhook"]["pending"], 7)
        self.assertIn("403", report["webhook"]["last_error"])

    def test_the_update_shapes_telegram_will_deliver_are_surfaced(self):
        # The one state that explains dead chooser buttons. allowed_updates
        # lives on Telegram's servers; after a deploy that taught the webhook
        # callback_query, a bot still filtered to ["message"] DISCARDS every
        # press -- no pending count, no last_error, every other line of this
        # report healthy. Without this field the report is drawn from the
        # exact HTTP response that contains the answer, and drops it.
        def answer(method):
            if method == "getWebhookInfo":
                return {"ok": True, "result": {
                    "url": "https://site/api/method/x",
                    "allowed_updates": ["message"],
                }}
            return {"ok": True, "result": {}}

        with self._hr(), \
             patch.object(transport, "_secret", return_value="123:ABC"), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch.object(transport, "_get", side_effect=answer):
            report = transport.diagnostics()

        self.assertEqual(report["webhook"]["allowed_updates"], ["message"])
        self.assertFalse(report["webhook"]["delivers_button_presses"])

    def test_an_absent_allowed_updates_list_means_presses_arrive(self):
        # Telegram omits the field when the bot is on the default (everything
        # but chat_member) -- absence is the healthy state, not an unknown.
        with self._hr(), \
             patch.object(transport, "_secret", return_value="123:ABC"), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch.object(transport, "_get",
                          return_value={"ok": True, "result": {}}):
            report = transport.diagnostics()

        self.assertIsNone(report["webhook"]["allowed_updates"])
        self.assertTrue(report["webhook"]["delivers_button_presses"])

    def test_an_unreachable_api_reads_as_unknown_not_healthy(self):
        # _get reports a failed call as {"ok": False}, which leaves the
        # result empty -- indistinguishable, naively, from Telegram's
        # default-allowed-updates answer. The one field the runbook tells
        # operators to trust must say "unknown" (None) there, and a failed
        # getMyCommands must not read as "set_bot_commands never ran".
        with self._hr(), \
             patch.object(transport, "_secret", return_value="123:ABC"), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch.object(transport, "_get",
                          return_value={"ok": False, "error": "NameResolutionError"}):
            report = transport.diagnostics()

        self.assertIsNone(report["webhook"]["delivers_button_presses"])
        self.assertIsNone(report["commands"]["listed"])

    def test_the_registered_command_menu_is_surfaced(self):
        # "language" missing from this list means set_bot_commands never ran
        # against this bot: /language is then undiscoverable for everyone
        # already linked, which makes the whole feature a no-op for them.
        def answer(method):
            if method == "getMyCommands":
                return {"ok": True, "result": [
                    {"command": "language", "description": "ភាសា · Language"},
                ]}
            return {"ok": True, "result": {}}

        with self._hr(), \
             patch.object(transport, "_secret", return_value="123:ABC"), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch.object(transport, "_get", side_effect=answer):
            report = transport.diagnostics()

        self.assertEqual(report["commands"]["listed"], ["language"])


class TestNotificationGates(unittest.TestCase):
    """"No notification arrived" has four causes and none of them surfaces.

    Every gate in send_checkin_notification returns a short string into the
    job log and sends nothing. That is right -- a punch must never fail
    because Telegram is off, and being unlinked is the normal state through a
    rollout -- and it is also why nobody can tell which gate is shut.
    """

    def test_the_gates_are_reported_in_the_order_the_job_checks_them(self):
        from dewey_time.telegram import notify

        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify.frappe.db, "count", return_value=0), \
             patch.object(notify.rollout, "phases_configured", return_value=False):
            gates = notify.delivery_gates()

        self.assertTrue(gates["telegram_enabled"])
        # The likely answer during a rollout, and the one worth seeing first:
        # nobody has completed /start, so there is nobody to notify.
        self.assertEqual(gates["links_enabled"], 0)
        # False means no rollout date is set anywhere, so every employee reads
        # LIVE and this gate cannot be what is stopping delivery.
        self.assertFalse(gates["rollout_configured"])
        self.assertNotIn("employee", gates)

    def test_one_employee_can_be_asked_about_specifically(self):
        from dewey_time.telegram import notify

        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify.frappe.db, "count", return_value=3), \
             patch.object(notify.rollout, "phases_configured", return_value=True), \
             patch.object(notify.frappe.db, "exists", return_value="HR-EMP-00042"), \
             patch.object(notify.rollout, "phase_for_employee", return_value="TESTING"), \
             patch.object(notify, "_link_for", return_value=None):
            gates = notify.delivery_gates("HR-EMP-00042")

        self.assertFalse(gates["employee_linked"])
        # Not LIVE, so even a linked employee would get nothing -- the second
        # of the two gates that are per-person.
        self.assertEqual(gates["employee_phase"], "TESTING")

    def test_diagnostics_carries_the_gates_alongside_the_bot_checks(self):
        # One call for "why no button" and "why no notification": they are
        # different questions with different silent failures, and asking them
        # separately is how one gets forgotten.
        with patch("dewey_time.attendance_engine.hr_calendar._require_hr_role"), \
             patch.object(transport, "_secret", return_value=""), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "get_url", return_value="https://site/hr-me"), \
             patch("dewey_time.telegram.notify.delivery_gates",
                   return_value={"links_enabled": 0}) as gates:
            report = transport.diagnostics("HR-EMP-00042")

        gates.assert_called_once_with("HR-EMP-00042")
        self.assertEqual(report["notifications"]["links_enabled"], 0)


class TestWebhookRegistration(unittest.TestCase):
    """Nothing in this app had ever called setWebhook.

    The handler, the constant-time secret check and both binding paths were
    all written, and none of them had ever run: Telegram was never told the
    endpoint existed. `/start` went nowhere, no Telegram Link was created, and
    every employee read as "unlinked" -- which the notifier reports as a
    normal rollout state, so nothing looked broken anywhere.
    """

    def test_it_registers_the_apps_own_endpoint_with_the_secret(self):
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            transport.set_webhook("https://site/api/method/x", "s3cret")

        self.assertIn("setWebhook", post.call_args[0][0])
        body = post.call_args[1]["json"]
        self.assertEqual(body["url"], "https://site/api/method/x")
        self.assertEqual(body["secret_token"], "s3cret")

    def test_only_the_shapes_the_handler_reads_are_requested(self):
        # Messages, and callback_query for the language chooser's buttons.
        # edited_message and the rest stay unrequested: asking for them is
        # asking Telegram to spend deliveries on updates we drop. If a new
        # shape is added to _handle, it must be added HERE too -- this list
        # lives on Telegram's servers and gates delivery entirely.
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            transport.set_webhook("https://site/api/method/x", "s3cret")
        self.assertEqual(
            post.call_args[1]["json"]["allowed_updates"],
            ["message", "callback_query"],
        )

    def test_a_rejection_is_reported_not_raised(self):
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 400
            post.return_value.text = "Bad Request: bad webhook: HTTPS url must be provided"
            self.assertEqual(
                transport.set_webhook("http://site/x", "s3cret"), transport.FAILED
            )

    def test_the_url_is_derived_and_must_be_https(self):
        with patch.object(transport, "get_url", return_value="https://site" + transport.WEBHOOK_PATH):
            self.assertTrue(transport.webhook_url().endswith(transport.WEBHOOK_PATH))
        with patch.object(transport, "get_url", return_value="http://localhost:8000/x"):
            with self.assertRaises(Exception):
                transport.webhook_url()

    def test_setup_does_all_three_pieces_of_telegram_side_state(self):
        # Where to deliver updates (and which shapes), what the menu button
        # opens, and the command menu. None of them lives in this site and no
        # deploy can touch any of them -- which is why setup must be re-run
        # after a deploy that changes what the webhook handles.
        with patch("dewey_time.attendance_engine.hr_calendar._require_hr_role"), \
             patch.object(transport, "webhook_url", return_value="https://site/hook"), \
             patch.object(transport, "miniapp_url", return_value="https://site/hr-me"), \
             patch.object(transport, "webhook_secret", return_value="s3cret"), \
             patch.object(transport, "set_webhook", return_value=transport.SENT) as hook, \
             patch.object(transport, "set_default_menu_button",
                          return_value=transport.SENT) as menu, \
             patch.object(transport, "set_bot_commands",
                          return_value=transport.SENT) as commands:
            result = transport.setup_telegram()

        hook.assert_called_once_with("https://site/hook", "s3cret")
        menu.assert_called_once_with("https://site/hr-me")
        commands.assert_called_once_with()
        self.assertEqual(result["webhook"]["status"], transport.SENT)
        self.assertEqual(result["menu_button"]["status"], transport.SENT)
        self.assertEqual(result["commands"]["status"], transport.SENT)

    def test_the_command_menu_lists_language_bilingually(self):
        # /language is the only persistent route back to the chooser once it
        # scrolls away; its menu entry must be readable before the choice it
        # exists to change has been made.
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            self.assertEqual(transport.set_bot_commands(), transport.SENT)

        self.assertIn("setMyCommands", post.call_args[0][0])
        commands = post.call_args[1]["json"]["commands"]
        language = [c for c in commands if c["command"] == "language"]
        self.assertEqual(len(language), 1)
        self.assertIn("ភាសា", language[0]["description"])
        self.assertIn("Language", language[0]["description"])
        # /start stays unlisted: it is the deep-link carrier, and the people
        # who should send it arrive holding a link that sends it for them.
        self.assertNotIn("start", [c["command"] for c in commands])

    def test_a_commands_rejection_is_reported_not_raised(self):
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.frappe, "log_error"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 400
            post.return_value.text = "Bad Request"
            self.assertEqual(transport.set_bot_commands(), transport.FAILED)


class TestGatesRefuseToGuessAboutAnUnknownEmployee(unittest.TestCase):
    """A typo used to come back looking like a real, blocked employee.

    `_link_for` finds no link for a name that cannot have one, and
    `phase_for_employee` resolves no branch and falls back to the site-wide
    phase -- so an id that does not exist returned `employee_linked: false`
    and a plausible `PRELAUNCH`. That is indistinguishable from a genuine
    employee whose branch is gated, and it sent a real diagnosis down the
    wrong path.
    """

    def test_an_unknown_id_says_so_instead_of_answering(self):
        from dewey_time.telegram import notify

        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify.frappe.db, "count", return_value=2), \
             patch.object(notify.rollout, "phases_configured", return_value=True), \
             patch.object(notify.frappe.db, "exists", return_value=False), \
             patch.object(notify.rollout, "phase_for_employee",
                          side_effect=AssertionError("must not be asked")):
            gates = notify.delivery_gates("HR-EMP-1168")

        self.assertFalse(gates["employee_exists"])
        # The two fields that previously looked like an answer are simply absent.
        self.assertNotIn("employee_linked", gates)
        self.assertNotIn("employee_phase", gates)

    def test_a_real_employee_is_still_answered_in_full(self):
        from dewey_time.telegram import notify

        with patch.object(notify.transport, "telegram_enabled", return_value=True), \
             patch.object(notify.frappe.db, "count", return_value=2), \
             patch.object(notify.rollout, "phases_configured", return_value=True), \
             patch.object(notify.frappe.db, "exists", return_value="DI-1221"), \
             patch.object(notify.rollout, "phase_for_employee", return_value="LIVE"), \
             patch.object(notify, "_link_for", return_value={"chat_id": "1", "name": "L"}):
            gates = notify.delivery_gates("DI-1221")

        self.assertTrue(gates["employee_exists"])
        self.assertTrue(gates["employee_linked"])
        self.assertEqual(gates["employee_phase"], "LIVE")


#: A token shaped exactly like a real one. The digits before the colon are the
#: bot id and the rest is base64url, which is what makes a naive "split on
#: whitespace" scrub miss it -- it contains no whitespace and looks like a path
#: segment.
FAKE_TOKEN = "7123456789:AAHfakeTokenValue_that-must-never-leak"


class TestTheBotTokenNeverLeavesThisModule(unittest.TestCase):
    """The token is in every Bot API URL, and requests reports the URL it failed on.

    These tests exist because the leak needs no attacker: a DNS blip is enough,
    and it lands in the two places chosen for wide readability -- the
    diagnostics response body and the Error Log, which persists into backups.
    """

    def _connection_error(self):
        # The real shape: requests embeds the full URL, token and all.
        return OSError(
            "HTTPSConnectionPool(host='api.telegram.org', port=443): Max retries "
            f"exceeded with url: /bot{FAKE_TOKEN}/getMe (Caused by NameResolutionError)"
        )

    def test_scrub_removes_the_token_and_keeps_the_error(self):
        scrubbed = transport.scrub_token(self._connection_error())
        self.assertNotIn(FAKE_TOKEN, scrubbed)
        self.assertNotIn("AAHfakeTokenValue", scrubbed)
        # An error with its cause stripped out is why nobody would notice this
        # was here, so the diagnosis itself must survive intact.
        self.assertIn("NameResolutionError", scrubbed)
        self.assertIn("api.telegram.org", scrubbed)

    def test_scrub_leaves_a_message_without_a_token_alone(self):
        self.assertEqual(transport.scrub_token("status=502 body=bad gateway"),
                         "status=502 body=bad gateway")

    def test_an_unreachable_api_does_not_return_the_token_to_the_caller(self):
        # _get is what diagnostics() puts straight into its HTTP response body.
        with patch.object(transport, "bot_token", return_value=FAKE_TOKEN), \
             patch.object(transport.requests, "get", side_effect=self._connection_error()):
            result = transport._get("getMe")

        self.assertFalse(result["ok"])
        self.assertNotIn(FAKE_TOKEN, result["error"])
        self.assertIn("NameResolutionError", result["error"])

    def test_diagnostics_cannot_hand_an_hr_user_the_token(self):
        # The whole report, serialised the way the HTTP layer would send it.
        import json

        with patch.object(transport, "_require_hr_role", create=True), \
             patch("dewey_time.attendance_engine.hr_calendar._require_hr_role"), \
             patch.object(transport, "_secret", return_value=FAKE_TOKEN), \
             patch.object(transport, "telegram_enabled", return_value=True), \
             patch.object(transport, "miniapp_url", return_value="https://s/hr-me"), \
             patch.object(transport.frappe, "get_cached_value", return_value=""), \
             patch.object(transport, "bot_token", return_value=FAKE_TOKEN), \
             patch.object(transport.requests, "get", side_effect=self._connection_error()):
            report = transport.diagnostics()

        self.assertNotIn(FAKE_TOKEN, json.dumps(report, default=str))

    def test_a_failed_send_does_not_write_the_token_to_the_error_log(self):
        logged = {}

        def capture(title=None, message=None, **kw):
            logged["message"] = message

        with patch.object(transport, "bot_token", return_value=FAKE_TOKEN), \
             patch.object(transport.requests, "post", side_effect=self._connection_error()), \
             patch.object(transport.frappe, "get_traceback",
                          return_value=f"Traceback:\n  url: /bot{FAKE_TOKEN}/sendMessage"), \
             patch.object(transport.frappe, "log_error", side_effect=capture):
            self.assertEqual(transport.send_message("55501", "hi"), transport.FAILED)

        self.assertNotIn(FAKE_TOKEN, logged["message"])
        self.assertIn("Traceback", logged["message"])

    def test_a_failed_webhook_registration_does_not_log_the_token(self):
        logged = {}

        with patch.object(transport, "bot_token", return_value=FAKE_TOKEN), \
             patch.object(transport.requests, "post", side_effect=self._connection_error()), \
             patch.object(transport.frappe, "get_traceback",
                          return_value=f"url: /bot{FAKE_TOKEN}/setWebhook"), \
             patch.object(transport.frappe, "log_error",
                          side_effect=lambda title=None, message=None, **kw: logged.update(m=message)):
            self.assertEqual(transport.set_webhook("https://s/hook", "sec"), transport.FAILED)

        self.assertNotIn(FAKE_TOKEN, logged["m"])
