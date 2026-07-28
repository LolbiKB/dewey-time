import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Command, CommandGroup, CommandList } from "@/components/ui/command";
import type { CalendarEmployee } from "@/types/calendar";

import { EmployeeOption } from "./EmployeePicker";

// list_calendar_employees sorts employees with shift coverage first, so clock-based
// employees land at the bottom of the list. The chip is what tells HR they are
// clock-based rather than missing an import.
const ADA: CalendarEmployee = { id: "HR-EMP-00001", label: "Ada Lovelace" };

function renderRow(employee: CalendarEmployee): string {
  return renderToStaticMarkup(
    <Command>
      <CommandList>
        <CommandGroup>
          <EmployeeOption employee={employee} selected={false} onSelect={() => {}} />
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
