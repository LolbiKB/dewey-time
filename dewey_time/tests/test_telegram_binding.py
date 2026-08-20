import unittest
from datetime import datetime
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
        # Two reads now: the link, then the employee's status.
        with patch.object(binding.frappe.db, "get_value",
                          side_effect=["HR-EMP-00001", "Active"]):
            self.assertEqual(binding.employee_for_telegram_user("55501"), "HR-EMP-00001")

    def test_a_leaver_is_refused_even_though_the_link_is_still_enabled(self):
        # Offboarding sets Employee.status and never touches the link row, so
        # without this the credential outlives employment -- and the register
        # that owns Unlink lists only Active employees, so HR cannot even see
        # the person to revoke them.
        with patch.object(binding.frappe.db, "get_value",
                          side_effect=["HR-EMP-00001", "Left"]):
            with self.assertRaises(Exception):
                binding.employee_for_telegram_user("55501")

    def test_the_status_is_read_for_the_employee_the_link_named(self):
        with patch.object(binding.frappe.db, "get_value",
                          side_effect=["HR-EMP-00042", "Active"]) as gv:
            binding.employee_for_telegram_user("55501")
        doctype, name, field = gv.call_args[0]
        self.assertEqual(doctype, "Employee")
        self.assertEqual(name, "HR-EMP-00042")
        self.assertEqual(field, "status")

    def test_any_status_that_is_not_active_is_refused(self):
        # Fails closed on values this app has never heard of, not just "Left".
        for status in ("Inactive", "Suspended", "", None, "active"):
            with self.subTest(status=status):
                with patch.object(binding.frappe.db, "get_value",
                                  side_effect=["HR-EMP-00001", status]):
                    with self.assertRaises(Exception):
                        binding.employee_for_telegram_user("55501")

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
             patch.object(binding, "_employee_bound_elsewhere", return_value=False), \
             patch.object(binding, "_existing_link", return_value=None), \
             patch.object(binding, "_create_link") as create, \
             patch.object(binding, "_mark_redeemed"):
            employee = binding.redeem_link_token("tok", "55501", "77702")

        self.assertEqual(employee, "HR-EMP-00001")
        self.assertEqual(create.call_args[1]["employee"], "HR-EMP-00001")
        self.assertEqual(create.call_args[1]["telegram_user_id"], "55501")
        self.assertEqual(create.call_args[1]["chat_id"], "77702")


