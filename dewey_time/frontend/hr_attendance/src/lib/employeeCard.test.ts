import assert from "node:assert/strict";
import test from "node:test";

import {
  WEEKLY_SCHEDULE_EMPLOYMENT_TYPES,
  employeeCommandFilter,
  employeeSearchHaystack,
  isWeeklyScheduleEligible,
  weeklyScheduleIneligibleMessage,
} from "@/lib/employeeCard";
import type { CalendarEmployee } from "@/types/calendar";

test("allowlist no longer contains Probation", () => {
  assert.deepEqual(
    [...WEEKLY_SCHEDULE_EMPLOYMENT_TYPES],
    ["Full-time", "Part-time Fixed", "Intern"]
  );
});

test("eligible types stay eligible", () => {
  assert.equal(isWeeklyScheduleEligible("Full-time"), true);
  assert.equal(isWeeklyScheduleEligible("part-time fixed"), true);
  assert.equal(isWeeklyScheduleEligible("Intern"), true);
});

test("Probation is now ineligible", () => {
  assert.equal(isWeeklyScheduleEligible("Probation"), false);
});

test("other types remain ineligible", () => {
  assert.equal(isWeeklyScheduleEligible("Part-time Flexible"), false);
  assert.equal(isWeeklyScheduleEligible(""), false);
  assert.equal(isWeeklyScheduleEligible(null), false);
});

test("ineligible message does not mention Probation", () => {
  const employee = {
    id: "DI-0159",
    employee_name: "Sok Dara",
    label: "Sok Dara",
    employment_type: "Part-time Flexible",
  } as unknown as CalendarEmployee;
  const msg = weeklyScheduleIneligibleMessage(employee, "DI-0159");
  assert.ok(msg);
  assert.ok(!msg!.includes("Probation"), `message should not mention Probation: ${msg}`);
});

// --- employeeCommandFilter --------------------------------------------------
// The picker renders one command item per employee with value = the haystack;
// cmdk calls this filter with that value. Build the same haystacks here.
function haystack(overrides: Partial<CalendarEmployee>): string {
  return employeeSearchHaystack({
    id: "DI-0001",
    label: "DI-0001 · Employee",
    company: "Dewey",
    ...overrides,
  } as unknown as CalendarEmployee);
}

const SREY = haystack({
  id: "DI-0042",
  employee_name: "Srey Nita",
  label: "Srey Nita",
  department: "Housekeeping",
});
const ADMS = haystack({
  id: "ADMS-BRIDGE",
  employee_name: "ADMS Bridge",
  label: "ADMS Bridge",
});

test("employeeCommandFilter keeps every row on an empty query", () => {
  assert.equal(employeeCommandFilter(SREY, ""), 1);
  assert.equal(employeeCommandFilter(ADMS, "   "), 1);
});

test("employeeCommandFilter narrows to the match and hides ADMS Bridge", () => {
  // Regression: cmdk's fuzzy default scored "srey" > 0 against the ADMS haystack
  // (an s…r…e…y subsequence), so the service account never got filtered out.
  assert.equal(employeeCommandFilter(SREY, "srey"), 1);
  assert.equal(employeeCommandFilter(ADMS, "srey"), 0);
});

test("employeeCommandFilter matches id and department, case-insensitively", () => {
  assert.equal(employeeCommandFilter(SREY, "DI-0042"), 1);
  assert.equal(employeeCommandFilter(SREY, "housekeeping"), 1);
  assert.equal(employeeCommandFilter(SREY, "di-0043"), 0);
});

test("employeeCommandFilter requires every whitespace-separated token to match", () => {
  assert.equal(employeeCommandFilter(SREY, "srey housekeeping"), 1);
  assert.equal(employeeCommandFilter(SREY, "srey engineering"), 0);
});

test("employeeCommandFilter still finds ADMS Bridge by its own name/id", () => {
  assert.equal(employeeCommandFilter(ADMS, "adms"), 1);
  assert.equal(employeeCommandFilter(ADMS, "bridge"), 1);
});
