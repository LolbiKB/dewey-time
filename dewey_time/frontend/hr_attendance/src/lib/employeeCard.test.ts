import assert from "node:assert/strict";
import test from "node:test";

import {
  WEEKLY_SCHEDULE_EMPLOYMENT_TYPES,
  employeeCommandFilter,
  employeeDisplayName,
  employeeInitials,
  employeeSearchHaystack,
  isWeeklyScheduleEligible,
  khmerName,
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

// A single initial where two are expected reads as a rendering bug, and it is:
// employeeDisplayName only trims outer whitespace, so a two-part name joined
// by anything other than one ASCII space came through verbatim and a naive
// split on one literal space left an empty element that ate the second
// initial.
test("a name separated by more than one space still yields two initials", () => {
  assert.equal(employeeInitials({ employee_name: "Chan  Dara" } as CalendarEmployee), "CD");
  assert.equal(employeeInitials({ employee_name: "Chan Dara" } as CalendarEmployee), "CD");
  assert.equal(employeeInitials({ employee_name: " Chan Dara " } as CalendarEmployee), "CD");
});

test("a mononym honestly yields one initial", () => {
  assert.equal(employeeInitials({ employee_name: "Sokha" } as CalendarEmployee), "S");
});

test("an initial is a whole character, not half a surrogate pair", () => {
  // "𝐀lice" starts with an astral code point; string indexing would return a
  // lone high surrogate and render as a replacement glyph.
  const initials = employeeInitials({ employee_name: "\u{1D400}lice Ng" } as CalendarEmployee);
  assert.equal([...initials].length, 2);
  assert.equal(initials, "\u{1D400}N".toUpperCase());
});

test("khmerName puts the family name first, matching the ADMS convention", () => {
  // `${last} ${first}` — ចាន់ is the family name. The vendored ADMS reference
  // frontend composes it the same way; a reversed order is a different person's
  // name to a Khmer reader, and nothing downstream could tell.
  assert.equal(khmerName("ចាន់", "សុភា"), "ចាន់ សុភា");
});

test("khmerName keeps a half-filled pair rather than discarding it", () => {
  // Neither field is required, so one-of-two is reachable. A partial name is
  // still a name; treating it as absent would hide a fact the record holds.
  assert.equal(khmerName("លី", null), "លី");
  assert.equal(khmerName(null, "វណ្ណា"), "វណ្ណា");
});

test("khmerName is null when there is nothing to show", () => {
  // Whitespace-only is the shape a Frappe Data field takes when someone tabs
  // through it. Rendering it would put an empty `·` separator on the line.
  assert.equal(khmerName(null, null), null);
  assert.equal(khmerName(undefined, undefined), null);
  assert.equal(khmerName("   ", "\t"), null);
});

test("khmerName trims a padded pair rather than discarding it", () => {
  // The other half of the same trim: padding around a real name is not the
  // absence of one. Its own test, because a failure here is a name that was
  // thrown away, and reported from the test above it would have read as
  // "khmerName is null when there is nothing to show" — the opposite fault.
  assert.equal(khmerName("  ចាន់  ", "  សុភា "), "ចាន់ សុភា");
});

test("employeeDisplayName shows the name as recorded, middle name and all", () => {
  // The pickers used to strip the middle name and the tables did not, so one
  // person read two ways. A silently shortened name and a visibly truncated one
  // are different claims and only the second admits something was left out.
  const employee = {
    id: "EMP-1", label: "EMP-1 · Ana Maria Cruz", employee_name: "Ana Maria Cruz",
  };
  assert.equal(employeeDisplayName(employee), "Ana Maria Cruz");
});

test("the picker haystack includes the Khmer name", () => {
  const haystack = employeeSearchHaystack({
    id: "EMP-1", label: "EMP-1 · Sophea Chan", employee_name: "Sophea Chan",
    custom_khmer_last_name: "ចាន់", custom_khmer_first_name: "សុភា",
  });
  assert.match(haystack, /ចាន់ សុភា/);
});

// Built through the same haystack() helper every other employeeCommandFilter
// test uses, so this pins the matcher-plus-haystack pairing, not just the
// matcher in isolation.
const KHMER_HAYSTACK = haystack({
  id: "EMP-1",
  employee_name: "Sophea Chan",
  label: "EMP-1 · Sophea Chan",
  custom_khmer_last_name: "ចាន់",
  custom_khmer_first_name: "សុភា",
});

test("a Khmer query matches inside a name with no word boundary", () => {
  // Khmer has no inter-word spaces. `សុភា` is the given name inside
  // `ចាន់ សុភា`, and no boundary-aware matcher would find it. This test fails
  // if someone "optimises" employeeCommandFilter into a word-boundary match.
  assert.equal(employeeCommandFilter(KHMER_HAYSTACK, "សុភា"), 1);
  assert.equal(employeeCommandFilter(KHMER_HAYSTACK, "ដារា"), 0);
  // Khmer routinely arrives with no space at all; this is the case a
  // split-on-whitespace matcher cannot find. Literal, not through haystack():
  // khmerName always joins with a space, so no real haystack produces this
  // shape — it is the synthetic case that closes the gap a split-and-compare
  // matcher would otherwise sail through undetected.
  assert.equal(employeeCommandFilter("ចាន់សុភា EMP-1", "សុភា"), 1);
});
