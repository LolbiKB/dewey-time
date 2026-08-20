"""What a punch receipt is allowed to claim, computed from the punches alone.

Frappe-free on purpose, like employment_type.py: the direction of a punch is
plain arithmetic over the day's punch rows, so it lives here where it can be
unit-tested without a bench -- and locked, fixture by fixture, against the
TypeScript pairing in attendancePunches.ts that draws the same day on screen
(dewey_time/tests/fixtures/punch_replay_fixtures.json is read by both suites).

THE RULE IS THE TIMELINE'S RULE, REPLAYED MID-STREAM. `pairRun` in
attendancePunches.ts decides retrospectively: a label is believed, an
unlabelled punch takes its position in its branch run, the first arrival
stays open, and a duplicate arrival is noise. This module walks the same
punches in the same order but stops at the punch being announced, because the
notifier speaks at punch time and a later punch must not change what this
message said.

Mid-stream, one thing is genuinely weaker: the timeline sees the whole day
and can call the last punch of a run a departure; the notifier cannot know a
punch is anyone's last. So where retrospection would guess, `announce`
returns NO_VERB and the message degrades to a neutral receipt. A confident
"Checked in" to someone walking out of the building is the failure this
module exists to end; silence beats a confident wrong sentence.

Two deliberate departures from a literal replay, both toward saying less:

- A DOUBLE TAP is dropped, not paired. An unlabelled punch within
  DUP_WINDOW_SECONDS of the previous kept punch at the same branch is a
  bounced read of one physical visit to one device -- pairing it (as the
  retrospective rule does) closes the real arrival with a seconds-long
  segment and inverts every later verb that day. Because nobody can walk out
  through a reader and back in again inside the window, dropping the bounce
  RESTORES the true stream, and every later verb stays claimable. That
  reasoning is exactly why the window must stay tight: at an earlier 120
  seconds it swallowed a genuine ninety-second errand, and the drop itself
  then inverted the rest of the run -- the same failure, caused by the cure.
  The dropped punch gets NO_VERB, and any day containing one never reports
  an hours figure, because the timeline will have paired what we dropped and
  the two surfaces must not disagree in writing.

- A FRESH RUN OPENED MID-DAY gets NO_VERB. At compose time, a first punch at
  a second campus is indistinguishable from a departure through that campus's
  exit device. It still OPENS an arrival for later pairing -- if an out-punch
  follows at the same campus, that pair is as real as the timeline says it is
  -- but the opener's own verb is not claimable.
"""

from __future__ import annotations

from datetime import datetime

IN = "IN"
OUT = "OUT"
#: No claim. compose() renders this as the neutral receipt.
NO_VERB = ""

#: An unlabelled punch this close behind the previous kept punch at the same
#: branch is a double tap. TEN SECONDS, deliberately physical: a fingerprint
#: read takes a second or two, and there is no way to leave through a reader
#: and return to it inside ten -- so a punch inside the window can only be a
#: bounce, and dropping it is safe for every verb that follows. A wider
#: window is not more conservative, it is less: anything long enough to
#: contain real movement turns the drop itself into the parity bug.
DUP_WINDOW_SECONDS = 10


def _label(punch: dict) -> str:
    value = str(punch.get("log_type") or "").strip().upper()
    return value if value in (IN, OUT) else ""


def _branch(punch: dict) -> str | None:
    value = (punch.get("custom_device_branch") or "").strip()
    return value or None


def _time(punch: dict) -> datetime | None:
    value = punch.get("time")
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    # "YYYY-MM-DD HH:MM:SS" from a fixture or a str()'d db value; tolerate a
    # T separator and trailing microseconds.
    text = str(value).strip().replace(" ", "T")[:19]
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def announce(punches: list[dict]) -> dict:
    """Verb for the LAST punch in `punches`, plus what else a receipt may claim.

    `punches` is the day's rows in delivery order, ending at the punch being
    announced -- the caller bounds the list at that punch's own time, never at
    "now". Each row carries `time`, `log_type`, `custom_device_branch`.

    Returns:
      verb                  IN / OUT / NO_VERB for the last punch
      is_first_punch_of_day the last punch is the day's first kept punch
      so_far_minutes        summed minutes across closed pairs, or None.
                            Present ONLY when the verb is OUT and every punch
                            so far sits inside a closed same-branch pair --
                            no duplicates dropped, no branchless punches, no
                            stray or still-open arrivals. Anything less and
                            the figure would disagree with the timeline or
                            with reality, so it is withheld entirely.

    The walk is causal: a punch's verb depends only on the punches before it,
    so announcing at every prefix of a day gives the same verbs as one pass
    over the whole day. That is the property the bounded query relies on.
    """
    verbs: list[str] = []
    pairs = 0
    total_minutes = 0
    kept = 0
    dups = 0
    branchless = 0

    run_branch: str | None = None
    run_len = 0
    open_time: datetime | None = None
    first_seen = False
    first_kept_index: int | None = None
    prev_kept_time: datetime | None = None
    prev_kept_branch: str | None = None

    for index, punch in enumerate(punches):
        label = _label(punch)
        branch = _branch(punch)
        when = _time(punch)

        if (
            not label
            and branch is not None
            and branch == prev_kept_branch
            and when is not None
            and prev_kept_time is not None
            and 0 <= (when - prev_kept_time).total_seconds() <= DUP_WINDOW_SECONDS
        ):
            dups += 1
            verbs.append(NO_VERB)
            continue

        if branch is None:
            # A rogue punch is its own run and breaks the current one, exactly
            # as groupCheckinsByBranchRuns does -- whatever was open can never
            # match now, and the punches on either side of it will not pair
            # across it.
            branchless += 1
            kept += 1
            if label:
                verbs.append(label)
            elif not first_seen:
                verbs.append(IN)
            else:
                verbs.append(NO_VERB)
            if not first_seen:
                first_kept_index = index
            first_seen = True
            run_branch = None
            run_len = 0
            open_time = None
            prev_kept_time = when
            prev_kept_branch = None
            continue

        if run_branch is None or branch != run_branch:
            # Abandoning an open arrival here is the retrospective rule too:
            # nothing in a later run can close it.
            run_branch = branch
            run_len = 0
            open_time = None
        run_len += 1
        kept += 1

        if label == OUT:
            if open_time is not None and when is not None:
                pairs += 1
                total_minutes += _pair_minutes(open_time, when)
                open_time = None
            # A stray OUT (nothing open) matches nothing; kept != 2*pairs
            # keeps the hours figure off for the rest of the day.
            verbs.append(OUT)
        elif label == IN:
            # First arrival stays open; a labelled repeat is noise (pairRun's
            # own comment: the earlier punch is when the person actually got
            # there).
            if open_time is None:
                open_time = when
            verbs.append(IN)
        elif open_time is not None:
            if when is not None:
                pairs += 1
                total_minutes += _pair_minutes(open_time, when)
            open_time = None
            verbs.append(OUT)
        elif not first_seen:
            open_time = when
            verbs.append(IN)
        elif run_len > 1:
            # Same-branch continuation with nothing open: a return after a
            # closed pair at this campus. The lunch-comeback.
            open_time = when
            verbs.append(IN)
        else:
            # Fresh run opened mid-day: opens for later pairing, but its own
            # verb is not claimable -- see the module docstring.
            open_time = when
            verbs.append(NO_VERB)

        if not first_seen:
            first_kept_index = index
        first_seen = True
        prev_kept_time = when
        prev_kept_branch = branch

    verb = verbs[-1] if verbs else NO_VERB
    clean = (
        verb == OUT
        and dups == 0
        and branchless == 0
        and kept == 2 * pairs
        and open_time is None
    )
    return {
        "verb": verb,
        "is_first_punch_of_day": (
            first_kept_index is not None and first_kept_index == len(punches) - 1
        ),
        "so_far_minutes": total_minutes if clean else None,
    }