class TestRedeemGuards(unittest.TestCase):
    """Every way one employee could end up with two authorised accounts.

    Each refusal asserts that NO write happened, not merely that something
    raised. A guard that raises for the wrong reason -- or a mock that raises
    before the guard is reached -- satisfies assertRaises alone.

    `_is_expired` is pinned False throughout for the reason the existing
    TestRedeem documents: under the frappe mock `get_datetime` is an identity
    passthrough, so a deleted guard would fall through to the expiry
    comparison and raise a TypeError, and the mutation would survive.
    """

    def _token_doc(self, **overrides):
        doc = {
            "name": "hash",
            "employee": "HR-EMP-00001",
            "expires_at": "2099-01-01 00:00:00",
            "redeemed_at": None,
            "revoked_at": None,
        }
        doc.update(overrides)
        return doc

    def _redeem(self, *, token_doc=None, existing=None, bound_elsewhere=False):
        with patch.object(binding, "_load_token",
                          return_value=token_doc or self._token_doc()), \
             patch.object(binding, "_is_expired", return_value=False), \
             patch.object(binding, "_existing_link", return_value=existing), \
             patch.object(binding, "_employee_bound_elsewhere", return_value=bound_elsewhere), \
             patch.object(binding, "_create_link") as create, \
             patch.object(binding, "_revive_link") as revive, \
             patch.object(binding, "_mark_redeemed") as mark:
            try:
                employee = binding.redeem_link_token("tok", "55501", "77702")
            except Exception:
                employee = None
            return employee, create, revive, mark

    def test_a_revoked_token_is_refused(self):
        employee, create, revive, mark = self._redeem(
            token_doc=self._token_doc(revoked_at="2026-08-18 09:00:00"))
        self.assertIsNone(employee)
        create.assert_not_called()
        revive.assert_not_called()
        mark.assert_not_called()

    def test_an_employee_already_bound_to_another_account_refuses(self):
        employee, create, revive, _ = self._redeem(bound_elsewhere=True)
        self.assertIsNone(employee)
        create.assert_not_called()
        revive.assert_not_called()

    def test_the_same_account_already_bound_here_is_idempotent(self):
        # No second row: Telegram Link autonames on telegram_user_id, so
        # _create_link would raise DuplicateEntryError.
        employee, create, revive, mark = self._redeem(
            existing={"name": "55501", "employee": "HR-EMP-00001", "enabled": 1})
        self.assertEqual(employee, "HR-EMP-00001")
        create.assert_not_called()
        revive.assert_not_called()
        mark.assert_called_once()

    def test_an_account_bound_to_a_different_employee_refuses(self):
        employee, create, revive, _ = self._redeem(
            existing={"name": "55501", "employee": "HR-EMP-00002", "enabled": 1})
        self.assertIsNone(employee)
        create.assert_not_called()
        revive.assert_not_called()

    def test_a_disabled_link_is_revived_rather_than_refused(self):
        # The changed-phone case. A Telegram account is keyed to a phone
        # number, so the same account coming back is the ORDINARY shape of
        # unlink -> re-issue, not an edge case.
        employee, create, revive, mark = self._redeem(
            existing={"name": "55501", "employee": "HR-EMP-00002", "enabled": 0})
        self.assertEqual(employee, "HR-EMP-00001")
        create.assert_not_called()
        self.assertEqual(revive.call_args[1]["name"], "55501")
        self.assertEqual(revive.call_args[1]["employee"], "HR-EMP-00001")
        self.assertEqual(revive.call_args[1]["chat_id"], "77702")
        mark.assert_called_once()

    def test_the_bound_elsewhere_guard_runs_before_the_revive(self):
        # Order, not merely presence. Reviving into an employee who already
        # has another live account is the two-accounts-one-employee failure
        # arriving through the back door.
        employee, create, revive, _ = self._redeem(
            existing={"name": "55501", "employee": "HR-EMP-00002", "enabled": 0},
            bound_elsewhere=True)
        self.assertIsNone(employee)
        revive.assert_not_called()
        create.assert_not_called()


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
        # `_live_link_names` is pinned, not inherited. Several test modules
        # replace the shared `frappe.get_all` mock by bare assignment rather
        # than through `patch`, so its default survives into this module under
        # `unittest discover` and an unpinned collaborator decides the result.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=[]), \
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
             patch.object(binding, "_live_link_names", return_value=[]), \
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
             patch.object(binding, "_live_link_names", return_value=[]), \
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


class TestReviveLink(unittest.TestCase):
    def test_reviving_goes_through_the_document_api(self):
        # frappe.db.set_value bypasses controller validation, and
        # TelegramLink.validate is the backstop that refuses a second enabled
        # link for one employee. A revive written with set_value would be the
        # single path in this module that skips it -- and it is the only path
        # that points an EXISTING row at a DIFFERENT employee, so it is the
        # one that most needs the check.
        import frappe

        with patch.object(frappe.db, "set_value") as set_value, \
             patch.object(frappe, "get_doc") as get_doc:
            doc = get_doc.return_value
            binding._revive_link(
                name="55501", employee="HR-EMP-00001", chat_id="77702")

        get_doc.assert_called_once_with(binding.LINK_DT, "55501")
        self.assertEqual(doc.employee, "HR-EMP-00001")
        self.assertEqual(doc.chat_id, "77702")
        self.assertEqual(doc.enabled, 1)
        self.assertEqual(doc.linked_via, "token")
        doc.save.assert_called_once_with(ignore_permissions=True)
        set_value.assert_not_called()


class TestInviteRefusesALinkedEmployee(unittest.TestCase):
    def test_an_already_linked_employee_gets_no_new_link(self):
        # The register hides its control for a linked employee; this is the
        # guard that makes that true rather than cosmetic. A stale tab, or any
        # direct call, would otherwise mint a credential that can bind a
        # second account to someone already bound.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=["55501"]), \
             patch.object(binding, "issue_link_token") as issue:
            with self.assertRaises(Exception):
                binding.create_link_invite("HR-EMP-00001")
        issue.assert_not_called()

    def test_the_invite_reports_a_one_day_window(self):
        # An integer duration, not a datetime string: the browser cannot turn
        # a naive site-local datetime into an instant without knowing the
        # site's timezone, and the countdown needs an instant.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=[]), \
             patch.object(binding, "issue_link_token",
                          return_value=binding.IssuedToken("tok123", "2026-08-19 09:00:00")), \
             patch.object(binding, "_bot_username", return_value="dewey_time_bot"):
            invite = binding.create_link_invite("HR-EMP-00001")
        self.assertEqual(invite["expires_in_seconds"], 86400)
        self.assertEqual(invite["expires_at"], "2026-08-19 09:00:00")


