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
            issued = binding.issue_link_token("HR-EMP-00001")
        self.assertLessEqual(len(issued.token), 64)
        self.assertRegex(issued.token, r"^[A-Za-z0-9_-]+$")

    def test_two_tokens_are_never_equal(self):
        with patch.object(binding, "_store_token"):
            a = binding.issue_link_token("HR-EMP-00001")
            b = binding.issue_link_token("HR-EMP-00001")
        self.assertNotEqual(a.token, b.token)

    def test_the_raw_token_is_never_stored(self):
        # Only its SHA-256 goes to the database, so a backup or a support
        # session never hands out a live token.
        with patch.object(binding, "_store_token") as store:
            issued = binding.issue_link_token("HR-EMP-00001")
        stored_hash = store.call_args[1]["token_hash"]
        self.assertNotEqual(stored_hash, issued.token)
        self.assertEqual(stored_hash, binding._hash_token(issued.token))

    def test_link_url_is_a_telegram_deep_link(self):
        self.assertEqual(
            binding.link_url("abc123", "dewey_time_bot"),
            "https://t.me/dewey_time_bot?start=abc123",
        )


class TestTokenRevocation(unittest.TestCase):
    """Re-issuing must REPLACE the live credential, not add a second one.

    Without this, every click left another independently redeemable link alive
    until its own expiry, and nothing anywhere listed them.
    """

    def test_issuing_revokes_the_employees_outstanding_tokens_first(self):
        with patch.object(binding, "_store_token"), \
             patch.object(binding, "revoke_outstanding_tokens") as revoke:
            binding.issue_link_token("HR-EMP-00001")
        revoke.assert_called_once_with("HR-EMP-00001")

    def test_revoking_stamps_every_unredeemed_unrevoked_row(self):
        import frappe

        rows = [{"name": "hash-a"}, {"name": "hash-b"}]
        with patch.object(frappe, "get_all", return_value=rows) as get_all, \
             patch.object(frappe.db, "set_value") as set_value:
            count = binding.revoke_outstanding_tokens("HR-EMP-00001")

        self.assertEqual(count, 2)
        self.assertEqual(set_value.call_count, 2)
        # The filters ARE the behaviour: they are what excludes a token that
        # was already redeemed (stamping that would rewrite history) and one
        # already revoked (a no-op write on every re-issue).
        filters = get_all.call_args[1]["filters"]
        self.assertEqual(filters["employee"], "HR-EMP-00001")
        self.assertEqual(filters["redeemed_at"], ["is", "not set"])
        self.assertEqual(filters["revoked_at"], ["is", "not set"])
        for call in set_value.call_args_list:
            self.assertEqual(call[0][2], "revoked_at")

    def test_revoking_a_blank_employee_queries_nothing(self):
        # A blank filter would match the whole table.
        import frappe

        with patch.object(frappe, "get_all", side_effect=AssertionError("must not query")):
            self.assertEqual(binding.revoke_outstanding_tokens("  "), 0)

    def test_the_issued_expiry_is_the_one_that_was_stored(self):
        # Two now_datetime() reads produced two different expiries: the row
        # said one thing and the response said another.
        with patch.object(binding, "_store_token") as store:
            issued = binding.issue_link_token("HR-EMP-00001")
        self.assertEqual(issued.expires_at, store.call_args[1]["expires_at"])


class TestBotUsernameNormalisation(unittest.TestCase):
    """The @ is how Telegram shows a username and the one thing a deep link
    cannot contain. Everything here is a form somebody can plausibly paste."""

    def test_the_at_form_loses_its_at(self):
        # THE REPORTED BUG. "@deweytimebot" in Settings produced
        # https://t.me/@deweytimebot?start=... -- Telegram: "user not found".
        self.assertEqual(binding.normalise_bot_username("@deweytimebot"), "deweytimebot")

    def test_surrounding_whitespace_goes(self):
        self.assertEqual(binding.normalise_bot_username("  @dewey_time_bot \n"), "dewey_time_bot")

    def test_a_pasted_profile_url_is_reduced_to_the_username(self):
        for pasted in (
            "https://t.me/dewey_time_bot",
            "http://t.me/dewey_time_bot",
            "t.me/dewey_time_bot",
            "https://telegram.me/dewey_time_bot",
            "HTTPS://T.ME/dewey_time_bot",
            "https://t.me/dewey_time_bot/",
            "https://t.me/dewey_time_bot?start=abc",
        ):
            with self.subTest(pasted=pasted):
                self.assertEqual(binding.normalise_bot_username(pasted), "dewey_time_bot")

    def test_an_unset_value_normalises_to_empty_rather_than_none(self):
        # `_bot_username` distinguishes "not configured" from "misconfigured"
        # by emptiness, so None must not arrive there as the string "None".
        self.assertEqual(binding.normalise_bot_username(None), "")
        self.assertEqual(binding.normalise_bot_username("   "), "")


