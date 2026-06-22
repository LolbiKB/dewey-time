from __future__ import annotations

from datetime import date, datetime, timedelta, time


def _as_date(d) -> date:
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return date.fromisoformat(str(d)[:10])


def shift_time_to_minutes(value) -> int | None:
    """Parse Shift Type time values (time, timedelta, or HH:MM string) to minutes since midnight."""
    if value is None:
        return None
    if isinstance(value, timedelta):
        total = int(value.total_seconds()) % (24 * 3600)
        return (total // 3600) * 60 + (total % 3600) // 60
    if isinstance(value, time):
        return value.hour * 60 + value.minute
    if hasattr(value, "hour") and not isinstance(value, datetime):
        return value.hour * 60 + value.minute
    text = str(value).strip()
    parts = text.split(":")
    if len(parts) < 2:
        return None
    try:
        hh = int(parts[0])
        mm = int(parts[1])
    except ValueError:
        return None
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        return None
    return hh * 60 + mm


def combine_date_time(d, t) -> datetime:
    """Combine attendance date with a Shift Type time (time, timedelta, datetime, or string)."""
    d = _as_date(d)
    if isinstance(t, datetime):
        return datetime(d.year, d.month, d.day, t.hour, t.minute, t.second)
    if isinstance(t, time):
        return datetime(d.year, d.month, d.day, t.hour, t.minute, t.second)
    if isinstance(t, timedelta):
        total = int(t.total_seconds()) % (24 * 3600)
        hours = total // 3600
        minutes = (total % 3600) // 60
        seconds = total % 60
        return datetime(d.year, d.month, d.day, hours, minutes, seconds)
    if hasattr(t, "hour"):
        return datetime(d.year, d.month, d.day, t.hour, t.minute, t.second)
    text = str(t).strip()
    parts = text.split(":")
    if len(parts) >= 2:
        try:
            hh = int(parts[0])
            mm = int(parts[1])
            ss = int(parts[2]) if len(parts) > 2 else 0
            return datetime(d.year, d.month, d.day, hh, mm, ss)
        except ValueError:
            pass
    raise ValueError(f"Unsupported shift time value: {t!r}")
