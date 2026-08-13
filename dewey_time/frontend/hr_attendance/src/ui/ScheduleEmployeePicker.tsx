import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  employeeCommandFilter,
  employeeDisplayName,
  employeeSearchHaystack,
  isWeeklyScheduleEligible,
  khmerName,
  scheduleEmployeeSubtitle,
} from "@/lib/employeeCard";
import { cn } from "@/lib/utils";
import type { CalendarEmployee } from "@/types/calendar";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";
import { EmployeeIdentity, type TailFact } from "@/ui/EmployeeIdentity";

export type ScheduleEmployeePickerProps = {
  employees: CalendarEmployee[];
  value: string | null;
  onChange: (id: string) => void;
  isLoading?: boolean;
  className?: string;
  compact?: boolean;
};

export function ScheduleEmployeePicker(props: ScheduleEmployeePickerProps) {
  const selected = useMemo(
    () => props.employees.find((e) => e.id === props.value) ?? null,
    [props.employees, props.value]
  );
  const [open, setOpen] = useState(false);
  const disabled = !props.employees.length || props.isLoading;

  // EmployeeIdentity always renders a second line, so with nothing selected
  // the id slot carries the same "Choose an employee" prompt
  // scheduleEmployeeSubtitle used to put there, rather than going blank —
  // mirroring EmployeePicker's trigger. Keyed off `selected`, not
  // `props.value`: an id that names no employee in the current list (still
  // loading, filtered out) should read the same as no id at all, not repeat
  // the bare id employeeDisplayName already fell back to on line one. The
  // employment-type tail fact is dropped for the same reason when nothing is
  // selected — it would otherwise carry that same prompt a second time.
  const employeeIdLine = selected ? selected.id : "Choose an employee";
  // Employment type FIRST: isWeeklyScheduleEligible gates this wizard on it,
  // so it is the fact that says whether this person can be picked at all. It
  // must never be the one that falls off the end.
  const tail: TailFact[] = selected
    ? [
        {
          label: scheduleEmployeeSubtitle(selected),
          tone: isWeeklyScheduleEligible(selected.employment_type) ? "normal" : "warning",
        },
        selected.department ? { label: selected.department } : null,
      ].filter((fact): fact is TailFact => fact !== null)
    : [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            props.compact ? "h-8 gap-1.5 px-2" : "h-11",
            "w-full justify-between font-normal",
            props.className
          )}
        >
          <EmployeeIdentity
            className="min-w-0 flex-1"
            englishName={employeeDisplayName(selected, props.value)}
            employeeId={employeeIdLine}
            khmerName={khmerName(selected?.custom_khmer_last_name, selected?.custom_khmer_first_name)}
            avatar={
              <EmployeeAvatar
                employee={selected}
                fallbackId={props.value}
                className={props.compact ? "size-6" : "size-8"}
              />
            }
            tail={tail}
          />
          {props.isLoading ? (
            <Loader2Icon className="size-4 shrink-0 animate-spin opacity-60" />
          ) : (
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-40" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command filter={employeeCommandFilter}>
          <CommandInput placeholder="Search employees…" />
          <CommandList>
            <CommandEmpty>No employees found.</CommandEmpty>
            <CommandGroup>
              {props.employees.map((employee) => (
                <ScheduleEmployeeOption
                  key={employee.id}
                  employee={employee}
                  selected={employee.id === props.value}
                  onSelect={() => {
                    props.onChange(employee.id);
                    setOpen(false);
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One row of the weekly-schedule picker list. Exported so its rendering can be
 * tested directly — Radix portals server-render to `null`, so anything left
 * inline inside `PopoverContent` never reaches `renderToStaticMarkup` output.
 */
export function ScheduleEmployeeOption(props: {
  employee: CalendarEmployee;
  selected: boolean;
  onSelect: () => void;
}) {
  const { employee } = props;
  const eligible = isWeeklyScheduleEligible(employee.employment_type);

  return (
    <CommandItem
      value={employeeSearchHaystack(employee)}
      disabled={!eligible}
      onSelect={() => {
        if (!eligible) return;
        props.onSelect();
      }}
      className="gap-2 py-2"
    >
      <EmployeeIdentity
        className="min-w-0 flex-1"
        englishName={employeeDisplayName(employee, employee.id)}
        employeeId={employee.id}
        khmerName={khmerName(employee.custom_khmer_last_name, employee.custom_khmer_first_name)}
        avatar={
          <EmployeeAvatar employee={employee} fallbackId={employee.id} className="size-8" />
        }
        // Employment type FIRST: isWeeklyScheduleEligible gates this wizard on
        // it, so it is the fact that says whether this person can be picked at
        // all. It must never be the one that falls off the end.
        tail={[
          {
            label: scheduleEmployeeSubtitle(employee),
            tone: eligible ? "normal" : "warning",
          },
          employee.department ? { label: employee.department } : null,
        ].filter((fact): fact is TailFact => fact !== null)}
      />
      {props.selected ? (
        <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      ) : null}
    </CommandItem>
  );
}
