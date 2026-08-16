import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  canGoForward, WeekNav, WeekRow, weekDatesFor, weekForOffset, weekRangeLabel,
} from "@/miniapp/MyWeekPage";
import { dayFacts } from "@/miniapp/miniDay";
import type { Day } from "@/types/calendar";

const MON = new Date(2026, 7, 10);
const WED = new Date(2026, 7, 12);
const FRI = new Date(2026, 7, 14);

function worked(date: string): Day {
  return {
    date,
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    first_in: `${date} 07:58:00`,
    last_out: `${date} 17:06:00`,
    checkins: [
      { time: `${date} 07:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${date} 17:06:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;
}

test("the week is Monday-first and seven days long", () => {
  const week = weekDatesFor(WED);
  assert.equal(week.length, 7);
  assert.equal(week[0]!.getDay(), 1);
  assert.equal(week[6]!.getDay(), 0);
});

test("a worked day shows its punch span and net total", () => {
  const line = dayFacts(worked("2026-08-10"), MON, FRI);
  assert.match(line.range!, /7:58/);
  assert.match(line.range!, /5:06/);
  assert.ok(line.worked);
  assert.equal(line.note, null);
});

test("leave is named, and shows no invented hours", () => {
  const day = { date: "2026-08-12", leave: { on_leave: true, leave_type: "Annual Leave" } } as Day;
  const line = dayFacts(day, WED, FRI);
  assert.equal(line.note, "Annual Leave");
  assert.equal(line.range, null);
  assert.equal(line.worked, null);
});

test("a scheduled day with no punches is stated, never judged", () => {
  // "absent" would be the app taking a position it has no standing to take:
  // the engine's verdict is provisional at this point and HR has reviewed
  // nothing. This assertion is the guard on that.
  const day = { date: "2026-08-10", shift: { shift_assigned: true }, checkins: [] } as unknown as Day;
  const line = dayFacts(day, MON, FRI);
  assert.equal(line.note, "No punches recorded");
  for (const judgment of ["absent", "late", "missing", "violation", "failed"]) {
    assert.doesNotMatch(line.note!.toLowerCase(), new RegExp(judgment));
  }
});

test("a future scheduled day reads as not-yet rather than as a gap", () => {
  const day = { date: "2026-08-14", shift: { shift_assigned: true }, checkins: [] } as unknown as Day;
  assert.equal(dayFacts(day, FRI, MON).note, "Scheduled");
});

test("an unrostered day is a day off, not a missing shift", () => {
  const day = { date: "2026-08-15", shift: { shift_assigned: false }, checkins: [] } as unknown as Day;
  assert.equal(dayFacts(day, new Date(2026, 7, 15), FRI).note, "Day off");
});

test("a day the payload has nothing for does not crash the row", () => {
  assert.equal(dayFacts(undefined, MON, FRI).note, "Day off");
});

// ---------------------------------------------------------------------------
// The week selector
// ---------------------------------------------------------------------------

test("the header names the range, repeating the month only across one", () => {
  // Every character here competes with two arrow buttons on a 390px phone.
  assert.equal(weekRangeLabel(weekForOffset(WED, 0)), "10 – 16 Aug");
  const straddles = weekForOffset(new Date(2026, 7, 31), 0);
  assert.match(weekRangeLabel(straddles), /Aug – .*Sep/);
});

test("an offset moves whole weeks, and zero is the week containing today", () => {
  assert.equal(weekForOffset(WED, 0)[0]!.getTime(), weekDatesFor(WED)[0]!.getTime());
  const back = weekForOffset(WED, -1);
  assert.equal(back[0]!.getDate(), 3);
  assert.equal(back[6]!.getDate(), 9);
});

test("there is no forward past the current week", () => {
  // Nothing is recorded in the future, and a next-week view of seven
  // "Scheduled" rows invites the reader to think something is missing.
  assert.equal(canGoForward(0), false, "the current week is the end of the road");
  assert.equal(canGoForward(-1), true);
  assert.equal(canGoForward(1), false);
});

test("the next-week control is present but disabled on the current week", () => {
  // Disabled rather than absent: a control that vanishes moves the header out
  // from under a thumb that is paging through weeks.
  const html = renderToStaticMarkup(
    <WeekNav label="10 – 16 Aug" offset={0} onOffsetChange={() => {}} />,
  );
  assert.match(html, /aria-label="Next week"[^>]*\sdisabled=""/);
  assert.match(html, /aria-label="Previous week"/);
  assert.doesNotMatch(html, /aria-label="Previous week"[^>]*\sdisabled=""/);
});

test("an offset week offers the way back to this one", () => {
  const html = renderToStaticMarkup(
    <WeekNav label="3 – 9 Aug" offset={-1} onOffsetChange={() => {}} />,
  );
  assert.match(html, /Back to this week/);
  assert.doesNotMatch(html, /aria-label="Next week"[^>]*\sdisabled=""/);
});

test("a week row is a real button naming the whole day", () => {
  // The row IS the affordance. A <li> with an onClick is invisible to a
  // keyboard and to a screen reader, and "Tuesday" alone tells a screen-reader
  // user nothing about which of the seven they are on.
  let opened: Date | null = null;
  const facts = dayFacts(worked("2026-08-10"), MON, FRI);
  const element = (
    <WeekRow date={MON} facts={facts} isToday onOpen={(d) => { opened = d; }} />
  );
  const html = renderToStaticMarkup(element);
  assert.match(html, /<button/);
  assert.match(html, /aria-label="Monday 10 August: [^"]*7:58/);

  const button = (element.props as { onOpen: (d: Date) => void });
  button.onOpen(MON);
  assert.equal(opened, MON);
});
