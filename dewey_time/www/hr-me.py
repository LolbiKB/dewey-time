import frappe
from frappe.utils import get_system_timezone

no_cache = 1


#: Telegram's browser-based web clients (web.telegram.org/k and /a) embed
#: Mini Apps in a REAL iframe -- unlike the mobile apps and Telegram Desktop,
#: which use native webviews. The bench's nginx template stamps
#: `X-Frame-Options: SAMEORIGIN` onto every response (bench
#: config/templates/nginx.conf), which blanks this app there; that header
#: cannot be removed from app code, and emitting a second X-Frame-Options
#: would make things worse (browsers take the most restrictive). What CAN be
#: done app-side is this: `frame-ancestors` is the CSP2 successor, and the
#: spec requires browsers to IGNORE X-Frame-Options when it is present.
FRAME_ANCESTORS = "frame-ancestors 'self' https://web.telegram.org"


def get_context(context):
    csrf_token = frappe.sessions.get_csrf_token()
    frappe.db.commit()

    # frappe.local.response_headers is v16's per-request custom-header
    # channel, merged into the final response in frappe/app.py. Guarded so a
    # framework that dropped it degrades to the pre-fix state (blank on web
    # clients) instead of 500ing every /hr-me launch.
    headers = getattr(frappe.local, "response_headers", None)
    if headers is not None:
        headers.set("Content-Security-Policy", FRAME_ANCESTORS)

    context.update({"csrf_token": csrf_token, "boot": get_boot()})
    return context


def get_boot():
    return frappe._dict(
        {
            "frappe_version": frappe.__version__,
            "site_name": frappe.local.site,
            "read_only_mode": frappe.flags.read_only,
            "system_timezone": get_system_timezone(),
        }
    )
