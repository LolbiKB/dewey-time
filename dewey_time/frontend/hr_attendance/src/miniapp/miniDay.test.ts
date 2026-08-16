import assert from "node:assert/strict";
import test from "node:test";

import { dayFacts, formatTotalWorked, totalWorkedMinutes } from "@/miniapp/miniDay";
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
  assert.match(facts.firstIn!, /7:58/);
  assert.match(facts.lastOut!, /5:06/);
  assert.ok(facts.workedMinutes! > 0);
});

test("the rostered shift is reported alongside what was actually worked", () => {
  // The comparison is the whole point of showing both: "8h 12m against an
  // 09:00 roster" is a different day from "8h 12m against a 13:00 one".
  const facts = dayFacts(worked("2026-08-10"), MON, FRI);
  assert.equal(facts.shift, "08:00 – 17:00");
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
  assert.equal(facts.shift, "22:00 – 06:00");
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
  const facts = [
    dayFacts(worked("2026-08-10"), MON, FRI),
    dayFacts(undefined, new Date(2026, 7, 11), FRI),
    dayFacts(worked("2026-08-12"), new Date(2026, 7, 12), FRI),
  ];
  const total = totalWorkedMinutes(facts);
  assert.equal(total, facts[0]!.workedMinutes! + facts[2]!.workedMinutes!);
  assert.ok(formatTotalWorked(facts));
});

test("a week with nothing worked totals null, never zero", () => {
  // "0h" is a claim that someone worked no hours. A week nobody has reached
  // yet has not made that claim, and a zero would read as one.
  const facts = [dayFacts(undefined, MON, FRI), dayFacts(undefined, FRI, FRI)];
  assert.equal(totalWorkedMinutes(facts), null);
  assert.equal(formatTotalWorked(facts), null);
});

test("a week's total is hours and minutes, never days", () => {
  // formatDurationMinutes rolls past 24h into days, which is right for one
  // day and useless for a week: a normal week rendered as "2d 6h 48m".
  // Nobody is owed hours in days and no payslip states them that way.
  const week = Array.from({ length: 6 }, (_, i) =>
    dayFacts(worked(`2026-08-1${i}`), MON, FRI),
  );
  const total = formatTotalWorked(week)!;
  assert.doesNotMatch(total, /d/, `a weekly total must not be given in days: ${total}`);
  assert.match(total, /^\d+h( \d+m)?$/);
});

test("an exact hour drops the minutes rather than saying 0m", () => {
  const facts = [dayFacts(worked("2026-08-10", "08:00:00", "17:00:00"), MON, FRI)];
  // 09:00 minus the observed lunch this fixture has none of.
  assert.match(formatTotalWorked(facts)!, /^\d+h$/);
});
