"""Tests for the ADMS dashboard token exchange role gate."""

from __future__ import annotations

import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from zkteco_hr.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

# dashboard_auth imports requests at module level; stub it when absent.
if "requests" not in sys.modules:
    requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    requests_stub.RequestException = _RequestException
    sys.modules["requests"] = requests_stub

from zkteco_hr.attendance_engine import dashboard_auth as mod  # noqa: E402

mod.frappe.PermissionError = PermissionError
mod.frappe.AuthenticationError = Exception


def _throw(msg, exc=None, *args, **kwargs):
    raise (exc or Exception)(msg)


def _patched_throw():
    """Own our throw behaviour — the shared frappe mock's throw gets
    reassigned by other test modules, so never rely on it."""
    return patch.object(mod.frappe, "throw", side_effect=_throw)


def _bridge_response(status_code: int, payload: dict | None = None, text: str = ""):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = payload or {}
    response.text = text
    return response


def _exchange(*, user: str, roles: list[str], conf: dict | None = None, response=None):
    conf = conf if conf is not None else {
        "adms_bridge_url": "https://bridge.example",
        "adms_bridge_secret": "s3cret",
    }
    with _patched_throw():
        with patch.object(mod.frappe, "session", SimpleNamespace(user=user)):
            with patch.object(mod.frappe, "get_roles", return_value=roles):
                with patch.object(mod.frappe.conf, "get", side_effect=conf.get):
                    with patch.object(mod.frappe.db, "get_value", return_value=user):
                        with patch.object(
                            mod.requests, "post", return_value=response
                        ) as post:
                            result = mod.get_dashboard_token()
                            return result, post


class TestDashboardTokenRoleGate(unittest.TestCase):
    def test_guest_is_rejected(self):
        with _patched_throw():
            with patch.object(mod.frappe, "session", SimpleNamespace(user="Guest")):
                with self.assertRaises(Exception):
                    mod.get_dashboard_token()

    def test_user_without_allowed_role_is_rejected(self):
        with _patched_throw():
            with patch.object(
                mod.frappe, "session", SimpleNamespace(user="staff@example.com")
            ):
                with patch.object(
                    mod.frappe, "get_roles", return_value=["Employee", "HR User"]
                ):
                    with self.assertRaises(PermissionError):
                        mod.get_dashboard_token()

    def test_adms_admin_role_passes_gate(self):
        result, post = _exchange(
            user="ops@example.com",
            roles=["Employee", "ADMS Admin"],
            response=_bridge_response(
                200,
                {"token": "tok", "expires_in": 900, "email": "ops@example.com", "role": "admin"},
            ),
        )
        self.assertEqual(result["token"], "tok")
        post.assert_called_once()
        # secret travels in the header, never in the result
        self.assertEqual(
            post.call_args.kwargs["headers"]["X-Bridge-Secret"], "s3cret"
        )
        self.assertNotIn("s3cret", str(result))

    def test_system_manager_still_passes_gate(self):
        result, _post = _exchange(
            user="admin@example.com",
            roles=["System Manager"],
            response=_bridge_response(200, {"token": "tok2", "expires_in": 900}),
        )
        self.assertEqual(result["token"], "tok2")

    def test_bridge_403_maps_to_permission_error(self):
        with self.assertRaises(PermissionError):
            _exchange(
                user="ops@example.com",
                roles=["ADMS Admin"],
                response=_bridge_response(403),
            )

    def test_missing_bridge_config_rejected_before_network(self):
        with self.assertRaises(Exception):
            _exchange(user="ops@example.com", roles=["ADMS Admin"], conf={})


class TestAdmsAdminRolePatch(unittest.TestCase):
    def test_creates_role_once(self):
        from zkteco_hr.patches import add_adms_admin_role as patch_mod

        doc = MagicMock()
        with patch.object(patch_mod.frappe.db, "exists", return_value=False):
            with patch.object(
                patch_mod.frappe, "get_doc", return_value=doc
            ) as get_doc:
                patch_mod.execute()
                get_doc.assert_called_once()
                payload = get_doc.call_args.args[0]
                self.assertEqual(payload["role_name"], "ADMS Admin")
                self.assertEqual(payload["desk_access"], 0)
                doc.insert.assert_called_once_with(ignore_permissions=True)

    def test_idempotent_when_role_exists(self):
        from zkteco_hr.patches import add_adms_admin_role as patch_mod

        with patch.object(patch_mod.frappe.db, "exists", return_value=True):
            with patch.object(patch_mod.frappe, "get_doc") as get_doc:
                patch_mod.execute()
                get_doc.assert_not_called()


if __name__ == "__main__":
    unittest.main()
