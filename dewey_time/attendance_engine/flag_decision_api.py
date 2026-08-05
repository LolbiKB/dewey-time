"""Write path for HR judgments on Attendance Flags.

Decisions are append-only: a flag is never edited to record that HR excused it.
Each judgment inserts an `Attendance Flag Decision` row keyed by
`flag_identity()` (see `flag_identity.py`), and a second judgment on the same
identity inserts a new row and flips `superseded` on the old one — so the full
history of who decided what, and when, survives every closeout rebuild of the
underlying flag.
"""

from __future__ import annotations

import json
import re

import frappe
from frappe.utils import getdate, now_datetime

from dewey_time.attendance_engine.flag_identity import evidence_fingerprint, flag_identity
from dewey_time.attendance_engine.hr_calendar import _require_hr_role

DECISION_DOCTYPE = "Attendance Flag Decision"

DECIDE_CONFIRM_THRESHOLD = 25
OUTCOMES = ("EXCUSED", "UPHELD")
REASONS = (
    "APPROVED_LEAVE",
    "DEVICE_OR_DATA_FAULT",
    "MANAGER_APPROVED",
    "SCHEDULE_WRONG",
    "COVERING_OTHER_SITE",
    "GENUINE_VIOLATION",
    "OTHER",
)

# flag_identity is "AUTO-{scrub(employee)}-{YYYY-MM-DD}-{suffix}" (flag_identity.py).
# The employee token is matched non-greedily so the FIRST ISO date wins: a MISSING_TIME
# suffix embeds its own scrubbed interval_start ("...-2026-08-03-08-15-00") and a greedy
# match would read that as the attendance_date.
_IDENTITY_RE = re.compile(r"^AUTO-(?P<employee>.+?)-(?P<date>\d{4}-\d{2}-\d{2})-.+$")


