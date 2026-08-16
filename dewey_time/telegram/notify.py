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

#: Worded identically to the webhook's button, because it opens the same place.
#: Two names for one destination is two things to learn.
OPEN_BUTTON_TEXT = "Open my attendance"

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


def _send_with_app_button(chat_id, text: str) -> str:
    """The check-in message, carrying an inline button into the Mini App.

    This is the message an employee actually receives — several times a day,
    every working day — and until now it was plain text with no way onward.
    The only inline button the bot ever sent was on the one-off link
    confirmation, which scrolls out of the chat and never comes back. So the
    app sat behind the menu button, which is discoverable only if you already
    know it is there.

    Falls back to a plain message on ANY failure of the button path, and the
    fallback matters more than the button: the notification is the product
    here, and an unset Mini App URL or an older client must cost the employee a
    convenience, never the message itself.
    """
    try:
        return transport.send_message_with_webapp_button(
            chat_id,
            text,
            button_text=OPEN_BUTTON_TEXT,
            url=transport.miniapp_url(),
        )
    except Exception:
        frappe.log_error(
            title="Telegram check-in button unavailable", message=frappe.get_traceback()
        )
        return transport.send_message(chat_id, text)


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

    result = _send_with_app_button(
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