class TestRevokeLink(unittest.TestCase):
    def test_revoking_requires_hr(self):
        with patch.object(binding, "_require_hr_role",
                          side_effect=Exception("Not permitted")) as gate, \
             patch.object(binding, "_live_link_names") as names:
            with self.assertRaises(Exception):
                binding.revoke_link("HR-EMP-00001")
        gate.assert_called_once()
        names.assert_not_called()

    def test_revoking_disables_the_link_and_kills_outstanding_tokens(self):
        import frappe

        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=["55501"]), \
             patch.object(binding, "revoke_outstanding_tokens", return_value=2) as tokens, \
             patch.object(frappe, "get_doc") as get_doc:
            doc = get_doc.return_value
            result = binding.revoke_link("HR-EMP-00001")

        self.assertEqual(result, {
            "employee": "HR-EMP-00001", "unlinked": 1, "tokens_revoked": 2,
        })
        get_doc.assert_called_once_with(binding.LINK_DT, "55501")
        self.assertEqual(doc.enabled, 0)
        tokens.assert_called_once_with("HR-EMP-00001")

    def test_the_unlink_is_written_where_version_history_can_see_it(self):
        # Telegram Link is track_changes:1, and Versions are written by
        # Document.save() -- frappe.db.set_value goes straight to SQL and
        # records nothing. Clearing the checkbox by hand in the desk, the path
        # this endpoint replaces, DOES record who revoked the credential and
        # when. A programmatic unlink that silently stopped doing so would be
        # an audit regression nobody would notice until they needed the trail.
        import frappe

        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=["55501"]), \
             patch.object(binding, "revoke_outstanding_tokens", return_value=0), \
             patch.object(frappe.db, "set_value") as set_value, \
             patch.object(frappe, "get_doc") as get_doc:
            doc = get_doc.return_value
            binding.revoke_link("HR-EMP-00001")

        doc.save.assert_called_once_with(ignore_permissions=True)
        set_value.assert_not_called()

    def test_the_row_is_disabled_never_deleted(self):
        # The row and its version history are the audit trail, and the
        # `enabled` field's own description promises they survive the unlink.
        import frappe

        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=["55501"]), \
             patch.object(binding, "revoke_outstanding_tokens", return_value=0), \
             patch.object(frappe, "get_doc"), \
             patch.object(frappe, "delete_doc", create=True) as delete_doc, \
             patch.object(frappe.db, "delete") as db_delete:
            binding.revoke_link("HR-EMP-00001")
        delete_doc.assert_not_called()
        db_delete.assert_not_called()

    def test_revoking_an_unlinked_employee_is_not_an_error(self):
        # Idempotent on purpose. A second press from a stale tab would
        # otherwise put a red message in front of HR for doing nothing wrong.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names", return_value=[]), \
             patch.object(binding, "revoke_outstanding_tokens", return_value=0):
            result = binding.revoke_link("HR-EMP-00001")
        self.assertEqual(result["unlinked"], 0)

    def test_revoking_refuses_a_blank_employee(self):
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_live_link_names") as names:
            with self.assertRaises(Exception):
                binding.revoke_link("  ")
        names.assert_not_called()



