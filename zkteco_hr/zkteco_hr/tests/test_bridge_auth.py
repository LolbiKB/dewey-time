"""Auth tests for the Bridge webhook gate (validate_bridge_request).

The Bridge webhooks (notify_device_closeout_status, notify_device_sync_status)
are allow_guest=True machine endpoints. They must authenticate the caller with
the Bridge API key (Authorization: token key:secret) regardless of any ambient
browser session — otherwise any logged-in user could drive device closeout/sync.

The shared Frappe mock's `throw` / `AuthenticationError` are reassigned by other
test modules, so this case owns them in setUp/tearDown rather than relying on
import-time state.
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from zkteco_hr.attendance_engine import bridge_auth as mod  # noqa: E402


class _AuthError(Exception):
    pass


def _throw(msg, exc=None, *args, **kwargs):
    raise (exc or Exception)(msg)


def _headers(mapping):
    return lambda name: mapping.get(name)


class TestValidateBridgeRequest(unittest.TestCase):
    def setUp(self):
        self._auth_err = mod.frappe.AuthenticationError
        self._throw = mod.frappe.throw
        mod.frappe.AuthenticationError = _AuthError
        mod.frappe.throw = _throw

    def tearDown(self):
        mod.frappe.AuthenticationError = self._auth_err
        mod.frappe.throw = self._throw

    def test_rejects_logged_in_user_without_api_key(self):
        """A non-Guest session with no Authorization header must NOT pass."""
        with patch.object(mod.frappe.session, "user", "employee@example.com"), patch.object(
            mod.frappe, "get_request_header", return_value=None
        ), patch.object(mod.frappe.conf, "get", return_value=None):
            with self.assertRaises(_AuthError):
                mod.validate_bridge_request()

    def test_authenticates_valid_api_token(self):
        user_row = SimpleNamespace(name="bridge@bot", api_secret="hashed")
        with patch.object(mod.frappe.session, "user", "Guest"), patch.object(
            mod.frappe, "get_request_header", side_effect=_headers({"Authorization": "token KEY:SECRET"})
        ), patch.object(mod.frappe.db, "get_value", return_value=user_row), patch.object(
            mod, "check_password", return_value=True
        ), patch.object(mod.frappe.conf, "get", return_value=None), patch.object(
            mod.frappe, "set_user"
        ) as set_user:
            mod.validate_bridge_request()
        set_user.assert_called_once_with("bridge@bot")

    def test_rejects_invalid_api_secret(self):
        user_row = SimpleNamespace(name="bridge@bot", api_secret="hashed")
        with patch.object(mod.frappe.session, "user", "Guest"), patch.object(
            mod.frappe, "get_request_header", side_effect=_headers({"Authorization": "token KEY:WRONG"})
        ), patch.object(mod.frappe.db, "get_value", return_value=user_row), patch.object(
            mod, "check_password", return_value=False
        ), patch.object(mod.frappe.conf, "get", return_value=None):
            with self.assertRaises(_AuthError):
                mod.validate_bridge_request()

    def test_rejects_wrong_bridge_secret_even_with_valid_token(self):
        user_row = SimpleNamespace(name="bridge@bot", api_secret="hashed")
        headers = _headers({"Authorization": "token KEY:SECRET", "X-Bridge-Secret": "WRONG"})
        with patch.object(mod.frappe.session, "user", "Guest"), patch.object(
            mod.frappe, "get_request_header", side_effect=headers
        ), patch.object(mod.frappe.db, "get_value", return_value=user_row), patch.object(
            mod, "check_password", return_value=True
        ), patch.object(mod.frappe.conf, "get", return_value="EXPECTED-SECRET"):
            with self.assertRaises(_AuthError):
                mod.validate_bridge_request()


if __name__ == "__main__":
    unittest.main()
