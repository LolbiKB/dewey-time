# Mini App day flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An employee can see what the attendance engine noticed about their own day — a pill bottom-left of the Today tab carrying a count, opening a bottom sheet that lists that day's flags in plain language with HR's decision attached.

**Architecture:** The server gains a second fail-closed allowlist in `miniapp_api.py` that lets nine flag codes and four fields through, plus two certainty rules that withhold provisional flags which can withdraw themselves. The client gets one pure module (`miniFlags.ts`) mapping codes to strings and resolving the status line, and two components (`MiniFlagButton`, `MiniFlagsSheet`) mounted from `MyDayPage`. Read-only throughout: no write endpoint exists and none is added.

**Tech Stack:** Frappe/Python 3 backend (`unittest`, `unittest.mock`); React 19 + TypeScript + Tailwind v4 frontend; `@lolbikb/dewey-ui` v3 primitives (`Sheet`); `tsx --test` (node:test) for unit and DOM tests; Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-17-miniapp-day-flags-design.md`

## Global Constraints

- **Built assets ARE the deployed artifact and MUST be committed.** Frappe Cloud never builds these SPAs. `dewey_time/public/**` and `dewey_time/www/*.html` are committed in the same branch.
- **Allowlists are fail-closed, never denylists.** Written as removals, a field added for an HR need reaches every employee silently with no test failing. Both new allowlists are membership tests, and both are pinned by an equality assertion, never by an "is absent" assertion.
- **`evidence` is never sent to the client.** It carries grace minutes, thresholds and rule internals. Rule 2 below reads it server-side and discards it.
- **Amber for problem states, never `destructive`.** Red is the loudest colour in the palette and this surface has never spent it. Same rule as the calendar marks in `MiniCalendarSheet.tsx`.
- **`Sheet`, never `ResponsiveModal`.** `ResponsiveModal` swaps to a centre Dialog above a width breakpoint and Telegram Desktop is wide enough to trip it. This must be a bottom sheet everywhere.
- **No numbers in the flag copy.** With `evidence` unexposed there is no trustworthy duration to quote; the timeline behind the sheet draws the times.
- **Khmer strings are unreviewed** and carry the existing native-speaker caveat. Copy them verbatim from the spec; do not improvise new ones.
- **Every commit ends with:**
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U57KAfPhiYScJgmrzYjK9A
  ```
- **Never bare `git stash` / `git stash pop`** — the stash stack is shared with other worktrees and other sessions. Use a temporary WIP commit instead.
- Branch is `feat/miniapp-day-flags`, already created, already carrying the spec commit `17520efc`.

## File Structure

**Backend**
- `dewey_time/telegram/miniapp_api.py` — modify. Gains `EMPLOYEE_FLAG_CODES`, `FLAG_KEYS`, `_certain()`, `_pick_flags()`; `"flags"` joins `DAY_KEYS`. This file is the entire employee-facing projection and stays the only place that decides what an employee may see.
- `dewey_time/tests/test_telegram_miniapp_api.py` — modify. One existing test (`test_no_flags_reach_the_employee`) is deliberately rewritten; the day-key-set equality gains `"flags"`.

**Frontend**
- `src/types/calendar.ts` — modify. Two optional fields join `Flag`, which currently under-describes the payload.
- `src/miniapp/miniStrings.ts` — modify. 25 new keys, EN and KM.
- `src/miniapp/miniFlags.ts` — create. Pure: code→string mapping, the visible filter, the status-line resolver. No React, no DOM, so its rules are testable without a render.
- `src/miniapp/MiniFlagButton.tsx` — create. The pill alone, so its hidden-at-zero rule is one component's problem.
- `src/miniapp/MiniFlagsSheet.tsx` — create. The sheet alone.
- `src/miniapp/MyDayPage.tsx` — modify. Mounts both and owns the open state.

**Tests**
- `src/miniapp/miniFlags.test.ts` — create.
- `src/miniapp/miniFlagsSheet.test.tsx` — create.
- `e2e/miniapp.spec.ts` — modify.

---

### Task 1: The server projection

**Files:**
- Modify: `dewey_time/telegram/miniapp_api.py`
- Test: `dewey_time/tests/test_telegram_miniapp_api.py`

**Interfaces:**
- Consumes: `hr_calendar.build_employee_calendar`, which already puts `flags` on each day (`hr_calendar.py:795`), already sets `is_provisional` (`:737`), and already redacts `decision` to `{outcome, decided_at}` for a non-HR viewer (`:729`). Mini App requests carry no Frappe session, so they receive the redacted shape already.
- Produces: each day in the payload gains `flags`, a list of dicts with exactly the keys `flag_code`, `is_provisional`, `decision`, `decision_state`. Task 2's `miniFlags.ts` reads exactly those four names.

- [ ] **Step 1: Write the failing tests**

Add to `dewey_time/tests/test_telegram_miniapp_api.py`. First a fixture builder, placed just below `HR_PAYLOAD`:

```python
def _flag(code, **over):
    """A full HR flag row — including everything an employee must never see."""
    row = {
        "name": f"AUTO-emp-1-2026-08-14-{code.lower()}",
        "flag_code": code,
        "severity": "CRITICAL",
        "status": "OPEN",
        "source": "AUTO",
        "day_closed": 1,
        "is_provisional": False,
        "hr_note": "spoke to the supervisor",
        "rule_version": "v3",
        "linked_checkin": "EMP-CKIN-1",
        "evidence": {"first_in": "07:58", "grace_minutes": 15},
        "decision": None,
        "decision_state": "undecided",
    }
    row.update(over)
    return row


def _day(flags, checkins=()):
    return {
        "employee": "HR-EMP-00001",
        "days": [{
            "date": "2026-08-14",
            "checkins": [{"time": t} for t in checkins],
            "flags": flags,
        }],
    }
```

Then a new test class, appended after `TestProjection`:

```python
class TestFlagProjection(unittest.TestCase):
    def _flags(self, payload):
        with patch.object(miniapp_api.miniapp_auth, "employee_from_init_data",
                          return_value="HR-EMP-00001"), \
             patch.object(miniapp_api.hr_calendar, "build_employee_calendar",
                          return_value=payload):
            got = miniapp_api.get_my_calendar("d", "2026-08-14", "2026-08-14")
        return got["days"][0]["flags"]

    def test_a_visible_flag_carries_exactly_four_fields(self):
        # Equality, not absence. An absence assertion passes forever while a
        # newly added field leaks.
        flags = self._flags(_day([_flag("LATE_START")]))
        self.assertEqual(len(flags), 1)
        self.assertEqual(
            set(flags[0]),
            {"flag_code", "is_provisional", "decision", "decision_state"},
        )

    def test_hr_internals_never_reach_the_employee(self):
        payload = repr(self._flags(_day([_flag("LATE_START")])))
        self.assertNotIn("grace_minutes", payload)
        self.assertNotIn("spoke to the supervisor", payload)
        self.assertNotIn("AUTO-emp-1", payload)
        self.assertNotIn("CRITICAL", payload)
        self.assertNotIn("EMP-CKIN-1", payload)

    def test_infrastructure_codes_are_not_the_employees_business(self):
        # Ours failing, not their day, and none of it actionable by them.
        flags = self._flags(_day([
            _flag("UNKNOWN_DEVICE_BRANCH"),
            _flag("DELIVERY_FAILED"),
            _flag("NON_PRIMARY_SITE_PUNCH"),
        ]))
        self.assertEqual(flags, [])

    def test_a_code_invented_later_is_hidden_by_default(self):
        # THE POINT OF THE ALLOWLIST. Written as a denylist this test would
        # pass only until somebody added a code to the engine.
        self.assertEqual(self._flags(_day([_flag("SOME_FUTURE_CODE")])), [])

    def test_a_provisional_absence_is_withheld(self):
        # intraday.py:175 raises it the moment the first MISSING_TIME interval
        # would have appeared and withdraws it when a punch lands. Somebody
        # whose approved leave is not keyed in yet would otherwise carry "no
        # record for this day" from mid-morning until closeout cleared it.
        flags = self._flags(_day([
            _flag("UNNOTIFIED_ABSENCE", is_provisional=True, day_closed=0),
        ]))
        self.assertEqual(flags, [])

    def test_a_closed_out_absence_is_shown(self):
        flags = self._flags(_day([_flag("UNNOTIFIED_ABSENCE")]))
        self.assertEqual([f["flag_code"] for f in flags], ["UNNOTIFIED_ABSENCE"])

    def test_a_provisional_gap_that_is_still_running_is_withheld(self):
        # The engine measures today's gaps up to the present minute, so an
        # untracked lunch is a 31-minute gap at 12:31 while the person eats.
        flags = self._flags(_day(
            [_flag("MISSING_TIME", is_provisional=True, day_closed=0,
                   evidence={"interval_start": "2026-08-14T12:00:00",
                             "interval_end": "2026-08-14T12:31:00"})],
            checkins=["2026-08-14 08:02:00", "2026-08-14 12:00:00"],
        ))
        self.assertEqual(flags, [])

    def test_a_provisional_gap_that_ended_is_shown(self):
        # A punch landed after it, so the gap is closed and certain.
        flags = self._flags(_day(
            [_flag("MISSING_TIME", is_provisional=True, day_closed=0,
                   evidence={"interval_start": "2026-08-14T12:00:00",
                             "interval_end": "2026-08-14T12:31:00"})],
            checkins=["2026-08-14 12:00:00", "2026-08-14 12:58:00"],
        ))
        self.assertEqual([f["flag_code"] for f in flags], ["MISSING_TIME"])

    def test_a_final_gap_needs_no_later_punch(self):
        flags = self._flags(_day(
            [_flag("MISSING_TIME",
                   evidence={"interval_end": "2026-08-14T12:31:00"})],
            checkins=[],
        ))
        self.assertEqual([f["flag_code"] for f in flags], ["MISSING_TIME"])

    def test_the_gap_comparison_parses_instead_of_comparing_strings(self):
        # THE TEST THAT EARNS ITS PLACE. evidence stores an ISO datetime with a
        # "T" and Frappe stores checkin times with a space. Compared as
        # strings, " " < "T", so "2026-08-14 12:58:00" sorts BEFORE
        # "2026-08-14T12:31:00" and a genuinely closed gap is withheld
        # forever. The naive implementation passes every other test here.
        flags = self._flags(_day(
            [_flag("MISSING_TIME", is_provisional=True, day_closed=0,
                   evidence={"interval_end": "2026-08-14T12:31:00"})],
            checkins=["2026-08-14 12:58:00"],
        ))
        self.assertEqual([f["flag_code"] for f in flags], ["MISSING_TIME"],
                         "a space-separated punch time must parse, not sort")

    def test_a_gap_with_no_interval_end_is_withheld_while_provisional(self):
        # Nothing to compare against is not the same as certain.
        flags = self._flags(_day(
            [_flag("MISSING_TIME", is_provisional=True, day_closed=0, evidence={})],
            checkins=["2026-08-14 12:58:00"],
        ))
        self.assertEqual(flags, [])

    def test_a_day_with_no_flags_gets_an_empty_list_not_a_missing_key(self):
        # The client counts len(flags); a missing key would make every day
        # need a guard, and one of them would be forgotten.
        self.assertEqual(self._flags(_day([])), [])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m unittest dewey_time.tests.test_telegram_miniapp_api -v`
Expected: FAIL — `KeyError: 'flags'`, because `narrow()` drops the key today.

- [ ] **Step 3: Update the two existing tests that pin the old behaviour**

`test_the_day_key_set_is_exactly_the_allowlist` gains `"flags"`:

```python
        self.assertEqual(
            set(day),
            {"date", "shift", "checkins", "holiday", "leave", "observed_lunch",
             "first_in", "last_out", "flags"},
        )
```

`test_no_flags_reach_the_employee` is **rewritten, not deleted** — its subject changed, and the parts of it that still hold are the ones worth keeping. Replace the whole method with:

```python
    def test_flags_reach_the_employee_stripped_of_everything_hr_only(self):
        # This test used to assert that NO flag reached the employee, and the
        # reason it gave was sound: intraday deletes and re-inserts AUTO flags
        # on every checkin, so an employee watching them would see provisional
        # judgments appear and vanish all day. The day-flags design keeps that
        # reasoning and answers it differently -- see the certainty rules in
        # TestFlagProjection, which withhold exactly the provisional flags that
        # can withdraw themselves. What must never come back is the payload
        # around the flag.
        payload = self._narrowed()
        self.assertEqual(
            set(payload["days"][0]["flags"][0]),
            {"flag_code", "is_provisional", "decision", "decision_state"},
        )
        self.assertNotIn("AUTO-emp-1", repr(payload))
        self.assertNotIn("grace_minutes", repr(payload))
```

`HR_PAYLOAD`'s single flag needs the fields the new assertion reads. Replace its `flags` block with:

```python
            "flags": [
                {
                    "name": "AUTO-emp-1-2026-08-14-late-start",
                    "flag_code": "LATE_START",
                    "severity": "WARNING",
                    "is_provisional": False,
                    "evidence": {"first_in": "07:58", "grace_minutes": 15},
                    "decision": None,
                    "decision_state": "undecided",
                }
            ],
```

- [ ] **Step 4: Implement the projection**

In `dewey_time/telegram/miniapp_api.py`, extend the import at line 23:

```python
from frappe.utils import date_diff, get_datetime, getdate
```

Add `"flags"` as the last entry of `DAY_KEYS`, then add below `CHECKIN_KEYS`:

```python
#: Flag codes an employee may be told about.
#:
#: An ALLOWLIST for the same reason DAY_KEYS is one: written as removals, a
#: code added to the engine next year would reach every employee silently with
#: no test failing. Built this way it stays hidden until somebody edits this
#: set on purpose.
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
#: `decision` arrives already redacted to {outcome, decided_at} for a non-HR
#: viewer (hr_calendar.py:729), which is why it is safe to pass through whole.
FLAG_KEYS = ("flag_code", "is_provisional", "decision", "decision_state")


def _certain(flag: dict, checkins: list[dict]) -> bool:
    """Is this flag safe to show the person it describes?

    A final flag is a fact about the record. A PROVISIONAL one is the engine
    mid-thought: intraday deletes and re-inserts AUTO flags on every punch, so
    two of them can appear in the morning and be gone by closeout. Showing
    those turns this surface into an accusation that withdraws itself.

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
    # -- so an untracked lunch becomes a 31-minute gap at 12:31 while the
    # person is still eating. A gap that ended because a punch resumed after it
    # is certain; that is what this asks.
    if code == "MISSING_TIME":
        end = get_datetime((flag.get("evidence") or {}).get("interval_end"))
        if end is None:
            return False
        # PARSED, not compared as strings. evidence stores an ISO datetime with
        # a "T" and Frappe stores punch times with a space; " " sorts before
        # "T", so a string compare puts 12:58 BEFORE 12:31 and withholds a
        # closed gap forever.
        return any(
            (punch := get_datetime(c.get("time"))) is not None and punch >= end
            for c in checkins
        )

    return True


def _pick_flags(day: dict) -> list[dict]:
    checkins = day.get("checkins") or []
    return [
        _pick(flag, FLAG_KEYS)
        for flag in (day.get("flags") or [])
        if flag.get("flag_code") in EMPLOYEE_FLAG_CODES and _certain(flag, checkins)
    ]
```

`get_datetime` raises on unparseable input rather than returning None, so wrap it once at the top of the module beside `_pick`:

```python
def _at(value):
    """A datetime, or None -- never an exception.

    frappe.utils.get_datetime raises on junk, and one malformed evidence value
    must not take the whole Mini App down to hide one flag.
    """
    if not value:
        return None
    try:
        return get_datetime(value)
    except Exception:
        return None
```

and use `_at(...)` in `_certain` in place of both `get_datetime(...)` calls.

Finally, in `narrow()`, add the flags line beside the checkins line:

```python
        narrowed["checkins"] = [
            _pick(c, CHECKIN_KEYS) for c in (day.get("checkins") or [])
        ]
        # Always a list, never absent: the client counts it, and a missing key
        # would need a guard on every day -- one of which would be forgotten.
        narrowed["flags"] = _pick_flags(day)
        days.append(narrowed)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m unittest dewey_time.tests.test_telegram_miniapp_api -v`
Expected: PASS, all tests including the two revised ones.

Also run the neighbouring suite, which shares the frappe mock:
Run: `python -m unittest dewey_time.tests.test_telegram_miniapp_auth -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dewey_time/telegram/miniapp_api.py dewey_time/tests/test_telegram_miniapp_api.py
git commit -m "feat(miniapp): the day's flags reach the employee, through two allowlists"
```

---

### Task 2: The words and the rules

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/src/types/calendar.ts`
- Modify: `dewey_time/frontend/hr_attendance/src/miniapp/miniStrings.ts`
- Create: `dewey_time/frontend/hr_attendance/src/miniapp/miniFlags.ts`
- Test: `dewey_time/frontend/hr_attendance/src/miniapp/miniFlags.test.ts`

**Interfaces:**
- Consumes: Task 1's four-field flag shape; `StringKey` from `miniStrings.ts`; `DecisionState` and `Outcome` from `@/types/flags` (both already exist — `flags.ts:13` and `:15`).
- Produces: `visibleFlags(day) → Flag[]`, `flagCount(day) → number`, `flagText(flag) → {title: StringKey; body: StringKey} | null`, `flagStatusKey(flag) → StringKey`. Task 3 renders exactly these.

- [ ] **Step 1: Widen the `Flag` type**

`src/types/calendar.ts` currently under-describes the payload: `hr_calendar.py:738-739` puts `decision` and `decision_state` on every flag row and the type does not mention them. Add them as optional — nothing else changes, and both are optional so no existing consumer breaks.

At the top of the file, extend the existing import:

```ts
import type { DecisionState, Outcome, RolloutPhase } from "@/types/flags";
```

Then in `Flag`, below `evidence`:

```ts
  /**
   * HR's live decision, or null while undecided.
   *
   * NARROWER than `FlagDecision` in types/flags.ts on purpose: hr_calendar
   * redacts this to {outcome, decided_at} for a non-HR viewer (hr_calendar.py:729),
   * so the note, the reason and who decided are absent in the employee's own
   * view. Typed as the intersection both callers can rely on.
   */
  decision?: { outcome?: Outcome | null; decided_at?: string | null } | null;
  /** Whether HR's decision still matches this flag's identity. */
  decision_state?: DecisionState;
