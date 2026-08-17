# Mini App day flags — design

**Date:** 2026-08-17
**Surface:** `dewey_time/telegram/miniapp_api.py` and
`dewey_time/frontend/hr_attendance/src/miniapp/` (the employee Mini App at `/hr-me`)

## Goal

Give an employee a way to see what the attendance engine has noticed about their
own day. A pill floats at the bottom-left of the Today tab carrying a count;
tapping it opens a bottom sheet listing that day's flags in plain language, with
HR's decision on each one where there is one.

Read-only. The employee cannot reply, and this spec does not build a reply path.

## What this reverses, and what it does not

The calendar-sheet spec (`2026-08-17-miniapp-calendar-sheet-design.md`) states a
constraint in bold:

> **The Mini App is never shown flags.** `miniapp_api.py` narrows the HR payload
> through an allowlist — `date, shift, checkins, holiday, leave, observed_lunch,
> first_in, last_out`. No flags, no tiers, no severity, and no grace minutes.

That was a real decision with a real reason, and this spec overturns the first
sentence deliberately, at the owner's direction. The reasoning underneath it
survives and shapes everything below: the engine's verdict on a day is
provisional until HR reviews it, so anything shown to the person it describes
must be either **certain** or **visibly undecided**.

**The calendar marks do not change.** `miniDayMark.ts` still reads only punches,
shift, leave and holiday, and still reports the record rather than a verdict. It
must keep doing so — the marks are rendered across forty days at a glance, where
there is no room for "awaiting review", and a dot that silently meant "HR flagged
this" would be exactly the unanswerable accusation this design is careful to
avoid. Flags are disclosed in one place, on one day, with their status attached.

## Decisions

Four calls the owner made, recorded with what they rule out:

