"""The Mini App's read endpoints.

Two: `get_my_calendar` for the days, `get_my_profile` for the record behind
them. They are separate because the calendar is fetched once per range -- a day
for Today, a week for the roster, a month for the stats -- while the record
changes for nobody during a session, and because one function holding two
allowlists is one careless edit away from widening both.

Two properties carry this module, and BOTH ENDPOINTS MUST HAVE BOTH. They are
structural rather than vigilant:

1. Neither takes an employee-selecting parameter. An attacker cannot name a
   victim because there is no field to put one in. A test guards each
   signature, and they exist because that property will die to a reasonable
   future edit -- a manager view adding `employee=` -- rather than to an attack.

2. Every projection is an ALLOWLIST. Written as removals they would fail open:
   a field added to the calendar builder, or to Employee, for an HR need would
   reach every employee silently, with no test failing. Built this way, a new
   field is hidden by default and exposing one is a deliberate edit.

What each narrows is HR-shaped. The calendar payload carries device serials,
`last_error`, flag evidence, internal flag names and grace minutes;
`build_employee_calendar` says so at its own definition. The Employee doctype
carries date_of_birth, passport_number and salary fields. None of it is an
employee's to see.
"""

from __future__ import annotations

from datetime import datetime

import frappe
from frappe.utils import date_diff, getdate

from dewey_time.attendance_engine import enrollment_api, finger_slots, hr_calendar
from dewey_time.telegram import miniapp_auth

#: One launch cannot pull more than this. Wide enough for a month view, narrow
#: enough that it is not a history export.
MAX_RANGE_DAYS = 62

#: first_in/last_out are derived server-side from this employee's own punches
#: (hr_calendar.py:791) and are strictly less than the punch list already
#: allowed below -- if they can see every punch, the first and last of them
#: are not a new disclosure. The week view reads them via
#: formatDayCheckinTimeRange.
DAY_KEYS = (
    "date",
    "shift",
    "checkins",
    "holiday",
    "leave",
    "observed_lunch",
    "first_in",
    "last_out",
    "flags",
)
SHIFT_KEYS = (
    "shift_assigned",
    "shift_type",
    "start_time",
    "end_time",
    "lunch_start",
    "lunch_end",
)
#: `custom_device_branch` is IN; `device_id` is out, and the line between them
#: is deliberate. The branch is a place the employee physically stood, which is
#: their own attendance fact -- the check-in notification already tells them
#: ("Checked in 07:58 · DIS Iconic"). The device serial is infrastructure.
#:
#: It is also load-bearing for rendering, which is how the original omission
#: was caught: attendancePunches.ts:37 -- "Punches without
#: custom_device_branch are never grouped -- each is its own run (rogue)" --
#: so dropping it made every punch draw as an anomaly on the timeline. Only
#: looking at the rendered page found that; no unit test could.
CHECKIN_KEYS = ("time", "log_type", "custom_device_branch")

#: Flag codes an employee may be told about.
#:
#: An ALLOWLIST for the same reason DAY_KEYS is one: written as removals, a code
#: added to the engine next year would reach every employee silently, with no
#: test failing. Built this way it stays hidden until somebody edits this set on
#: purpose.
#:
#: Excluded deliberately. UNKNOWN_DEVICE_BRANCH and DELIVERY_FAILED are our
#: infrastructure failing rather than the employee's day, and neither is
#: actionable by them. NON_PRIMARY_SITE_PUNCH is INFO and usually just a cover
#: shift -- it would alarm somebody who did nothing unusual.
EMPLOYEE_FLAG_CODES = frozenset({
    "LATE_START",
    "LEFT_EARLY",
    "LATE_FROM_LUNCH",
    "MISSING_TIME",
    "MISSING_IN_OR_OUT",
    "UNNOTIFIED_ABSENCE",
    "OFF_SHIFT_PUNCH",
    "MISSING_LUNCH",
    "ATTENDANCE_ISSUE",
})

#: `evidence` is NOT here, and that is the load-bearing omission -- it carries
#: grace minutes, thresholds and rule internals. `severity` is not here either:
#: it is HR's triage order, not a measure of what matters to the person.
FLAG_KEYS = ("flag_code", "is_provisional", "decision", "decision_state")

#: What an employee may see of HR's decision. A SECOND allowlist, because
#: `decision` is a nested dict and FLAG_KEYS only guards the level above it.
#:
#: hr_calendar.py:725 already redacts this to the same two fields -- but only
#: `if not hr_view`, which is a `frappe.session.user` check in another module.
#: Depending on it would put this module's whole promise ("the projection is an
#: allowlist, so a field added to the calendar builder for an HR need is hidden
#: by default") in the hands of a predicate that knows nothing about the Mini
#: App. Add `reason` to that dict upstream for an HR need and every phone gets
#: HR's rejection reasons, with no test in this file failing.
#:
#: So it is re-projected here, and pinned by an equality test. The duplication
#: is the point: two independent narrowings of the same object, and this one
#: cannot be widened from somewhere else.
DECISION_KEYS = ("outcome", "decided_at")


