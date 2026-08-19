"""The publish helpers must never delete the bundle they publish.

REAL DIRECTORIES AND A REAL SYMLINK, deliberately. The defect these tests pin
is a property of the filesystem, not of our code's opinion about it: on a bench
`sites/assets/<app>` is a symlink into the app's own `public/`, so
`sites/assets/<app>/<bundle>` is an ordinary directory that resolves back to the
source. A mocked `os.path` would have to be told that, which is precisely the
assumption that was wrong, so the mock would agree with the bug.
"""

import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

from dewey_time.tests.test_closeout import _install_frappe_mock

_install_frappe_mock()

from dewey_time.utils import (  # noqa: E402
    sync_adms_assets as adms,
    sync_hr_attendance_assets as hr,
    sync_miniapp_assets as miniapp,
)


class _Bench:
    """A throwaway bench laid out the way a real one is.

        apps/dewey_time/dewey_time/public/<bundle>/assets/{index.js,index.css}
        sites/assets/dewey_time -> apps/dewey_time/dewey_time/public   (symlink)
    """

    def __init__(self, bundles):
        self.root = tempfile.mkdtemp()
        self.app_path = os.path.join(self.root, "apps", "dewey_time", "dewey_time")
        self.public = os.path.join(self.app_path, "public")
        for bundle in bundles:
            assets = os.path.join(self.public, bundle, "assets")
            os.makedirs(assets)
            for name in ("index.js", "index.css"):
                with open(os.path.join(assets, name), "w") as handle:
                    handle.write("/* the deployed artifact */")
            with open(os.path.join(assets, "build-id.txt"), "w") as handle:
                handle.write("build-1")

        self.sites_path = os.path.join(self.root, "sites")
        os.makedirs(os.path.join(self.sites_path, "assets"))
        # The link that makes the destination resolve back to the source.
        os.symlink(self.public, os.path.join(self.sites_path, "assets", "dewey_time"))

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)


class TestForceSyncCannotDeleteTheBundle(unittest.TestCase):
    def setUp(self):
        self.bench = _Bench(["miniapp", "adms", "hr_attendance"])
        self.addCleanup(self.bench.close)
        patcher = patch.object(miniapp.frappe, "get_app_path", return_value=self.bench.app_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        for module in (miniapp, adms, hr):
            p1 = patch.object(module.frappe, "get_app_path", return_value=self.bench.app_path)
            p1.start()
            self.addCleanup(p1.stop)
            p2 = patch.object(module.frappe.local, "sites_path", self.bench.sites_path)
            p2.start()
            self.addCleanup(p2.stop)

    def _bundle_files(self, bundle):
        assets = os.path.join(self.bench.public, bundle, "assets")
        return sorted(os.listdir(assets)) if os.path.isdir(assets) else []

    def test_force_sync_miniapp_leaves_the_source_bundle_intact(self):
        # The trigger is an operator running the documented repair helper.
        miniapp.force_sync_miniapp_assets()
        self.assertEqual(
            self._bundle_files("miniapp"), ["build-id.txt", "index.css", "index.js"]
        )

    def test_force_sync_adms_leaves_the_source_bundle_intact(self):
        adms.force_sync_adms_assets()
        self.assertEqual(self._bundle_files("adms"), ["build-id.txt", "index.css", "index.js"])

    def test_force_sync_hr_attendance_leaves_the_source_bundle_intact(self):
        hr.force_sync_hr_attendance_assets()
        self.assertEqual(
            self._bundle_files("hr_attendance"), ["build-id.txt", "index.css", "index.js"]
        )

    def test_the_ordinary_sync_also_leaves_it_intact(self):
        # Not just the force helper: the normal path calls _remove_dest too, and
        # is protected only incidentally by a build-id match.
        miniapp.sync_miniapp_assets()
        self.assertEqual(
            self._bundle_files("miniapp"), ["build-id.txt", "index.css", "index.js"]
        )

    def test_the_guard_recognises_the_resolved_destination(self):
        src = os.path.join(self.bench.public, "miniapp")
        dest = os.path.join(self.bench.sites_path, "assets", "dewey_time", "miniapp")
        # The destination is NOT itself a symlink -- which is exactly why the
        # existing leaf check let rmtree through.
        self.assertFalse(os.path.islink(dest))
        self.assertTrue(os.path.isdir(dest))
        self.assertTrue(miniapp._dest_is_the_source(src, dest))

    def test_a_genuinely_separate_destination_is_still_published(self):
        # The guard must not turn the helper into a no-op on a normal bench,
        # where sites/assets/<app> is a real directory.
        os.unlink(os.path.join(self.bench.sites_path, "assets", "dewey_time"))
        os.makedirs(os.path.join(self.bench.sites_path, "assets", "dewey_time"))
        miniapp.force_sync_miniapp_assets()
        published = os.path.join(
            self.bench.sites_path, "assets", "dewey_time", "miniapp", "assets", "index.js"
        )
        self.assertTrue(os.path.isfile(published))
        self.assertEqual(
            self._bundle_files("miniapp"), ["build-id.txt", "index.css", "index.js"]
        )
