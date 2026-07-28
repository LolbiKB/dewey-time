import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DayChips } from "./DayChips";

test("renders a Clock chip on a clock day", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <DayChips isClockDay />
    </TooltipProvider>,
  );
  assert.match(html, />Clock</);
});

// No TooltipProvider needed here: with no props, DayChips returns null before
// any tooltip is constructed, so there's nothing for a missing provider to break.
test("renders nothing when there is nothing to show", () => {
  const html = renderToStaticMarkup(<DayChips />);
  assert.equal(html, "");
});

test("a clock day carries no destructive styling", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <DayChips isClockDay />
    </TooltipProvider>,
  );
  assert.doesNotMatch(html, /destructive/);
});

// Source assertions: the headline behaviour (clock days render neutrally) spans
// two files whose full data stack a rendering test can't easily reproduce here —
// WeekView.tsx needs a real Day map to route through isClockDay, and
// WeekDayView.tsx's DayChips wiring only fires once a day is actually selected.
// Pin the conditions at the source instead (same idiom as clockDayGate.test.tsx).
const weekView = readFileSync(new URL("./WeekView.tsx", import.meta.url), "utf8");
const weekDayView = readFileSync(new URL("./WeekDayView.tsx", import.meta.url), "utf8");

test("clock days are excluded from off-day (destructive) styling", () => {
  assert.match(
    weekView,
    /const isOffDay =\s*holiday != null \|\| \(!clockDay && info\?\.shift\?\.shift_assigned !== true\)/,
  );
});

test("phone day view wires the Clock chip", () => {
  assert.match(weekDayView, /isClockDay=\{isClockDay\(props\.isClockBased, selectedInfo\)\}/);
});
