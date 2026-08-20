import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { earliestMonth, latestMonth, MONTHS_BACK } from "@/miniapp/MiniCalendarSheet";

const SRC = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/**
 * The same file with its comments removed.
 *
 * Every "this must NOT appear" assertion below reads this rather than SRC. The
 * first draft did not, and two of them failed instantly — against comments
 * naming the very things they forbid, which is exactly what a file documenting
 * a rejected alternative is going to contain. A guard that a sentence can trip
 * is a guard nobody can write a comment near.
 */
const CODE = (name: string) =>
  SRC(name)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// Paging bounds
// ---------------------------------------------------------------------------

test("three months are reachable in total, this one included", () => {
  // "Three months back" reads two ways and the difference is a whole month,
  // so the arithmetic is pinned rather than described. In August the grid
  // reaches June: June, July, August.
  const august = new Date(2026, 7, 17, 12, 0);
  const first = earliestMonth(august);
  assert.equal(first.getFullYear(), 2026);
  assert.equal(first.getMonth(), 5, "June");
  assert.equal(first.getDate(), 1, "the first of the month, not the 17th");
});

test("the back bound crosses a year without going sideways", () => {
  const january = new Date(2026, 0, 9, 12, 0);
  const first = earliestMonth(january);
  assert.equal(first.getFullYear(), 2025);
  assert.equal(first.getMonth(), 10, "November");
});

test("forward stops at this month, because the future records nothing", () => {
  const august = new Date(2026, 7, 17, 12, 0);
  const last = latestMonth(august);
  assert.equal(last.getMonth(), 7);
  assert.equal(last.getDate(), 1);
});

test("MONTHS_BACK is two, and the name says back rather than total", () => {
  // The constant and the behaviour disagree by one on purpose: two months
  // BACK from August is June, which is three months of reach. Pinned so a
  // future edit that "fixes" the name to 3 has to face this test.
  assert.equal(MONTHS_BACK, 2);
});

// ---------------------------------------------------------------------------
// Structure the renderer cannot show
// ---------------------------------------------------------------------------

test("the sheet is a bottom Sheet, never a ResponsiveModal", () => {
  // ResponsiveModal swaps to a centre Dialog above a width breakpoint, and a
  // Telegram Desktop Mini App is wide enough to trip it. A single-viewport
  // render test cannot see that — the breakpoint only exists at the other
  // width — so the guard is a source read.
  assert.doesNotMatch(CODE("MiniCalendarSheet.tsx"), /ResponsiveModal/);
  assert.match(SRC("MiniCalendarSheet.tsx"), /side="bottom"/);
});

test("the day number is rendered through the locale's digits", () => {
  // react-day-picker emits Latin digits and has no opinion about Khmer, so a
  // grid whose header says សីហា would count ១ 2 3 without this.
  const src = SRC("MiniCalendarSheet.tsx");
  assert.match(src, /fmt\.digits\(String\(day\.date\.getDate\(\)\)\)/);
});

test("the caption's year goes through the locale's digits too", () => {
  // THE LEAK THE LOCALE DOES NOT CLOSE. date-fns's `km` gives សីហា and then
  // "2026", because it emits Latin digits in every locale — so the one line
  // above a grid of Khmer numerals was Latin. Only visible in a screenshot.
  const src = SRC("MiniCalendarSheet.tsx");
  assert.match(src, /formatCaption/);
  assert.match(src, /fmt\.digits\(String\(date\.getFullYear\(\)\)\)/);
});

