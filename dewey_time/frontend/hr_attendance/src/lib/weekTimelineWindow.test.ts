import { test } from "node:test";
import assert from "node:assert/strict";
import { collectWeekTimelineMinutes, resolveWeekTimelineWindow } from "./weekTimelineWindow";
import type { Day } from "../types/calendar";

const D = (iso: string) => new Date(`${iso}T00:00:00`);

test("collectWeekTimelineMinutes gathers checkin, first/last, and shift minutes", () => {
  const days = new Map<string, Day>([
    [
      "2026-07-14",
      {
        date: "2026-07-14",
        checkins: [{ time: "2026-07-14 09:15:00" }],
        first_in: "2026-07-14 09:00:00",
        last_out: "2026-07-14 17:30:00",
        shift: { shift_assigned: true, start_time: "08:30:00", end_time: "17:00:00" },
      } as unknown as Day,
    ],
  ]);
  const mins = collectWeekTimelineMinutes([D("2026-07-14")], days);
  assert.ok(mins.includes(9 * 60 + 15), "includes checkin 09:15");
  assert.ok(mins.includes(8 * 60 + 30), "includes shift start 08:30");
  assert.ok(mins.includes(17 * 60), "includes shift end 17:00");
});

test("resolveWeekTimelineWindow falls back to 08:00–18:00 with no data", () => {
  const w = resolveWeekTimelineWindow([D("2026-07-14")], new Map());
  assert.equal(w.startMin, 8 * 60);
  assert.equal(w.endMin, 18 * 60);
  assert.equal(w.spanMinutes, 10 * 60);
  assert.equal(
    (w as Record<string, unknown>).canvasHeightPct,
    undefined,
    "no canvas height: the axis is scaled to fit, never scrolled",
  );
});
