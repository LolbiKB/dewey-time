import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { WeekDayView } from "./WeekDayView";
import type { Day } from "../types/calendar";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(`2026-07-${13 + i}T00:00:00`));

test("WeekDayView renders a 7-pip day switcher and one selected day", () => {
  const html = renderToStaticMarkup(
    <WeekDayView
      weekDates={WEEK}
      daysByDate={new Map<string, Day>()}
      alertsByDate={new Map()}
      syncByDate={new Map()}
      onInspectDay={() => {}}
      onInspectFlag={() => {}}
    />,
  );
  const pips = html.match(/data-pip=/g) ?? [];
  assert.equal(pips.length, 7, "one pip per weekday");
  assert.match(html, /aria-label="Previous day"/);
  assert.match(html, /aria-label="Next day"/);
});

test("WeekDayView reuses the shared timeline window + DayChips (no drift)", () => {
  const src = readFileSync(resolve(PKG, "src/ui/WeekDayView.tsx"), "utf8");
  assert.match(src, /useWeekTimelineWindow/, "shares the axis window with the desktop grid");
  assert.match(src, /DayCell/, "renders the standalone DayCell");
  assert.match(src, /DayChips/, "reuses the shared chip row");
  assert.match(src, /stepDay/, "chevrons step through the week");
  assert.ok(!/overflow-x-auto/.test(src), "never horizontally scrolls");
});
