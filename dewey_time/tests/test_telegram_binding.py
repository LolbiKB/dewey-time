import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.telegram import binding  # noqa: E402


class TestTokenShape(unittest.TestCase):
    def test_token_fits_telegrams_start_payload(self):
        # Telegram's deep-link `start` payload allows 64 chars of
        # [A-Za-z0-9_-]. A 32-byte token base64url-encodes to 43.
        with patch.object(binding, "_store_token"):
            token = binding.issue_link_token("HR-EMP-00001")
        self.assertLessEqual(len(token), 64)
        self.assertRegex(token, r"^[A-Za-z0-9_-]+$")

    def test_two_tokens_are_never_equal(self):
        with patch.object(binding, "_store_token"):
            a = binding.issue_link_token("HR-EMP-00001")
            b = binding.issue_link_token("HR-EMP-00001")
        self.assertNotEqual(a, b)

    def test_the_raw_token_is_never_stored(self):
        # Only its SHA-256 goes to the database, so a backup or a support
        # session never hands out a live token.
        with patch.object(binding, "_store_token") as store:
            token = binding.issue_link_token("HR-EMP-00001")
        stored_hash = store.call_args[1]["token_hash"]
        self.assertNotEqual(stored_hash, token)
        self.assertEqual(stored_hash, binding._hash_token(token))

    def test_link_url_is_a_telegram_deep_link(self):
        self.assertEqual(
            binding.link_url("abc123", "dewey_time_bot"),
            "https://t.me/dewey_time_bot?start=abc123",
        )


class TestResolverFailsClosed(unittest.TestCase):
    def test_unknown_telegram_user_raises(self):
        with patch.object(binding.frappe.db, "get_value", return_value=None):
            with self.assertRaises(Exception):
                binding.employee_for_telegram_user("99999")

    def test_disabled_link_raises(self):
        # The filter must include enabled=1. Without it an unlinked person
        # keeps reading their record after HR revokes access.
        with patch.object(binding.frappe.db, "get_value", return_value=None) as gv:
            with self.assertRaises(Exception):
                binding.employee_for_telegram_user("55501")
        self.assertEqual(gv.call_args[0][1]["enabled"], 1)

    def test_resolver_returns_the_employee_id_not_a_boolean(self):
        with patch.object(binding.frappe.db, "get_value", return_value="HR-EMP-00001"):
            self.assertEqual(binding.employee_for_telegram_user("55501"), "HR-EMP-00001")

    def test_blank_telegram_user_id_raises(self):
        with self.assertRaises(Exception):
            binding.employee_for_telegram_user("")


class TestRedeem(unittest.TestCase):
    def _token_doc(self, **overrides):
        doc = {
            "name": "hash",
            "employee": "HR-EMP-00001",
            "expires_at": "2099-01-01 00:00:00",
            "redeemed_at": None,
        }
        doc.update(overrides)
        return doc

    def test_unknown_token_raises(self):
        with patch.object(binding, "_load_token", return_value=None):
            with self.assertRaises(Exception):
                binding.redeem_link_token("nope", "55501", "55501")

    def test_already_redeemed_token_raises(self):
        # _is_expired is pinned False on purpose. Without it, deleting the
        # redeemed_at guard would still "pass" this test -- execution would
        # fall through to the expiry comparison and raise a TypeError under
        # the mock, so the mutation would survive and the test would be
        # protecting nothing.
        with patch.object(binding, "_load_token",
                          return_value=self._token_doc(redeemed_at="2026-08-01 00:00:00")), \
             patch.object(binding, "_is_expired", return_value=False):
            with self.assertRaises(Exception):
                binding.redeem_link_token("tok", "55501", "55501")

    def test_a_telegram_redelivery_is_idempotent_not_an_error(self):
        # Telegram redelivers an update when it does not get a timely 200, so
        # the same /start can arrive twice. Without this the employee is told
        # "that link didn't work" immediately after being told they're linked.
        with patch.object(binding, "_load_token", return_value=self._token_doc(
                redeemed_at="2026-08-01 00:00:00",
                redeemed_by_telegram_user_id="55501")), \
             patch.object(binding, "_create_link") as create:
            employee = binding.redeem_link_token("tok", "55501", "77702")
        self.assertEqual(employee, "HR-EMP-00001")
        create.assert_not_called()

    def test_a_different_account_cannot_reuse_a_redeemed_token(self):
        # The mirror of the case above, and the reason it is scoped to the
        # same account: a used token must stay used for everyone else.
        with patch.object(binding, "_load_token", return_value=self._token_doc(
                redeemed_at="2026-08-01 00:00:00",
                redeemed_by_telegram_user_id="55501")), \
             patch.object(binding, "_is_expired", return_value=False):
            with self.assertRaises(Exception):
                binding.redeem_link_token("tok", "99999", "77702")

    def test_expired_token_raises(self):
        with patch.object(binding, "_load_token",
                          return_value=self._token_doc(expires_at="2000-01-01 00:00:00")), \
             patch.object(binding, "_is_expired", return_value=True):
            with self.assertRaises(Exception):
                binding.redeem_link_token("tok", "55501", "55501")

    def test_valid_token_creates_the_link_and_returns_the_employee(self):
        with patch.object(binding, "_load_token", return_value=self._token_doc()), \
             patch.object(binding, "_is_expired", return_value=False), \
             patch.object(binding, "_create_link") as create, \
             patch.object(binding, "_mark_redeemed"):
            employee = binding.redeem_link_token("tok", "55501", "77702")

        self.assertEqual(employee, "HR-EMP-00001")
        self.assertEqual(create.call_args[1]["employee"], "HR-EMP-00001")
        self.assertEqual(create.call_args[1]["telegram_user_id"], "55501")
        self.assertEqual(create.call_args[1]["chat_id"], "77702")


class TestInvite(unittest.TestCase):
    def test_invite_requires_hr(self):
        with patch.object(binding, "_require_hr_role",
                          side_effect=Exception("Not permitted")) as gate:
            with self.assertRaises(Exception):
                binding.create_link_invite("HR-EMP-00001")
        gate.assert_called_once()

    def test_invite_returns_a_tappable_url(self):
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "issue_link_token", return_value="tok123"), \
             patch.object(binding, "_bot_username", return_value="dewey_time_bot"):
            invite = binding.create_link_invite("HR-EMP-00001")
        self.assertEqual(invite["url"], "https://t.me/dewey_time_bot?start=tok123")
        self.assertEqual(invite["employee"], "HR-EMP-00001")

    def test_invite_refuses_a_blank_employee(self):
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "issue_link_token") as issue:
            with self.assertRaises(Exception):
                binding.create_link_invite("  ")
        issue.assert_not_called()
