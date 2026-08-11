import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SpreadsheetImportTrigger } from "@/ui/schedule-import/SpreadsheetImportTrigger";
import { ClearAllSchedulesDialog } from "@/ui/ClearAllSchedulesDialog";
import { ClearEmployeeScheduleDialog } from "@/ui/ClearEmployeeScheduleDialog";
import { ClearSitePatternsDialog } from "@/ui/ClearSitePatternsDialog";
import { RunEngineDialog } from "@/ui/RunEngineDialog";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Both providers exist for the FAILING case, not the passing one.
//
// While the guards hold, none of this is needed: each component returns null
// before touching a hook, so it renders with no context at all. But a test
// whose failure mode is a crash is a weak test -- it proves the guard changed
// something, not that the button appeared. With these in place, deleting a
// guard produces the trigger's actual HTML and the assertion fails on the
// thing it names.
//
// Verified: without QueryClientProvider these die on "No QueryClient set" from
// useClearAllSchedules; without TooltipProvider, RunEngineDialog's AppTooltip
// throws.
const queryClient = new QueryClient();

function markup(node: ReactNode) {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

// THE CONTROL. Every assertion below is an absence, and absence proves nothing
// if the harness renders nothing at all. This is a real, non-dev trigger from
// the same header row: it must appear.
test("the render harness works: a non-dev trigger DOES render", () => {
  const html = markup(<SpreadsheetImportTrigger onClick={() => {}} />);
  assert.match(html, />Import</);
});

test("Clear schedule (dev) does not render in a production build", () => {
  const html = markup(<ClearEmployeeScheduleDialog employee="HR-EMP-00001" />);
  assert.doesNotMatch(html, /Clear schedule \(dev\)/);
});

test("Clear all (dev) does not render in a production build", () => {
  const html = markup(<ClearAllSchedulesDialog />);
  assert.doesNotMatch(html, /Clear all \(dev\)/);
});

test("Wipe patterns (dev) does not render in a production build", () => {
  const html = markup(<ClearSitePatternsDialog />);
  assert.doesNotMatch(html, /Wipe patterns \(dev\)/);
});

test("Run flag engine (dev) does not render in a production build", () => {
  // Asserted on the aria-label: this trigger is an icon button with no visible
  // text, so matching on the "(dev)" string would only find the tooltip
  // content and would pass even if the button itself rendered.
  const html = markup(
    <RunEngineDialog employee="HR-EMP-00001" weekStart={new Date("2026-03-02T00:00:00Z")} />,
  );
  assert.doesNotMatch(html, /aria-label="Run flag engine"/);
});

test("all four dev controls carry the guard, not just the ones rendered above", () => {
  // A source-text check in the idiom of dialogMigration.test.tsx. The render
  // tests prove the four behave correctly today; this one fails loudly if
  // someone adds a fifth dev control to the list without gating it, or strips
  // a guard while leaving the component returning null for another reason.
  const GATED = [
    "src/ui/ClearAllSchedulesDialog.tsx",
    "src/ui/ClearEmployeeScheduleDialog.tsx",
    "src/ui/ClearSitePatternsDialog.tsx",
    "src/ui/RunEngineDialog.tsx",
  ];
  for (const rel of GATED) {
    const src = readFileSync(resolve(PKG, rel), "utf8");
    assert.match(src, /IS_DEV_BUILD/, `${rel} imports the build guard`);
    assert.match(src, /if \(!IS_DEV_BUILD\) return null;/, `${rel} returns null in prod builds`);
  }
});
