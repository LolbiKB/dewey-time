import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * A source-text guard, not a render: `ResponsiveModal`'s desktop leg is a
 * Radix `Dialog`, which only portals its content into a real DOM — it
 * renders nothing under `renderToStaticMarkup` (confirmed empirically: an
 * open `SchedulePlanPreviewDialog` rendered this way produces a zero-length
 * string). `weekCanvasFrame.test.tsx` already proves the `minDayWidth`
 * mechanism itself works; this test is the one guarding that the dialog
 * still asks for it, matching the pattern `dialogMigration.test.tsx` uses
 * for the same class of “can only assert from source” regression.
 */
test("the dialog gives its canvas a narrower minimum than WeekCanvasFrame's 8rem default", () => {
  const src = readFileSync(resolve(PKG, "src/ui/SchedulePlanPreviewDialog.tsx"), "utf8");
  const canvasBlock = src.match(/<PlannedWeekCanvas[\s\S]*?\/>/)?.[0];
  assert.ok(canvasBlock, "expected a <PlannedWeekCanvas ... /> in the dialog body");

  const minDayWidth = canvasBlock!.match(/minDayWidth="([^"]+)"/)?.[1];
  assert.ok(
    minDayWidth,
    "the dialog is size=\"md\" (sm:max-w-lg, 32rem) minus padding — at WeekCanvasFrame's " +
      "default 8rem-per-column minimum, only about three of seven days fit before the grid " +
      "scrolls. Losing this prop silently regresses the preview back to that.",
  );
  assert.notEqual(minDayWidth, "8rem", "must differ from the default, not just repeat it");
});
