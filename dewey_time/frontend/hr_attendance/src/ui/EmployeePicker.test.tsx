import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Command, CommandGroup, CommandList } from "@/components/ui/command";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CalendarEmployee } from "@/types/calendar";

import { EmployeeOption, EmployeePicker } from "./EmployeePicker";
import { ScheduleEmployeeOption } from "./ScheduleEmployeePicker";

// list_calendar_employees sorts employees with shift coverage first, so clock-based
// employees land at the bottom of the list. The chip is what tells HR they are
// clock-based rather than missing an import.
const ADA: CalendarEmployee = { id: "HR-EMP-00001", label: "Ada Lovelace" };

// CommandItem needs a Command/CommandList/CommandGroup ancestor to render at
// all, so both option rows are rendered through this harness rather than bare.
function renderRow(
  employee: CalendarEmployee,
  opts?: { selected?: boolean; onSelect?: () => void },
): string {
  return renderToStaticMarkup(
    <Command>
      <CommandList>
        <CommandGroup>
          <EmployeeOption
            employee={employee}
            selected={opts?.selected ?? false}
            onSelect={opts?.onSelect ?? (() => {})}
          />
        </CommandGroup>
      </CommandList>
    </Command>,
  );
}

// ScheduleEmployeePicker's list row is only reachable outside Radix's portal
// via this exported component — anything left inline inside PopoverContent
// server-renders to nothing at all.
function renderScheduleRow(
  employee: CalendarEmployee,
  opts?: { selected?: boolean; onSelect?: () => void },
): string {
  return renderToStaticMarkup(
    <Command>
      <CommandList>
        <CommandGroup>
          <ScheduleEmployeeOption
            employee={employee}
            selected={opts?.selected ?? false}
            onSelect={opts?.onSelect ?? (() => {})}
          />
        </CommandGroup>
      </CommandList>
    </Command>,
  );
}

test("a clock-based employee's picker row carries a Clock chip", () => {
  assert.match(renderRow({ ...ADA, is_clock_based: true }), />Clock</);
});

test("a scheduled employee's picker row has no Clock chip", () => {
  assert.doesNotMatch(renderRow({ ...ADA, is_clock_based: false }), />Clock</);
  assert.doesNotMatch(renderRow(ADA), />Clock</);
});

test("the picker Clock chip is neutral, never destructive", () => {
  assert.doesNotMatch(renderRow({ ...ADA, is_clock_based: true }), /destructive/);
});

test("the picker option shows the Khmer name and the employee id", () => {
  const html = renderRow({
    id: "EMP-0088", label: "EMP-0088 · Sophea Chan", employee_name: "Sophea Chan",
    department: "Retail", title: "Barista",
    custom_khmer_last_name: "ចាន់", custom_khmer_first_name: "សុភា",
  });
  assert.match(html, /ចាន់ សុភា/, "the Khmer name reaches the option");
  assert.match(html, /EMP-0088/);
  assert.ok(html.indexOf("Sophea Chan") < html.indexOf("ចាន់ សុភា"), "English leads");
});

test("the weekly-schedule picker puts employment type ahead of department", () => {
  // isWeeklyScheduleEligible gates the wizard on employment type, so it is the
  // fact that says whether this person can be picked at all. Under a shared
  // global priority it would eventually be the one that fell off the end.
  const html = renderScheduleRow({
    id: "EMP-1", label: "EMP-1 · Jonas Berg", employee_name: "Jonas Berg",
    department: "Warehouse", employment_type: "Full-time",
    custom_khmer_last_name: null, custom_khmer_first_name: null,
  });
  assert.ok(html.indexOf("Full-time") < html.indexOf("Warehouse"));
});

// Regression: EmployeeIdentity always renders a second line, so feeding its
// `employeeId` slot `props.value ?? ""` with nothing selected left that line
// blank where employeePickerSubtitle used to prompt "Choose an employee".
test("with nothing selected, the picker prompts rather than going blank", () => {
  const trigger = renderToStaticMarkup(
    <TooltipProvider>
      <EmployeePicker
        employees={[]}
        value={null}
        onChange={() => {}}
        weekDates={[]}
        daysByDate={new Map()}
        weekAssignedShiftDays={0}
      />
    </TooltipProvider>,
  );
  assert.match(trigger, /Choose an employee/, "the interactive trigger prompts, not blank");

  const readOnly = renderToStaticMarkup(
    <EmployeePicker
      employees={[]}
      value={null}
      onChange={() => {}}
      weekDates={[]}
      daysByDate={new Map()}
      weekAssignedShiftDays={0}
      readOnly
    />,
  );
  assert.match(readOnly, /Choose an employee/, "the read-only branch prompts, not blank");
});
