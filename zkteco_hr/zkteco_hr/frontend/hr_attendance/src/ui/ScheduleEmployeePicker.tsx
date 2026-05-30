import { ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
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
  employeeShortName,
} from "@/lib/employeeCard";
import { cn } from "@/lib/utils";
import type { CalendarEmployee } from "@/types/calendar";

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
            <span
              className={cn(
                "flex shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold",
                props.compact ? "size-6" : "size-8"
              )}
            >
              {employeeInitials(selected, props.value)}
            </span>
            <span className="min-w-0 truncate">
              <span className={cn("block truncate font-medium", props.compact && "text-sm")}>
                {employeeShortName(selected, props.value)}
              </span>
              {!props.compact ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {employeePickerSubtitle(selected)}
                </span>
              ) : null}
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
        <Command filter={(value, search, keywords) => {
          const haystack = [value, ...(keywords ?? [])].join(" ").toLowerCase();
          return haystack.includes(search.toLowerCase()) ? 1 : 0;
        }}>
          <CommandInput placeholder="Search employees…" />
          <CommandList>
            <CommandEmpty>No employees found.</CommandEmpty>
            <CommandGroup>
              {props.employees.map((employee) => (
                <CommandItem
                  key={employee.id}
                  value={employee.id}
                  keywords={[employee.name, employee.id, employee.branch ?? ""]}
                  onSelect={() => {
                    props.onChange(employee.id);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium">{employeeShortName(employee, employee.id)}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">
                    {employeePickerSubtitle(employee)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
