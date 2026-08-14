import assert from "node:assert/strict";
import test from "node:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Command, CommandGroup, CommandList } from "@/components/ui/command";
import { attendancePickerTail, schedulePickerTail } from "@/lib/employeeCard";
import type { CalendarEmployee } from "@/types/calendar";
import type { TailFact } from "@/ui/EmployeeIdentity";

import {
  ClockBadge,
  EmployeeOption,
  EmployeePicker,
  type EmployeePickerProps,
} from "./EmployeePicker";

// list_calendar_employees sorts employees with shift coverage first, so clock-based
// employees land at the bottom of the list. The chip is what tells HR they are
// clock-based rather than missing an import.
const ADA: CalendarEmployee = { id: "HR-EMP-00001", label: "Ada Lovelace" };

// CommandItem needs a Command/CommandList/CommandGroup ancestor to render at
// all, so both option rows are rendered through this harness rather than bare.
function renderRow(
  employee: CalendarEmployee,
  opts?: {
    selected?: boolean;
    disabled?: boolean;
    tail?: (e: CalendarEmployee) => TailFact[];
    badge?: ReactNode;
    onSelect?: () => void;
  },
): string {
  return renderToStaticMarkup(
    <Command>
      <CommandList>
        <CommandGroup>
          <EmployeeOption
            employee={employee}
            selected={opts?.selected ?? false}
            disabled={opts?.disabled}
            tail={opts?.tail ?? attendancePickerTail}
            badge={opts?.badge}
            onSelect={opts?.onSelect ?? (() => {})}
          />
        </CommandGroup>
      </CommandList>
    </Command>,
  );
}

// Destructure before spreading. A trailing `{...overrides}` would re-apply
// `tail: undefined` for any caller that omitted it, overriding the default and
// crashing on `props.tail(selected)`.
function renderTrigger(overrides: Partial<EmployeePickerProps> = {}): string {
  const { employees, value, onChange, tail, ...rest } = overrides;
  return renderToStaticMarkup(
    <EmployeePicker
      employees={employees ?? []}
      value={value ?? null}
      onChange={onChange ?? (() => {})}
      tail={tail ?? attendancePickerTail}
      {...rest}
    />,
  );
}

// Replaces three separate Clock-chip tests. The chip is now supplied by the
// caller rather than owned by the picker, so presence, absence and tone are
// one question about the same prop.
test("the Clock badge is neutral and appears only when the caller asks", () => {
  const withBadge = renderRow(ADA, { badge: <ClockBadge /> });
  assert.match(withBadge, />Clock</);
  assert.doesNotMatch(withBadge, /destructive/);
  assert.doesNotMatch(renderRow(ADA), />Clock</);
});

test("the option row shows the branch, prefix stripped", () => {
  const html = renderRow({
    id: "EMP-0088",
    label: "EMP-0088 · Sophea Chan",
    employee_name: "Sophea Chan",
    branch: "BRANCH-Iconic",
    department: "Retail",
  });
  assert.match(html, />Iconic</, "the formatted branch label reaches the row");
  assert.doesNotMatch(html, /BRANCH-Iconic</, "the raw value is for search, not display");
  assert.ok(html.indexOf("Iconic") < html.indexOf("Retail"), "branch leads department");
});

test("an employee with no branch gets no branch fact at all", () => {
  const html = renderRow({ id: "EMP-9", label: "EMP-9 · Bo Lin", department: "Ops" });
  assert.doesNotMatch(html, /No branch/);
});

test("a disabled option cannot be chosen", () => {
  let chosen = false;
  const html = renderRow(
    { id: "EMP-5", label: "EMP-5 · Casey Ward", employment_type: "Casual" },
    {
      disabled: true,
      tail: schedulePickerTail,
      onSelect: () => {
        chosen = true;
      },
    },
  );
  assert.match(html, /data-disabled="true"/);
  assert.equal(chosen, false);
});