class TestBotUsernameValidation(unittest.TestCase):
    def _configured(self, value):
        return patch.object(binding.frappe, "get_cached_value", return_value=value)

    def test_the_at_form_is_read_out_of_settings_and_cleaned(self):
        with self._configured("@deweytimebot"):
            self.assertEqual(binding._bot_username(), "deweytimebot")

    def test_an_unset_username_is_refused(self):
        with self._configured(""):
            with self.assertRaises(Exception):
                binding._bot_username()

    def test_something_that_cannot_be_a_username_is_refused(self):
        # A space, a dash, or four characters all make a link that resolves to
        # nothing. Failing here beats failing in the employee's chat a week
        # later with the token already spent.
        for bad in ("dewey time bot", "dewey-time-bot", "bot", "a" * 33, "dewey.time.bot"):
            with self.subTest(bad=bad), self._configured(bad):
                with self.assertRaises(Exception):
                    binding._bot_username()


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


class TestClaimByRecordedId(unittest.TestCase):
    """The no-token path, and every way it must refuse rather than guess.

    Each refusal is asserted as `_create_link` NOT being called, not merely as
    "something raised". A guard that raises for the wrong reason -- or a mock
    that raises before the guard is reached -- would satisfy assertRaises alone
    while writing no link, and a guard that was deleted would raise nothing and
    write one. Only the write tells the two apart.
    """

    def _claim(self, *, existing=None, matches=(), bound_elsewhere=False):
        with patch.object(binding, "_existing_link", return_value=existing), \
             patch.object(binding, "_employees_with_recorded_id", return_value=list(matches)), \
             patch.object(binding, "_employee_bound_elsewhere", return_value=bound_elsewhere), \
             patch.object(binding, "_create_link") as create:
            try:
                employee = binding.claim_by_recorded_id("55501", "77702")
            except Exception:
                return None, create
            return employee, create

    def test_one_active_match_binds(self):
        employee, create = self._claim(matches=["HR-EMP-00001"])
        self.assertEqual(employee, "HR-EMP-00001")
        self.assertEqual(create.call_args[1]["employee"], "HR-EMP-00001")
        self.assertEqual(create.call_args[1]["telegram_user_id"], "55501")
        self.assertEqual(create.call_args[1]["chat_id"], "77702")

    def test_a_binding_records_how_it_was_made(self):
        # `linked_via` is what lets HR tell an auto-bind from a link they sent
        # when they come to audit one. Defaulting it to "token" would make the
        # 35 indistinguishable from everyone else.
        _, create = self._claim(matches=["HR-EMP-00001"])
        self.assertEqual(create.call_args[1]["linked_via"], "recorded_id")

    def test_no_match_refuses(self):
        employee, create = self._claim(matches=[])
        self.assertIsNone(employee)
        create.assert_not_called()

    def test_two_employees_sharing_an_id_refuses_rather_than_picking(self):
        # The column has no unique constraint -- verified on production, where
        # `unique` is 0 -- so a duplicated id is possible, and there is no safe
        # way to choose. Picking the first would hand one employee's whole
        # attendance history to the other.
        employee, create = self._claim(matches=["HR-EMP-00001", "HR-EMP-00002"])
        self.assertIsNone(employee)
        create.assert_not_called()

    def test_an_existing_enabled_link_is_idempotent(self):
        # Telegram redelivers an update when it does not get a timely 200.
        employee, create = self._claim(
            existing={"name": "55501", "employee": "HR-EMP-00001", "enabled": 1}
        )
        self.assertEqual(employee, "HR-EMP-00001")
        create.assert_not_called()

    def test_a_revoked_link_is_not_silently_restored(self):
        # THE guard that makes revocation mean anything. Without it, disabling
        # a link is undone by the employee reopening the bot -- and revocation
        # is the only lever HR has when a phone is lost or someone leaves.
        employee, create = self._claim(
            existing={"name": "55501", "employee": "HR-EMP-00001", "enabled": 0}
        )
        self.assertIsNone(employee)
        create.assert_not_called()

    def test_a_revoked_link_is_not_bypassed_by_a_recorded_id(self):
        # The same guard, with a live match behind it: the recorded id must not
        # provide a second way in around a revocation.
        employee, create = self._claim(
            existing={"name": "55501", "employee": "HR-EMP-00001", "enabled": 0},
            matches=["HR-EMP-00001"],
        )
        self.assertIsNone(employee)
        create.assert_not_called()

    def test_an_employee_already_bound_to_another_account_refuses(self):
        # Either the recorded id is stale or two accounts claim one person.
        # Both want a human, and neither wants a second reader of their data.
        employee, create = self._claim(matches=["HR-EMP-00001"], bound_elsewhere=True)
        self.assertIsNone(employee)
        create.assert_not_called()

    def test_a_blank_telegram_user_id_refuses(self):
        with patch.object(binding, "_create_link") as create:
            with self.assertRaises(Exception):
                binding.claim_by_recorded_id("", "77702")
        create.assert_not_called()


