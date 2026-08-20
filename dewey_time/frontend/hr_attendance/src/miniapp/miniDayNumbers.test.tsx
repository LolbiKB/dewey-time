import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MiniDayNumbers } from "@/miniapp/MiniDayNumbers";
import type { Day } from "@/types/calendar";

/** Source with comments stripped, so a guard cannot match its own note. */
function source(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DATE = new Date(2026, 7, 10);

function render(day: Day | undefined, flagCount = 0, now = DATE) {
  return renderToStaticMarkup(
    <MiniDayNumbers
      day={day} date={DATE} today={DATE} now={now}
      flagCount={flagCount} onOpenFlags={() => {}}
    />,
  );
}

const WORKED = {
  date: "2026-08-10",
  shift: {
    shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
    lunch_start: "12:00:00", lunch_end: "13:00:00",
  },
  checkins: [
    { time: "2026-08-10 08:00:00", log_type: "IN", custom_device_branch: "A" },
    { time: "2026-08-10 16:00:00", log_type: "OUT", custom_device_branch: "A" },
  ],
} as unknown as Day;

const ON_LEAVE = {
  date: "2026-08-10",
  leave: { on_leave: true, leave_type: "Annual Leave" },
  shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
  checkins: [],
} as unknown as Day;

test("a worked day shows both figures", () => {
  assert.match(render(WORKED), /8h/);
});

test("a leave day shows no numbers and no row", () => {
  // The status chip beside the date already says "Annual Leave".
  assert.equal(render(ON_LEAVE), "");
});

test("a leave day WITH a flag still renders, carrying the pill alone", () => {
  const html = render(ON_LEAVE, 2);
  assert.match(html, /2 to check/);
  // No rostered figure smuggled in beside it.
  assert.ok(!/8h/.test(html), "a leave day must not show a rostered figure");
});

test("nothing to say and nothing flagged renders nothing at all", () => {
  const empty = {
    date: "2026-08-08", shift: { shift_assigned: false }, checkins: [],
  } as unknown as Day;
  assert.equal(render(empty), "");
});

test("the figures carry a spoken sentence, not a slash", () => {
  // "8h 11m / 8h" read aloud is two durations and a punctuation mark.
  assert.match(render(WORKED), /Worked .* of .* rostered/);
});

test("a live day marks its total as still running", () => {
  const day = {
    date: "2026-08-10",
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    checkins: [
      { time: "2026-08-10 08:00:00", log_type: "IN", custom_device_branch: "A" },
    ],
  } as unknown as Day;
  const html = render(day, 0, new Date(2026, 7, 10, 11, 0, 0));
  assert.match(html, /so far/);
  // And a finished day does not, or a final figure reads as unfinished.
  assert.ok(!/so far/.test(render(WORKED)), "a closed day must not say 'so far'");
});

// A day somebody plainly worked, whose punches cannot be added up: neither
// carries a device branch, and `deriveSegments` drops a run whose first punch
// has none. The visible row prints "—"; the question is what it SAYS.
const UNADDABLE = {
  date: "2026-08-10",
  shift: {
    shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00",
    lunch_start: "12:00:00", lunch_end: "13:00:00",
  },
  checkins: [
    { time: "2026-08-10 08:00:00", log_type: "IN" },
    { time: "2026-08-10 17:05:00", log_type: "OUT" },
  ],
} as unknown as Day;

test("a record that will not add up is not spoken as an empty day", () => {
  // "Rostered 8h, nothing worked yet" is an accusation on a day with two
  // punches on it. The em dash means "no figure", never "no work", and the
  // sentence has to mean the same thing the dash does.
  const html = render(UNADDABLE);
  assert.match(html, /—/);
  assert.match(html, /could not be added up/);
  assert.ok(
    !/nothing worked yet/.test(html),
    "a day with punches must not be announced as one with none",
  );
});

test("a rostered day with NO punches keeps the old sentence", () => {
  // The inversion. If both arms said the same thing the fix would be a
  // rewording, not a distinction — and this is the day where "nothing worked
  // yet" is the honest reading.
  const bare = {
    date: "2026-08-10",
    shift: { shift_assigned: true, start_time: "08:00:00", end_time: "17:00:00" },
    checkins: [],
  } as unknown as Day;
  assert.match(render(bare), /nothing worked yet/);
});

test("a clock-based day with punches is no longer silent", () => {
  // No roster, so `rostered` is null and every arm above fell through to
  // null — a screen reader got NOTHING on a day carrying punches and a flag.
  const clockDay = {
    date: "2026-08-10",
    shift: { shift_assigned: false },
    checkins: [
      { time: "2026-08-10 09:00:00", log_type: "IN" },
      { time: "2026-08-10 18:00:00", log_type: "OUT" },
    ],
  } as unknown as Day;
  const html = render(clockDay, 1);
  assert.match(html, /could not be added up/);
});

test("nothing on the Day tab is positioned fixed", () => {
  // THE defect this row exists to retire: a fixed pill cannot be laid out
  // against a tab bar it cannot measure, and it overlapped it by 35px on
  // every phone with a bottom safe-area inset. A comment is not a guard.
  for (const file of ["./MyDayPage.tsx", "./MiniFlagButton.tsx", "./MiniDayNumbers.tsx"]) {
    const code = source(file);
    assert.ok(!/\bfixed\b/.test(code), `${file} must not position anything fixed`);
    assert.ok(!/\bbottom:\s*/.test(code), `${file} must not set a bottom offset`);
  }
});