test("each size token maps to its width class and nothing else", () => {
  // Width only. A token that also changed height or type would invalidate
  // EmployeeIdentity's thresholds, which are measured at 14px semibold.
  assert.match(renderTrigger({ size: "sm" }), /w-60/);
  assert.match(renderTrigger({ size: "md" }), /w-88/);
  assert.match(renderTrigger({ size: "lg" }), /max-w-lg/);
  for (const size of ["sm", "md", "lg"] as const) {
    const html = renderTrigger({ size });
    assert.match(html, /min-h-14/, `${size} must use the shared minimum height`);
    assert.doesNotMatch(html, /text-base/, `${size} must not scale the name type`);
  }
});

test("the trigger's height is a minimum, never a fixed height", () => {
  // A hard h-14 clips a Khmer descender: line one's line box grows with the
  // Khmer face's ascent and descent, and `truncate` already sets
  // overflow:hidden on it.
  const html = renderTrigger({ size: "lg" });
  assert.match(html, /min-h-14/);
  // Lookbehind for `min-`, because `\bh-14\b` matches INSIDE `min-h-14`: the
  // hyphen is a non-word character, so it opens a word boundary. Without it
  // this assertion fails against correct code, which is how it was caught.
  assert.doesNotMatch(html, /(?<!min-)\bh-14\b/);
});

test("read-only renders no combobox at all", () => {
  const html = renderTrigger({ readOnly: true });
  assert.doesNotMatch(html, /role="combobox"/);
  assert.match(html, /Choose an employee/);
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

test("the weekly-schedule tail puts employment type ahead of department", () => {
  // isWeeklyScheduleEligible gates the wizard on employment type, so it is the
  // fact that says whether this person can be picked at all. Under the
  // attendance ordering it would eventually be the one that fell off the end.
  const html = renderRow(
    {
      id: "EMP-1", label: "EMP-1 · Jonas Berg", employee_name: "Jonas Berg",
      department: "Warehouse", employment_type: "Full-time",
      custom_khmer_last_name: null, custom_khmer_first_name: null,
    },
    { tail: schedulePickerTail },
  );
  // Without this, the ordering assertion below passes as `-1 < N` if the
  // employment-type fact vanished from the markup entirely.
  assert.match(html, /Full-time/);
  assert.ok(html.indexOf("Full-time") < html.indexOf("Warehouse"));
});

test("an ineligible employment type carries the warning tone on its own fact span", () => {
  const html = renderRow(
    {
      id: "EMP-2", label: "EMP-2 · Casey Ward", employee_name: "Casey Ward",
      department: "Ops", employment_type: "Casual",
      custom_khmer_last_name: null, custom_khmer_first_name: null,
    },
    { tail: schedulePickerTail },
  );
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
  assert.match(
    renderTrigger(),
    /Choose an employee/,
    "the interactive trigger prompts, not blank",
  );
  assert.match(
    renderTrigger({ readOnly: true }),
    /Choose an employee/,
    "the read-only branch prompts, not blank",
  );
});

// Same regression under the schedule tail, whose first fact is never omitted:
// the prompt has to live in the always-rendered `employeeId` slot, not a
// `tail` fact — those hide below their container-query threshold, so a
// fact-only prompt would reappear blank in a narrow trigger.
test("with nothing selected, the trigger prompts in the id slot, not a tail fact", () => {
  const html = renderTrigger({ tail: schedulePickerTail });
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

test("an id absent from the employee list does not repeat itself on both lines", () => {
  // selected is null (the id names nobody in the list — still loading,
  // filtered out), so line one falls back to the bare id and line two must
  // not repeat it: it should read the same "Choose an employee" prompt as
  // no id at all.
  const html = renderTrigger({ value: "EMP-404", tail: schedulePickerTail });
  assert.match(html, /EMP-404/, "line one still shows the unresolved id");
  assert.match(html, /<span class="tabular-nums">Choose an employee<\/span>/);
  assert.equal((html.match(/EMP-404/g) ?? []).length, 1, "the id is not repeated on line two");
});
