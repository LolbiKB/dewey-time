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


class TestWebAppButton(unittest.TestCase):
    def test_the_button_carries_a_web_app_url(self):
        with patch.object(transport, "bot_token", return_value="123:ABC"), \
             patch.object(transport.requests, "post") as post:
            post.return_value.status_code = 200
            transport.send_message_with_webapp_button(
                "55501", "You're linked", button_text="Open", url="https://site/hr-me"
            )
        markup = post.call_args[1]["json"]["reply_markup"]
        self.assertEqual(
            markup["inline_keyboard"][0][0]["web_app"]["url"], "https://site/hr-me"
        )


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
