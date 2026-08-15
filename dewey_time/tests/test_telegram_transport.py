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

    def test_an_unset_url_is_refused(self):
        with patch.object(transport.frappe, "get_cached_value", return_value=""):
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
        with patch.object(transport, "miniapp_url", return_value="https://site/hr-me"), \
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
