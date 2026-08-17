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

from __future__ import annotations

import frappe
from frappe.utils import get_datetime, getdate, nowdate

from dewey_time.attendance_engine import rollout
from dewey_time.telegram import transport

LINK_DT = "Telegram Link"


#: Khmer first, English under it.
#:
#: BILINGUAL RATHER THAN CHOSEN, and the reason is that there is nothing here
#: worth guessing with. Telegram reports a client language, but that is the
#: language of someone's PHONE, which on this roster is frequently English for
#: people who read Khmer. Employee carries no language field. Guessing wrong
#: sends an unreadable message to the person least able to say so, and this
#: message is two short lines either way.
#:
#: Khmer leads because the English is the line that can be inferred from the
#: numbers beside it, not the other way round.
_VERBS = {
    "IN": ("បានចូល", "Checked in"),
    "OUT": ("បានចេញ", "Checked out"),
}


def compose(log_type: str, punch_time, branch) -> str:
    # Twelve hour, matching the Mini App this message now links into. "17:06"
    # in the notification and "5:06 PM" one tap later is one event described
    # two ways.
    stamp = get_datetime(punch_time).strftime("%-I:%M %p")
    khmer, english = _VERBS["OUT" if str(log_type or "").upper() == "OUT" else "IN"]
    tail = f" · {branch}" if branch else ""
    return f"{khmer} {stamp}{tail}\n{english} {stamp}{tail}"


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

    # PLAIN TEXT, no inline button. The Mini App is reached from the bot's own
    # Main Mini App button and from the chat menu button, both of which are
    # always there; an inline copy on every check-in message was a third route
    # to the same place, repeated several times a day, on the one message that
    # should be glanceable and gone.
    result = transport.send_message(
        link["chat_id"],
        compose(row["log_type"], row["time"], row.get("custom_device_branch")),
    )
    if result == transport.BLOCKED:
        # The user blocked the bot. That is a decision, not a fault -- stop
        # sending rather than retrying forever.
        _disable_link(link["name"])
    return result


def delivery_gates(employee: str | None = None) -> dict:
    """Which of `send_checkin_notification`'s gates are open.

    Every gate above returns a short string into the job log and sends
    nothing, which is right -- a punch must never fail because Telegram is
    off, and being unlinked is the normal state through a rollout. It also
    means "no notification arrived" has four indistinguishable causes, none of
    which surfaces anywhere an employee or HR would look.

    This reports them, in the same order the job checks them, so the answer is
    one call rather than four guesses. Pass an employee to test that person's
    two gates specifically.
    """
    gates: dict = {
        "telegram_enabled": transport.telegram_enabled(),
        "links_enabled": frappe.db.count(LINK_DT, {"enabled": 1}),
        # False means no rollout date is set anywhere, so every employee reads
        # LIVE and this gate cannot be what is stopping delivery.
        "rollout_configured": rollout.phases_configured(),
    }
    if employee:
        link = _link_for(employee)
        gates["employee"] = employee
        gates["employee_linked"] = bool(link)
        gates["employee_phase"] = rollout.phase_for_employee(
            employee=employee, attendance_date=nowdate()
        )
    return gates


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
