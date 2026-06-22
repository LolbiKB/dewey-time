import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { CalendarDaysIcon, CalendarRangeIcon } from "lucide-react";
import { MobileTabBar } from "../ui/MobileTabBar";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("MobileTabBar is a phone-only, safe-area-padded bottom nav with the active signal", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <MobileTabBar
        items={[
          { label: "Attendance", href: "/hr-attendance", active: true, icon: CalendarDaysIcon },
          { label: "Schedule", href: "/hr-schedule", active: false, icon: CalendarRangeIcon },
        ]}
      />
    </MemoryRouter>,
  );
  assert.match(html, /aria-label="Primary"/, "labelled nav");
  assert.match(html, /md:hidden/, "hidden from md up (tablet/desktop keep top tabs)");
  assert.match(html, /env\(safe-area-inset-bottom\)/, "safe-area padded");
  assert.match(html, /Attendance/);
  assert.match(html, /Schedule/);
  assert.match(html, /aria-current="page"/, "active tab marked");
  assert.match(html, /text-primary/, "active tab carries the primary signal");
  assert.match(html, /text-muted-foreground/, "inactive tab is muted");
});

test("useIsMobile seeds synchronously (no first-paint desktop flash)", () => {
  const src = readFileSync(resolve(PKG, "src/hooks/useIsMobile.ts"), "utf8");
  assert.match(src, /useState\(read\)/, "state seeded from a sync reader, not an effect");
  assert.ok(!/useState\(\s*(void 0|undefined)\s*\)/.test(src), "not seeded undefined");
  assert.match(src, /innerWidth/, "reads window width");
});

test("HrAppShell swaps the top tabs for the bottom bar on phones and pads for it", () => {
  const shell = readFileSync(resolve(PKG, "src/ui/HrAppShell.tsx"), "utf8");
  assert.match(shell, /useIsMobile/, "uses the sync mobile hook");
  assert.match(shell, /MobileTabBar/, "renders the bottom bar");
  assert.match(shell, /isMobile && showBottomNav \? \[\] : tabs/, "empties top tabs on phone");
  assert.match(shell, /pb-\[calc\(3\.5rem\+env\(safe-area-inset-bottom\)\)\]/, "pads content for the bar");
});

test("the <Outlet> wrapper is a full-height passthrough so screens flex to fill (regression)", () => {
  // dewey-ui's TabsShell content slot is `min-h-0 flex-1 overflow-hidden` — a
  // definite-height block. The screens (App week grid, WeeklySchedulePage shift
  // blocks) use an `h-full` root that fills it. The bottom-nav padding wrapper we
  // inject between the slot and <Outlet> MUST carry h-full unconditionally, or it
  // collapses to content height and the cards stop flexing to fill (incl. desktop).
  const shell = readFileSync(resolve(PKG, "src/ui/HrAppShell.tsx"), "utf8");
  assert.match(
    shell,
    /<div\s+className=\{cn\(\s*"[^"]*h-full[^"]*"\s*,[\s\S]*?\)\}\s*>\s*<Outlet/,
    "the div wrapping <Outlet> passes the shell's full height down (unconditional h-full)",
  );
});

test("touch shell is active (PWA installs on touch devices)", () => {
  const css = readFileSync(resolve(PKG, "src/brand/base.css"), "utf8");
  assert.match(css, /@media \(pointer: coarse\)/, "touch-shell media query present");
  assert.match(css, /user-select:\s*none/, "non-selectable body on touch");
  assert.ok(!css.includes("Uncomment to turn on"), "active, not the commented template");
});
