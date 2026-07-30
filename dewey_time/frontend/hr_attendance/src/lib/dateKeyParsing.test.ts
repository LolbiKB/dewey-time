import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { format } from "date-fns";

import { parseDateKey } from "./attendanceTime";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("a yyyy-MM-dd key formats as the same calendar day", () => {
  // `new Date("2026-07-01")` is parsed as UTC midnight, so every timezone west
  // of UTC formats it as 30 June. parseDateKey anchors at local noon, which is
  // clear of both the date boundary and any DST shift.
  assert.equal(format(parseDateKey("2026-07-01"), "yyyy-MM-dd"), "2026-07-01");
  assert.equal(format(parseDateKey("2026-01-01"), "MMM yyyy"), "Jan 2026");
});

test("no source file parses a date key with new Date()", () => {
  // The two that did — DayInspectorSheet's header and employeeCard's schedule
  // range — showed the wrong day west of UTC. This is a whole-source guard
  // because the mistake reads as correct and there is no typecheck to catch it.
  const files = [
    "ui/DayInspectorSheet.tsx",
    "lib/employeeCard.ts",
    "lib/weekCalendar.ts",
    "ui/App.tsx",
  ];
  for (const rel of files) {
    const src = readFileSync(resolve(SRC, rel), "utf8");
    for (const m of src.matchAll(/new Date\(([^)]*)\)/g)) {
      const arg = (m[1] ?? "").trim();
      assert.ok(
        !/(date|_date|dateKey|Date)$/i.test(arg) || arg === "",
        `${rel}: new Date(${arg}) — use parseDateKey for yyyy-MM-dd keys`,
      );
    }
  }
});
