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
  employeeCommandFilter,
  employeePickerSubtitle,
  employeeSearchHaystack,
  employeeShortName,
  roleLine,
} from "@/lib/employeeCard";
import { cn } from "@/lib/utils";
import type { CalendarEmployee, Day } from "@/types/calendar";

import { AppTooltip } from "@/ui/AppTooltip";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";
import { WeeklyScheduleSummary } from "@/ui/WeeklyScheduleSummary";

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
  readOnly?: boolean;
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

  if (props.readOnly) {
    return (
      <div
        className={cn(
          "flex min-h-14 w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-border bg-background px-3 py-2",
          disabled && "opacity-50",
          props.className
        )}
      >
        <EmployeeAvatar employee={selected} fallbackId={props.value} className="size-10" />
        <span className="min-w-0 flex-1 text-left leading-snug">
          <span className="block truncate text-base font-semibold">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
        {props.isLoading ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin opacity-60" />
        ) : null}
      </div>
    );
  }

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
            <EmployeeAvatar employee={selected} fallbackId={props.value} className="size-10" />
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
          <Command filter={employeeCommandFilter}>
            <CommandInput placeholder="Search by name, id, or department…" className="h-10" />
            <CommandList className="max-h-[min(60vh,320px)]">
              <CommandEmpty>No employees match your search.</CommandEmpty>
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

      <WeeklyScheduleSummary
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        employee={selected}
        weekDates={props.weekDates}
        daysByDate={props.daysByDate}
        weekAssignedShiftDays={props.weekAssignedShiftDays}
        showWeekDetail={props.showWeekScheduleHint === true}
      >
        <ScheduleAccessButton
          weekAssignedShiftDays={props.weekAssignedShiftDays}
          disabled={!selected || disabled}
        />
      </WeeklyScheduleSummary>
    </div>
  );
}

function ScheduleAccessButton(props: { weekAssignedShiftDays: number; disabled?: boolean }) {
  const detail =
    props.weekAssignedShiftDays > 0
      ? `${props.weekAssignedShiftDays} scheduled this week`
      : "View expected shifts";

  return (
    // Tooltip outside, popover trigger inside: both are `asChild` slots, and
    // only this order lets each merge onto the button. Reversed, the popover's
    // props land on the tooltip's Root and its click handler is dropped.
    <AppTooltip content={detail} side="bottom">
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={props.disabled}
          aria-label="View weekly schedule"
          className="h-auto min-h-14 w-11 shrink-0 rounded-none border-0 px-0 shadow-none hover:bg-muted/50"
        >
          <CalendarDaysIcon className="size-4" strokeWidth={2} />
          <span className="sr-only">Weekly schedule</span>
        </Button>
      </PopoverTrigger>
    </AppTooltip>
  );
}

/** One row of the picker list. Exported so its rendering can be tested directly. */
export function EmployeeOption(props: {
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
      <EmployeeAvatar employee={employee} fallbackId={employee.id} className="size-8" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {employeeShortName(employee)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[employee.id, meta].filter(Boolean).join(" · ")}
        </span>
      </span>
      {employee.is_clock_based ? (
        // Clock-based employees have no shift coverage, so the list sorts them to
        // the bottom. Without this they read as "schedule failed to import".
        <span className="shrink-0 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
          Clock
        </span>
      ) : null}
      {props.selected ? <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
    </CommandItem>
  );
}
