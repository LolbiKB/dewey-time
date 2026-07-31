import assert from "node:assert/strict";
import test from "node:test";

import { gridLoadError } from "@/lib/attendanceLoadError";

const employeesFailed = new Error("list_calendar_employees failed");
const calendarFailed = new Error("get_employee_calendar failed");

test("an employees failure with no rows loaded blanks the grid", () => {
  assert.equal(
    gridLoadError({
      employeesError: employeesFailed,
      calendarError: null,
      employeeCount: 0,
    }),
    employeesFailed
  );
});

// The regression: queryClient sets staleTime 0 + refetchOnWindowFocus, so
// returning to the tab refires list_calendar_employees. React Query keeps the
// loaded rows and sets `error` when that refetch fails, and 4xx is not retried
// — a populated, healthy grid must not be replaced by "didn't load".
test("an employees failure with rows already loaded leaves the grid alone", () => {
  assert.equal(
    gridLoadError({
      employeesError: employeesFailed,
      calendarError: null,
      employeeCount: 12,
    }),
    null
  );
});

test("a calendar failure always blanks the grid — the grid IS the calendar", () => {
  for (const employeeCount of [0, 12]) {
    assert.equal(
      gridLoadError({ employeesError: null, calendarError: calendarFailed, employeeCount }),
      calendarFailed,
      `employeeCount=${employeeCount}`
    );
  }
});

test("with both failing, the reported error depends on whether rows are loaded", () => {
  // Rows on screen: the employees refetch is survivable, the calendar is not.
  assert.equal(
    gridLoadError({
      employeesError: employeesFailed,
      calendarError: calendarFailed,
      employeeCount: 12,
    }),
    calendarFailed
  );
  // Nothing on screen: the employees failure is the earlier, more useful one.
  assert.equal(
    gridLoadError({
      employeesError: employeesFailed,
      calendarError: calendarFailed,
      employeeCount: 0,
    }),
    employeesFailed
  );
});

test("no failure returns null, including when the hooks report undefined", () => {
  assert.equal(
    gridLoadError({ employeesError: null, calendarError: null, employeeCount: 12 }),
    null
  );
  assert.equal(
    gridLoadError({ employeesError: undefined, calendarError: undefined, employeeCount: 0 }),
    null
  );
});
