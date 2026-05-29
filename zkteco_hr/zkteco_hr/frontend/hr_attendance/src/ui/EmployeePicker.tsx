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
  employeeShortName,
  formatEmploymentType,
  formatScheduleCoverage,
  roleLine,
  shiftScheduleStatus,
  type ScheduleStatus,
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
  const schedule = shiftScheduleStatus(
    selected,
    props.weekDates,
    props.weekAssignedShiftDays,
    props.showWeekScheduleHint === true
  );
  const subtitle = buildSubtitle(selected);

  return (
    <div className={cn("flex min-w-0 items-stretch gap-2", props.className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-auto min-h-11 min-w-0 flex-1 justify-start gap-3 px-3 py-2 font-normal"
          >
            <EmployeeAvatar
              employee={selected}
              fallbackId={props.value}
              tone={schedule.tone}
              size="md"
            />
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
            <CommandInput placeholder="Search employees…" className="h-10" />
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

      <ScheduleAccessButton
        schedule={schedule}
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

function buildSubtitle(employee: CalendarEmployee | null): string {
  if (!employee) return "Choose an employee";
  return [
    employee.id,
    formatEmploymentType(employee.employment_type) || null,
    roleLine(employee) || null,
  ]
    .filter((part) => part != null && String(part).trim())
    .join(" · ");
}

function ScheduleAccessButton(props: {
  schedule: ScheduleStatus;
  weekAssignedShiftDays: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  const subtitle =
    props.weekAssignedShiftDays > 0
      ? `${props.weekAssignedShiftDays} day${props.weekAssignedShiftDays === 1 ? "" : "s"} this week`
      : props.schedule.tone === "warn"
        ? "Needs attention"
        : "View week";

  const iconWrap =
    props.schedule.tone === "warn"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : props.schedule.tone === "ok"
        ? "bg-primary/10 text-primary"
        : "bg-muted text-muted-foreground";

  const border =
    props.schedule.tone === "warn"
      ? "border-amber-500/25 hover:border-amber-500/40 hover:bg-amber-500/[0.06]"
      : "border-border/70 hover:border-primary/30 hover:bg-muted/30";

  return (
    <Button
      type="button"
      variant="outline"
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={`View weekly schedule. ${props.schedule.label}`}
      title={props.schedule.detail ?? props.schedule.label}
      className={cn(
        "h-auto min-h-11 shrink-0 gap-2.5 rounded-xl px-3 py-2",
        border
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          iconWrap
        )}
      >
        <CalendarDaysIcon className="size-4" strokeWidth={2} />
      </span>
      <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
        <span className="text-xs font-semibold">Schedule</span>
        <span className="max-w-[7rem] truncate text-[10px] text-muted-foreground">{subtitle}</span>
      </span>
    </Button>
  );
}

function EmployeeAvatar(props: {
  employee: CalendarEmployee | null;
  fallbackId: string | null;
  tone: ScheduleStatus["tone"];
  size?: "sm" | "md";
}) {
  const sizeClass =
    props.size === "sm" ? "size-8 text-[11px]" : props.size === "md" ? "size-10 text-xs" : "size-11 text-sm";
  const dotClass =
    props.tone === "warn"
      ? "bg-amber-500"
      : props.tone === "ok"
        ? "bg-emerald-500"
        : "bg-transparent";

  return (
    <span className={cn("relative shrink-0", sizeClass)}>
      <span
        className={cn(
          "flex size-full items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-muted-foreground",
          sizeClass
        )}
      >
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
      {props.tone !== "neutral" ? (
        <span
          className={cn(
            "absolute -bottom-px -right-px size-2 rounded-full ring-2 ring-background",
            dotClass
          )}
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}

function employeeSearchTokens(employee: CalendarEmployee): string {
  return [
    employee.id,
    employee.employee_name,
    employeeShortName(employee),
    employee.employment_type,
    employee.title,
    employee.department,
    employee.company,
    formatScheduleCoverage(employee),
  ]
    .filter((part) => part != null && String(part).trim())
    .join(" ");
}

function EmployeeOption(props: {
  employee: CalendarEmployee;
  selected: boolean;
  onSelect: () => void;
}) {
  const { employee } = props;
  const coverage = formatScheduleCoverage(employee);

  return (
    <CommandItem
      value={employeeSearchTokens(employee)}
      onSelect={props.onSelect}
      className="gap-2 py-2"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          <span className="font-medium">{employeeShortName(employee)}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-mono text-xs">{employee.id}</span>
        </span>
        {coverage ? (
          <span className="block truncate text-[10px] text-muted-foreground">{coverage}</span>
        ) : null}
      </span>
      {props.selected ? <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
    </CommandItem>
  );
}
