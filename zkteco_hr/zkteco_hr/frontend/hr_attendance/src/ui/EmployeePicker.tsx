import { CalendarDaysIcon, CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
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
  employeeInitials,
  employeePickerSubtitle,
  employeeSearchHaystack,
  employeeShortName,
  roleLine,
} from "@/lib/employeeCard";
import { cn } from "@/lib/utils";
import type { CalendarEmployee, Day } from "@/types/calendar";

import { WeeklyScheduleSheet } from "@/ui/WeeklyScheduleSheet";

export type EmployeePickerProps = {
  employees: CalendarEmployee[];
  value: string | null;
  onChange: (id: string) => void;
  isLoading?: boolean;
  weekDates: Date[];
  weekAssignedShiftDays: number;
  showWeekScheduleHint?: boolean;
  daysByDate: Map<string, Day>;
  className?: string;
};

export function EmployeePicker(props: EmployeePickerProps) {
  const selected = useMemo(
    () => props.employees.find((e) => e.id === props.value) ?? null,
    [props.employees, props.value]
  );
  const [open, setOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const disabled = !props.employees.length || props.isLoading;

  const name = employeeShortName(selected, props.value);
  const subtitle = employeePickerSubtitle(selected);

  return (
    <div
      className={cn(
        "flex min-h-14 w-full min-w-0 overflow-hidden rounded-xl border border-border bg-background",
        disabled && "opacity-50",
        props.className
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-auto min-h-14 min-w-0 flex-1 justify-start gap-3 rounded-none border-0 px-3 py-2 font-normal shadow-none hover:bg-muted/50"
          >
            <EmployeeAvatar employee={selected} fallbackId={props.value} />
            <span className="min-w-0 flex-1 text-left leading-snug">
              <span className="block truncate text-base font-semibold">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
            </span>
            {props.isLoading ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin opacity-60" />
            ) : (
              <ChevronsUpDownIcon className="size-4 shrink-0 opacity-40" />
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[min(100%,22rem)] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search by name, id, or department…" className="h-10" />
            <CommandList className="max-h-[min(60vh,320px)]">
              <CommandEmpty className="hidden py-0" />
              <CommandGroup>
                {props.employees.map((employee) => (
                  <EmployeeOption
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

      <div className="w-px shrink-0 self-stretch bg-border" aria-hidden="true" />

      <ScheduleAccessButton
        weekAssignedShiftDays={props.weekAssignedShiftDays}
        disabled={!selected || disabled}
        onClick={() => setScheduleOpen(true)}
      />

      <WeeklyScheduleSheet
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        employee={selected}
        weekDates={props.weekDates}
        daysByDate={props.daysByDate}
        weekAssignedShiftDays={props.weekAssignedShiftDays}
        showWeekDetail={props.showWeekScheduleHint === true}
      />
    </div>
  );
}

function ScheduleAccessButton(props: {
  weekAssignedShiftDays: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  const detail =
    props.weekAssignedShiftDays > 0
      ? `${props.weekAssignedShiftDays} scheduled this week`
      : "View expected shifts";

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label="View weekly schedule"
      title={detail}
      className="h-auto min-h-14 w-11 shrink-0 rounded-none border-0 px-0 shadow-none hover:bg-muted/50"
    >
      <CalendarDaysIcon className="size-4" strokeWidth={2} />
      <span className="sr-only">Weekly schedule</span>
    </Button>
  );
}

function EmployeeAvatar(props: {
  employee: CalendarEmployee | null;
  fallbackId: string | null;
}) {
  return (
    <span className="relative size-10 shrink-0">
      <span className="flex size-full items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {props.employee?.image ? (
          <img
            src={props.employee.image}
            alt=""
            className="size-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          employeeInitials(props.employee, props.fallbackId)
        )}
      </span>
    </span>
  );
}

function EmployeeOption(props: {
  employee: CalendarEmployee;
  selected: boolean;
  onSelect: () => void;
}) {
  const { employee } = props;
  const meta = roleLine(employee);

  return (
    <CommandItem
      value={employeeSearchHaystack(employee)}
      onSelect={props.onSelect}
      className="gap-2 py-2"
    >
      <EmployeeAvatar employee={employee} fallbackId={employee.id} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {employeeShortName(employee)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[employee.id, meta].filter(Boolean).join(" · ")}
        </span>
      </span>
      {props.selected ? <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
    </CommandItem>
  );
}