#: Employee fields an employee may see about their own record, on the Profile
#: tab.
#:
#: An ALLOWLIST for the same reason DAY_KEYS is one. This doctype also carries
#: date_of_birth, passport_number and salary fields; written as removals, the
#: next one added for an HR need would reach every phone with nothing failing.
PROFILE_FIELDS = ("department", "employment_type", "date_of_joining", "branch")

#: Their own contact details, so they can see what HR will actually be dialling.
#: A separate tuple from PROFILE_FIELDS only so the PII reads as PII at a glance.
CONTACT_FIELDS = ("cell_number", "personal_email")


def _pick(source, keys):
    source = source or {}
    return {k: source[k] for k in keys if k in source}


def _at(value):
    """A datetime, or None -- never an exception.

    `datetime.fromisoformat` rather than `frappe.utils.get_datetime`, and that
    is deliberate twice over.

    It accepts BOTH separators, which is the whole point: evidence stores an ISO
    datetime with a "T" (absence_flags.py builds it from `.isoformat()`) and
    Frappe stores punch times with a space. Anything that does not reconcile the
    two ends up comparing them as strings, where " " sorts before "T" and 12:58
    lands before 12:31.

    And it does not go through the frappe mock. `test_closeout._install_frappe_mock`
    stubs `get_datetime` as `lambda value: value` -- a passthrough that hands
    back the string -- so a comparison built on it would silently be a string
    comparison under test while looking correct in the source. That is not a
    hypothetical: the first draft of this function used get_datetime and the
    parse test caught it.
    """
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        return None


def _certain(flag: dict, checkins: list[dict]) -> bool:
    """Is this flag safe to show the person it describes?

    A final flag is a fact about the record. A PROVISIONAL one is the engine
    mid-thought: intraday deletes and re-inserts AUTO flags on every punch, so
    one can appear in the morning and be gone by closeout. Showing those turns
    this surface into an accusation that withdraws itself.

    Only two provisional codes can reach here -- intraday writes MISSING_TIME,
    NON_PRIMARY_SITE_PUNCH and UNNOTIFIED_ABSENCE (intraday.py:29), and the
    middle one is already out under EMPLOYEE_FLAG_CODES.
    """
    if not flag.get("is_provisional"):
        return True

    code = flag.get("flag_code")

    # A provisional no-show. intraday.py:175 raises it the moment the first
    # MISSING_TIME interval would have appeared and withdraws it when a punch
    # lands. Someone whose approved leave has not been keyed into ERPNext yet
    # would carry "no record for this day" all morning -- the worst thing this
    # surface could do, and the case that happens most.
    if code == "UNNOTIFIED_ABSENCE":
        return False

    # A gap that is still running is a person who may be about to walk back in.
    # The engine measures today's gaps up to the present MINUTE --
    # missing_expected_max_end_min returns present_hour_start_min(now), which
    # despite its name is now.hour * 60 + now.minute (absence_intervals.py:44)
    # -- so an untracked lunch becomes a 31-minute gap at 12:31 while the person
    # is still eating. A gap that ended because a punch resumed after it is
    # certain; that is what this asks.
    if code == "MISSING_TIME":
        end = _at((flag.get("evidence") or {}).get("interval_end"))
        if end is None:
            return False
        # PARSED, not compared as strings. evidence stores an ISO datetime with
        # a "T" and Frappe stores punch times with a space; " " sorts before
        # "T", so a string compare puts 12:58 BEFORE 12:31 and withholds a
        # closed gap forever. There is a test named after exactly this.
        for checkin in checkins:
            punch = _at(checkin.get("time"))
            if punch is not None and punch >= end:
                return True
        return False

    return True


def _pick_flags(day: dict) -> list[dict]:
    checkins = day.get("checkins") or []
    picked = []
    for flag in day.get("flags") or []:
        if flag.get("flag_code") not in EMPLOYEE_FLAG_CODES:
            continue
        if not _certain(flag, checkins):
            continue
        narrowed = _pick(flag, FLAG_KEYS)
        # Only when there IS one. `_pick` of a None decision would fabricate an
        # empty dict, and the client reads `decision?.outcome` to mean "HR has
        # not looked at this yet" -- an empty object is truthy and would still
        # resolve to the same "awaiting" branch today, but it is a lie about the
        # data that the next reader of this code would have to re-derive.
        if narrowed.get("decision"):
            narrowed["decision"] = _pick(narrowed["decision"], DECISION_KEYS)
        picked.append(narrowed)
    return picked