```

- [ ] **Step 2: Add the strings**

In `src/miniapp/miniStrings.ts`, append to `EN` (before its closing brace), and the matching Khmer block to `KM` in the same order. Copy both verbatim from the spec's tables — the `EN` block:

```ts
  // Day flags. The engine's findings, in the second person, as RECORDS rather
  // than verdicts — the same rule the day states above follow.
  //
  // No numbers anywhere: `evidence` is never sent to this app (grace minutes
  // are HR-only), so there is no duration here that could be trusted. The
  // timeline directly behind the sheet draws the times.
  flagsToCheck: "{n} to check",
  flagsSheetTitle: "Things to check",
  flagsNone: "Nothing to check on this day.",

  flagLateStart: "Late start",
  flagLateStartBody: "Your first check-in was after your shift started.",
  flagLeftEarly: "Left early",
  flagLeftEarlyBody: "Your last check-out was before your shift ended.",
  flagLateFromLunch: "Late back from lunch",
  flagLateFromLunchBody: "You checked back in after your lunch break ended.",
  flagMissingTime: "Gap in your record",
  flagMissingTimeBody: "There's a stretch of your shift with no check-in covering it.",
  flagMissingInOrOut: "Only one check-in",
  flagMissingInOrOutBody:
    "Only one check-in was recorded, so there's no start-and-finish pair.",
  // UNNOTIFIED_ABSENCE maps here. "Unnotified absence" is a verdict word and
  // this app has no standing to use it; "no record" is what the data says, and
  // HR can still forgive it.
  flagNoRecord: "No record for this day",
  flagNoRecordBody: "This was a working day and no check-ins were recorded.",
  flagOffShiftPunch: "Checked in on a non-working day",
  flagOffShiftPunchBody:
    "Check-ins were recorded on a day you weren't scheduled to work.",
  flagMissingLunch: "Lunch not recorded",
  flagMissingLunchBody:
    "Your lunch break couldn't be matched to a check-out and check-in pair.",
  flagAttendanceIssue: "Record couldn't be matched up",
  flagAttendanceIssueBody:
    "Your check-ins for this day couldn't be paired into complete sessions.",

  flagStatusAwaiting: "Awaiting HR review",
  flagStatusExcused: "Excused by HR",
  flagStatusUpheld: "Upheld by HR",
  flagStatusRereview:
    "Awaiting HR review again — this day changed after it was reviewed",
