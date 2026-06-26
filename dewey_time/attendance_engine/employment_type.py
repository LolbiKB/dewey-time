"""Pure employment-type policy for Weekly Schedule.

Frappe-free on purpose: the eligibility allowlist and the schedule-derived
employment-type rules are plain data/arithmetic, so they live here and can be
unit-tested with ``python3 -m unittest`` without a bench. ``schedule_resolver``,
``schedule_import``, and ``schedule_api`` import their employment-type
primitives from this module.

Policy:
- Eligible (Weekly-Schedule-allowed) types: Full-time, Part-time Fixed, Intern.
- When an import row is otherwise valid but the *only* blocker is an
  ineligible/blank employment type, the type is derived from the scheduled
  weekly hours instead of blocking: >= 40 h/week -> Full-time, else Part-time
  Fixed.
"""

from __future__ import annotations

WEEKLY_SCHEDULE_EMPLOYMENT_TYPES: tuple[str, ...] = (
    "Full-time",
    "Part-time Fixed",
    "Intern",
)

# >= this many scheduled minutes per week counts as Full-time.
FULL_TIME_WEEKLY_MINUTES = 40 * 60


def is_weekly_schedule_eligible(employment_type: str | None) -> bool:
    normalized = (employment_type or "").strip().lower()
    if not normalized:
        return False
    allowed = {value.lower() for value in WEEKLY_SCHEDULE_EMPLOYMENT_TYPES}
    return normalized in allowed


def _time_to_minutes(value) -> int | None:
    """Minutes-since-midnight for ``HH:MM`` / ``HH:MM:SS`` strings or time objects."""
    if value is None:
        return None
    if hasattr(value, "hour"):  # datetime.time / datetime
        return value.hour * 60 + value.minute
    text = str(value).strip()
    if not text:
        return None
    parts = text.split(":")
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return None


def weekly_scheduled_minutes(week_pattern: dict | None) -> int:
    """Total scheduled working minutes across the week, lunch gaps excluded."""
    if not week_pattern:
        return 0
    total = 0
    for day in week_pattern.get("days", []):
        if not day.get("works"):
            continue
        start = _time_to_minutes(day.get("start_time"))
        end = _time_to_minutes(day.get("end_time"))
        if start is None or end is None:
            continue
        span = end - start
        if span < 0:  # overnight shift safety
            span += 24 * 60
        lunch_start = _time_to_minutes(day.get("lunch_start"))
        lunch_end = _time_to_minutes(day.get("lunch_end"))
        if lunch_start is not None and lunch_end is not None:
            lunch = lunch_end - lunch_start
            if lunch > 0:
                span -= lunch
        if span > 0:
            total += span
    return total


def derive_employment_type(weekly_minutes: int) -> str:
    """>= 40 h/week -> Full-time, otherwise Part-time Fixed."""
    return "Full-time" if weekly_minutes >= FULL_TIME_WEEKLY_MINUTES else "Part-time Fixed"


def _supported_types_label(conjunction: str = "and") -> str:
    types = list(WEEKLY_SCHEDULE_EMPLOYMENT_TYPES)
    if len(types) == 1:
        return types[0]
    return f"{', '.join(types[:-1])}, {conjunction} {types[-1]}"


def ineligible_block_message(employment_type: str | None) -> str:
    """User-facing message when an ineligible employee is scheduled without derivation."""
    if not (employment_type or "").strip():
        return (
            "This employee has no employment type set. "
            f"Weekly Schedule supports {_supported_types_label('and')} only."
        )
    return (
        f"This employee ({employment_type}) is not eligible for Weekly Schedule. "
        f"Choose {_supported_types_label('or')}."
    )


def resolve_apply_employment_type(
    employment_type: str | None,
    week_pattern: dict | None,
    *,
    derive: bool,
) -> tuple[str, str | None]:
    """Decide what to do with an employee's type when applying a weekly schedule.

    Returns ``(action, value)``:
      - ``("ok", None)``          already eligible — leave the record alone.
      - ``("set", "<type>")``     derive mode — persist this derived type.
      - ``("block", "<message>")``  ineligible and not deriving — caller raises.
    """
    if is_weekly_schedule_eligible(employment_type):
        return ("ok", None)
    if not derive:
        return ("block", ineligible_block_message(employment_type))
    return ("set", derive_employment_type(weekly_scheduled_minutes(week_pattern)))
