import assert from "node:assert/strict";
import test from "node:test";

import { dayFacts } from "@/miniapp/miniDay";
import { dayMark, dayMarkLabel, type DayMark } from "@/miniapp/miniDayMark";
import type { Day } from "@/types/calendar";

/**
 * The mark is what an employee reads about their own day at a glance, so every
 * case here is written as the sentence it has to survive being read as.
 *
 * Fixed dates, never `new Date()`: half of these turn on where `now` sits
 * inside a shift, and a suite that passes in the morning and accuses somebody
 * in the evening is worse than no suite.
 */
const AUG = (day: number, hour = 9, min = 0) => new Date(2026, 7, day, hour, min);
const KEY = (day: number) => `2026-08-${String(day).padStart(2, "0")}`;

const SHIFT = {
  shift_assigned: true,
  start_time: "08:00:00",
  end_time: "17:00:00",
  lunch_start: "12:00:00",
  lunch_end: "13:00:00",
};

/**
 * `count` punches out of a normal 4-punch day. 3 is the forgotten clock-out.
 *
 * The punches carry a branch because real mapped-device punches do, and the
 * pairing is branch-run based: a branchless punch is its own run, which is
 * the UNMAPPED-DEVICE shape and gets its own test below.
 */
function day(dayNum: number, count: number, extra: Partial<Day> = {}): Day {
  const k = KEY(dayNum);
  const all = [
    { time: `${k} 07:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
    { time: `${k} 12:01:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
    { time: `${k} 12:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
    { time: `${k} 17:06:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
  ].slice(0, count);
  const outs = all.filter((c) => c.log_type === "OUT");
  return {
    date: k,
    shift: SHIFT,
    holiday: null,
    leave: { on_leave: false },
    first_in: all.length ? all[0]!.time : null,
    last_out: outs.length ? outs[outs.length - 1]!.time : null,
    checkins: all,
    ...extra,
  } as unknown as Day;
}

/** Run the real pair, the way the sheet does. */
function mark(d: Day | undefined, date: Date, now: Date): DayMark {
  return dayMark(dayFacts(d, date, now), d, date, now);
}

// ---------------------------------------------------------------------------
// The present tense
// ---------------------------------------------------------------------------

test("today's open run is not an accusation", () => {
  // THE ONE THAT MATTERS MOST. At 09:00 on a rostered day there is one punch
  // and no matching out, because the person is at work. An earlier draft
  // marked that `incomplete` — an amber ring on a morning going perfectly
  // well, on the phone of the person it is about.
  assert.equal(mark(day(17, 1), AUG(17), AUG(17, 9, 0)), "none");
  assert.equal(mark(day(17, 3), AUG(17), AUG(17, 13, 30)), "none");
});

test("today with nothing recorded yet is not a missing day", () => {
  // 07:30 on an 08:00 shift. Nobody has arrived because it is not eight
  // o'clock.
  assert.equal(mark(day(17, 0), AUG(17), AUG(17, 7, 30)), "none");
});

test("today becomes judgeable once the rostered end has passed", () => {
  // 17:00 is the end. After it, the day is over and its record is final.
  assert.equal(mark(day(17, 0), AUG(17), AUG(17, 17, 30)), "missing");
  assert.equal(mark(day(17, 3), AUG(17), AUG(17, 17, 30)), "incomplete");
  assert.equal(mark(day(17, 4), AUG(17), AUG(17, 17, 30)), "complete");
});

test("a completed day today reads complete even mid-shift", () => {
  // Punched out at 17:06 but read at 13:00 — an odd fixture, but the record
  // IS whole, and withholding the reassuring mark would be the wrong caution.
  assert.equal(mark(day(17, 4), AUG(17), AUG(17, 13, 0)), "complete");
});

test("nothing is marked in the future — not even a day off", () => {
  // These showed hollow rings on next week's weekends: a row of noise
  // standing exactly where the eye scans for days that need attention.
  // Caught in a screenshot, not by a test, which is why this one exists.
  assert.equal(mark(day(20, 0), AUG(20), AUG(17, 12, 0)), "none");
  const futureOff = day(22, 0, { shift: { shift_assigned: false } } as Partial<Day>);
  assert.equal(mark(futureOff, AUG(22), AUG(17, 12, 0)), "none");
  const futureHoliday = day(21, 0, { holiday: { description: "Constitution Day" } } as Partial<Day>);
  assert.equal(mark(futureHoliday, AUG(21), AUG(17, 12, 0)), "none");
});

// ---------------------------------------------------------------------------
// Past days
// ---------------------------------------------------------------------------

test("pairing is the branch-run replay, the same rule the timeline draws by", () => {
  // Not whole-day parity any more: the day is grouped into branch runs and
  // each run paired by `pairRun`, exactly as `deriveSegments` draws it.
  // Complete means NOTHING went unmatched.
  assert.equal(mark(day(10, 4), AUG(10), AUG(17, 12, 0)), "complete");
  assert.equal(mark(day(10, 2), AUG(10), AUG(17, 12, 0)), "complete");
  assert.equal(mark(day(10, 3), AUG(10), AUG(17, 12, 0)), "incomplete");
  assert.equal(mark(day(10, 1), AUG(10), AUG(17, 12, 0)), "incomplete");
});

test("a cover shift's lone closing punch is not one undifferentiated oddness", () => {
  // Four paired punches at the home branch, then the day's departure recorded
  // at a second site. Whole-day parity saw "five, odd" and the single string
  // said "no clock-out recorded" -- the clock-out is the punch that EXISTS.
  const k = KEY(10);
  const cover = day(10, 4, {
    checkins: [
      { time: `${k} 07:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${k} 12:01:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
      { time: `${k} 12:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${k} 16:00:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
      { time: `${k} 19:00:00`, log_type: "OUT", custom_device_branch: "DIS Toul Kork" },
    ],
  } as Partial<Day>);
  assert.equal(mark(cover, AUG(10), AUG(17, 12, 0)), "incomplete");
  assert.equal(dayMarkLabel("incomplete", cover), "markIncompleteNoIn");
});

test("a lone OUT is an unpaired clock-out, never a missing one", () => {
  // THE AUDIT'S EXACT CASE: a day whose only punch is an explicit OUT was
  // announced as "no clock-out recorded" -- the opposite of what happened --
  // and sent the worker to argue about the wrong end of their day.
  const k = KEY(10);
  const loneOut = day(10, 0, {
    checkins: [{ time: `${k} 17:06:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" }],
  } as Partial<Day>);
  assert.equal(mark(loneOut, AUG(10), AUG(17, 12, 0)), "incomplete");
  assert.equal(dayMarkLabel("incomplete", loneOut), "markIncompleteNoIn");
});

test("a lone IN keeps the wording that was always right for it", () => {
  assert.equal(dayMarkLabel("incomplete", day(10, 1)), "markIncomplete");
  assert.equal(dayMarkLabel("incomplete", day(10, 3)), "markIncomplete");
});

test("unlabelled or mixed strays refuse to name an end", () => {
  // Direction comes from a punch's own label and nothing else -- position
  // pairs, it never names. An unlabelled stray gets the neutral wording, the
  // same refusal the Telegram receipt makes when it cannot honestly call it.
  const k = KEY(10);
  const blankStray = day(10, 0, {
    checkins: [
      { time: `${k} 07:58:00`, log_type: null, custom_device_branch: "DIS Iconic" },
      { time: `${k} 12:01:00`, log_type: null, custom_device_branch: "DIS Iconic" },
      { time: `${k} 12:58:00`, log_type: null, custom_device_branch: "DIS Iconic" },
    ],
  } as Partial<Day>);
  assert.equal(mark(blankStray, AUG(10), AUG(17, 12, 0)), "incomplete");
  assert.equal(dayMarkLabel("incomplete", blankStray), "markUnpaired");

  const mixed = day(10, 0, {
    checkins: [
      { time: `${k} 07:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${k} 17:06:00`, log_type: "OUT", custom_device_branch: "DIS Toul Kork" },
    ],
  } as Partial<Day>);
  assert.equal(dayMarkLabel("incomplete", mixed), "markUnpaired");
});

test("an unmapped device's day cannot masquerade as a complete record", () => {
  // No branch means every punch is its own run -- the timeline draws two
  // strays and totals zero. Whole-day parity called this even count
  // "complete record" while the canvas below showed nothing paired: the mark
  // now agrees with the picture, and the wording stays neutral because the
  // punches carry no labels to name an end with.
  const k = KEY(10);
  const unmapped = day(10, 0, {
    checkins: [
      { time: `${k} 07:58:00`, log_type: null },
      { time: `${k} 17:06:00`, log_type: null },
    ],
  } as Partial<Day>);
  assert.equal(mark(unmapped, AUG(10), AUG(17, 12, 0)), "incomplete");
  assert.equal(dayMarkLabel("incomplete", unmapped), "markUnpaired");
});

test("two arrivals in one run are an unmatched punch, whatever the count", () => {
  // The discriminator between pairRun and any parity rule, per-run included:
  // an even-count run of two INs has a duplicate arrival in it, which parity
  // of every flavour calls a complete record. pairRun keeps the first arrival
  // open and files the repeat as unmatched.
  const k = KEY(10);
  const doubled = day(10, 0, {
    checkins: [
      { time: `${k} 08:00:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${k} 09:00:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
    ],
  } as Partial<Day>);
  assert.equal(mark(doubled, AUG(10), AUG(17, 12, 0)), "incomplete");
});

test("the payload's order cannot change the mark", () => {
  // The runs are grouped by walking CONSECUTIVE punches, so an out-of-order
  // row would split one run into three and flip complete to incomplete. The
  // payload's order is the query's order, not a guarantee -- sorted first.
  const k = KEY(10);
  const scrambled = day(10, 0, {
    checkins: [
      { time: `${k} 12:01:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
      { time: `${k} 17:06:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
      { time: `${k} 07:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: `${k} 12:58:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
    ],
  } as Partial<Day>);
  assert.equal(mark(scrambled, AUG(10), AUG(17, 12, 0)), "complete");
});

test("the label passthrough for the other marks is the static table", () => {
  assert.equal(dayMarkLabel("complete", day(10, 4)), "markComplete");
  assert.equal(dayMarkLabel("missing", day(10, 0)), "markMissing");
  assert.equal(dayMarkLabel("off", undefined), "markOff");
  assert.equal(dayMarkLabel("uncertain", day(10, 0)), "markUncertain");
});

test("one lone punch is incomplete, not missing", () => {
  // These are opposite problems and dayFacts cannot tell them apart: a single
  // IN with no OUT has no range, so its tone is "nothing" — the same tone a
  // day nobody came to gets. Keying the mark on tone called a forgotten
  // clock-out an absence. The count is the only thing that separates them.
  assert.equal(mark(day(10, 1), AUG(10), AUG(17, 12, 0)), "incomplete");
});

test("a rostered day with no punches at all is missing, not incomplete", () => {
  // Different things to go and fix: one is a forgotten tap, the other is a
  // day with no evidence anybody was there.
  assert.equal(mark(day(13, 0), AUG(13), AUG(17, 12, 0)), "missing");
});

test("an unrostered day with no punches is off, never missing", () => {
  // A Saturday is not an absence. Without this the grid accuses everybody of
  // two missing days a week, every week.
  const off = day(15, 0, { shift: { shift_assigned: false } } as Partial<Day>);
  assert.equal(mark(off, AUG(15), AUG(17, 12, 0)), "off");
});

test("a day the payload has nothing for is off, and does not crash", () => {
  assert.equal(mark(undefined, AUG(9), AUG(17, 12, 0)), "off");
});

// ---------------------------------------------------------------------------
// Leave and holidays outrank punches
// ---------------------------------------------------------------------------

test("leave and holidays outrank punches, matching dayFacts", () => {
  // Somebody who came in for an hour on a public holiday is still on a
  // holiday. The grid must not disagree with the heading the same day shows
  // when it is opened.
  const onLeave = day(11, 2, { leave: { on_leave: true, leave_type: "Annual Leave" } } as Partial<Day>);
  assert.equal(mark(onLeave, AUG(11), AUG(17, 12, 0)), "off");

  const holiday = day(12, 2, { holiday: { description: "Constitution Day" } } as Partial<Day>);
  assert.equal(mark(holiday, AUG(12), AUG(17, 12, 0)), "off");
});

test("a leave day with an odd punch count is still off, not incomplete", () => {
  const onLeave = day(11, 1, { leave: { on_leave: true, leave_type: "Sick Leave" } } as Partial<Day>);
  assert.equal(mark(onLeave, AUG(11), AUG(17, 12, 0)), "off");
});

// ---------------------------------------------------------------------------
// The union is closed
// ---------------------------------------------------------------------------

test("every mark this app can produce is one of the five", () => {
  // A sixth would render as an unstyled cell rather than fail, because the
  // class lookup in Mark is indexed by the union.
  const seen = new Set<DayMark>([
    mark(day(10, 4), AUG(10), AUG(17, 12, 0)),
    mark(day(10, 3), AUG(10), AUG(17, 12, 0)),
    mark(day(13, 0), AUG(13), AUG(17, 12, 0)),
    mark(day(15, 0, { shift: { shift_assigned: false } } as Partial<Day>), AUG(15), AUG(17, 12, 0)),
    mark(day(20, 0), AUG(20), AUG(17, 12, 0)),
  ]);
  assert.deepEqual(
    [...seen].sort(),
    ["complete", "incomplete", "missing", "none", "off"],
  );
});

test("a night shift's own day is not judged finished at its end minute", () => {
  // THE DEFECT: `end_time` is a minute-of-day, so a 22:00–06:00 roster reported
  // an end of 360 and every minute after six in the morning compared as "over".
  // The day was marked `missing` from 06:00 — sixteen hours before the shift
  // starts — and then `incomplete` all night while they stood at the machine.
  const day = {
    date: "2026-08-19",
    shift: { shift_assigned: true, start_time: "22:00:00", end_time: "06:00:00" },
    checkins: [],
  } as unknown as Day;
  const date = new Date(2026, 7, 19);

  const facts = dayFacts(day, date, date);
  // Midday: the shift has not started, so there is nothing to report yet.
  assert.equal(dayMark(facts, day, date, new Date(2026, 7, 19, 12, 0)), "none");
  // And late in the evening, mid-shift, it is still not a verdict.
  assert.equal(dayMark(facts, day, date, new Date(2026, 7, 19, 23, 30)), "none");
});

test("an ordinary day still finishes at its end time", () => {
  // The counterweight: the wrap guard must not stop every day from being judged.
  const day = {
    date: "2026-08-19",
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    checkins: [],
  } as unknown as Day;
  const date = new Date(2026, 7, 19);
  const facts = dayFacts(day, date, date);

  assert.equal(dayMark(facts, day, date, new Date(2026, 7, 19, 12, 0)), "none");
  assert.equal(dayMark(facts, day, date, new Date(2026, 7, 19, 18, 0)), "missing");
});

test("a day our own feed never delivered is not marked like a no-show", () => {
  const base = {
    date: "2026-08-19",
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    checkins: [],
  };
  const date = new Date(2026, 7, 19);
  const after = new Date(2026, 7, 19, 18, 0);

  const blamed = base as unknown as Day;
  assert.equal(dayMark(dayFacts(blamed, date, date), blamed, date, after), "missing");

  const ours = { ...base, feed_uncertain: true } as unknown as Day;
  assert.equal(dayMark(dayFacts(ours, date, date), ours, date, after), "uncertain");
});

test("an uncertain feed does not rewrite a record that arrived intact", () => {
  // Punches that came through and paired up are a complete record whatever the
  // device did afterwards; calling every day uncertain would excuse real
  // absences, which is the same dishonesty facing the other way.
  const day = {
    date: "2026-08-19",
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    feed_uncertain: true,
    first_in: "2026-08-19 08:00:00",
    last_out: "2026-08-19 17:00:00",
    checkins: [
      { time: "2026-08-19 08:00:00", log_type: "IN", custom_device_branch: "DIS Iconic" },
      { time: "2026-08-19 17:00:00", log_type: "OUT", custom_device_branch: "DIS Iconic" },
    ],
  } as unknown as Day;
  const date = new Date(2026, 7, 19);

  assert.equal(
    dayMark(dayFacts(day, date, date), day, date, new Date(2026, 7, 19, 18, 0)),
    "complete",
  );
});
