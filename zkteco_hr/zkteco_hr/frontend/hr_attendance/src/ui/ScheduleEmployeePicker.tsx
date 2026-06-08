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
  employeeSearchHaystack,
  employeeShortName,
  isWeeklyScheduleEligible,
  scheduleEmployeeSubtitle,
} from "@/lib/employeeCard";
import { cn } from "@/lib/utils";
import type { CalendarEmployee } from "@/types/calendar";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";

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
          <span className="flex min-w-0 items-center gap-2 truncate text-left">
            <EmployeeAvatar
              employee={selected}
              fallbackId={props.value}
              className={props.compact ? "size-6" : "size-8"}
            />
            <span className="min-w-0 truncate">
              <span className={cn("block truncate font-medium", props.compact && "text-sm")}>
                {employeeShortName(selected, props.value)}
              </span>
              <span
                className={cn(
                  "block truncate text-xs text-muted-foreground",
                  props.compact && "text-[11px] leading-tight"
                )}
              >
                {scheduleEmployeeSubtitle(selected)}
              </span>
            </span>
          </span>
          {props.isLoading ? (
            <Loader2Icon className="size-4 shrink-0 animate-spin opacity-60" />
          ) : (
            <ChevronsUpDownIcon className="size-4 shrink-0 opacity-40" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Search employees…" />
          <CommandList>
            <CommandEmpty>No employees found.</CommandEmpty>
            <CommandGroup>
              {props.employees.map((employee) => {
                const eligible = isWeeklyScheduleEligible(employee.employment_type);

                return (
                  <CommandItem
                    key={employee.id}
                    value={employeeSearchHaystack(employee)}
                    disabled={!eligible}
                    onSelect={() => {
                      if (!eligible) return;
                      props.onChange(employee.id);
                      setOpen(false);
                    }}
                    className="gap-2 py-2"
                  >
                    <EmployeeAvatar employee={employee} fallbackId={employee.id} className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {employeeShortName(employee, employee.id)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {scheduleEmployeeSubtitle(employee)}
                      </span>
                    </span>
                    {employee.id === props.value ? (
                      <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