class TestTheTokenWindowIsActuallyEnforced(unittest.TestCase):
    """`_is_expired`, executed rather than patched over.

    Every test that mentioned expiry replaced this function with a stub, so the
    comparison inside it had never run once. The module's own docstring explains
    why that is dangerous here: under the shared frappe mock `get_datetime` is
    the identity function, so a comparison built on it is a STRING comparison
    that looks like a datetime one -- which is also why these tests supply real
    datetimes instead of relying on the mock.
    """

    NOW = datetime(2026, 8, 19, 12, 0, 0)

    def _is_expired(self, expires_at):
        real = lambda v: v if isinstance(v, datetime) else datetime.fromisoformat(str(v))
        with patch.object(binding, "get_datetime", side_effect=real), \
             patch.object(binding, "now_datetime", return_value=self.NOW):
            return binding._is_expired(expires_at)

    def test_a_token_that_expired_an_hour_ago_is_expired(self):
        self.assertTrue(self._is_expired(datetime(2026, 8, 19, 11, 0, 0)))

    def test_a_token_with_an_hour_left_is_not(self):
        self.assertFalse(self._is_expired(datetime(2026, 8, 19, 13, 0, 0)))

    def test_the_boundary_instant_is_not_yet_expired(self):
        self.assertFalse(self._is_expired(self.NOW))

    def test_a_string_timestamp_is_compared_as_a_datetime_not_as_text(self):
        # "2026-08-19 11:00:00" > "2026-08-19 12:00:00" is False as text too,
        # so the discriminating case is one where string and datetime ordering
        # disagree: a single-digit hour sorts after a double-digit one.
        self.assertTrue(self._is_expired("2026-08-19 09:00:00"))
        self.assertFalse(self._is_expired("2026-08-19 13:00:00"))

    def test_the_ttl_the_window_is_built_from_is_twenty_four_hours(self):
        # The mock's add_to_date cannot be trusted to compute a real offset, so
        # this asserts the ARGUMENT rather than the result -- the runbook's
        # printed-invite workflow depends on this number.
        self.assertEqual(binding.DEFAULT_TTL_HOURS, 24)
        with patch.object(binding, "add_to_date", return_value="2026-08-20 12:00:00") as add, \
             patch.object(binding, "now_datetime", return_value=self.NOW), \
             patch.object(binding, "_store_token"), \
             patch.object(binding, "revoke_outstanding_tokens"):
            issued = binding.issue_link_token("HR-EMP-00001")

        self.assertEqual(add.call_args[0][0], self.NOW)
        self.assertEqual(add.call_args[1]["hours"], 24)
        self.assertEqual(issued.expires_at, "2026-08-20 12:00:00")


class TestSetLanguage(unittest.TestCase):
    """The one write a chooser button can cause, and every way it must refuse.

    Refusals assert that `frappe.get_doc` was never reached, not merely that
    something raised -- the pattern every guard class in this file uses, and
    for the same reason: a mock that raises before the guard satisfies
    assertRaises on its own.
    """

    def _link(self, enabled=1):
        return {"name": "55501", "employee": "HR-EMP-00001", "enabled": enabled}

    def test_a_valid_choice_is_saved_and_the_chat_id_returned(self):
        import frappe

        with patch.object(binding, "_existing_link", return_value=self._link()), \
             patch.object(frappe.db, "has_column", return_value=True), \
             patch.object(frappe, "get_doc") as get_doc:
            doc = get_doc.return_value
            doc.chat_id = "77702"
            chat_id = binding.set_language("55501", "en")

        get_doc.assert_called_once_with(binding.LINK_DT, "55501")
        self.assertEqual(doc.language, "en")
        # ignore_permissions: the caller is the Guest-context webhook.
        doc.save.assert_called_once_with(ignore_permissions=True)
        # The chat id comes back so the confirmation can go to the bound chat.
        self.assertEqual(chat_id, "77702")

    def test_the_write_goes_through_the_document_api(self):
        # Same audit rule as revoke_link: the doctype tracks changes, and
        # Versions are written by Document.save() -- db.set_value records
        # nothing, so "when did this switch to English" would be unanswerable.
        import frappe

        with patch.object(binding, "_existing_link", return_value=self._link()), \
             patch.object(frappe.db, "has_column", return_value=True), \
             patch.object(frappe.db, "set_value") as set_value, \
             patch.object(frappe, "get_doc"):
            binding.set_language("55501", "km")
        set_value.assert_not_called()

    def test_a_missing_language_column_refuses_rather_than_lying(self):
        # Deploy without Migrate: with no DocField, doc.save() silently drops
        # the value and the bot would then confirm a change that never
        # persisted. Refusing keeps the press visibly inert instead -- and
        # notify.delivery_gates names the missing column for the investigator.
        import frappe

        with patch.object(binding, "_existing_link", return_value=self._link()), \
             patch.object(frappe.db, "has_column", return_value=False), \
             patch.object(frappe, "get_doc") as get_doc:
            with self.assertRaises(Exception):
                binding.set_language("55501", "en")
        get_doc.assert_not_called()

    def test_a_revoked_link_keeps_its_revocation(self):
        # A revoked account pressing a button on an old chooser message must
        # change nothing -- the same rule that stops a bare /start silently
        # reviving a disabled link.
        import frappe

        with patch.object(binding, "_existing_link",
                          return_value=self._link(enabled=0)), \
             patch.object(frappe, "get_doc") as get_doc:
            with self.assertRaises(Exception):
                binding.set_language("55501", "en")
        get_doc.assert_not_called()

    def test_an_account_that_never_linked_is_refused(self):
        import frappe

        with patch.object(binding, "_existing_link", return_value=None), \
             patch.object(frappe, "get_doc") as get_doc:
            with self.assertRaises(Exception):
                binding.set_language("99999", "en")
        get_doc.assert_not_called()

    def test_only_renderable_languages_are_accepted(self):
        # The value is interpolated into nothing, but a junk write would read
        # as Khmer forever -- a misconfiguration wearing the default. The
        # webhook's allowlist should make these unreachable; this guard is for
        # every OTHER future caller.
        import frappe

        for bad in ("both", "", None, "fr", "EN", "km "):
            with patch.object(binding, "_existing_link") as existing, \
                 patch.object(frappe, "get_doc") as get_doc:
                with self.assertRaises(Exception, msg=f"{bad!r} should be refused"):
                    binding.set_language("55501", bad)
            existing.assert_not_called()
            get_doc.assert_not_called()

    def test_a_blank_telegram_user_id_is_refused(self):
        import frappe

        with patch.object(frappe, "get_doc") as get_doc:
            with self.assertRaises(Exception):
                binding.set_language("  ", "km")
        get_doc.assert_not_called()


