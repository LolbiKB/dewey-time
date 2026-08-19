import assert from "node:assert/strict";
import test from "node:test";

import {
  dayFacts, dayNumbers, formatMinuteOfDay, formatSpan, netWorkedFor,
  totalWorkedMinutes, wasWorked,
} from "@/miniapp/miniDay";
import type { Day } from "@/types/calendar";

const MON = new Date(2026, 7, 10);
const FRI = new Date(2026, 7, 14);

function worked(date: string, from = "07:58:00", to = "17:06:00"): Day {
  return {
    date,
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    first_in: `${date} ${from}`,
    last_out: `${date} ${to}`,
    checkins: [
      { time: `${date} ${from}`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${date} ${to}`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;
}

test("a worked day reports its own in, out and net", () => {
  const facts = dayFacts(worked("2026-08-10"), MON, FRI);
  assert.equal(facts.tone, "worked");
  // RAW datetimes, not rendered times — the renderer owns the locale.
  assert.equal(facts.firstInAt, "2026-08-10 07:58:00");
  assert.equal(facts.lastOutAt, "2026-08-10 17:06:00");
  assert.ok(facts.workedMinutes! > 0);
});

test("the rostered shift is reported alongside what was actually worked", () => {
  // The comparison is the whole point of showing both: "8h 12m against an
  // 09:00 roster" is a different day from "8h 12m against a 13:00 one".
  const facts = dayFacts(worked("2026-08-10"), MON, FRI);
  assert.equal(facts.shift, "8:00 AM – 5:00 PM");
  assert.equal(facts.shiftMinutes, 540);
});

test("an overnight roster spans the wrap instead of going negative", () => {
  // 22:00–06:00 is a real shift here. end < start on the clock, and a naive
  // subtraction renders it as a day of minus sixteen hours.
  const day = {
    date: "2026-08-10",
    shift: { shift_assigned: true, start_time: "22:00:00", end_time: "06:00:00" },
  } as unknown as Day;
  const facts = dayFacts(day, MON, FRI);
  assert.equal(facts.shiftMinutes, 480);
  assert.equal(facts.shift, "10:00 PM – 6:00 AM");
});

test("leave outranks punches, and names the leave type", () => {
  // Someone who came in for an hour on approved leave is still on leave; the
  // header must say so rather than reporting the hour as an ordinary day.
  const day = {
    ...worked("2026-08-12"),
    leave: { on_leave: true, leave_type: "Annual Leave" },
  } as unknown as Day;
  const facts = dayFacts(day, new Date(2026, 7, 12), FRI);
  assert.equal(facts.tone, "leave");
  assert.equal(facts.note, "Annual Leave");
  assert.equal(facts.range, null);
});

test("a holiday outranks punches too", () => {
  const day = { ...worked("2026-08-11"), holiday: { description: "Pchum Ben" } } as unknown as Day;
  assert.equal(dayFacts(day, new Date(2026, 7, 11), FRI).tone, "holiday");
});

test("nothing here ever judges a day", () => {
  // The Mini App receives no flags at all — the API allowlist drops them — and
  // the engine's verdict is provisional until HR reviews it. Every note this
  // can produce is checked, not just the interesting one.
  const cases: Day[] = [
    { date: "2026-08-10", shift: { shift_assigned: true }, checkins: [] } as unknown as Day,
    { date: "2026-08-15", shift: { shift_assigned: false }, checkins: [] } as unknown as Day,
    { date: "2026-08-14", shift: { shift_assigned: true }, checkins: [] } as unknown as Day,
  ];
  for (const day of cases) {
    const note = dayFacts(day, MON, FRI).note ?? "";
    for (const judgment of ["absent", "late", "violation", "failed", "breach"]) {
      assert.doesNotMatch(note.toLowerCase(), new RegExp(judgment), `"${note}" judges`);
    }
  }
});

test("a week's total adds only the days that have one", () => {
  const days = [worked("2026-08-10"), undefined, worked("2026-08-12")];
  const total = totalWorkedMinutes(days);
  assert.equal(total, netWorkedFor(days[0])! + netWorkedFor(days[2])!);
});

test("a week with nothing worked totals null, never zero", () => {
  // "0h" is a claim that someone worked no hours. A week nobody has reached
  // yet has not made that claim, and a zero would read as one.
  assert.equal(totalWorkedMinutes([undefined, undefined]), null);
});

test("hours punched on a holiday still reach the month total", () => {
  // THE DEFECT: dayFacts answers holiday before it looks at a punch, so a
  // total built from its facts dropped exactly the premium-paid day a worker
  // opens the app to check. The Day tab showed the hours; the month said the
  // day never happened.
  const day = worked("2026-08-11");
  (day as unknown as { holiday: unknown }).holiday = { description: "Pchum Ben" };

  assert.equal(dayFacts(day, new Date(2026, 7, 11), FRI).tone, "holiday");
  assert.equal(dayFacts(day, new Date(2026, 7, 11), FRI).workedMinutes, null);

  // ...and the total counts them anyway.
  assert.equal(totalWorkedMinutes([day]), netWorkedFor(day));
  assert.ok(totalWorkedMinutes([day])! > 0);
  assert.equal(wasWorked(day), true);
});

test("hours punched on approved leave still reach the month total", () => {
  const day = worked("2026-08-11");
  (day as unknown as { leave: unknown }).leave = {
    on_leave: true,
    leave_type: "Annual Leave",
  };

  assert.equal(dayFacts(day, new Date(2026, 7, 11), FRI).tone, "leave");
  assert.equal(totalWorkedMinutes([day]), netWorkedFor(day));
  assert.equal(wasWorked(day), true);
});

test("a day nobody punched is not a day worked", () => {
  // The counterweight: wasWorked must not simply return true.
  assert.equal(wasWorked(undefined), false);
  const rostered = { date: "2026-08-11", shift: { shift_assigned: true }, checkins: [] };
  assert.equal(wasWorked(rostered as unknown as Day), false);
});

test("times are 12-hour, matching the punches shown beside them", () => {
  // Punches read "7:58 AM" (formatCheckinTime), so a roster printed as
  // "08:00 – 17:00" made one screen speak two clock conventions — and 17:00
  // is not how anybody here says five o'clock.
  assert.equal(formatMinuteOfDay(0), "12:00 AM");
  assert.equal(formatMinuteOfDay(8 * 60), "8:00 AM");
  assert.equal(formatMinuteOfDay(12 * 60), "12:00 PM");
  assert.equal(formatMinuteOfDay(17 * 60 + 6), "5:06 PM");
  assert.equal(formatSpan(8 * 60, 17 * 60), "8:00 AM – 5:00 PM");
});

test("a span with a missing end is no span at all", () => {
  // Half a range renders as "8:00 AM – " with nothing after the dash, which
  // reads as an open-ended shift rather than as missing data.
  assert.equal(formatSpan(8 * 60, null), null);
  assert.equal(formatSpan(null, 17 * 60), null);
  assert.equal(formatMinuteOfDay(null), null);
  assert.equal(formatMinuteOfDay(undefined), null);
});

test("the rostered lunch is reported, and only when there is one", () => {
  // "Worked 8h 11m" against a 9-hour roster looks like an hour unaccounted
  // for until the break is named.
  const withLunch = {
    date: "2026-08-10",
    shift: {
      shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
      lunch_start: "12:00:00", lunch_end: "13:00:00",
    },
  } as unknown as Day;
  const facts = dayFacts(withLunch, MON, FRI);
  assert.equal(facts.lunch, "12:00 PM – 1:00 PM");
  assert.equal(facts.lunchMinutes, 60);

  const noLunch = {
    date: "2026-08-15",
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "12:00:00" },
  } as unknown as Day;
  // A four-hour Saturday has no break, and "Lunch —" reads as one taken away.
  assert.equal(dayFacts(noLunch, MON, FRI).lunch, null);
});

test("a zero-length lunch is not a lunch", () => {
  const day = {
    date: "2026-08-10",
    shift: {
      shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
      lunch_start: "12:00:00", lunch_end: "12:00:00",
    },
  } as unknown as Day;
  assert.equal(dayFacts(day, MON, FRI).lunch, null);
});

/* ── dayNumbers: the two figures under the timeline ───────────────────── */

/** A day with an unclosed arrival -- somebody currently at work. */
function stillIn(date: string, since = "07:58:00"): Day {
  return {
    date,
    shift: {
      shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
      lunch_start: "12:00:00", lunch_end: "13:00:00",
    },
    first_in: `${date} ${since}`,
    last_out: null,
    checkins: [
      { time: `${date} ${since}`, log_type: "IN", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;
}

test("a finished day reports net worked against net rostered", () => {
  const day = {
    date: "2026-08-10",
    shift: {
      shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
      lunch_start: "12:00:00", lunch_end: "13:00:00",
    },
    checkins: [
      { time: "2026-08-10 07:58:00", log_type: "IN", custom_device_branch: "A" },
      { time: "2026-08-10 12:01:00", log_type: "OUT", custom_device_branch: "A" },
      { time: "2026-08-10 12:58:00", log_type: "IN", custom_device_branch: "A" },
      { time: "2026-08-10 17:06:00", log_type: "OUT", custom_device_branch: "A" },
    ],
  } as unknown as Day;
  const n = dayNumbers(day, MON, FRI, FRI);
  assert.equal(n.worked, 4 * 60 + 3 + (4 * 60 + 8));
  // Rostered is NET: nine hours of window less the rostered hour of lunch.
  assert.equal(n.rostered, 8 * 60);
  assert.equal(n.live, false);
});

test("an open run on TODAY accrues up to now, and says so", () => {
  // The whole reason this function exists: netWorkedMinutes pairs punches, so
  // somebody three hours into a shift reads as null until they clock out.
  const today = new Date(2026, 7, 10, 11, 0, 0);
  const n = dayNumbers(stillIn("2026-08-10"), today, today, today);
  assert.equal(n.worked, 3 * 60 + 2);
  assert.equal(n.live, true);
});

test("an open run on a PAST day accrues nothing", () => {
  // An unclosed punch on a past day is a MISSING_IN_OR_OUT flag, not somebody
  // still at work. Counting it would grow that day's total forever.
  const date = new Date(2026, 7, 10);
  const today = new Date(2026, 7, 14, 11, 0, 0);
  const n = dayNumbers(stillIn("2026-08-10"), date, today, today);
  assert.equal(n.worked, null);
  assert.equal(n.live, false);
});

test("a clock skewed into the future never subtracts minutes", () => {
  const today = new Date(2026, 7, 10, 7, 0, 0); // before the 07:58 punch
  const n = dayNumbers(stillIn("2026-08-10"), today, today, today);
  assert.equal(n.worked, 0);
  assert.equal(n.live, true);
});

test("leave and holiday have no rostered figure to fall short of", () => {
  const base = {
    date: "2026-08-10",
    shift: {
      shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
      lunch_start: "12:00:00", lunch_end: "13:00:00",
    },
    checkins: [],
  };
  const onLeave = { ...base, leave: { on_leave: true, leave_type: "Annual Leave" } };
  const holiday = { ...base, holiday: { description: "Constitution Day" } };
  assert.equal(dayNumbers(onLeave as unknown as Day, MON, FRI, FRI).rostered, null);
  assert.equal(dayNumbers(holiday as unknown as Day, MON, FRI, FRI).rostered, null);
});

test("work punched on a holiday still counts, alone", () => {
  // dayFacts answers "holiday" and returns before it looks at a punch, so its
  // workedMinutes is null here. This is the case that made netWorkedFor exist.
  const day = {
    date: "2026-08-10",
    holiday: { description: "Constitution Day" },
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    checkins: [
      { time: "2026-08-10 09:00:00", log_type: "IN", custom_device_branch: "A" },
      { time: "2026-08-10 11:00:00", log_type: "OUT", custom_device_branch: "A" },
    ],
  } as unknown as Day;
  const n = dayNumbers(day, MON, FRI, FRI);
  assert.equal(n.worked, 120);
  assert.equal(n.rostered, null);
});

test("an overnight shift's rostered figure spans the wrap", () => {
  const day = {
    date: "2026-08-10",
    shift: {
      shift_assigned: true, start_time: "22:00:00", end_time: "06:00:00",
      lunch_start: "02:00:00", lunch_end: "02:30:00",
    },
    checkins: [],
  } as unknown as Day;
  // Eight hours across midnight, less the half-hour break.
  assert.equal(dayNumbers(day, MON, FRI, FRI).rostered, 7 * 60 + 30);
});

test("a day with no roster and no punches has neither figure", () => {
  const day = { date: "2026-08-08", shift: { shift_assigned: false }, checkins: [] } as unknown as Day;
  const n = dayNumbers(day, MON, FRI, FRI);
  assert.equal(n.worked, null);
  assert.equal(n.rostered, null);
  assert.equal(n.live, false);
});
