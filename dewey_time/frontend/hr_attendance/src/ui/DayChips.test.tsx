import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DayChips } from "./DayChips";

test("renders a Clock chip on a clock day", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <DayChips isClockDay />
    </TooltipProvider>,
  );
  assert.match(html, /Clock/);
});

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