def _pair_minutes(start: datetime, end: datetime) -> int:
    """One pair's minutes, rounded the way the timeline rounds.

    deriveSegments does `Math.round(delta / 60000)` PER SEGMENT and its
    callers sum the rounded values. Flooring the summed seconds instead
    agrees with that only when every punch lands on a whole minute -- real
    device rows carry seconds, and a figure one minute off from the app is a
    figure the app contradicts in writing. Math.round is floor(x + 0.5),
    which is not Python's round() (banker's), so it is spelled out.
    """
    seconds = max(0.0, (end - start).total_seconds())
    return int(seconds / 60 + 0.5)


# ---------------------------------------------------------------------------
# The meaning line. Formatting only -- every gate that decides WHETHER one of
# these lines may be said lives with the queries in notify.py; what lives
# here is the guarantee that both languages say the same thing. The
# formatters stay PAIR-BUILDING (Khmer first, English second) even though
# each message now carries only the language chosen on the link: building
# both halves together is what keeps them reviewed together, and
# notify.compose picks the one to send. ASCII digits and AM/PM in both
# languages for now, matching the verb line's stamp -- Khmer numerals mean
# porting the Mini App's formatter and are a recorded open question, not an
# oversight.

#: The roster holds nothing for this day, said only when the roster has
#: actually opined about the day (see notify's horizon gate) and only to
#: employees whose employment type promises a roster at all.
NO_ROSTER_LINES = (
    "មិនមានវេនក្នុងកាលវិភាគថ្ងៃនេះ",
    "No shift on your roster today",
)


def _ampm(minutes: int) -> str:
    hours24, mins = divmod(minutes % (24 * 60), 60)
    suffix = "AM" if hours24 < 12 else "PM"
    hours12 = hours24 % 12 or 12
    return f"{hours12}:{mins:02d} {suffix}"


def format_shift_window_lines(start_minutes: int, end_minutes: int) -> tuple[str, str]:
    """The roster stated as a fact: the window, no comparison to the punch.

    Reads identically for the person who arrived early and the one who
    arrived late -- that is the point. Lateness is a closeout verdict this
    message must never anticipate.
    """
    window = f"{_ampm(start_minutes)} – {_ampm(end_minutes)}"
    return (f"វេន {window}", f"Shift {window}")


def _duration_en(minutes: int) -> str:
    hours, mins = divmod(minutes, 60)
    if hours and mins:
        return f"{hours}h {mins}m"
    if hours:
        return f"{hours}h"
    return f"{mins}m"


def _duration_km(minutes: int) -> str:
    hours, mins = divmod(minutes, 60)
    if hours and mins:
        return f"{hours} ម៉ោង {mins} នាទី"
    if hours:
        return f"{hours} ម៉ោង"
    return f"{mins} នាទី"


def format_so_far_lines(minutes: int) -> tuple[str, str]:
    """Accumulated paired time, phrased as a running figure, never a total.

    "So far" is load-bearing: nothing on this path knows a punch is the last
    one, so the wording must stay true if the person comes back after
    dinner. The figure itself is announce()'s so_far_minutes, which is only
    ever present when every punch so far pairs cleanly and therefore always
    equals the timeline's own sum.
    """
    # ថ្ងៃនេះ scopes the Khmer half to the day the way "today" scopes the
    # English -- without it the line read as a running total to anyone
    # scrolling back through the chat on Thursday. (Khmer strings across
    # this module still await native review.)
    return (
        f"ថ្ងៃនេះ គិតត្រឹមពេលនេះ {_duration_km(minutes)}",
        f"So far today {_duration_en(minutes)}",
    )
