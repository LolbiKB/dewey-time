"""Publish a built bundle into sites/assets/ without a half-copied window.

The sync helpers used to `shutil.copytree(src, dest)` straight into place, and
the freshness sentinel (`assets/build-id.txt`) travelled as ordinary payload.
`copytree` walks in directory order, so an interrupted copy — a killed
migrate, a full disk, a deploy restart — could land the sentinel and the two
`index.*` files and die before the fonts. The next `_needs_resync` then read a
matching build id over a complete-looking skeleton and certified a bundle that
was never fully copied, and no later migrate would ever retry it.

So the copy goes to a sibling temp directory and moves into place with one
`os.rename`, which is atomic on the same filesystem (and sites/assets is one
filesystem — the temp is created beside the destination for exactly that
reason). Either the whole bundle appears under the destination name or none
of it does; the sentinel can no longer certify a partial tree because a
partial tree can never be at the destination path.

Deliberately frappe-free so it can be tested as a plain function against a
real filesystem, the same policy as test_asset_sync_symlink_safety.py: the
failure class lives in the filesystem, and a mock would agree with the bug.
"""

from __future__ import annotations

import os
import shutil

#: Temp directories are `<dest>.publishing-<pid>`. The suffix is swept on the
#: next publish, so a crashed run's leftovers cannot accumulate.
TMP_SUFFIX = ".publishing"


def _sweep_stale_tmp(dest_dir: str) -> None:
    parent = os.path.dirname(dest_dir)
    marker = os.path.basename(dest_dir) + TMP_SUFFIX + "-"
    if not os.path.isdir(parent):
        return
    for name in os.listdir(parent):
        if name.startswith(marker):
            shutil.rmtree(os.path.join(parent, name), ignore_errors=True)


def publish_tree(src_dir: str, dest_dir: str, ignore=None) -> None:
    """Copy `src_dir` to `dest_dir` all-or-nothing.

    The caller has already removed any previous destination (and bailed if it
    could not); this function's contract is only that `dest_dir` never exists
    half-copied. If the rename loses a race to something that re-created the
    destination, the temp is cleaned up and the error propagates — a migrate
    that cannot publish should say so, not certify silence.
    """
    _sweep_stale_tmp(dest_dir)
    tmp_dir = f"{dest_dir}{TMP_SUFFIX}-{os.getpid()}"
    shutil.rmtree(tmp_dir, ignore_errors=True)
    try:
        shutil.copytree(src_dir, tmp_dir, ignore=ignore)
        os.rename(tmp_dir, dest_dir)
    except BaseException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
