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


def compose(direction: str, punch_time, branch) -> str:
    """The message body. `direction` is already resolved to IN or OUT."""
    # Twelve hour, matching the Mini App. "17:06" here and "5:06 PM" one tap
    # later is one event described two ways.
    stamp = get_datetime(punch_time).strftime("%-I:%M %p")
    khmer, english = _VERBS["OUT" if str(direction or "").upper() == "OUT" else "IN"]
    tail = f" · {branch}" if branch else ""
    return f"{khmer} {stamp}{tail}\n{english} {stamp}{tail}"


def direction_of(employee: str, row) -> str:
    """IN or OUT for this punch -- resolved, not assumed.

    `log_type` on Employee Checkin is an OPTIONAL Select and nothing in this
    app writes it; a device that reports only a timestamp leaves it empty on
    every row. This module used to read "anything that is not OUT is an
    arrival", so on such a stream every departure announced itself as
    "Checked in / បានចូល" -- telling someone they had arrived as they walked
    out of the building.

    The Mini App's status chip had the identical bug and is fixed the same
    way, which matters: the message and the app must not describe one punch
    two different ways.

    An explicit label is believed. Without one the punch is PAIRED against
    the day's earlier ones -- the same rule `deriveSegments` uses to draw the
    timeline -- so an odd count is an arrival and an even one a departure.
    Bounded at this punch's own timestamp rather than "today so far", because
    the job runs asynchronously and a later punch must not change what this
    message says.
    """
    explicit = str((row or {}).get("log_type") or "").upper()
    if explicit in ("IN", "OUT"):
        return explicit

    # The date is sliced off the timestamp rather than parsed out of it.
    # `row["time"]` is a datetime from the database or a string from a
    # fixture, and str() renders both as "YYYY-MM-DD HH:MM:SS" -- so the first
    # ten characters are the day, with no parser to disagree about a space
    # versus a T. (getdate() handles both on a real bench; the CI harness's
    # stub does not, and this needed no parse to begin with.)
    day = str(row["time"])[:10]
    so_far = frappe.db.count(
        "Employee Checkin",
        {"employee": employee, "time": ["between", [f"{day} 00:00:00", row["time"]]]},
    )
    return "IN" if int(so_far or 0) % 2 == 1 else "OUT"


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
        compose(direction_of(employee, row), row["time"], row.get("custom_device_branch")),
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


@frappe.whitelist()
def send_test_notification(employee: str | None = None) -> dict:
    """The real check-in message, sent now, ignoring ONLY the rollout phase.

    Rollout exists so a branch can be watched before its employees are told
    anything, and that is right -- but it also means the notification cannot
    be proven until the moment it starts going to everyone. Nobody should
    have to discover a wording or a binding fault on the day they flip a
    branch LIVE.

    So this is the real path, not a mock of it: the same link lookup, the same
    `direction_of`, the same `compose`, the same transport. Only
    `phase_for_employee` is skipped, and the response says so. If this works
    and a punch does not, the difference is the rollout phase and nothing
    else.

    IT DOES NOT DISABLE A BLOCKED LINK. `send_checkin_notification` does,
    correctly -- a person who blocked the bot should stop being written to.
    Doing it from a test would let HR switch off an employee's notifications
    by checking whether they work.

    Returns the text it sent, so the wording can be reviewed from the response
    without a phone in hand -- which is the only way the Khmer gets checked by
    someone who is not holding the linked account.
    """
    from dewey_time.attendance_engine.hr_calendar import (
        _employee_linked_to_user,
        _require_hr_role,
    )

    _require_hr_role()
    employee = (employee or _employee_linked_to_user() or "").strip()
    if not employee:
        frappe.throw(
            "No employee to test with. Pass one explicitly: "
            "?employee=HR-EMP-00042"
        )

    report = {"employee": employee, "rollout_phase_ignored": True}
    if not transport.telegram_enabled():
        return {**report, "result": "disabled"}

    link = _link_for(employee)
    if not link:
        return {**report, "result": "unlinked"}

    # Their most recent punch, whenever it was -- a real row rather than a
    # fabricated time, so `direction_of` is exercised against the same
    # unlabelled stream production has.
    latest = frappe.db.get_value(
        "Employee Checkin",
        {"employee": employee},
        ["name", "log_type", "time", "custom_device_branch"],
        order_by="time desc",
        as_dict=True,
    )
    if not latest:
        return {**report, "result": "no-checkin"}

    text = compose(
        direction_of(employee, latest), latest["time"], latest.get("custom_device_branch")
    )
    return {
        **report,
        "checkin": latest["name"],
        "text": text,
        "result": transport.send_message(link["chat_id"], text),
    }


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
