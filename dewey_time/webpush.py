"""Web push for the HR attendance PWA.

Inert by default: VAPID keys auto-generate on migrate, but `enable_web_push` stays
OFF until an admin turns it on, and nothing auto-fires a push. When you decide what
event should notify whom, call `send_web_push(email, ...)` from a queued/after-commit
hook (never synchronously inside a doc event).

The service worker privacy-guards on the `recipient` field in the payload, so on a
shared/logged-out device it shows a generic notice instead of another user's details.
"""

import base64
import hashlib
import json

import frappe

SETTINGS = "Dewey Time Settings"
SUB_DT = "Dewey Time Push Subscription"


def subscription_name(endpoint: str) -> str:
    """Deterministic doc name per browser endpoint (idempotent re-subscribe)."""
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()[:40]


# ---------------------------------------------------------------- frontend API

@frappe.whitelist()
def get_vapid_public_key() -> dict:
    s = frappe.get_cached_doc(SETTINGS)
    return {"enabled": bool(s.enable_web_push), "public_key": s.vapid_public_key or ""}


@frappe.whitelist()
def save_push_subscription(subscription) -> dict:
    sub = json.loads(subscription) if isinstance(subscription, str) else subscription
    endpoint = (sub or {}).get("endpoint")
    keys = (sub or {}).get("keys") or {}
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        frappe.throw(frappe._("Invalid push subscription"))
    name = subscription_name(endpoint)
    doc = frappe.get_doc(SUB_DT, name) if frappe.db.exists(SUB_DT, name) else frappe.new_doc(SUB_DT)
    doc.user = frappe.session.user  # re-bind the endpoint to whoever is logged in
    doc.endpoint = endpoint
    doc.p256dh = keys["p256dh"]
    doc.auth = keys["auth"]
    ua = frappe.request.headers.get("User-Agent", "") if getattr(frappe, "request", None) else ""
    doc.user_agent = ua[:140]
    doc.save(ignore_permissions=True)
    return {"ok": True}


@frappe.whitelist()
def delete_push_subscription(endpoint: str) -> dict:
    name = subscription_name(endpoint)
    if frappe.db.exists(SUB_DT, {"name": name, "user": frappe.session.user}):
        frappe.delete_doc(SUB_DT, name, ignore_permissions=True, force=True)
    return {"ok": True}


@frappe.whitelist()
def send_test_push() -> dict:
    """Send a test notification to the current user's own devices — verifies the pipe."""
    send_web_push(
        frappe.session.user,
        title="Dewey Time",
        body="Push notifications are working.",
        url="/hr-attendance",
    )
    return {"ok": True}


@frappe.whitelist()
def get_my_badge_count() -> int:
    """The signed-in user's own recent attendance flags — drives the app icon badge.
    Read-only; 0 when no Employee is linked. The SW refreshes the badge from this."""
    from frappe.utils import add_days, today

    emp = frappe.db.get_value(
        "Employee", {"user_id": frappe.session.user, "status": "Active"}, "name"
    )
    if not emp:
        return 0
    return frappe.db.count(
        "Attendance Flag",
        {"employee": emp, "attendance_date": [">=", add_days(today(), -14)]},
    )


# ---------------------------------------------------------------- send (server)

def send_web_push(email: str, title: str, body: str, url: str) -> None:
    """Best-effort fan-out to a user's devices. Never raises; prunes dead endpoints."""
    s = frappe.get_cached_doc(SETTINGS)
    if not s.enable_web_push:
        return
    private = s.get_password("vapid_private_key", raise_exception=False)
    if not private:
        return

    try:
        from pywebpush import WebPushException, webpush
    except Exception:  # dependency missing — degrade silently
        frappe.log_error("pywebpush not installed", "Web Push")
        return

    site = frappe.local.site
    subject = s.vapid_subject or f"mailto:noreply@{site}"
    payload = json.dumps({"title": title, "body": body, "url": url, "recipient": email})

    for sub in frappe.get_all(
        SUB_DT, filters={"user": email}, fields=["name", "endpoint", "p256dh", "auth"]
    ):
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=private,
                vapid_claims={"sub": subject},
            )
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):  # endpoint gone — prune
                frappe.delete_doc(SUB_DT, sub.name, ignore_permissions=True, force=True)
            else:
                frappe.log_error(f"web push failed: {e}", "Web Push")


# ---------------------------------------------------------------- after_migrate

def ensure_vapid_keys() -> None:
    """Generate a VAPID keypair into Dewey Time Settings if absent. Best-effort —
    never break migrate. Keys are inert until `enable_web_push` is turned on."""
    try:
        if not frappe.db.exists("DocType", SETTINGS):
            return
        s = frappe.get_single(SETTINGS)
        if s.vapid_public_key and s.get_password("vapid_private_key", raise_exception=False):
            return

        from cryptography.hazmat.primitives import serialization
        from py_vapid import Vapid01

        v = Vapid01()
        v.generate_keys()
        raw_pub = v.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        app_server_key = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode("ascii")
        priv_pem = v.private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode("ascii")

        s.vapid_public_key = app_server_key
        s.vapid_private_key = priv_pem
        s.save(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "ensure_vapid_keys")