1. **Read-only, in plain language.** Not HR's wording. `flagDetails.ts`'s
   `FLAG_SUMMARIES` are third-person and written for a reviewer ("This
   employee's first paired check-in was after shift start, including the
   effective grace period") — they are not reused.
2. **An allowlist of codes, not all of them.** Fail-closed, matching the rule
   `miniapp_api.py`'s own docstring gives for `DAY_KEYS`: written as removals a
   new flag code would reach every employee silently, with no test failing.
3. **Live on today, but only what is certain.** Provisional flags that can
   withdraw themselves are held back rather than shown with a hedge.
4. **Every HR outcome is shown**, including "upheld".

## Server: what leaves the machine

`hr_calendar.py:795` already puts a `flags` list on every day; `narrow()`
(`miniapp_api.py:83`) drops it. Two new allowlists let a filtered version
through.

```python
#: Flag codes an employee may be told about. An ALLOWLIST for the same reason
#: DAY_KEYS is one -- a code added to the engine next year is hidden until
#: somebody deliberately exposes it here.
#:
#: Excluded on purpose: UNKNOWN_DEVICE_BRANCH and DELIVERY_FAILED are our
#: infrastructure failing, not the employee's day, and neither is actionable by
#: them. NON_PRIMARY_SITE_PUNCH is INFO and usually just a cover shift -- it
#: would alarm somebody who did nothing unusual.
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

#: `evidence` is NOT here, and that is the load-bearing omission: it carries
#: grace minutes, thresholds and rule internals. `severity` is not here either
#: -- it is HR's triage order, not a measure of what matters to the person.
FLAG_KEYS = ("flag_code", "is_provisional", "decision", "decision_state")
```

Also excluded by omission: `name`, `hr_note`, `hr_user`, `hr_decided_at`,
`status_changed_by`, `linked_checkin`, `rule_version`, `rollout_phase`,
`employee_name`, `company`, `source`, `day_closed`, `severity`, `evidence`.

### Two things already built that this leans on

- **`build_employee_calendar` already has an employee-view path.**
  `hr_calendar.py:674` reads `hr_view = _is_hr_staff()`, and line 729 trims
  `decision` down to `{outcome, decided_at}` for a non-HR viewer, with a comment
  saying it keeps the outcome deliberately so *"an excused flag [does not]
  falsely report 'undecided' in the employee's own view."* Mini App requests
  carry no Frappe session, so they are already receiving that redacted shape.
  Nothing new needs writing to make decisions safe to show.
- **`_filter_auto_flags_for_calendar_day` (`hr_calendar.py:96`) already picks
  provisional-versus-final per day**, including the branch-still-open case. The
  Mini App inherits that; this spec adds rules on top of it, not instead of it.

### Incidental finding, not in scope

`NO_CHECKIN_YET` appears in `AUTO_FLAG_CODES` (`closeout.py:48`) and
`FLAG_SEVERITY` (`closeout.py:72`) and **nothing writes it**. The catalogue
advertises thirteen codes and the engine emits twelve. It is left alone here;
it is recorded so a future reader does not go looking for the employee wording
of a flag that never exists.

## Server: the certainty rules

Both applied in `miniapp_api.py`, after the code allowlist, before the payload
is returned.

### Rule 1 — no provisional absence

```
Drop UNNOTIFIED_ABSENCE while is_provisional is true.
```

`intraday.py:175` raises it the moment the first `MISSING_TIME` interval would
have appeared, and withdraws it when a punch lands — the refresh deletes its own
previous rows first, which is why the code has to be in `INTRADAY_FLAG_CODES`.
An employee whose approved leave has not been keyed into ERPNext yet would carry
"no record for this day" on their phone from mid-morning until closeout cleared
it. That is the single worst thing this surface could do, and it is the case
that happens most.

A closed-out `UNNOTIFIED_ABSENCE` is shown normally. By then it is a fact about
the record.

### Rule 2 — no gap that is still running

```
Show a provisional MISSING_TIME only if the day has a check-in whose time is at
or after that flag's evidence interval_end. A final one is always shown.
```

The engine measures today's gaps up to the present minute:
`missing_expected_max_end_min` returns `present_hour_start_min(now)`, which
despite its name is `now.hour * 60 + now.minute` (`absence_intervals.py:44`) —
now, to the minute, not the top of the hour. So somebody who punches out at
12:00 for a lunch their shift does not have configured becomes a 31-minute gap
at 12:31, while they are still eating.

A gap that ended because a punch resumed after it is certain. A gap whose end is
"now" is a person who may be about to walk back in. Comparing against the
employee's own punches rather than against the clock keeps the rule
deterministic and free of clock-skew fuzz.

**This rule reads `evidence.interval_end` server-side. `evidence` is still never
sent** — it is consumed to make the decision and dropped by `FLAG_KEYS`.

## Client: the pill

A floating button, bottom-left of the Day tab, lifted clear of the tab bar by
the tab bar's own height plus `TAB_BAR_FLOOR_PX`.

- **Bottom-left specifically.** The hour gutter is the only column of that
  canvas with nothing at stake; bottom-right would cover the punch blocks, which
  print their own times and durations on their faces. Measured against the real
  app at 390×520 the pill costs zero timeline height (canvas stays 330px) while
  Telegram's native `SecondaryButton` — the alternative considered — took it to
  256px, 22% of the drawn day.
- **Hidden when the count is zero.** The calendar mark already says a day is
  clean, and a permanent "0 to check" is chrome on the shortest axis this app
  has — the same objection that removed the add-to-home-screen row.
- **Amber, never `destructive`.** Red is the loudest colour in the palette and
  this surface has never spent it. Same rule as the calendar marks.
- **Day tab only**, and it reflects whichever day is on screen, including a day
  drilled into from the calendar sheet.
- Visible text is the accessible name — this is a plain `<button>`, so
  name-from-content applies and no `aria-label` is needed. (It was needed on the
  calendar's day buttons only because react-day-picker sets its own
  `aria-label`, which beats content.)

## Client: the sheet

`Sheet side="bottom"` from `@/components/ui/sheet`, the same primitive
`MiniCalendarSheet` uses. **Not `ResponsiveModal`** — it swaps to a centre
Dialog above a width breakpoint and a Telegram Desktop Mini App is wide enough
to trip it.

Title is the sheet's own heading; one row per flag beneath it:

```
Late start
Your first check-in was after your shift started.
Awaiting HR review
```

No flag codes on screen, no severity, no evidence rows, no HR notes. The times
themselves are not repeated in the copy — the timeline is directly behind the
sheet and draws them.

### Status line

| Payload state | Line |
|---|---|
| `decision` is null | Awaiting HR review |
| `decision.outcome == "EXCUSED"` | Excused by HR |
| `decision.outcome == "UPHELD"` | Upheld by HR |
| `decision_state == "needs_re_review"` | Awaiting HR review again — this day changed after it was reviewed |

`decision_state` wins over `outcome`: a stale verdict on a day that has since
changed is worse than no verdict. Outcomes are `EXCUSED` / `UPHELD`
(`flag_decision_api.py:25`), from the append-only Flag Decision model that
superseded the legacy `status` field on the flag row — `status` is not read.

### Empty state

The pill is hidden at zero, but a sheet left open across a refetch can empty
out. It shows a single line rather than collapsing to nothing.

## Wording

New keys in `miniStrings.ts`, EN and KM. Second person, no jargon, no numbers —
with `evidence` unexposed there are no durations to quote, and the timeline
behind the sheet shows what happened.

| Key | English |
|---|---|
| `flagsToCheck` | `{n} to check` |
| `flagsSheetTitle` | Things to check |
| `flagsNone` | Nothing to check on this day. |
| `flagLateStart` | Late start |
| `flagLateStartBody` | Your first check-in was after your shift started. |
| `flagLeftEarly` | Left early |
| `flagLeftEarlyBody` | Your last check-out was before your shift ended. |
| `flagLateFromLunch` | Late back from lunch |
| `flagLateFromLunchBody` | You checked back in after your lunch break ended. |
| `flagMissingTime` | Gap in your record |
| `flagMissingTimeBody` | There's a stretch of your shift with no check-in covering it. |
| `flagMissingInOrOut` | Only one check-in |
| `flagMissingInOrOutBody` | Only one check-in was recorded, so there's no start-and-finish pair. |
| `flagNoRecord` | No record for this day |
| `flagNoRecordBody` | This was a working day and no check-ins were recorded. |
| `flagOffShiftPunch` | Checked in on a non-working day |
| `flagOffShiftPunchBody` | Check-ins were recorded on a day you weren't scheduled to work. |
| `flagMissingLunch` | Lunch not recorded |
| `flagMissingLunchBody` | Your lunch break couldn't be matched to a check-out and check-in pair. |
| `flagAttendanceIssue` | Record couldn't be matched up |
| `flagAttendanceIssueBody` | Your check-ins for this day couldn't be paired into complete sessions. |
| `flagStatusAwaiting` | Awaiting HR review |
| `flagStatusExcused` | Excused by HR |
| `flagStatusUpheld` | Upheld by HR |
| `flagStatusRereview` | Awaiting HR review again — this day changed after it was reviewed |

`UNNOTIFIED_ABSENCE` maps to `flagNoRecord`, not to a translation of its code
name. "Unnotified absence" is a verdict word; "no record for this day" is what
the data says, and HR can still forgive it.

### Khmer

| Key | Khmer |
|---|---|
| `flagsToCheck` | `{n} ត្រូវពិនិត្យ` |
| `flagsSheetTitle` | អ្វីដែលត្រូវពិនិត្យ |
| `flagsNone` | គ្មានអ្វីត្រូវពិនិត្យសម្រាប់ថ្ងៃនេះទេ។ |
| `flagLateStart` | ចាប់ផ្តើមយឺត |
| `flagLateStartBody` | ការស្កេនចូលដំបូងរបស់អ្នកគឺក្រោយពេលវេនចាប់ផ្តើម។ |
| `flagLeftEarly` | ចេញមុនម៉ោង |
| `flagLeftEarlyBody` | ការស្កេនចេញចុងក្រោយរបស់អ្នកគឺមុនពេលវេនបញ្ចប់។ |
| `flagLateFromLunch` | ត្រឡប់ពីអាហារថ្ងៃត្រង់យឺត |
| `flagLateFromLunchBody` | អ្នកបានស្កេនចូលវិញក្រោយពេលសម្រាកអាហារថ្ងៃត្រង់បានបញ្ចប់។ |
| `flagMissingTime` | មានចន្លោះក្នុងកំណត់ត្រា |
| `flagMissingTimeBody` | មានរយៈពេលមួយក្នុងវេនរបស់អ្នកដែលគ្មានការស្កេនគ្របដណ្តប់។ |
| `flagMissingInOrOut` | មានតែការស្កេនម្តង |
| `flagMissingInOrOutBody` | មានតែការស្កេនមួយប៉ុណ្ណោះត្រូវបានកត់ត្រា ដូច្នេះគ្មានគូចូល និងចេញទេ។ |
| `flagNoRecord` | គ្មានកំណត់ត្រាសម្រាប់ថ្ងៃនេះ |
| `flagNoRecordBody` | នេះជាថ្ងៃធ្វើការ ហើយគ្មានការស្កេនណាមួយត្រូវបានកត់ត្រាទេ។ |
| `flagOffShiftPunch` | ស្កេនក្នុងថ្ងៃមិនធ្វើការ |
| `flagOffShiftPunchBody` | មានការស្កេនត្រូវបានកត់ត្រាក្នុងថ្ងៃដែលអ្នកមិនមានវេនធ្វើការ។ |
| `flagMissingLunch` | មិនមានកំណត់ត្រាអាហារថ្ងៃត្រង់ |
| `flagMissingLunchBody` | ការសម្រាកអាហារថ្ងៃត្រង់របស់អ្នកមិនអាចផ្គូផ្គងនឹងការស្កេនចេញ និងចូលបានទេ។ |
| `flagAttendanceIssue` | កំណត់ត្រាមិនអាចផ្គូផ្គងបាន |
| `flagAttendanceIssueBody` | ការស្កេនរបស់អ្នកសម្រាប់ថ្ងៃនេះមិនអាចផ្គូផ្គងជាវគ្គពេញលេញបានទេ។ |
| `flagStatusAwaiting` | រង់ចាំការពិនិត្យពី HR |
| `flagStatusExcused` | បានអនុគ្រោះដោយ HR |
| `flagStatusUpheld` | បានបញ្ជាក់ដោយ HR |
| `flagStatusRereview` | រង់ចាំការពិនិត្យឡើងវិញ — ថ្ងៃនេះមានការផ្លាស់ប្តូរក្រោយពេលពិនិត្យ។ |

> **These Khmer strings have not been reviewed by a native speaker and must be
> before this ships to employees.** `flagStatusUpheld` is the one most likely to
> be wrong: it must read as *HR confirmed this note*, not *HR punished you*.
> This is the same outstanding review that already covers
> `បានចេញ ក្នុងម៉ោងធ្វើការ` and the four calendar marks.

## Deliberately not in this design

- **No reply path.** The `Attendance Flag` doctype already carries
  `employee_note`, `employee_attachment`, `employee_submitted_at`, a `source`
  value of `EMPLOYEE` and a status of `EXPLAINED`, and `flagDetails.ts:137`
  already tells HR to expect explanations — for something no employee can do.
  Wiring that up is the obvious next step and is explicitly out of scope here.
  It would be the Mini App's first write endpoint, which is a security surface
  deserving its own spec.
- **No numbers in the copy**, because `evidence` is not exposed. If "24 minutes
  late" turns out to be wanted, it is a new key in `FLAG_KEYS` and a new
  decision about which of the several minute-like values in evidence is the one
  an employee should read.
- **No flags on the calendar marks.** Covered above.
- **No badge on the tab bar or app icon.** Telegram offers neither reliably, and
  a count that persists outside the app is a nag.

## Files

**Backend**
- Modify: `dewey_time/telegram/miniapp_api.py` — `EMPLOYEE_FLAG_CODES`,
  `FLAG_KEYS`, the two certainty rules, `flags` added to `DAY_KEYS`
- Modify: `dewey_time/tests/test_miniapp_api.py`

**Frontend**
- Create: `src/miniapp/miniFlags.ts` — flag code → string keys, status line
  resolution, visible-count
- Create: `src/miniapp/MiniFlagsSheet.tsx`
- Create: `src/miniapp/MiniFlagButton.tsx`
- Modify: `src/miniapp/MyDayPage.tsx` — mount the pill and sheet
- Modify: `src/miniapp/miniStrings.ts`

`src/types/calendar.ts` is **not** touched. Its `Flag` is the full HR row and
stays that way for the HR console; the narrowed four-field shape is its own
`MiniFlag` type declared in `miniFlags.ts`, so the two cannot drift into each
other.

**Tests**
- Create: `src/miniapp/miniFlags.test.ts`
- Create: `src/miniapp/miniFlagsSheet.test.tsx`
- Modify: `e2e/miniapp.spec.ts`

## Testing

The unit tests that matter are the ones that would have caught this design being
implemented wrong:

1. **The allowlist is fail-closed.** Feed `narrow()` a fabricated HR flag row
   carrying `evidence`, `severity`, `hr_note` and an invented flag code; assert
   none of them survive. This mirrors the existing `DAY_KEYS` tests and is the
   test that fails when somebody adds a field for an HR need.
2. **Rule 1.** A provisional `UNNOTIFIED_ABSENCE` is dropped; the same flag with
   `is_provisional` false is kept.
3. **Rule 2.** A provisional `MISSING_TIME` with no check-in after its
   `interval_end` is dropped; the same flag with a later check-in is kept.
4. **The count matches the list.** The pill's number and the number of rows in
   the sheet come from one function, and a test pins that they cannot diverge —
   the same class of bug as the flag-queue header recount.
5. **`needs_re_review` beats `outcome`.** A flag carrying both an `EXCUSED`
   decision and `decision_state: "needs_re_review"` reads as awaiting review.
6. **Zero means no pill.** A clean day renders no button at all.

End-to-end, in `e2e/miniapp.spec.ts`:

7. The pill's accessible name reads as the count, and tapping it opens a sheet
   whose rows carry the plain wording — asserted against the rendered accessible
   name, not against source text. The calendar sheet shipped with silent marks
   because a source-read test passed while the DOM said otherwise.
8. The Khmer render contains no Latin digits in the pill's count.

## Open, needs a person

- Native-speaker review of every Khmer string above, `flagStatusUpheld` first.
- Whether "upheld" should reach an employee at all is an HR-policy question the
  owner has answered yes to; if that changes, it is one branch in `miniFlags.ts`.
