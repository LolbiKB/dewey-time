import assert from "node:assert/strict";
import test from "node:test";

import {
  WEEKLY_SCHEDULE_EMPLOYMENT_TYPES,
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