class TestCredentialOpsAreSerialised(unittest.TestCase):
    """Issue and revoke take the Employee row lock BEFORE their first read.

    The invariant "at most one live credential per employee" is check-then-act
    across three statements with no schema constraint behind it, so the lock's
    POSITION is the guarantee: taken after the liveness read, it would
    serialise nothing. A mock cannot exercise two racing transactions, so
    these pin the two things a reviewer would otherwise have to re-derive --
    that the lock is asked of the database as SELECT ... FOR UPDATE on the
    Employee row, and that both endpoints take it before reading anything.
    """

    def test_the_lock_is_a_select_for_update_on_the_employee_row(self):
        import frappe

        with patch.object(frappe.db, "get_value") as get_value:
            binding._serialize_credential_ops("HR-EMP-00001")
        get_value.assert_called_once_with(
            "Employee", "HR-EMP-00001", "name", for_update=True
        )

    def test_issuing_locks_before_the_liveness_check_reads(self):
        calls = []
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_serialize_credential_ops",
                          side_effect=lambda e: calls.append("lock")), \
             patch.object(binding, "_live_link_names",
                          side_effect=lambda e: calls.append("read") or []), \
             patch.object(binding, "issue_link_token",
                          return_value=binding.IssuedToken("tok123", "2026-08-19 09:00:00")), \
             patch.object(binding, "_bot_username", return_value="dewey_time_bot"):
            binding.create_link_invite("HR-EMP-00001")
        self.assertEqual(calls, ["lock", "read"])

    def test_revoking_takes_the_same_lock_before_reading(self):
        calls = []
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_serialize_credential_ops",
                          side_effect=lambda e: calls.append("lock")), \
             patch.object(binding, "_live_link_names",
                          side_effect=lambda e: calls.append("read") or []), \
             patch.object(binding, "revoke_outstanding_tokens", return_value=0):
            binding.revoke_link("HR-EMP-00001")
        self.assertEqual(calls, ["lock", "read"])

    def test_a_blank_employee_takes_no_lock(self):
        # The refusal happens before the lock: locking on garbage input would
        # hold a phantom row name open for the transaction for no reason.
        with patch.object(binding, "_require_hr_role"), \
             patch.object(binding, "_serialize_credential_ops") as lock:
            with self.assertRaises(Exception):
                binding.create_link_invite("  ")
        lock.assert_not_called()
