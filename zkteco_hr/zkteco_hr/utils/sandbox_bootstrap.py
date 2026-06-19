"""Sandbox bootstrap: ensure zkteco_hr's custom fields on a sandbox/test bench.

Run via: bench --site <site> execute zkteco_hr.utils.sandbox_bootstrap.run

Reuses the app's canonical custom-field setup (zkteco_hr.setup.custom_fields), so a
schema-light restore gets the same fields a real install/migrate creates. The app now
creates these on after_install/after_migrate too, so this is mostly a safety net for
restores that predate that — and the reference for the frappe-sandbox `bootstrap_method`
hook: any app can point bootstrap_method at its own such setup.
"""
from __future__ import annotations

from zkteco_hr.setup.custom_fields import make_custom_fields


def run() -> str:
    make_custom_fields()
    return "BOOTSTRAP_OK"