test("the mark's words go through the primitive's own label API", () => {
  // A grid of forty identical circles tells a screen-reader user nothing, and
  // the circles are the entire reason the grid exists.
  //
  // THIS FILE'S FIRST ATTEMPT PUT THEM IN A VISUALLY-HIDDEN SPAN AND THEY WERE
  // NEVER ANNOUNCED: react-day-picker sets its own aria-label on every day
  // button, and an aria-label beats name-from-content unconditionally. The
  // source looked right and a source-read test passed the whole time. Only
  // dumping the rendered DOM showed it, which is why the real guard is the
  // e2e test "every day announces its mark, not just draws it" — this one only
  // pins the mechanism.
  const src = SRC("MiniCalendarSheet.tsx");
  assert.match(src, /aria-hidden="true"/, "the dot itself stays out of the name");
  assert.match(src, /labelDayButton/);
  // Through dayMarkLabel, never a static table: an `incomplete` dot has three
  // possible wordings and only the day's own unmatched punches say which.
  assert.match(src, /dayMarkLabel\(mark, day\)/);
  assert.doesNotMatch(CODE("MiniCalendarSheet.tsx"), /MARK_LABEL/);
  assert.doesNotMatch(
    CODE("MiniCalendarSheet.tsx"),
    /className="sr-only"/,
    "a hidden span here is dead weight the aria-label overrides",
  );
});

test("no mark is a spacer, not an absent element", () => {
  // Without it the days that carry a mark are taller than the ones that do
  // not, and every row of the grid sits at a different height.
  const src = SRC("MiniCalendarSheet.tsx");
  assert.match(src, /if \(props\.mark === "none"\)[\s\S]{0,320}?className="block size-2"/);
});

test("neither problem state is drawn in the destructive colour", () => {
  // Amber at two fills, not red. `destructive` reads as "you are in trouble"
  // on a day HR may still forgive, and this surface has never spent it.
  assert.doesNotMatch(CODE("MiniCalendarSheet.tsx"), /destructive/);
  const src = SRC("MiniCalendarSheet.tsx");
  assert.match(src, /incomplete: "border-amber-500"/);
  assert.match(src, /missing: "border-amber-500 bg-amber-500"/);
});

test("the two amber states differ by fill, not by ring weight", () => {
  // 8px circles at two border widths are indistinguishable at arm's length —
  // measured in a screenshot, which is the only way that claim can be made.
  const src = SRC("MiniCalendarSheet.tsx");
  const incomplete = /incomplete: "([^"]*)"/.exec(src)?.[1] ?? "";
  const missing = /missing: "([^"]*)"/.exec(src)?.[1] ?? "";
  assert.ok(!/bg-/.test(incomplete), "incomplete must stay hollow");
  assert.ok(/bg-/.test(missing), "missing must be filled");
});

// ---------------------------------------------------------------------------
// The Week tab is gone, and took nothing with it
// ---------------------------------------------------------------------------

test("MyWeekPage is gone and nothing imports it", () => {
  assert.throws(() => SRC("MyWeekPage.tsx"), /ENOENT/);
  for (const file of ["MiniAppShell.tsx", "MySchedulePage.tsx", "MyDayPage.tsx"]) {
    assert.doesNotMatch(CODE(file), /MyWeekPage/, `${file} still imports it`);
  }
});

test("the roster's navigator survived the deletion", () => {
  // MySchedulePage imported weekForOffset, weekRangeLabel and WeekNav from
  // MyWeekPage. Deleting that file without extracting them would have taken
  // the roster's only way to reach another week.
  const schedule = SRC("MySchedulePage.tsx");
  assert.match(schedule, /from "@\/miniapp\/miniWeek"/);
  assert.match(schedule, /from "@\/miniapp\/MiniWeekNav"/);
  assert.match(schedule, /forwardLimit=\{false\}/, "the roster pages forward; attendance does not");
});

test("the date heading is a real button, not a click handler on the h1", () => {
  // A handler on the heading is invisible to a keyboard and announces
  // nothing — on the only control that reaches another day.
  const src = SRC("MyDayPage.tsx");
  assert.match(src, /<button[\s\S]{0,200}onClick=\{\(\) => props\.onPickDate\?\.\(\)\}/);
  assert.match(src, /t\("chooseDate"\)/);
});