```

and the `KM` block:

```ts
  flagsToCheck: "{n} ត្រូវពិនិត្យ",
  flagsSheetTitle: "អ្វីដែលត្រូវពិនិត្យ",
  flagsNone: "គ្មានអ្វីត្រូវពិនិត្យសម្រាប់ថ្ងៃនេះទេ។",

  flagLateStart: "ចាប់ផ្តើមយឺត",
  flagLateStartBody: "ការស្កេនចូលដំបូងរបស់អ្នកគឺក្រោយពេលវេនចាប់ផ្តើម។",
  flagLeftEarly: "ចេញមុនម៉ោង",
  flagLeftEarlyBody: "ការស្កេនចេញចុងក្រោយរបស់អ្នកគឺមុនពេលវេនបញ្ចប់។",
  flagLateFromLunch: "ត្រឡប់ពីអាហារថ្ងៃត្រង់យឺត",
  flagLateFromLunchBody: "អ្នកបានស្កេនចូលវិញក្រោយពេលសម្រាកអាហារថ្ងៃត្រង់បានបញ្ចប់។",
  flagMissingTime: "មានចន្លោះក្នុងកំណត់ត្រា",
  flagMissingTimeBody: "មានរយៈពេលមួយក្នុងវេនរបស់អ្នកដែលគ្មានការស្កេនគ្របដណ្តប់។",
  flagMissingInOrOut: "មានតែការស្កេនម្តង",
  flagMissingInOrOutBody:
    "មានតែការស្កេនមួយប៉ុណ្ណោះត្រូវបានកត់ត្រា ដូច្នេះគ្មានគូចូល និងចេញទេ។",
  flagNoRecord: "គ្មានកំណត់ត្រាសម្រាប់ថ្ងៃនេះ",
  flagNoRecordBody: "នេះជាថ្ងៃធ្វើការ ហើយគ្មានការស្កេនណាមួយត្រូវបានកត់ត្រាទេ។",
  flagOffShiftPunch: "ស្កេនក្នុងថ្ងៃមិនធ្វើការ",
  flagOffShiftPunchBody: "មានការស្កេនត្រូវបានកត់ត្រាក្នុងថ្ងៃដែលអ្នកមិនមានវេនធ្វើការ។",
  flagMissingLunch: "មិនមានកំណត់ត្រាអាហារថ្ងៃត្រង់",
  flagMissingLunchBody:
    "ការសម្រាកអាហារថ្ងៃត្រង់របស់អ្នកមិនអាចផ្គូផ្គងនឹងការស្កេនចេញ និងចូលបានទេ។",
  flagAttendanceIssue: "កំណត់ត្រាមិនអាចផ្គូផ្គងបាន",
  flagAttendanceIssueBody:
    "ការស្កេនរបស់អ្នកសម្រាប់ថ្ងៃនេះមិនអាចផ្គូផ្គងជាវគ្គពេញលេញបានទេ។",

  flagStatusAwaiting: "រង់ចាំការពិនិត្យពី HR",
  flagStatusExcused: "បានអនុគ្រោះដោយ HR",
  flagStatusUpheld: "បានបញ្ជាក់ដោយ HR",
  flagStatusRereview: "រង់ចាំការពិនិត្យឡើងវិញ — ថ្ងៃនេះមានការផ្លាស់ប្តូរក្រោយពេលពិនិត្យ។",