def _parse_confirm(value) -> bool:
    """Same coercion as dev_tools._parse_confirm (dev_tools.py:124-129). Duplicated rather
    than imported because dev_tools pulls in closeout + intraday at import time, and a
    decision write must not drag the whole flag engine into its import graph."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes")
    return bool(value)


def _parse_identities(identities) -> list[str]:
    """Frappe serialises structured arguments as JSON over the wire, so the same argument
    arrives as a list from Python and as a string from the SPA — coerce both, exactly as
    schedule_api._parse_json (schedule_api.py:74-84) does.

    Duplicates are collapsed: two copies of one identity in a single call would otherwise
    make the second row supersede the first row of the *same* action.
    """
    if isinstance(identities, str):
        text = identities.strip()
        if not text:
            identities = []
        else:
            try:
                identities = json.loads(text)
            except ValueError:
                frappe.throw("identities must be a JSON array of flag_identity strings")
    if identities is None:
        identities = []
    if not isinstance(identities, (list, tuple)):
        frappe.throw("identities must be a list of flag_identity strings")

    seen: set[str] = set()
    out: list[str] = []
    for item in identities:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)

    if not out:
        frappe.throw("identities is required")
    return out


def _split_identity(identity: str) -> tuple[str, str]:
    """(scrubbed employee token, "YYYY-MM-DD"). Raises ValueError on anything that is not
    a flag_identity, so a malformed row lands in the per-row errors list rather than
    aborting the batch."""
    match = _IDENTITY_RE.match(identity)
    if not match:
        raise ValueError(f"Unrecognised flag_identity: {identity}")
    return match.group("employee"), match.group("date")


def _validate_decision(outcome, reason, note) -> tuple[str, str, str]:
    outcome = (outcome or "").strip().upper()
    reason = (reason or "").strip().upper()
    note = (note or "").strip()

    if outcome not in OUTCOMES:
        frappe.throw(f"outcome must be one of: {', '.join(OUTCOMES)}")
    if reason not in REASONS:
        frappe.throw(f"reason must be one of: {', '.join(REASONS)}")
    # OTHER explains nothing on its own, and UPHELD is the outcome that costs the
    # employee — both have to carry a written justification or the audit trail is
    # unreadable a year later.
    if not note and (reason == "OTHER" or outcome == "UPHELD"):
        frappe.throw("note is required when reason is OTHER or outcome is UPHELD")

    return outcome, reason, note


def _preview(identities: list[str]) -> dict:
    """Blast radius, counted straight off the identity strings so the preview path touches
    no rows at all. The employee token is the scrubbed employee id, which is distinct per
    employee for the id formats this site issues — good enough for a number HR reads
    before confirming, and it is never used as a join key."""
    employees: set[str] = set()
    for identity in identities:
        try:
            employee_token, _date = _split_identity(identity)
        except ValueError:
            continue
        employees.add(employee_token)
    return {"count": len(identities), "employees": len(employees)}


def _live_flags_by_identity(identities: list[str]) -> dict[str, dict]:
    """One batched read of the AUTO flags these identities point at, keyed by identity.

    The date window comes out of the identities themselves, which keeps this a single
    query however many rows the bulk action covers — a per-identity lookup would be 39
    queries for one group decision.
    """
    dates: set[str] = set()
    for identity in identities:
        try:
            _employee_token, date_text = _split_identity(identity)
        except ValueError:
            continue
        dates.add(date_text)
    if not dates:
        return {}

    rows = (
        frappe.get_all(
            "Attendance Flag",
            filters={"attendance_date": ["in", sorted(dates)], "source": "AUTO"},
            fields=["name", "employee", "attendance_date", "flag_code", "evidence", "day_closed"],
            order_by="day_closed asc",
            limit_page_length=0,
        )
        or []
    )

    wanted = set(identities)
    by_identity: dict[str, dict] = {}
    for row in rows:
        identity = flag_identity(
            employee=row.get("employee"),
            attendance_date=row.get("attendance_date"),
            flag_code=row.get("flag_code"),
            evidence=row.get("evidence"),
        )
        if identity not in wanted:
            continue
        # A provisional and its final replacement share one identity by design
        # (day_closed is excluded from the key), so ordering day_closed asc lets the
        # final row win and the fingerprint be taken from the closed-out evidence.
        by_identity[identity] = row
    return by_identity


def _branch_by_employee(employees) -> dict[str, str | None]:
    """Denormalisation source for `employee_branch`: one query, so cause grouping in the
    queue never has to join Employee (spec: Data model / employee_branch)."""
    names = sorted({name for name in employees if name})
    if not names:
        return {}
    rows = (
        frappe.get_all(
            "Employee",
            filters={"name": ["in", names]},
            fields=["name", "branch"],
            limit_page_length=0,
        )
        or []
    )
    return {row["name"]: row.get("branch") for row in rows}


def _live_decisions_by_identity(identities: list[str]) -> dict[str, str]:
    """identity -> name of the row currently live (superseded=0) for it."""
    rows = (
        frappe.get_all(
            DECISION_DOCTYPE,
            filters={"flag_identity": ["in", sorted(identities)], "superseded": 0},
            fields=["name", "flag_identity"],
            limit_page_length=0,
        )
        or []
    )
    return {row["flag_identity"]: row["name"] for row in rows}


def _new_group_key() -> str:
    return f"AFD-{frappe.generate_hash(length=12)}"


def _write_decision(
    *,
    identity: str,
    flag: dict | None,
    branch_by_employee: dict,
    live_decisions: dict,
    outcome: str,
    reason: str,
    note: str,
    group_key: str,
    decided_by: str,
    decided_at,
) -> str:
    if not flag:
        # Correcting a punch changes the evidence and therefore the identity, and
        # correcting a punch is the most common thing HR does while triaging — so this
        # is the expected "the flag changed while you were deciding" race, not a bug.
        raise ValueError("No live AUTO flag matches this identity")

    employee = flag.get("employee")
    previous = live_decisions.get(identity)

    doc = frappe.get_doc(
        {
            "doctype": DECISION_DOCTYPE,
            "flag_identity": identity,
            "employee": employee,
            "attendance_date": getdate(flag.get("attendance_date")),
            "flag_code": flag.get("flag_code"),
            "employee_branch": branch_by_employee.get(employee),
            "outcome": outcome,
            "reason": reason,
            "note": note or None,
            "evidence_fingerprint": evidence_fingerprint(flag.get("evidence")),
            "group_key": group_key,
            "decided_by": decided_by,
            "decided_at": decided_at,
            "supersedes": previous,
            "superseded": 0,
        }
    )
    # ignore_permissions because authorisation is the endpoint gate (_require_hr_role()):
    # going through the doctype's own perms would additionally apply User Permissions on
    # Employee, which would stop an HR User deciding for employees outside their own
    # scope — deliberately not the model here (spec, Open risk 4). Same reason
    # upsert_device_closeout_alert inserts this way (closeout.py:219).
    doc.insert(ignore_permissions=True)

    if previous:
        # Flipped AFTER the insert, so a failed insert can never leave the identity with
        # no live decision at all. Decision content is immutable — this pointer is the
        # only thing that ever changes on an existing row — and update_modified=False
        # keeps the audit row byte-stable.
        frappe.db.set_value(DECISION_DOCTYPE, previous, "superseded", 1, update_modified=False)

    # The row just written is now the live one for this identity.
    live_decisions[identity] = doc.name
    return doc.name


@frappe.whitelist(methods=["POST"])
def decide_flags(
    identities,
    outcome: str,
    reason: str,
    note: str | None = None,
    group_key: str | None = None,
    confirm=None,
) -> dict:
    """Record an HR judgment on 1..N flags.

    A single-flag decision and a 39-person bulk action deliberately share this one code
    path, so the supersession and partial-failure rules cannot drift between them.
    """
    _require_hr_role()

    identity_list = _parse_identities(identities)
    outcome, reason, note = _validate_decision(outcome, reason, note)

    confirm_value = confirm if confirm is not None else frappe.form_dict.get("confirm")
    if len(identity_list) > DECIDE_CONFIRM_THRESHOLD and not _parse_confirm(confirm_value):
        # Show the blast radius before committing it — the same preview/confirm two-step
        # as schedule_api.apply_weekly_schedule (schedule_api.py:438) and
        # dev_tools.clear_employee_schedule_api (dev_tools.py:160-162). Nothing is
        # written on this path.
        return {"needs_confirm": True, "preview": _preview(identity_list)}

    # One group_key for the whole call, generated here when the caller did not supply
    # one: it is what reverse_decision_group undoes later.
    group_key = (group_key or "").strip() or _new_group_key()

    flags_by_identity = _live_flags_by_identity(identity_list)
    branch_by_employee = _branch_by_employee(
        row.get("employee") for row in flags_by_identity.values()
    )
    live_decisions = _live_decisions_by_identity(identity_list)

    # Stamped from the session, never from the payload: a client-supplied decider makes
    # the whole audit trail worthless.
    decided_by = frappe.session.user
    decided_at = now_datetime()

    written = 0
    errors: list[dict] = []
    for identity in identity_list:
        # Per-row isolation — one stale identity out of 39 must never cost the other 38.
        # Pattern: schedule_resolver.clear_employee_schedule (schedule_resolver.py:1214-1223).
        try:
            _write_decision(
                identity=identity,
                flag=flags_by_identity.get(identity),
                branch_by_employee=branch_by_employee,
                live_decisions=live_decisions,
                outcome=outcome,
                reason=reason,
                note=note,
                group_key=group_key,
                decided_by=decided_by,
                decided_at=decided_at,
            )
            written += 1
        except Exception as exc:
            errors.append({"flag_identity": identity, "error": str(exc)})

    # Commit here rather than leaning on request teardown, so the rows that did write
    # survive a later failure in the same request (dev_tools.py:68 does the same). The
    # inserts fire the doc_event that busts the 60s queue cache; no explicit
    # invalidation is needed on this path.
    frappe.db.commit()

    return {
        "ok": not errors,
        "written": written,
        "group_key": group_key,
        "errors": errors,
    }


def _require_hr_manager_for_reversal():
    """Deciding is HR User; mass-reversing is not.

    A reversal supersedes every row one bulk action wrote — up to the whole roster in a
    single call — so it gets the explicit stricter check layered on top of
    _require_hr_role(), the way dev_tools._require_system_manager_for_clear
    (dev_tools.py:132-139) does for other high-blast-radius operations. The asymmetry is
    deliberate: an HR User who mis-decides one flag simply decides it again (supersession
    is append-only and cheap), but an HR User who wipes someone else's 168-row batch
    cannot put it back — every reversed row would have to be re-decided by hand.
    """
    user = frappe.session.user
    if user == "Administrator":
        return
    roles = set(frappe.get_roles(user) or [])
    if roles & {"HR Manager", "System Manager"}:
        return
    frappe.throw("Reversing a decision batch requires the HR Manager or System Manager role")


def _record_reversal_note(names: list[str], *, note: str, group_key: str):
    """Best-effort audit trail for WHY a batch was reversed.

    A decision row is immutable apart from `superseded` and the doctype has no
    reversal-note field, so the note lands as a standard Frappe Comment on each row the
    reversal touched. Never raises: an audit-write failure must not undo an already
    committed reversal — same rule as schedule_change_log.record_schedule_change
    (schedule_change_log.py:19-21).
    """
    if not names:
        return
    content = f"Decision batch {group_key} reversed by {frappe.session.user}: {note}"
    try:
        for name in names:
            frappe.get_doc(
                {
                    "doctype": "Comment",
                    "comment_type": "Comment",
                    "reference_doctype": DECISION_DOCTYPE,
                    "reference_name": name,
                    "content": content,
                }
            ).insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(title="flag decision reversal: comment write failed")


@frappe.whitelist(methods=["POST"])
def reverse_decision_group(group_key: str, note: str, confirm=None) -> dict:
    """Undo one bulk decision by superseding every live row that shares its group_key."""
    _require_hr_role()
    _require_hr_manager_for_reversal()

    group_key = (group_key or "").strip()
    if not group_key:
        frappe.throw("group_key is required")
    note = (note or "").strip()
    if not note:
        frappe.throw("note is required to reverse a decision batch")

    rows = (
        frappe.get_all(
            DECISION_DOCTYPE,
            filters={"group_key": group_key, "superseded": 0},
            fields=["name", "flag_identity", "employee"],
            limit_page_length=0,
        )
        or []
    )

    confirm_value = confirm if confirm is not None else frappe.form_dict.get("confirm")
    if not _parse_confirm(confirm_value):
        return {
            "needs_confirm": True,
            "preview": {
                "count": len(rows),
                "employees": len({row.get("employee") for row in rows if row.get("employee")}),
            },
        }

    reversed_names: list[str] = []
    errors: list[dict] = []
    for row in rows:
        # Per-row isolation again: one locked row must not strand the rest of the batch
        # half-reversed with no report of which half.
        try:
            frappe.db.set_value(
                DECISION_DOCTYPE, row["name"], "superseded", 1, update_modified=False
            )
            reversed_names.append(row["name"])
        except Exception as exc:
            errors.append({"flag_identity": row.get("flag_identity"), "error": str(exc)})

    _record_reversal_note(reversed_names, note=note, group_key=group_key)
    frappe.db.commit()

    # `superseded` flips through raw set_value, which fires no document hooks, so the
    # doc_event that busts the 60s queue cache never runs on a reversal — unlike
    # decide_flags, which invalidates it via the insert. Invalidate explicitly,
    # best-effort: a cache miss must not fail a reversal that has already committed.
    try:
        from dewey_time.attendance_engine.flag_queue_api import invalidate_flag_queue_cache

        invalidate_flag_queue_cache()
    except Exception:
        frappe.log_error(title="flag decision reversal: queue cache invalidation failed")

    return {
        "ok": not errors,
        "reversed": len(reversed_names),
        "group_key": group_key,
        "errors": errors,
    }
