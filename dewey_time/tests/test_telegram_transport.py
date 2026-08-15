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
