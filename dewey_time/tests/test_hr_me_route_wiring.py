import os
import unittest

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TestHrMeRouteWiring(unittest.TestCase):
    def test_the_page_controller_exists(self):
        self.assertTrue(os.path.isfile(os.path.join(APP_ROOT, "www", "hr-me.py")))

    def test_the_route_rules_cover_the_spa_path(self):
        # Without a <path:app_path> rule a reload inside the Telegram webview
        # 404s, which reads to an employee as "the app is broken".
        with open(os.path.join(APP_ROOT, "hooks.py"), encoding="utf-8") as handle:
            hooks = handle.read()
        self.assertIn('"from_route": "/hr-me"', hooks)
        self.assertIn('"from_route": "/hr-me/<path:app_path>"', hooks)

    def test_the_asset_sync_runs_after_migrate(self):
        # Frappe Cloud never builds these SPAs, so the committed bundle has to
        # be republished into sites/assets on every migrate or the page 404s.
        with open(os.path.join(APP_ROOT, "hooks.py"), encoding="utf-8") as handle:
            hooks = handle.read()
        self.assertIn("sync_miniapp_assets", hooks)


class TestBundlesAreBuiltTogether(unittest.TestCase):
    def test_the_main_build_also_builds_the_mini_app(self):
        # The two bundles share src/, and BOTH are committed artifacts that
        # Frappe Cloud never rebuilds. Before this, changing a shared
        # component (DayCell, PlannedWeekCanvas, anything in lib/) and running
        # `npm run build` rebuilt only the HR console -- shipping a Mini App
        # bundle silently stale against the source it was built from, with no
        # error anywhere.
        import json

        pkg = os.path.join(
            os.path.dirname(APP_ROOT), "dewey_time", "frontend", "hr_attendance",
            "package.json",
        )
        with open(pkg, encoding="utf-8") as handle:
            scripts = json.load(handle)["scripts"]
        self.assertIn("build:miniapp", scripts)
        self.assertIn(
            "build:miniapp",
            scripts["build"],
            "`npm run build` must also build the Mini App, or a shared-component "
            "change ships a stale bundle",
        )


class TestDeployedPagesBustTheirCache(unittest.TestCase):
    """Every committed entry page must version its asset URLs.

    The bundles are immutable per deploy and served from a stable path with
    far-future caching, so an unversioned URL means a client that has ever
    loaded the page keeps the old bundle. `/hr-me` shipped without this and the
    failure mode was the worst possible one: a deploy that verifiably landed,
    the server returning the new bytes, and the app on the phone unchanged with
    nothing anywhere reporting a problem. A Telegram webview caches harder than
    a browser tab and offers no reload.

    Both entries are checked because guarding only one is exactly how the Mini
    App went unguarded while the HR pages were fine.
    """

    PAGES = {
        "hr-me.html": "miniapp",
        "hr-attendance.html": "hr_attendance",
        "hr-flags.html": "hr_attendance",
        "hr-schedule.html": "hr_attendance",
    }

    def test_every_entry_page_versions_its_assets(self):
        import re

        for page, bundle in self.PAGES.items():
            with self.subTest(page=page):
                path = os.path.join(APP_ROOT, "www", page)
                with open(path, encoding="utf-8") as handle:
                    html = handle.read()

                for asset in ("index.js", "index.css"):
                    url = f"/assets/dewey_time/{bundle}/assets/{asset}"
                    self.assertIn(url, html, f"{page} does not reference {asset}")
                    # The version must be ON the reference, not merely present
                    # somewhere in the file.
                    self.assertRegex(
                        html,
                        re.escape(url) + r"\?v=\d+",
                        f"{page} serves {asset} from a permanently cacheable URL",
                    )