```

`StringKey` is `keyof typeof EN` and `KM` is typed against it, so a key added to one and forgotten in the other is a compile error rather than a screen that silently falls back to English.

- [ ] **Step 3: Write the failing test**

Create `src/miniapp/miniFlags.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { flagCount, flagStatusKey, flagText, visibleFlags } from "@/miniapp/miniFlags";
import type { Day, Flag } from "@/types/calendar";

const flag = (over: Partial<Flag> = {}): Flag =>
  ({ name: "f", flag_code: "LATE_START", ...over }) as Flag;

const day = (flags: Flag[]): Day => ({ date: "2026-08-14", flags });

test("a day with no flags counts zero rather than throwing", () => {
  assert.equal(flagCount(undefined), 0);
  assert.equal(flagCount({ date: "2026-08-14" }), 0);
  assert.equal(flagCount(day([])), 0);
});

test("the count and the list are the same function", () => {
  // Not two implementations that agree today. The flag-queue header shipped a
  // count that disagreed with the rows below it, from exactly this shape of
  // duplication.
  const d = day([flag(), flag({ flag_code: "LEFT_EARLY" })]);
  assert.equal(flagCount(d), visibleFlags(d).length);
});

test("a code with no employee wording is not rendered as a blank row", () => {
  // The server allowlist should already have removed these, but the client
  // must not render an empty card if one ever arrives — belt and braces
  // across a trust boundary.
  const d = day([flag({ flag_code: "UNKNOWN_DEVICE_BRANCH" }), flag()]);
  assert.deepEqual(visibleFlags(d).map((f) => f.flag_code), ["LATE_START"]);
});