#: Top-level keys an employee may see about themselves.
#:
#: `employee_branch` is their own primary site -- the same fact the check-in
#: notification already states ("Checked in 07:58 · DIS Iconic"). Everything
#: else the payload carries at this level stays out: `device_alerts` and
#: `device_sync` are infrastructure health, and `_employee_nav_meta` is the
#: SPA's picker plumbing.
PAYLOAD_KEYS = ("employee", "employee_branch")


def narrow(payload: dict) -> dict:
    """Project the HR calendar payload down to what an employee may see."""
    days = []
    for day in payload.get("days") or []:
        narrowed = _pick(day, DAY_KEYS)
        # Only if the source had one. Fabricating an empty shift would make an
        # off day render as a scheduled one.
        if "shift" in narrowed:
            narrowed["shift"] = _pick(day.get("shift"), SHIFT_KEYS)
        narrowed["checkins"] = [
            _pick(c, CHECKIN_KEYS) for c in (day.get("checkins") or [])
        ]
        # Always a list, never absent: the client counts it, and a missing key
        # would need a guard on every day -- one of which would be forgotten.
        # Read from the SOURCE day, not from `narrowed`, because _certain needs
        # the punch times and `narrowed` has not been given them yet.
        narrowed["flags"] = _pick_flags(day)
        days.append(narrowed)
    return {**_pick(payload, PAYLOAD_KEYS), "days": days}


def _identity(employee: str) -> dict:
    """Who the server resolved this launch to.

    THE POINT IS CONFIRMATION, not decoration. Telegram already knows the
    user's own name and echoing it back proves nothing; what an employee cannot
    otherwise check is which Employee record their account is bound to. The
    recorded-id bind path makes that worth showing: it trusts an id somebody
    recorded, and a wrong one binds a stranger silently. Seeing someone else's
    name at the top of the app is how that gets reported on day one instead of
    never.

    Khmer name included because for a great many of these employees it is the
    name they would actually recognise as theirs, and an English transliteration
    they never use is a poor thing to verify an identity against.
    """
    fields = ["employee_name", "designation", "image"]
    # Installed by dewey_time.setup.custom_fields, but a site mid-migration may
    # not have them yet -- and an unknown column makes the select raise, which
    # would take the whole Mini App down to lose one optional name.
    khmer_fields = [
        field
        for field in ("custom_khmer_last_name", "custom_khmer_first_name")
        if frappe.db.has_column("Employee", field)
    ]
    row = frappe.db.get_value("Employee", employee, fields + khmer_fields, as_dict=True) or {}
    khmer = " ".join(
        part for part in (
            row.get("custom_khmer_last_name"),
            row.get("custom_khmer_first_name"),
        ) if part
    ).strip()
    return {
        "employee_name": row.get("employee_name"),
        "designation": row.get("designation"),
        "khmer_name": khmer or None,
        # The Employee's OWN photo — the one HR put on their record, and the
        # one that appears beside them everywhere else in Dewey Time. The
        # Telegram avatar is whatever the person chose for Telegram, which is
        # frequently not a face at all, and it confirms nothing about the
        # binding: it is the viewer's own picture by definition.
        #
        # `_public_image` drops private files rather than shipping a path that
        # 403s for a Guest. See its own note.
        "image": _public_image(row.get("image")),
    }


def _public_image(url) -> str | None:
    """An Employee photo URL only if a Guest can actually load it.

    Mini App requests carry no Frappe session -- there is no User for these
    callers by design -- so a `/private/files/...` path renders as a broken
    image with a 403 behind it. Returning None instead lets the client fall
    back to initials, which looks deliberate.

    Anything not a same-origin path is dropped too: this value is written into
    an <img src>, and the Employee image field is free text a Desk user can
    put anything into.
    """
    url = str(url or "").strip()
    if not url.startswith("/files/"):
        return None
    return url


# POST-only, deliberately. Without methods=[...] Frappe also accepts GET, and
# a GET would carry init_data -- the entire authentication credential -- in the
# query string, where it lands in the web server's access log, any proxy in
# front of it, and the webview's history. The webhook already pins this; this
# endpoint did not.
@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_my_calendar(init_data: str, start_date: str, end_date: str) -> dict:
    """The employee's own calendar, resolved from their Telegram binding.

    allow_guest because no Frappe User exists for these callers by design. The
    initData signature and the binding are the entire authorization -- see
    miniapp_auth's module docstring for why there is nothing beneath them.
    """
    # FIRST, before any other validation. Checking the range first would let an
    # unauthenticated caller probe for accepted date windows.
    employee = miniapp_auth.employee_from_init_data(init_data)

    start = getdate(start_date)
    end = getdate(end_date)
    if end < start:
        frappe.throw("end_date must be on or after start_date")
    if date_diff(end, start) > MAX_RANGE_DAYS:
        frappe.throw(f"Range is limited to {MAX_RANGE_DAYS} days")

    payload = narrow(hr_calendar.build_employee_calendar(employee, str(start), str(end)))
    # Merged here rather than inside narrow(): narrow is a pure projection of
    # what it is handed, and identity is a separate lookup. Keeping it pure is
    # what lets the allowlist tests feed it a fabricated HR payload.
    return {**payload, **_identity(employee)}


