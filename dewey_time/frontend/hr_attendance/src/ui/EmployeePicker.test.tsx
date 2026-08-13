import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Command, CommandGroup, CommandList } from "@/components/ui/command";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CalendarEmployee } from "@/types/calendar";

import { EmployeeOption, EmployeePicker } from "./EmployeePicker";
import { ScheduleEmployeeOption, ScheduleEmployeePicker } from "./ScheduleEmployeePicker";

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
  // Without this, the ordering assertion below passes as `-1 < N` if the
  // employment-type fact vanished from the markup entirely.
  assert.match(html, /Full-time/);
  assert.ok(html.indexOf("Full-time") < html.indexOf("Warehouse"));
});

test("an ineligible employment type carries the warning tone on its own fact span", () => {
  const html = renderScheduleRow({
    id: "EMP-2", label: "EMP-2 · Casey Ward", employee_name: "Casey Ward",
    department: "Ops", employment_type: "Casual",
    custom_khmer_last_name: null, custom_khmer_first_name: null,
  });
  // On the fact's OWN span, not just anywhere in the document — a tone class
  // landing on the wrong element would still satisfy a whole-markup match.
  assert.match(
    html,
    /class="[^"]*text-brand-accent[^"]*"><span aria-hidden="true" class="mx-1 opacity-40">·<\/span>Casual/,
  );
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

// Same regression, the sibling picker: the prompt has to live in the always-
// rendered `employeeId` slot, not a `tail` fact — those hide below their
// container-query threshold, so a fact-only prompt would reappear blank in a
// narrow (e.g. `compact`) trigger, which is the width this variant is for.
test("with nothing selected, the weekly-schedule trigger prompts rather than going blank", () => {
  const html = renderToStaticMarkup(
    <ScheduleEmployeePicker employees={[]} value={null} onChange={() => {}} />,
  );
  assert.match(
    html,
    /<span class="tabular-nums">Choose an employee<\/span>/,
    "the prompt sits in the id span, not a width-gated tail fact",
  );
  assert.equal(
    (html.match(/Choose an employee/g) ?? []).length,
    1,
    "the prompt is not also duplicated into a tail fact",
  );
});

test("with nothing selected, the compact weekly-schedule trigger still prompts", () => {
  const html = renderToStaticMarkup(
    <ScheduleEmployeePicker employees={[]} value={null} onChange={() => {}} compact />,
  );
  assert.match(html, /<span class="tabular-nums">Choose an employee<\/span>/);
});

test("an id absent from the employee list does not repeat itself on both lines", () => {
  // selected is null (the id names nobody in the list — still loading,
  // filtered out), so line one falls back to the bare id and line two must
  // not repeat it: it should read the same "Choose an employee" prompt as
  // no id at all.
  const html = renderToStaticMarkup(
    <ScheduleEmployeePicker employees={[]} value="EMP-404" onChange={() => {}} />,
  );
  assert.match(html, /EMP-404/, "line one still shows the unresolved id");
  assert.match(html, /<span class="tabular-nums">Choose an employee<\/span>/);
  assert.equal((html.match(/EMP-404/g) ?? []).length, 1, "the id is not repeated on line two");
});
