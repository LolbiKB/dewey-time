"""Server-side wiring for /hr-flags: the e2e suite runs against the Vite dev
server's SPA-mode fallback and cannot catch a missing Frappe website route
rule or a missing www/ entry — a bare page load (or refresh, or bookmark) of
/hr-flags against a real site 404s without these. Pinned here instead.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

if "requests" not in sys.modules:
    _requests_stub = MagicMock(name="requests")

    class _RequestException(Exception):
        pass

    _requests_stub.RequestException = _RequestException
    sys.modules["requests"] = _requests_stub

import dewey_time.hooks as hooks  # noqa: E402

# Resolved from __file__, never the CWD — bench run-tests runs from the bench
# directory, not this repo. hooks.py and www/ are siblings under dewey_time/.
_APP_ROOT = os.path.dirname(os.path.abspath(hooks.__file__))


class HrFlagsRouteWiringTests(unittest.TestCase):
    def test_website_route_rules_cover_both_hr_flags_forms(self):
        rules = hooks.website_route_rules
        self.assertIn(
            {"from_route": "/hr-flags/<path:app_path>", "to_route": "hr-flags"},
            rules,
        )
        self.assertIn({"from_route": "/hr-flags", "to_route": "hr-flags"}, rules)

    def test_hr_flags_www_entry_exists_on_disk(self):
        www_dir = os.path.join(_APP_ROOT, "www")
        self.assertTrue(
            os.path.isfile(os.path.join(www_dir, "hr-flags.py")),
            "expected dewey_time/www/hr-flags.py",
        )
        self.assertTrue(
            os.path.isfile(os.path.join(www_dir, "hr-flags.html")),
            "expected dewey_time/www/hr-flags.html (emitted by the frontend build)",
        )

    def test_hr_flags_py_matches_the_existing_sibling_entries_byte_for_byte(self):
        www_dir = os.path.join(_APP_ROOT, "www")
        with open(os.path.join(www_dir, "hr-attendance.py")) as f:
            attendance_py = f.read()
        with open(os.path.join(www_dir, "hr-flags.py")) as f:
            flags_py = f.read()
        self.assertEqual(
            flags_py,
            attendance_py,
            "www/hr-flags.py should mirror www/hr-attendance.py exactly, like "
            "www/hr-schedule.py already does",
        )


if __name__ == "__main__":
    unittest.main()
