"""Check-in/out notifications over Telegram.

Queued, never synchronous: webpush.py already states the rule for this
codebase, and a Telegram outage must never fail a checkin write.

Content is deliberately minimal -- the punch time and the branch. No lateness,
no flags, no judgment. At punch time the engine's determination is provisional
(intraday re-inserts AUTO flags on every checkin), so anything evaluative here
would be both premature and frequently wrong.

RATE LIMITS. Telegram allows roughly 30 messages/second overall and one per
second per chat. Neither is paced explicitly here, deliberately:

- Per-chat is not reachable. One employee produces one message per punch, and
  nobody punches twice in a second in a way that matters.
- Global is bounded incidentally by the `short` queue's worker concurrency --
  each job makes one synchronous POST with a 20s timeout, so a handful of
  workers cannot approach 30/s.

That second one is a happy accident of the deployment, not a designed
guarantee. If worker concurrency is raised, or if notifications are ever sent
in a loop rather than one job per punch, this needs a real token bucket.
Telegram answers 429 with a `retry_after`, so the symptom would be a burst of
FAILED results in the Error Log rather than silent loss.
"""

import frappe
from frappe.utils import get_datetime, getdate

from dewey_time.attendance_engine import rollout
from dewey_time.telegram import transport

LINK_DT = "Telegram Link"


def compose(log_type: str, punch_time, branch) -> str:
    stamp = get_datetime(punch_time).strftime("%H:%M")
    verb = "Checked out" if str(log_type or "").upper() == "OUT" else "Checked in"
    if branch:
        return f"{verb} {stamp} · {branch}"
    return f"{verb} {stamp}"


def _link_for(employee: str):
    return frappe.db.get_value(
        LINK_DT,
        {"employee": employee, "enabled": 1},
        ["name", "chat_id"],
        as_dict=True,
    )


def _checkin(checkin_name: str):
    return frappe.db.get_value(
        "Employee Checkin",
        checkin_name,
        ["log_type", "time", "custom_device_branch"],
        as_dict=True,
    )


def _disable_link(link_name: str) -> None:
    frappe.db.set_value(LINK_DT, link_name, "enabled", 0)


def send_checkin_notification(employee: str, checkin_name: str) -> str:
    """Queued job. Returns a short status string for the job log."""
    if not transport.telegram_enabled():
        return "disabled"

    link = _link_for(employee)
    if not link:
        # Unlinked is the normal state during rollout, not an error.
        return "unlinked"

    row = _checkin(checkin_name)
    if not row:
        return "no-checkin"

    if rollout.phase_for_employee(
        employee=employee, attendance_date=getdate(row["time"])
    ) != rollout.LIVE:
        return "not-live"

    result = transport.send_message(
        link["chat_id"],
        compose(row["log_type"], row["time"], row.get("custom_device_branch")),
    )
    if result == transport.BLOCKED:
        # The user blocked the bot. That is a decision, not a fault -- stop
        # sending rather than retrying forever.
        _disable_link(link["name"])
    return result


def on_employee_checkin_after_insert(doc, method=None):
    employee = (getattr(doc, "employee", "") or "").strip()
    if not employee:
        return

    frappe.enqueue(
        "dewey_time.telegram.notify.send_checkin_notification",
        queue="short",
        job_id=f"dewey_time-tg-notify-{doc.name}"[:140],
        deduplicate=True,
        employee=employee,
        checkin_name=doc.name,
    )
