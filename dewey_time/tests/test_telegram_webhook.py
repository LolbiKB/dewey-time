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
        # The happy path now sends via the web-app button, so both senders are
        # patched: leaving either real would fire an actual HTTP request.
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001") as redeem, \
             patch.object(webhook.transport, "miniapp_url",
                          return_value="https://site/hr-me"), \
             patch.object(webhook.transport,
                          "send_message_with_webapp_button") as button, \
             patch.object(webhook.transport, "send_message"):
            webhook._handle(_update(text="/start abc123"))

        self.assertEqual(redeem.call_args[0][0], "abc123")
        # The Telegram user id must come off the update, not the message text.
        self.assertEqual(redeem.call_args[0][1], "55501")
        self.assertIn("linked", button.call_args[0][1].lower())

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
             patch.object(webhook.transport, "miniapp_url", return_value="https://x/hr-me"), \
             patch.object(webhook.transport, "send_message_with_webapp_button") as button:
            webhook._handle(_update(text="/start"))
        redeem.assert_not_called(), "a bare /start has no token to redeem"
        self.assertEqual(claim.call_args[0][0], "55501", "the id comes off the update")
        self.assertEqual(claim.call_args[0][1], "77702")
        self.assertIn("linked", button.call_args[0][1].lower())

    def test_a_token_start_never_takes_the_recorded_id_path(self):
        # The two paths must not blur: a token names ONE employee, and falling
        # back to the recorded id would bind a different one than the link HR
        # sent was for.
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001"), \
             patch.object(webhook.binding, "claim_by_recorded_id") as claim, \
             patch.object(webhook.transport, "miniapp_url", return_value="https://x/hr-me"), \
             patch.object(webhook.transport, "send_message_with_webapp_button"):
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


class TestMiniAppButton(unittest.TestCase):
    def test_a_successful_link_offers_the_mini_app(self):
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001"), \
             patch.object(webhook.transport, "miniapp_url",
                          return_value="https://site/hr-me"), \
             patch.object(webhook.transport,
                          "send_message_with_webapp_button") as button:
            webhook._handle(_update(text="/start abc123"))
        self.assertEqual(button.call_args[1]["url"], "https://site/hr-me")

    def test_an_unconfigured_mini_app_url_still_confirms_the_link(self):
        # The binding is already written and the employee IS linked. Failing to
        # offer a button must not read as "linking failed".
        with patch.object(webhook.binding, "redeem_link_token",
                          return_value="HR-EMP-00001"), \
             patch.object(webhook.transport, "miniapp_url",
                          side_effect=Exception("not configured")), \
             patch.object(webhook.transport, "send_message") as send:
            webhook._handle(_update(text="/start abc123"))
        self.assertIn("linked", send.call_args[0][1].lower())

    def test_a_failed_link_offers_no_button(self):
        # Negative control. Without it, moving the button call outside the
        # success path would go unnoticed and hand a launch button to someone
        # whose token was rejected.
        with patch.object(webhook.binding, "redeem_link_token",
                          side_effect=Exception("bad token")), \
             patch.object(webhook.transport, "miniapp_url",
                          return_value="https://site/hr-me"), \
             patch.object(webhook.transport,
                          "send_message_with_webapp_button") as button, \
             patch.object(webhook.transport, "send_message"):
            webhook._handle(_update(text="/start abc123"))
        button.assert_not_called()