def _employee_row(employee: str, fields: tuple) -> dict:
    """Read only the columns this site actually has.

    An unknown column makes the whole select raise, which would take the
    Profile tab down to lose one optional row. `_identity` already guards the
    Khmer pair this way and hr_calendar.py:346 guards `employment_type` for the
    same reason.
    """
    present = [field for field in fields if frappe.db.has_column("Employee", field)]
    if not present:
        return {}
    return frappe.db.get_value("Employee", employee, present, as_dict=True) or {}


def _reports_to_name(employee: str):
    """The manager's NAME.

    Never the docname. That is another employee's identifier, and "who do I
    tell if I'm sick" is answered by a name. A dangling link yields None rather
    than raising -- Employee records get deleted and this row is optional.
    """
    if not frappe.db.has_column("Employee", "reports_to"):
        return None
    manager = frappe.db.get_value("Employee", employee, "reports_to")
    if not manager:
        return None
    return frappe.db.get_value("Employee", manager, "employee_name") or None


def _biometric(employee: str) -> dict:
    """Enrolment, as THREE states rather than two.

    "Not enrolled" and "we have never heard from the bridge" are different
    facts. `enrollment_status` returns last_snapshot_at precisely so they can be
    told apart -- its own docstring says so -- and telling somebody they are not
    set up when the truth is that our snapshot is missing is the same failure as
    showing a provisional flag: the app stating something it does not know.
    """
    status = enrollment_api.enrollment_status(employee)

    # ONE value drives both the state and the timestamp, so they cannot
    # contradict each other on screen.
    #
    # `last_snapshot_at` alone is not the question. It is a Single, and clearing
    # it in Desk stores 0001-01-01, which _last_snapshot_at normalises to None
    # -- a path its own docstring records as observed on a real bench. Every
    # register row would still carry its own synced_at, so keying "unknown" off
    # the marker alone rendered "Not checked yet" directly above "Last checked
    # 17 Aug". This person's OWN snapshot time is the stronger evidence that we
    # have heard about them; the bridge's last contact of any kind is the
    # weaker answer that is still true.
    heard_at = status.get("synced_at") or status.get("last_snapshot_at")
    if not heard_at:
        state = "unknown"
    elif status.get("is_registered"):
        state = "enrolled"
    else:
        state = "not_enrolled"

    return {
        "state": state,
        # SLUGS, never the device's integers -- see finger_slots for why the
        # mapping is there and not in TypeScript. Empty for everyone today: the
        # bridge collapses templates to a count before Frappe ever sees them.
        "fingers": [finger_slots.slug_for(fid) for fid in status.get("finger_ids") or []],
        "fingerprint_count": int(status.get("fingerprint_count") or 0),
        # A yes/no, not a count. Nobody enrols two faces, and a number invites
        # the reader to wonder what the other one is.
        "face": bool(status.get("face_count") or 0),
        # Null exactly when the state is "unknown", by construction.
        "checked_at": heard_at,
    }


# POST-only for the same reason get_my_calendar is: a GET would carry init_data
# -- the entire authentication credential -- in the query string.
@frappe.whitelist(allow_guest=True, methods=["POST"])
def get_my_profile(init_data: str) -> dict:
    """The employee's own record, resolved from their Telegram binding.

    A SEPARATE endpoint rather than more keys on get_my_calendar. That one is
    fetched once per range -- a day for Today, a week for the roster, a month
    for the stats -- and none of this changes between them, so bundling would
    ship the whole record three times a launch. One function holding two
    allowlists is also one careless edit away from widening both.
    """
    # FIRST, before any read. Same property as get_my_calendar.
    employee = miniapp_auth.employee_from_init_data(init_data)

    fields = PROFILE_FIELDS + CONTACT_FIELDS
    row = _employee_row(employee, fields)
    # `or None` so an empty string reaches the client as null: the client drops
    # a row that has no value, and "" would render an empty line under a label.
    picked = {key: row.get(key) or None for key in fields}

    return {
        "employee": employee,
        **_identity(employee),
        **picked,
        "reports_to_name": _reports_to_name(employee),
        "biometric": _biometric(employee),
    }