test("every allowlisted code has both a title and a body", () => {
  // The one test that fails when the server list and the client table drift.
  const codes = [
    "LATE_START", "LEFT_EARLY", "LATE_FROM_LUNCH", "MISSING_TIME",
    "MISSING_IN_OR_OUT", "UNNOTIFIED_ABSENCE", "OFF_SHIFT_PUNCH",
    "MISSING_LUNCH", "ATTENDANCE_ISSUE",
  ];
  for (const code of codes) {
    const text = flagText(flag({ flag_code: code }));
    assert.ok(text, `${code} has no wording`);
    assert.ok(text.title && text.body, `${code} is missing a title or body`);
  }
});

test("an absence is worded as a missing record, never as an absence", () => {
  // "Unnotified absence" is a verdict this app has no standing to make.
  assert.equal(flagText(flag({ flag_code: "UNNOTIFIED_ABSENCE" }))?.title,
    "flagNoRecord");
});

test("an undecided flag reads as awaiting review", () => {
  assert.equal(flagStatusKey(flag()), "flagStatusAwaiting");
  assert.equal(flagStatusKey(flag({ decision: null })), "flagStatusAwaiting");
});

test("HR's outcomes are both shown", () => {
  assert.equal(flagStatusKey(flag({ decision: { outcome: "EXCUSED" } })),
    "flagStatusExcused");
  assert.equal(flagStatusKey(flag({ decision: { outcome: "UPHELD" } })),
    "flagStatusUpheld");
});

