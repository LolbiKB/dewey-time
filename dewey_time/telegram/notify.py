"""Check-in/out notifications over Telegram.

Queued, never synchronous: webpush.py already states the rule for this
codebase, and a Telegram outage must never fail a checkin write.

Content is facts, never verdicts: the punch time and branch, and -- when the
day's punches support one honestly -- a single meaning line (the rostered
shift window on the first arrival, accumulated "so far" time on a cleanly
paired departure). No lateness, no flags, no judgment. At punch time the
engine's determination is provisional (intraday re-inserts AUTO flags on
every checkin), so anything evaluative here would be both premature and
frequently wrong; _meaning_for's docstring records everything the line
refuses to say and why.

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

from datetime import date, timedelta

import frappe
from frappe.utils import get_datetime, nowdate

from dewey_time.attendance_engine import rollout
from dewey_time.attendance_engine.employment_type import is_weekly_schedule_eligible
from dewey_time.attendance_engine.holidays import holiday_by_date_for_company
from dewey_time.attendance_engine.shift_assignment import (
    get_shift_assignment,
    has_assignment_overlapping,
)
from dewey_time.attendance_engine.shift_times import shift_time_to_minutes
from dewey_time.telegram import receipt, transport

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
#:
#: The third entry is the NEUTRAL receipt: the punch was recorded, and which
#: way it went is not claimable (see receipt.py for when that happens). It
#: deliberately shares no word with the other two -- "Recorded" mistaken for
#: "Checked in" is the failure the neutral verb exists to end.
_VERBS = {
    receipt.IN: ("បានចូល", "Checked in"),
    receipt.OUT: ("បានចេញ", "Checked out"),
    receipt.NO_VERB: ("បានកត់ត្រា", "Recorded"),
}


def compose(direction: str, punch_time, branch, meaning: tuple[str, str] | None = None) -> str:
    """The message body. `direction` is IN, OUT, or "" for the neutral receipt.

    `meaning` is an optional (khmer, english) line pair appended AFTER the two
    verb lines -- deliberately after: push previews truncate to the leading
    line, so the meaning line is context for someone who opens the chat,
    never the claim itself. The verb lines must stand alone.
    """
    # Twelve hour, matching the Mini App. "17:06" here and "5:06 PM" one tap
    # later is one event described two ways.
    stamp = get_datetime(punch_time).strftime("%-I:%M %p")
    key = str(direction or "").upper()
    khmer, english = _VERBS[key if key in (receipt.IN, receipt.OUT) else receipt.NO_VERB]
    tail = f" · {branch}" if branch else ""
    lines = [f"{khmer} {stamp}{tail}", f"{english} {stamp}{tail}"]
    if meaning:
        lines.extend(meaning)
    return "\n".join(lines)


def _day_punches_up_to(employee: str, row) -> list[dict]:
    """The day's punch rows, in order, ending at the punch being announced.

    Bounded at `row["time"]` rather than "now", because the job runs
    asynchronously and a later punch must not change what this message says.
    Rows tied on time sort by insertion (`creation`), and anything that sorted
    AFTER the announced punch inside the same second is dropped -- the replay
    must end at the punch it is describing. If the announced row is not in
    the fetched window at all (a stub, a deleted row), the whole window is
    replayed instead: the bound already ends at this punch's time, so a
    missing name costs at most its same-second siblings, and guessing a cut
    would cost more.

    The date is sliced off the timestamp rather than parsed out of it.
    `row["time"]` is a datetime from the database or a string from a fixture,
    and str() renders both as "YYYY-MM-DD HH:MM:SS" -- so the first ten
    characters are the day, with no parser to disagree about a space versus
    a T. (getdate() handles both on a real bench; the CI harness's stub does
    not, and this needed no parse to begin with.)
    """
    day = str(row["time"])[:10]
    rows = (
        frappe.get_all(
            "Employee Checkin",
            filters={
                "employee": employee,
                "time": ["between", [f"{day} 00:00:00", row["time"]]],
            },
            fields=["name", "time", "log_type", "custom_device_branch"],
            order_by="time asc, creation asc",
        )
        or []
    )
    name = (row or {}).get("name")
    if name:
        for i, fetched in enumerate(rows):
            if fetched.get("name") == name:
                return rows[: i + 1]
    return rows


def direction_of(employee: str, row) -> str:
    """IN, OUT, or "" (no claim) for this punch -- resolved, not assumed.

    `log_type` on Employee Checkin is an OPTIONAL Select and nothing in this
    app writes it; a device that reports only a timestamp leaves it empty on
    every row. This module used to read "anything that is not OUT is an
    arrival", so on such a stream every departure announced itself as
    "Checked in / បានចូល" -- telling someone they had arrived as they walked
    out of the building.

    The first rewrite paired the punch against a whole-day COUNT, which was
    still wrong two ways, both live: the count was blind to campus (three
    punches across two sites made the 5pm departure "odd", an arrival) and
    blind to double taps (a second tap seconds after the first inverted every
    later verb that day).

    An explicit label is believed. Without one, the day's punches up to this
    one are replayed under the SAME branch-run pairing the timeline draws
    with -- see receipt.py, which is fixture-locked against the TypeScript
    implementation -- and where that replay cannot honestly call a direction,
    the answer is "" and compose() sends a neutral receipt instead of a
    confident wrong verb.
    """
    explicit = str((row or {}).get("log_type") or "").upper()
    if explicit in (receipt.IN, receipt.OUT):
        return explicit
    return receipt.announce(_day_punches_up_to(employee, row))["verb"]


def _receipt_for(employee: str, row) -> tuple[str, tuple[str, str] | None]:
    """Verb plus meaning line for one punch -- one replay, both decisions.

    Unlike `direction_of`, this always fetches the day: even a labelled punch
    needs the replay's aggregates to know whether it is the day's first
    arrival or a departure whose day paired cleanly.
    """
    explicit = str((row or {}).get("log_type") or "").upper()
    announced = receipt.announce(_day_punches_up_to(employee, row))
    direction = explicit if explicit in (receipt.IN, receipt.OUT) else announced["verb"]
    try:
        meaning = _meaning_for(employee, row, direction, announced)
    except Exception:
        # The verb IS the service; the meaning line is garnish. A broken
        # Shift Type row, a half-migrated column, or a bug in a gate must
        # cost the line, never the receipt -- without this, a garnish fault
        # silences every check-in message in the queue.
        frappe.log_error(
            title="Telegram meaning line failed",
            message=f"employee={employee}\n{frappe.get_traceback()}",
        )
        meaning = None
    return direction, meaning


def _meaning_for(employee: str, row, direction: str, announced: dict) -> tuple[str, str] | None:
    """The one optional line pair under the verb, or None -- mostly None.

    The whole design is what this refuses to say. No lateness (a closeout
    verdict the phone must never anticipate), no "day complete" (nothing on
    this path knows a punch is the last), nothing on a neutral verb (a line
    that interprets a punch the verb declined to interpret), nothing on a
    holiday (an hours figure there is effectively a pay claim, and "your
    shift starts at 7:00" on Khmer New Year is the wrongest sentence this
    message could send), nothing around an overnight shift (the calendar-day
    replay cannot see across midnight), and no roster claims to people whose
    employment type promises no roster.

    What survives, per the design map:
    - the day's first arrival, on a rostered day, states the shift window as
      a FACT -- it reads identically for the 6:40 arrival and the 8:34 one,
      and puts the roster in front of the one person who can dispute it;
    - a departure whose day paired cleanly states the accumulated time,
      phrased "so far", with the figure announce() already guaranteed equal
      to the timeline's;
    - a rostered-population employee punching on a day the roster provably
      holds nothing for is told that fact -- only when the assignment
      horizon actually covers the day, because past the horizon "no shift"
      is a statement about generation lag, not about the roster.
    """
    day = str(row["time"])[:10]

    if direction == receipt.OUT and announced["so_far_minutes"] is not None:
        context = _day_context(employee, day)
        if context["is_holiday"] or context["is_overnight"]:
            return None
        if _overnight_on(employee, _previous_day(day)):
            # The night worker's 01:00-out / 01:30-in meal break lands on a
            # fresh calendar date and pairs cleanly there -- a figure
            # computed from it measures the break, or the gap between
            # leaving and coming back, never a day's work. The IN branch
            # already refuses this frame; the OUT branch must refuse it for
            # the same reason, not just for today's own overnight roster.
            return None
        return receipt.format_so_far_lines(announced["so_far_minutes"])

    if direction == receipt.IN and announced["is_first_punch_of_day"]:
        context = _day_context(employee, day)
        if context["is_holiday"] or context["is_overnight"]:
            return None
        if not context["eligible"]:
            return None
        if _overnight_on(employee, _previous_day(day)):
            # An early punch may belong to yesterday's overnight shift; every
            # roster-relative sentence about "today" is then the wrong frame.
            return None
        if context["shift_window"]:
            return receipt.format_shift_window_lines(*context["shift_window"])
        if context["assignment"] is None and _roster_opined_around(employee, day):
            return receipt.NO_ROSTER_LINES
        return None

    return None


def _day_context(employee: str, day: str) -> dict:
    """The facts the meaning line's gates read, fetched once.

    A broken Shift Type (unparseable or missing times) yields neither a
    window nor an overnight flag: the day then says nothing, rather than
    letting a configuration error read as "unscheduled" -- the same refusal
    _get_shift_meta makes for the engine.
    """
    employee_row = (
        frappe.db.get_value(
            "Employee", employee, ["company", "employment_type"], as_dict=True
        )
        or {}
    )
    context = {
        "is_holiday": bool(
            holiday_by_date_for_company(
                company=employee_row.get("company"), start=day, end=day
            )
        ),
        "eligible": is_weekly_schedule_eligible(employee_row.get("employment_type")),
        "assignment": get_shift_assignment(employee=employee, attendance_date=day),
        "shift_window": None,
        "is_overnight": False,
    }
    if context["assignment"]:
        start, end = _shift_minutes(context["assignment"]["shift_type"])
        if start is not None and end is not None:
            if end > start:
                context["shift_window"] = (start, end)
            elif end < start:
                context["is_overnight"] = True
    return context


def _shift_minutes(shift_type: str) -> tuple[int | None, int | None]:
    meta = (
        frappe.db.get_value(
            "Shift Type", shift_type, ["start_time", "end_time"], as_dict=True
        )
        or {}
    )
    return (
        shift_time_to_minutes(meta.get("start_time")),
        shift_time_to_minutes(meta.get("end_time")),
    )


def _previous_day(day: str) -> str:
    return (date.fromisoformat(day) - timedelta(days=1)).isoformat()


def _overnight_on(employee: str, day: str) -> bool:
    assignment = get_shift_assignment(employee=employee, attendance_date=day)
    if not assignment:
        return False
    start, end = _shift_minutes(assignment["shift_type"])
    return start is not None and end is not None and end < start


#: How far to each side of a day the roster must reach before a blank day
#: may be called a day off. A week spans any roster's cadence.
ROSTER_OPINION_WINDOW_DAYS = 7


def _roster_opined_around(employee: str, day: str) -> bool:
    """Has the roster actually opined about this stretch of the calendar?

    Four indistinguishable reasons produce "no assignment for the day" -- a
    real day off, a person HR never scheduled, a new hire ahead of their
    roster, and a lapsed generation horizon. "No shift on your roster" is
    honest only in the first shape, and MIN/MAX bounds cannot isolate it:
    they are an envelope, so an interior generation gap (a missed month
    between two generated windows) reads as covered, and one far-future
    open-ended row reads as an infinite horizon.

    The honest predicate needs the roster on BOTH sides of the day, within
    a week each way. One side is not enough, and each side kills a distinct
    false claim: with only the trailing side, a lapsed block keeps
    "speaking" for a week past its end; with only the leading side, a new
    hire hears about their roster a week before it exists. A blank day
    BETWEEN generated days is the one shape that is a statement the roster
    actually makes. Everything else stays silent -- the same reasoning
    that put schedule_max_date in the Mini App payload instead of a "not
    scheduled" label. (A hole in generation narrower than the window still
    reads as days off; a hole that small between two active blocks is a
    roster decision more often than an accident, and silence-on-doubt ends
    at some width or the line never fires at all.)
    """
    anchor = date.fromisoformat(day)
    window = timedelta(days=ROSTER_OPINION_WINDOW_DAYS)
    return has_assignment_overlapping(
        employee=employee,
        start=(anchor - window).isoformat(),
        end=day,
    ) and has_assignment_overlapping(
        employee=employee,
        start=day,
        end=(anchor + window).isoformat(),
    )


def _link_for(employee: str):
    return frappe.db.get_value(
        LINK_DT,
        {"employee": employee, "enabled": 1},
        ["name", "chat_id"],
        as_dict=True,
    )


def _checkin(checkin_name: str):
    # `name` rides along so _day_punches_up_to can find this punch among
    # same-second siblings and cut the replay off exactly there.
    return frappe.db.get_value(
        "Employee Checkin",
        checkin_name,
        ["name", "log_type", "time", "custom_device_branch"],
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

    # NO ROLLOUT GATE. This used to require the branch to be LIVE, and that
    # was the wrong gate at the wrong granularity.
    #
    # The engine's rollout phase governs when its DETERMINATIONS -- lateness,
    # absence, flags -- become real for a branch. This message contains none
    # of them, by a decision recorded at the top of this module: punch facts
    # and roster facts, nothing evaluative. The shift window and the "so far"
    # figure are true the moment the punch row exists, whatever the engine is
    # allowed to conclude that day.
    #
    # And the consent is already here, per person and explicit. A Telegram
    # Link exists only because that employee opened the bot and sent /start,
    # or redeemed a link handed to them. Silencing someone who opted in
    # because of a branch-wide date they had no part in is the wrong unit
    # entirely -- and it made a small pilot impossible without changing engine
    # behaviour for everyone at that branch.
    #
    # The exit stays per person too: blocking the bot returns BLOCKED below
    # and disables the link.

    # PLAIN TEXT, no inline button. The Mini App is reached from the bot's own
    # Main Mini App button and from the chat menu button, both of which are
    # always there; an inline copy on every check-in message was a third route
    # to the same place, repeated several times a day, on the one message that
    # should be glanceable and gone.
    direction, meaning = _receipt_for(employee, row)
    result = transport.send_message(
        link["chat_id"],
        compose(direction, row["time"], row.get("custom_device_branch"), meaning),
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
        # Engine context, not a notification gate. Left in the report because
        # it explains what the ENGINE is doing for these employees, which is
        # the next question after "did the message arrive".
        "rollout_configured": rollout.phases_configured(),
    }
    if employee:
        gates["employee"] = employee
        # EXISTENCE FIRST. Without this the report answers confidently about a
        # record that is not there: `_link_for` finds no link for a name that
        # cannot have one, and `phase_for_employee` resolves no branch and so
        # falls back to the site-wide phase -- so a typo returns
        # `employee_linked: false` and a plausible-looking `PRELAUNCH`, which
        # reads exactly like a real employee who is blocked.
        #
        # That happened: a placeholder id from a instructions was pasted into
        # a real query, and the answer sent two people looking for a binding
        # fault that did not exist.
        if not frappe.db.exists("Employee", employee):
            gates["employee_exists"] = False
            return gates

        gates["employee_exists"] = True
        gates["employee_linked"] = bool(_link_for(employee))
        # Reported as CONTEXT, not as a gate -- notifications no longer
        # consult it. Kept because it still governs what the engine concludes
        # about this employee's days, which is worth seeing next to their
        # notification state.
        gates["employee_phase"] = rollout.phase_for_employee(
            employee=employee, attendance_date=nowdate()
        )
    return gates


@frappe.whitelist()
def send_test_notification(employee: str | None = None) -> dict:
    """The real check-in message, sent on demand.

    Rollout exists so a branch can be watched before its employees are told
    anything, and that is right -- but it also means the notification cannot
    be proven until the moment it starts going to everyone. Nobody should
    have to discover a wording or a binding fault on the day they flip a
    branch LIVE.

    So this is the real path, not a mock of it: the same link lookup, the same
    `direction_of`, the same `compose`, the same transport, against the
    employee's most recent actual punch.

    It began as a way around the rollout gate, which no longer exists on this
    path -- a link is now the whole permission. What it still does, and a
    punch cannot, is fire on demand and hand the text back, so wording can be
    checked without waiting at a terminal or holding the linked phone.

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

    report = {"employee": employee}
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

    # The meaning line is computed only when the latest punch is from TODAY.
    # This test path fires against whatever the most recent punch is, and a
    # message saying "So far today 4h 56m" about last Tuesday is a
    # fresh-looking claim about a stale day -- the exact shape the design
    # map flagged on this endpoint. The verb is safe either way; the day
    # framing is not.
    if str(latest["time"])[:10] == str(nowdate()):
        direction, meaning = _receipt_for(employee, latest)
    else:
        direction, meaning = direction_of(employee, latest), None
    text = compose(
        direction, latest["time"], latest.get("custom_device_branch"), meaning
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
