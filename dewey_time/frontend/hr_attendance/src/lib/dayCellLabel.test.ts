import { test } from "node:test";
import assert from "node:assert/strict";

import { dayCellAccessibleName } from "./dayCellLabel";
import type { Day } from "../types/calendar";

const D = new Date(2026, 6, 1); // Wed 1 July 2026

const day = (over: Partial<Day>): Day => ({ date: "2026-07-01", ...over }) as Day;

test("a day always announces its weekday and date", () => {
  assert.match(dayCellAccessibleName(D, undefined), /^Wednesday 1 July/);
});

test("a scheduled day with no punches says so rather than announcing nothing", () => {
  // The UNNOTIFIED_ABSENCE case: previously this button contained only
  // aria-hidden grid lines and an unlabelled dashed div.
  const label = dayCellAccessibleName(D, day({ shift: { shift_assigned: true }, checkins: [] }));
  assert.match(label, /no punches recorded/);
});

test("a worked day announces its range", () => {
  const label = dayCellAccessibleName(
    D,
    day({
      shift: { shift_assigned: true },
      first_in: "2026-07-01 09:00:00",
      last_out: "2026-07-01 17:00:00",
      checkins: [
        { time: "2026-07-01 09:00:00" },
        { time: "2026-07-01 17:00:00" },
      ],
    } as Partial<Day>),
  );
  assert.match(label, /worked/);
});

test("punches without a usable range are counted, not denied", () => {
  const label = dayCellAccessibleName(
    D,
    day({ shift: { shift_assigned: true }, checkins: [{ time: "2026-07-01 09:00:00" }] } as Partial<Day>),
  );
  assert.match(label, /1 punch recorded/);
});

test("off, holiday and leave are distinguished", () => {
  assert.match(dayCellAccessibleName(D, day({ shift: { shift_assigned: false } })), /day off/);
  assert.match(
    dayCellAccessibleName(D, day({ holiday: { description: "X", weekly_off: false } } as Partial<Day>)),
    /holiday/,
  );
  assert.match(
    dayCellAccessibleName(D, day({ leave: { on_leave: true, leave_type: "Annual Leave" } } as Partial<Day>)),
    /on leave, Annual Leave/,
  );
});

test("flags are counted, because that is why HR clicks the day", () => {
  const label = dayCellAccessibleName(
    D,
    day({ shift: { shift_assigned: false }, flags: [{ flag_code: "A" }, { flag_code: "B" }] } as Partial<Day>),
  );
  assert.match(label, /2 flags/);
  const one = dayCellAccessibleName(
    D,
    day({ shift: { shift_assigned: false }, flags: [{ flag_code: "A" }] } as Partial<Day>),
  );
  assert.match(one, /1 flag(?!s)/);
});

test("the worked total is part of the name", () => {
  // aria-label replaces the accessible name computed from the column's
  // contents, so a figure the column displays must be restated here or it
  // disappears from assistive tech — and from e2e's day selector.
  const label = dayCellAccessibleName(
    D,
    day({ shift: { shift_assigned: true }, gross_minutes: 534 } as Partial<Day>),
  );
  assert.match(label, /8h 54m/);
});