test("a decision that no longer matches the day loses to re-review", () => {
  // A stale verdict on a day that has since changed is worse than no verdict.
  assert.equal(
    flagStatusKey(flag({
      decision: { outcome: "EXCUSED" },
      decision_state: "needs_re_review",
    })),
    "flagStatusRereview",
  );
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd dewey_time/frontend/hr_attendance && npx tsx --test src/miniapp/miniFlags.test.ts`
Expected: FAIL — cannot resolve `@/miniapp/miniFlags`.

- [ ] **Step 5: Implement `miniFlags.ts`**

```ts
/**
 * What the engine noticed about a day, in words its subject can read.
 *
 * The wording rule is the same one miniStrings and miniDayMark follow: every
 * line here is a statement about the RECORD, never a verdict on the person.
 * "No record for this day" is a fact HR can still forgive; "unnotified
 * absence" is a claim this app has no standing to make — so UNNOTIFIED_ABSENCE
 * maps to the former.
 *
 * This table is also the client half of a two-sided allowlist. The server
 * (`miniapp_api.EMPLOYEE_FLAG_CODES`) decides what leaves the machine; a code
 * with no entry here renders nothing rather than an empty card, so the two
 * cannot drift into a blank row on somebody's phone.
 */
import type { Day, Flag } from "@/types/calendar";
import type { StringKey } from "@/miniapp/miniStrings";

const FLAG_TEXT: Record<string, { title: StringKey; body: StringKey }> = {
  LATE_START: { title: "flagLateStart", body: "flagLateStartBody" },
  LEFT_EARLY: { title: "flagLeftEarly", body: "flagLeftEarlyBody" },
  LATE_FROM_LUNCH: { title: "flagLateFromLunch", body: "flagLateFromLunchBody" },
  MISSING_TIME: { title: "flagMissingTime", body: "flagMissingTimeBody" },
  MISSING_IN_OR_OUT: { title: "flagMissingInOrOut", body: "flagMissingInOrOutBody" },
  UNNOTIFIED_ABSENCE: { title: "flagNoRecord", body: "flagNoRecordBody" },
  OFF_SHIFT_PUNCH: { title: "flagOffShiftPunch", body: "flagOffShiftPunchBody" },
  MISSING_LUNCH: { title: "flagMissingLunch", body: "flagMissingLunchBody" },
  ATTENDANCE_ISSUE: { title: "flagAttendanceIssue", body: "flagAttendanceIssueBody" },
};

export function flagText(flag: Flag): { title: StringKey; body: StringKey } | null {
  return FLAG_TEXT[flag.flag_code] ?? null;
}

/** The day's flags that this app has words for, in payload order. */
export function visibleFlags(day: Day | undefined): Flag[] {
  return (day?.flags ?? []).filter((flag) => flag.flag_code in FLAG_TEXT);
}

/** ONE function behind both the pill's number and the sheet's rows. */
export function flagCount(day: Day | undefined): number {
  return visibleFlags(day).length;
}

/**
 * The line under each flag: where HR has got to with it.
 *
 * `needs_re_review` beats the outcome deliberately. It means the day changed
 * after HR decided, so the stored verdict describes a day that no longer
 * exists — showing "Excused" then would be a promise the record cannot keep.
 */
export function flagStatusKey(flag: Flag): StringKey {
  if (flag.decision_state === "needs_re_review") return "flagStatusRereview";
  const outcome = flag.decision?.outcome;
  if (outcome === "EXCUSED") return "flagStatusExcused";
  if (outcome === "UPHELD") return "flagStatusUpheld";
  return "flagStatusAwaiting";
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx tsx --test src/miniapp/miniFlags.test.ts`
Expected: PASS, 8 tests.

Run: `npx tsc --noEmit`
Expected: no errors — this is what proves the KM block is exhaustive.

- [ ] **Step 7: Commit**

```bash
git add src/types/calendar.ts src/miniapp/miniStrings.ts src/miniapp/miniFlags.ts src/miniapp/miniFlags.test.ts
git commit -m "feat(miniapp): plain wording for the nine flags an employee can see"
```

---

### Task 3: The pill and the sheet

**Files:**
- Create: `dewey_time/frontend/hr_attendance/src/miniapp/MiniFlagButton.tsx`
- Create: `dewey_time/frontend/hr_attendance/src/miniapp/MiniFlagsSheet.tsx`
- Modify: `dewey_time/frontend/hr_attendance/src/miniapp/MyDayPage.tsx`
- Test: `dewey_time/frontend/hr_attendance/src/miniapp/miniFlagsSheet.test.tsx`

**Interfaces:**
- Consumes: `flagCount`, `visibleFlags`, `flagText`, `flagStatusKey` from Task 2; `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle` from `@/components/ui/sheet`; `useT` from `@/miniapp/MiniLocale`; `TAB_BAR_FLOOR_PX` from `@/miniapp/MiniAppShell`.
- Produces: nothing consumed by a later task. Task 4 asserts against the rendered DOM.

- [ ] **Step 1: Write the failing test**

Create `src/miniapp/miniFlagsSheet.test.tsx`. It follows `miniCalendarSheet.test.tsx`'s pattern, including the `CODE()` helper that strips comments before any "must not appear" assertion — the first draft of that file had two guards fail against comments naming the very things they forbade.

```tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** The same file with comments removed — see miniCalendarSheet.test.tsx. */
const CODE = (name: string) =>
  SRC(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the sheet is a bottom sheet everywhere, not a responsive modal", () => {
  // ResponsiveModal swaps to a centre Dialog above a width breakpoint and a
  // Telegram Desktop Mini App is wide enough to trip it.
  const code = CODE("MiniFlagsSheet.tsx");
  assert.ok(!code.includes("ResponsiveModal"), "must not use ResponsiveModal");
  assert.match(code, /side="bottom"/);
});

test("problem states are amber, never destructive", () => {
  // Red is the loudest colour in the palette and this surface has never spent
  // it — it reads as "you are in trouble" on a day HR may still forgive.
  const code = CODE("MiniFlagButton.tsx") + CODE("MiniFlagsSheet.tsx");
  assert.ok(!code.includes("destructive"), "must not use the destructive token");
  assert.match(code, /amber-500/);
});

test("no flag code or severity is ever rendered", () => {
  // The sheet shows wording, not the engine's vocabulary.
  const code = CODE("MiniFlagsSheet.tsx");
  for (const leak of ["flag_code}", "severity", "evidence"]) {
    assert.ok(!code.includes(leak), `${leak} must not be rendered`);
  }
});

test("the pill reads its count from miniFlags, not from its own arithmetic", () => {
  const code = CODE("MyDayPage.tsx");
  assert.match(code, /flagCount\(/);
});

test("every string on screen comes from the table", () => {
  // A literal here is a string that exists in English only.
  const code = CODE("MiniFlagsSheet.tsx");
  const literals = code.match(/>[A-Z][a-z]{3,}[^<{]*</g) ?? [];
  assert.deepEqual(literals, [], `untranslated literals: ${literals.join(", ")}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/miniapp/miniFlagsSheet.test.tsx`
Expected: FAIL — `ENOENT`, the two component files do not exist.

- [ ] **Step 3: Write `MiniFlagButton.tsx`**

```tsx
/**
 * How many things on this day are worth a look.
 *
 * BOTTOM-LEFT, floating. Measured against the real app at 390x520: this costs
 * zero timeline height, while Telegram's native SecondaryButton — the
 * alternative considered — took the canvas from 330px to 256px, 22% of the
 * drawn day. Left rather than right because the hour gutter is the only column
 * of that canvas with nothing at stake; the right side is where punch blocks
 * print their own times and durations.
 *
 * HIDDEN AT ZERO. The calendar mark already says a day is clean, and a
 * permanent "0 to check" is chrome on the shortest axis this app has — the
 * same objection that removed the add-to-home-screen row.
 */
import { TriangleAlertIcon } from "lucide-react";

import { useFormat, useT } from "@/miniapp/MiniLocale";

export function MiniFlagButton(props: {
  count: number;
  onOpen: () => void;
  /** Height of the tab bar to clear, in px. */
  lift: number;
}) {
  const t = useT();
  const fmt = useFormat();
  if (props.count <= 0) return null;
  return (
    // Fixed, not absolute: the Day page scrolls and this must not scroll with
    // it. The visible text is the accessible name — a plain button takes its
    // name from content, so no aria-label is needed here. (The calendar's day
    // buttons needed one only because react-day-picker sets its own, which
    // beats content.)
    <button
      type="button"
      onClick={props.onOpen}
      style={{ bottom: props.lift }}
      className="fixed left-3.5 z-40 flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-2 text-[13px] font-semibold text-foreground shadow-lg transition-colors active:bg-muted"
    >
      <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-amber-500" />
      {/* Digits in the reader's script. Khmer numerals are the whole reason
          fmt.digits exists; a Latin "2" beside Khmer words is the exact leak
          the e2e guard forbids. */}
      <span>{t("flagsToCheck").replace("{n}", fmt.digits(String(props.count)))}</span>
    </button>
  );
}
```

- [ ] **Step 4: Write `MiniFlagsSheet.tsx`**

```tsx
/**
 * What the engine noticed about this day, and where HR has got to with it.
 *
 * READ-ONLY. The Attendance Flag doctype already carries employee_note,
 * employee_attachment and a status of EXPLAINED, and the HR console already
 * tells reviewers to expect explanations — for something no employee can
 * currently do. Wiring that up is deliberately out of scope: it would be this
 * app's first write endpoint and deserves its own design.
 *
 * `Sheet`, not `ResponsiveModal`: the latter swaps to a centre Dialog above a
 * width breakpoint and a Telegram Desktop Mini App is wide enough to trip it.
 */
import { TriangleAlertIcon } from "lucide-react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { flagStatusKey, flagText, visibleFlags } from "@/miniapp/miniFlags";
import { useT } from "@/miniapp/MiniLocale";
import type { Day } from "@/types/calendar";

export function MiniFlagsSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Day | undefined;
}) {
  const t = useT();
  const flags = visibleFlags(props.day);

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="bottom" className="gap-0 rounded-t-xl px-4 pb-8">
        <SheetHeader className="px-0 pb-2">
          <SheetTitle className="text-base">{t("flagsSheetTitle")}</SheetTitle>
        </SheetHeader>

        {/* The pill is hidden at zero, so this is only reachable when a sheet
            left open outlives its last flag across a refetch. A line rather
            than a collapse: an empty sheet reads as a broken one. */}
        {flags.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("flagsNone")}</p>
        ) : (
          <ul className="flex flex-col gap-4 py-1">
            {flags.map((flag, i) => {
              const text = flagText(flag);
              if (!text) return null;
              return (
                // Index in the key because the narrowed flag carries no id —
                // `name` is HR-only and deliberately not sent. The list is
                // re-rendered whole on every refetch, so there is no identity
                // to preserve across one.
                <li key={`${flag.flag_code}-${i}`} className="flex gap-3">
                  <TriangleAlertIcon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-amber-500"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{t(text.title)}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                      {t(text.body)}
                    </p>
                    <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">
                      {t(flagStatusKey(flag))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: Mount both from `MyDayPage.tsx`**

Add to the imports:

```tsx
import { useState } from "react";

import { MiniFlagButton } from "@/miniapp/MiniFlagButton";
import { MiniFlagsSheet } from "@/miniapp/MiniFlagsSheet";
import { flagCount } from "@/miniapp/miniFlags";
```

Add the state at the top of the component body, beside the existing `const t = useT();`:

```tsx
  const [flagsOpen, setFlagsOpen] = useState(false);
```

`MyDayPage` returns early on loading and error before `info` exists, and hooks must not sit below those returns — `useState` above is already in the right place. Then, immediately before the closing `</div>` of the page root, add:

```tsx
      {/* The tab bar's own height plus its floor. A fixed pill measured from
          the viewport bottom has to clear a bar it is not inside. */}
      <MiniFlagButton
        count={flagCount(info)}
        onOpen={() => setFlagsOpen(true)}
        lift={TAB_BAR_HEIGHT_PX}
      />
      <MiniFlagsSheet open={flagsOpen} onOpenChange={setFlagsOpen} day={info} />
```

and declare the constant just above the `MyDayPage` function, with the import of the floor:

```tsx
import { TAB_BAR_FLOOR_PX } from "@/miniapp/MiniAppShell";

/**
 * How far the pill sits above the bottom of the viewport.
 *
 * The tab bar is `py-3` around a `text-sm` row — 44px — plus TAB_BAR_FLOOR_PX
 * and whatever safe-area inset the device asks for. The inset is NOT added
 * here: the shell already pads the tab bar by it, and the pill only has to
 * clear the bar's painted height. A constant rather than a measurement because
 * a fixed element cannot read a sibling's box without a layout effect, and one
 * frame of the pill in the wrong place is worse than 4px of slack.
 */
const TAB_BAR_HEIGHT_PX = 44 + TAB_BAR_FLOOR_PX;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx --test src/miniapp/miniFlagsSheet.test.tsx`
Expected: PASS, 5 tests.

Run: `npm run test:web`
Expected: PASS — check the reported test count went UP, not that the run was green. A glob that matches nothing exits zero.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/miniapp/MiniFlagButton.tsx src/miniapp/MiniFlagsSheet.tsx src/miniapp/MyDayPage.tsx src/miniapp/miniFlagsSheet.test.tsx
git commit -m "feat(miniapp): a flags pill on the Today tab, opening a bottom sheet"
```

---

### Task 4: Prove it in a browser, then ship the artifact

**Files:**
- Modify: `dewey_time/frontend/hr_attendance/e2e/miniapp.spec.ts`
- Modify: `dewey_time/public/**` and `dewey_time/www/*.html` (build output)

**Interfaces:**
- Consumes: everything above. Nothing downstream.

The unit tests in Tasks 2 and 3 read source text. That is not enough on this surface and the reason is on the record: the calendar sheet shipped with marks that were silent to a screen reader while a source-read test passed the whole time, and only dumping the rendered DOM found it.

- [ ] **Step 1: Write the failing e2e tests**

`e2e/miniapp.spec.ts` already has `rosteredDay(date, punches)` and `openMiniApp(page, opts)`. Extend `rosteredDay` to accept flags — add a fourth parameter and pass it through:

```ts
function rosteredDay(date: string, punches: Punches = "full", flags: unknown[] = []) {
```

and add `flags,` to the returned object.

Then append these tests:

```ts
test("a clean day shows no flags pill at all", async ({ page }) => {
  // Hidden at zero, not rendered as "0 to check" — the calendar mark already
  // says a day is clean and this is the shortest axis the app has.
  await openMiniApp(page);
  await expect(page.getByRole("button", { name: /to check/ })).toHaveCount(0);
});

test("the pill's accessible name carries the count, and opens the sheet", async ({ page }) => {
  // Asserted against the RENDERED accessible name, not against source text.
  // The calendar sheet shipped with silent marks because a source-read test
  // passed while the DOM said otherwise.
  await openMiniApp(page, {
    flags: [
      { flag_code: "LATE_START", is_provisional: false, decision: null,
        decision_state: "undecided" },
      { flag_code: "MISSING_TIME", is_provisional: false,
        decision: { outcome: "EXCUSED" }, decision_state: "matched" },
    ],
  });

  const pill = page.getByRole("button", { name: "2 to check" });
  await expect(pill).toBeVisible();
  await pill.click();

  await expect(page.getByText("Late start")).toBeVisible();
  await expect(page.getByText("Awaiting HR review")).toBeVisible();
  await expect(page.getByText("Gap in your record")).toBeVisible();
  await expect(page.getByText("Excused by HR")).toBeVisible();
});

test("the sheet never shows the engine's own vocabulary", async ({ page }) => {
  await openMiniApp(page, {
    flags: [{ flag_code: "UNNOTIFIED_ABSENCE", is_provisional: false,
              decision: null, decision_state: "undecided" }],
  });
  await page.getByRole("button", { name: /to check/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("No record for this day");
  await expect(sheet).not.toContainText("UNNOTIFIED_ABSENCE");
  await expect(sheet).not.toContainText("CRITICAL");
});

test("the pill counts in Khmer digits", async ({ page }) => {
  // A Latin "2" beside Khmer words is the exact leak miniIntl exists to close.
  await openMiniApp(page, {
    languageCode: "km",
    flags: [{ flag_code: "LATE_START", is_provisional: false, decision: null,
              decision_state: "undecided" }],
  });
  const pill = page.getByRole("button", { name: /ត្រូវពិនិត្យ/ });
  await expect(pill).toBeVisible();
  await expect(pill).not.toContainText(/[0-9]/);
});
```

`openMiniApp` needs a `flags` option threaded into its stubbed response. Add `flags?: unknown[]` to its `opts` type and pass it to every `rosteredDay(...)` call it builds.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test e2e/miniapp.spec.ts --project=desktop`
Expected: FAIL — the four new tests, on a missing pill.

- [ ] **Step 3: Make them pass**

If Task 3 is correct they pass with only the fixture plumbing from Step 1. If any fail, the defect is real — fix it in the Task 3 files, not by weakening the assertion.

Run: `npx playwright test e2e/miniapp.spec.ts --project=desktop`
Expected: PASS.

- [ ] **Step 4: Run the whole suite**

Run: `npm run test:web && npx tsc --noEmit && npx playwright test`
Expected: PASS. `e2e/employee-identity.spec.ts:285` is a known pre-existing flake under a full-suite run — it fails on clean `main` too. Anything else that fails is this branch's.

Run: `python -m unittest discover dewey_time.tests -v`
Expected: PASS.

- [ ] **Step 5: Build and commit the artifact**

Built assets ARE the deployed artifact — Frappe Cloud never builds these SPAs, so an unbuilt branch deploys the previous UI with the new backend.

```bash
cd dewey_time/frontend/hr_attendance && npm run build && cd -
git add dewey_time/public dewey_time/www
git status --porcelain   # confirm the built files actually changed
```

- [ ] **Step 6: Commit**

```bash
git add dewey_time/frontend/hr_attendance/e2e/miniapp.spec.ts dewey_time/public dewey_time/www
git commit -m "test(miniapp): browser guards for the flags pill, and the built assets"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: the two allowlists and both certainty rules → Task 1; the string tables and the status-line resolution → Task 2; the pill, the sheet, the hidden-at-zero rule and the amber constraint → Task 3; the eight named tests → distributed across Tasks 1–4 (allowlist fail-closed §1, rules 1 and 2 §1, count-matches-list §2, `needs_re_review` §2, zero-means-no-pill §4, accessible name §4, Khmer digits §4). The "deliberately not in this design" items are carried as comments in the code they would otherwise creep into.

**One deviation from the spec, deliberate.** The spec says `src/types/calendar.ts` is not touched and the narrowed shape gets its own `MiniFlag` type. Task 2 instead widens `Flag` with two optional fields. `decision` and `decision_state` are genuinely on the HR payload (`hr_calendar.py:738-739`) and `Flag` simply does not mention them today, so this is a truthful correction rather than a new type; the alternative was a cast at the boundary, which describes nothing and silences the compiler. The spec is amended in the same commit as this plan.

**Placeholders.** None. Every code step carries the code; every run step carries the command and the expected result.

**Type consistency.** `flagCount`/`visibleFlags`/`flagText`/`flagStatusKey` are named identically in Task 2's implementation, Task 2's tests and Task 3's consumers. `TAB_BAR_FLOOR_PX` is the existing export from `MiniAppShell.tsx:75`. `DecisionState` and `Outcome` are the existing exports from `types/flags.ts:13` and `:15`. The four payload field names — `flag_code`, `is_provisional`, `decision`, `decision_state` — are identical in Task 1's `FLAG_KEYS`, Task 2's type widening and Task 4's fixtures.

**Known soft spot, flagged rather than hidden.** `TAB_BAR_HEIGHT_PX = 44 + TAB_BAR_FLOOR_PX` hard-codes the tab bar's painted height. It is correct for the current `py-3` + `text-sm` bar and would drift if that bar is restyled. A measurement would need a layout effect and would flash the pill in the wrong place for one frame. Task 4's screenshots are where a wrong value shows up.
