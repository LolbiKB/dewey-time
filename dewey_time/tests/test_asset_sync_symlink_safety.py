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
    asset_publish,
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


def _certifiable_partial_copy(src_dir, tmp_dir, ignore=None):
    """A copytree that dies AFTER writing everything the freshness checks read.

    This is the worst-case interruption: the sentinel (build-id.txt) and both
    index files land, the fonts never do. Under the old in-place copy this
    exact tree passed `_bundle_ok` AND matched the source build id, so no
    migrate would ever repair it.
    """
    assets = os.path.join(tmp_dir, "assets")
    os.makedirs(assets)
    for name in ("index.js", "index.css"):
        with open(os.path.join(assets, name), "w") as handle:
            handle.write("/* partial */")
    src_build = os.path.join(src_dir, "assets", "build-id.txt")
    shutil.copy2(src_build, os.path.join(assets, "build-id.txt"))
    raise OSError("disk full / killed migrate")


class TestPublishIsAllOrNothing(unittest.TestCase):
    """An interrupted copy must never leave a destination the sentinel certifies.

    Same policy as above: a real bench layout, a real interruption. The bench
    here has a REAL directory at sites/assets/dewey_time (no symlink), because
    the atomicity question only exists when publishing actually copies.
    """

    def setUp(self):
        self.bench = _Bench(["miniapp"])
        self.addCleanup(self.bench.close)
        link = os.path.join(self.bench.sites_path, "assets", "dewey_time")
        os.unlink(link)
        os.makedirs(link)
        for module in (miniapp,):
            p1 = patch.object(module.frappe, "get_app_path", return_value=self.bench.app_path)
            p1.start()
            self.addCleanup(p1.stop)
            p2 = patch.object(module.frappe.local, "sites_path", self.bench.sites_path)
            p2.start()
            self.addCleanup(p2.stop)
        self.dest = os.path.join(self.bench.sites_path, "assets", "dewey_time", "miniapp")

    def test_an_interrupted_copy_certifies_nothing(self):
        # THE DEFECT: copytree walked straight into the destination, so a copy
        # killed after the sentinel landed left a tree the next migrate read
        # as fresh — permanently, because the build ids matched.
        with patch.object(asset_publish.shutil, "copytree", _certifiable_partial_copy):
            with self.assertRaises(OSError):
                miniapp.sync_miniapp_assets()

        # Nothing at the destination name, so the next sync MUST retry.
        self.assertFalse(os.path.lexists(self.dest))
        self.assertTrue(miniapp._needs_resync(os.path.join(self.bench.public, "miniapp"), self.dest))

        # And the retry succeeds once the copy can complete.
        miniapp.sync_miniapp_assets()
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "assets", "index.js")))

    def test_the_interruption_leaves_no_temp_litter(self):
        with patch.object(asset_publish.shutil, "copytree", _certifiable_partial_copy):
            with self.assertRaises(OSError):
                miniapp.sync_miniapp_assets()
        parent = os.path.dirname(self.dest)
        leftovers = [n for n in os.listdir(parent) if asset_publish.TMP_SUFFIX in n]
        self.assertEqual(leftovers, [])

    def test_a_stale_temp_from_a_crashed_run_is_swept(self):
        # A hard kill (SIGKILL, power loss) skips the except-branch cleanup;
        # the NEXT publish must sweep what it finds rather than accumulate.
        stale = f"{self.dest}{asset_publish.TMP_SUFFIX}-99999"
        os.makedirs(os.path.join(stale, "assets"))
        miniapp.sync_miniapp_assets()
        self.assertFalse(os.path.lexists(stale))
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "assets", "index.js")))

    def test_a_successful_publish_is_complete_and_clean(self):
        miniapp.sync_miniapp_assets()
        self.assertEqual(
            sorted(os.listdir(os.path.join(self.dest, "assets"))),
            ["build-id.txt", "index.css", "index.js"],
        )
        parent = os.path.dirname(self.dest)
        self.assertEqual([n for n in os.listdir(parent) if asset_publish.TMP_SUFFIX in n], [])
