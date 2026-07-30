"""Tests for bridge webhook authentication.

These pin a real security hole that shipped: `_validate_api_key_auth` used to
return early whenever `frappe.session.user` was not Guest, so any logged-in
user — an ordinary ESS employee with a browser session — passed bridge
authentication without presenting an API key, and could drive
`notify_device_closeout_status` into writing finalized (day_closed=1) flags.

Removing that shortcut made the key-lookup path reachable for the first time,
so the principal pin is tested alongside it: a valid api_key alone proves only
that SOME user issued it, not that the caller is the Bridge.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.attendance_engine import bridge_auth as mod  # noqa: E402

mod.frappe.AuthenticationError = Exception


class _D(dict):
    """Stand-in for frappe._dict: a dict whose keys are also attributes."""

    def __getattr__(self, k):
        try:
            return self[k]
        except KeyError as exc:
            raise AttributeError(k) from exc


class _Throw(Exception):
    pass


def _throw(msg, exc=None):
    raise _Throw(str(msg))


class BridgeAuthTest(unittest.TestCase):
    #: The frappe mock is shared process-wide by every test module, so anything
    #: this class rebinds must be restored — leaking `throw`/`conf`/`session`
    #: broke five unrelated dashboard_auth tests when the suite ran together.
    _PATCHED = ("throw", "_", "get_request_header", "conf", "session")

    def setUp(self):
        self._saved = {
            name: getattr(mod.frappe, name, self._MISSING) for name in self._PATCHED
        }
        self._headers = {}
        self._conf = {}
        mod.frappe.throw = _throw
        mod.frappe._ = lambda s: s
        mod.frappe.get_request_header = lambda k: self._headers.get(k)
        mod.frappe.conf = self._conf
        mod.frappe.session = type("S", (), {"user": "Guest"})()

    def tearDown(self):
        for name, value in self._saved.items():
            if value is self._MISSING:
                try:
                    delattr(mod.frappe, name)
                except AttributeError:
                    pass
            else:
                setattr(mod.frappe, name, value)

    _MISSING = object()

    # ---- the hole ----------------------------------------------------

    def test_a_logged_in_user_cannot_skip_the_api_key(self):
        """The regression that motivated this file.

        A browser session is not a bridge credential. With no Authorization
        header at all, an authenticated session must still be rejected.
        """
        mod.frappe.session.user = "employee@example.com"
        with self.assertRaises(_Throw) as ctx:
            mod.validate_bridge_request()
        self.assertIn("Authorization", str(ctx.exception))

    # ---- the path the fix made reachable ------------------------------

    def test_a_valid_key_from_a_non_bridge_user_is_rejected(self):
        """Removing the session shortcut made the key lookup reachable.

        A valid api_key proves only that some User issued it. Without a
        principal pin, any employee who generated API credentials in Desk
        could call the webhooks.
        """
        self._headers["Authorization"] = "token KEY:SECRET"
        with patch.object(
            mod.frappe.db, "get_value", return_value=_D(name="employee@example.com", api_secret="h")
        ), patch.object(mod, "check_password", return_value=True), patch.object(
            mod.frappe, "get_roles", return_value=["Employee"]
        ):
            with self.assertRaises(_Throw) as ctx:
                mod.validate_bridge_request()
        self.assertIn("not authorised", str(ctx.exception))

    def test_the_bridge_role_admits_the_caller(self):
        self._headers["Authorization"] = "token KEY:SECRET"
        seen = {}
        with patch.object(
            mod.frappe.db, "get_value", return_value=_D(name="bridge@example.com", api_secret="h")
        ), patch.object(mod, "check_password", return_value=True), patch.object(
            mod.frappe, "get_roles", return_value=["Bridge Device"]
        ), patch.object(
            mod.frappe, "set_user", side_effect=lambda u: seen.setdefault("user", u)
        ):
            mod.validate_bridge_request()
        self.assertEqual(seen["user"], "bridge@example.com")

    def test_site_config_bridge_user_pins_an_exact_account(self):
        self._headers["Authorization"] = "token KEY:SECRET"
        self._conf["bridge_user"] = "bridge@example.com"
        with patch.object(
            mod.frappe.db, "get_value", return_value=_D(name="someone-else@example.com", api_secret="h")
        ), patch.object(mod, "check_password", return_value=True):
            with self.assertRaises(_Throw) as ctx:
                mod.validate_bridge_request()
        self.assertIn("not the configured bridge user", str(ctx.exception))

    def test_disabled_users_are_excluded_at_lookup(self):
        """A revoked account must not keep working: enabled=1 is part of the filter."""
        self._headers["Authorization"] = "token KEY:SECRET"
        captured = {}

        def _get_value(doctype, filters, fields, as_dict=False):
            captured["filters"] = filters
            return None

        with patch.object(mod.frappe.db, "get_value", side_effect=_get_value):
            with self.assertRaises(_Throw):
                mod.validate_bridge_request()
        self.assertEqual(captured["filters"].get("enabled"), 1)

    # ---- the secret ---------------------------------------------------

    def test_the_secret_is_enforced_when_configured(self):
        self._headers["Authorization"] = "token KEY:SECRET"
        self._conf["bridge_closeout_secret"] = "s3cret"
        self._headers["X-Bridge-Secret"] = "wrong"
        with patch.object(
            mod.frappe.db, "get_value", return_value=_D(name="bridge@example.com", api_secret="h")
        ), patch.object(mod, "check_password", return_value=True), patch.object(
            mod.frappe, "get_roles", return_value=["Bridge Device"]
        ), patch.object(mod.frappe, "set_user"):
            with self.assertRaises(_Throw) as ctx:
                mod.validate_bridge_request()
        self.assertIn("bridge secret", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
