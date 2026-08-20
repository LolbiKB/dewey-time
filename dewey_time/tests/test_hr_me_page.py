"""The /hr-me page must tell browsers who may frame it.

Telegram's browser-based web clients embed Mini Apps in a REAL iframe, and the
bench's nginx template stamps `X-Frame-Options: SAMEORIGIN` on every response
-- which blanked the app there, silently, for anyone opening it from
web.telegram.org. The app-side counter is the CSP `frame-ancestors` directive,
which the spec requires browsers to prefer over X-Frame-Options.

The module lives at www/hr-me.py -- a hyphen, so it is loaded here by path the
same way Frappe's website loader does, rather than imported.
"""

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

import frappe  # noqa: E402

# MagicMock auto-creates ordinary attributes but never dunders, and get_boot
# reports the framework version. Pinned here: this suite is its only reader.
frappe.__version__ = "16.0.0-mock"

_spec = importlib.util.spec_from_file_location(
    "dewey_time_www_hr_me", Path(__file__).parent.parent / "www" / "hr-me.py"
)
hr_me = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hr_me)


class _RecordingHeaders:
    def __init__(self):
        self.rows = {}

    def set(self, key, value):
        self.rows[key] = value


class TestHrMeFrameAncestors(unittest.TestCase):
    def _run_get_context(self, local):
        original = frappe.local
        frappe.local = local
        try:
            context = {}
            hr_me.get_context(context)
            return context
        finally:
            frappe.local = original

    def test_the_page_declares_who_may_frame_it(self):
        headers = _RecordingHeaders()
        self._run_get_context(SimpleNamespace(site="test", response_headers=headers))

        csp = headers.rows.get("Content-Security-Policy")
        self.assertIsNotNone(csp, "frame-ancestors must be declared")
        self.assertIn("frame-ancestors", csp)
        # The two ancestors that matter: the site itself, and Telegram's web
        # clients (web.telegram.org/k and /a are one origin). Mobile apps and
        # Telegram Desktop use native webviews and never consult this.
        self.assertIn("'self'", csp)
        self.assertIn("https://web.telegram.org", csp)

    def test_no_app_side_x_frame_options_is_ever_emitted(self):
        # nginx already stamps one; a second X-Frame-Options makes browsers
        # take the MOST restrictive, which would defeat the whole fix.
        headers = _RecordingHeaders()
        self._run_get_context(SimpleNamespace(site="test", response_headers=headers))
        self.assertNotIn("X-Frame-Options", headers.rows)

    def test_a_framework_without_the_channel_degrades_instead_of_500ing(self):
        # Blank-on-web-clients is the pre-fix state; a TypeError on every
        # launch would be strictly worse.
        context = self._run_get_context(SimpleNamespace(site="test"))
        self.assertIn("boot", context)