class TestRecordedIdLookup(unittest.TestCase):
    def test_only_active_employees_are_matched(self):
        # A leaver whose id is still on their record could otherwise walk back
        # in by messaging the bot and keep reading their own attendance.
        import frappe

        captured = {}

        def get_all(_doctype, **kwargs):
            captured.update(kwargs.get("filters") or {})
            return []

        with patch.object(frappe, "get_all", side_effect=get_all), \
             patch.object(frappe.db, "has_column", return_value=True):
            binding._employees_with_recorded_id("55501")

        self.assertEqual(captured.get("status"), "Active")
        self.assertEqual(captured.get(binding.TELEGRAM_ID_FIELD), "55501")

    def test_a_site_without_the_column_matches_nobody_and_asks_nothing(self):
        # CI's bench site has no such column, and selecting it anyway makes
        # get_all raise -- which here would turn every bare /start into a
        # logged traceback.
        import frappe

        with patch.object(frappe, "get_all", side_effect=AssertionError("must not query")), \
             patch.object(frappe.db, "has_column", return_value=False):
            self.assertEqual(binding._employees_with_recorded_id("55501"), [])


class TestInvite(unittest.TestCase):
    def test_invite_requires_hr(self):
        with patch.object(binding, "_require_hr_role",
                          side_effect=Exception("Not permitted")) as gate:
            with self.assertRaises(Exception):
                binding.create_link_invite("HR-EMP-00001")
        gate.assert_called_once()

    def test_invite_returns_a_tappable_url(self):
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "issue_link_token",
                          return_value=binding.IssuedToken("tok123", "2026-08-19 09:00:00")), \
             patch.object(binding, "_bot_username", return_value="dewey_time_bot"):
            invite = binding.create_link_invite("HR-EMP-00001")
        self.assertEqual(invite["url"], "https://t.me/dewey_time_bot?start=tok123")
        self.assertEqual(invite["employee"], "HR-EMP-00001")

    def test_an_invite_link_never_carries_an_at(self):
        # End to end from the setting a person typed to the URL HR copies.
        # The unit test above pins the helper; this pins that the helper is
        # actually on the path -- `link_url(token, _bot_username())` reads the
        # same either way.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "issue_link_token",
                          return_value=binding.IssuedToken("tok123", "2026-08-19 09:00:00")), \
             patch.object(binding.frappe, "get_cached_value", return_value="@deweytimebot"):
            invite = binding.create_link_invite("HR-EMP-00001")
        self.assertEqual(invite["url"], "https://t.me/deweytimebot?start=tok123")
        self.assertNotIn("@", invite["url"])

    def test_a_misconfigured_username_does_not_burn_a_token(self):
        # The token row is written and its 24-hour clock starts on `insert`, so
        # minting before the username is resolved leaves live tokens behind on
        # every failed attempt.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "issue_link_token") as issue, \
             patch.object(binding.frappe, "get_cached_value", return_value="not a username"):
            with self.assertRaises(Exception):
                binding.create_link_invite("HR-EMP-00001")
        issue.assert_not_called()

    def test_invite_refuses_a_blank_employee(self):
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "issue_link_token") as issue:
            with self.assertRaises(Exception):
                binding.create_link_invite("  ")
        issue.assert_not_called()
