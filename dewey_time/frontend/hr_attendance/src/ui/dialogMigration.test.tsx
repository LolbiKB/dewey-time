import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MIGRATED = [
  "src/ui/RunEngineDialog.tsx",
  "src/ui/ClearAllSchedulesDialog.tsx",
  "src/ui/ClearEmployeeScheduleDialog.tsx",
  "src/ui/ClearSitePatternsDialog.tsx",
  "src/ui/SchedulePlanPreviewDialog.tsx",
  "src/ui/WeeklyScheduleTemplatePickerDialog.tsx",
  "src/ui/WeeklySchedulePage.tsx",
];

test("every quick-decision surface routes through ResponsiveModal (adaptive on mobile)", () => {
  for (const rel of MIGRATED) {
    const src = readFileSync(resolve(PKG, rel), "utf8");
    assert.match(src, /ResponsiveModal/, `${rel} uses ResponsiveModal`);
    assert.ok(
      !/from "@\/components\/ui\/dialog"/.test(src),
      `${rel} no longer imports the raw Dialog primitive`,
    );
  }
});
