import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/**
 * The same file with its comments removed.
 *
 * Every "must NOT appear" assertion below reads this rather than SRC. In
 * miniCalendarSheet.test.tsx the first draft did not, and two guards failed
 * instantly against comments naming the very things they forbade — a file
 * documenting a rejected alternative is going to mention it by name.
 */
const CODE = (name: string) =>
  SRC(name).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the sheet is a bottom sheet everywhere, not a responsive modal", () => {
  // ResponsiveModal swaps to a centre Dialog above a width breakpoint and a
  // Telegram Desktop Mini App is wide enough to trip it.
  const code = CODE("MiniFlagsSheet.tsx");
  assert.ok(!code.includes("ResponsiveModal"), "must not use ResponsiveModal");
  assert.match(code, /side="bottom"/);
});

test("problem states are amber, never destructive", () => {
  // Red is the loudest colour in the palette and this surface has never spent
  // it — it reads as "you are in trouble" on a day HR may still forgive.
  const code = CODE("MiniFlagButton.tsx") + CODE("MiniFlagsSheet.tsx");
  assert.ok(!code.includes("destructive"), "must not use the destructive token");
  assert.match(code, /amber-500/);
});

test("no flag code, severity or evidence is ever rendered", () => {
  // The sheet shows wording, not the engine's vocabulary.
  const code = CODE("MiniFlagsSheet.tsx");

  // POSITIONAL for flag_code, because the React key legitimately contains it
  // and a plain substring check flags that instead. What is forbidden is
  // flag_code appearing as an element's CHILD — i.e. on screen. The first
  // version of this assertion was the substring one and failed on the key.
  assert.ok(
    !/>\s*\{[^}]*flag_code[^}]*\}\s*</.test(code),
    "flag_code must not be rendered as text",
  );

  // These two have no legitimate use in this file at all.
  for (const leak of ["severity", "evidence"]) {
    assert.ok(!code.includes(leak), `${leak} must not appear`);
  }
});

test("the pill reads its count from miniFlags, not from its own arithmetic", () => {
  // One function behind the number and the rows, or they drift.
  assert.match(CODE("MyDayPage.tsx"), /flagCount\(/);
});

test("every string on screen comes from the table", () => {
  // A bare literal here is a string that exists in English only.
  const code = CODE("MiniFlagsSheet.tsx");
  const literals = code.match(/>[A-Z][a-z]{3,}[^<{]*</g) ?? [];
  assert.deepEqual(literals, [], `untranslated literals: ${literals.join(", ")}`);
});
