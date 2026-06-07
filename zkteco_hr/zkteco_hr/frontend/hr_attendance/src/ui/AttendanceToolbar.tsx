import { format } from "date-fns";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CalendarEmployee, Day } from "@/types/calendar";

import { formatWeekRangeLabel } from "@/lib/weekSchedule";
import { EmployeePicker } from "@/ui/EmployeePicker";
import { RunEngineDialog } from "@/ui/RunEngineDialog";

export type AttendanceToolbarProps = {
  employees: CalendarEmployee[];
  employee: string | null;
  onEmployeeChange: (id: string) => void;
  employeeLoading?: boolean;
  weekDates: Date[];
  weekStart: Date;
  weekAssignedShiftDays: number;
  showWeekScheduleHint: boolean;
  daysByDate: Map<string, Day>;
  anchor: Date;
  onSelectDate: (date: Date) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onRefresh: () => void;
  onRunEngineSuccess?: () => void;
  employeeLabel?: string | null;
  canGoPrev: boolean;
  canGoNext: boolean;
  calendarMinDate: Date;
  calendarMaxDate: Date;
  isRefreshing: boolean;
  isCalendarLoading: boolean;
  hrStaff?: boolean;
};

export function AttendanceToolbar(props: AttendanceToolbarProps) {
  const weekLabel = formatWeekRangeLabel(props.weekDates);
  const navDisabled = props.isCalendarLoading;
  const hrStaff = props.hrStaff !== false;

  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <EmployeePicker
        employees={props.employees}
        value={props.employee}
        onChange={props.onEmployeeChange}
        isLoading={props.employeeLoading}
        readOnly={!hrStaff}
        weekDates={props.weekDates}
        weekAssignedShiftDays={props.weekAssignedShiftDays}
        showWeekScheduleHint={props.showWeekScheduleHint}
        daysByDate={props.daysByDate}
        className="w-full sm:flex-1 sm:max-w-lg"
      />

      <nav
        className="flex items-center gap-0.5 self-stretch sm:self-auto"
        aria-label="Week navigation"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={props.onPrevWeek}
          disabled={!props.canGoPrev}
          aria-label="Previous week"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>

        <WeekPicker
          anchor={props.anchor}
          weekLabel={weekLabel}
          onSelectDate={props.onSelectDate}
          disabled={navDisabled}
          minDate={props.calendarMinDate}
          maxDate={props.calendarMaxDate}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={props.onNextWeek}
          disabled={!props.canGoNext}
          aria-label="Next week"
        >
          <ChevronRightIcon className="size-4" />
        </Button>

        <div className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 text-xs"
          onClick={props.onToday}
          disabled={navDisabled}
        >
          Today
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={props.onRefresh}
          disabled={props.isRefreshing || navDisabled}
          aria-label="Refresh attendance data"
        >
          <RefreshCwIcon className={cn("size-4", props.isRefreshing && "animate-spin")} />
        </Button>

        {hrStaff ? (
          <RunEngineDialog
            employee={props.employee}
            employeeLabel={props.employeeLabel}
            weekStart={props.weekStart}
            onSuccess={props.onRunEngineSuccess}
            disabled={navDisabled}
          />
        ) : null}
      </nav>
    </header>
  );
}

function WeekPicker(props: {
  anchor: Date;
  weekLabel: string;
  onSelectDate: (date: Date) => void;
  disabled?: boolean;
  minDate: Date;
  maxDate: Date;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={props.disabled}
          className="h-8 min-w-0 flex-1 px-2 text-xs font-medium sm:min-w-[9.5rem] sm:flex-none sm:text-sm"
        >
          <CalendarDaysIcon className="mr-1.5 size-3.5 shrink-0 opacity-60" />
          <span className="truncate">{props.weekLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={props.anchor}
          onSelect={(date) => {
            if (!date) return;
            props.onSelectDate(date);
            setOpen(false);
          }}
          weekStartsOn={1}
          disabled={{ before: props.minDate, after: props.maxDate }}
          startMonth={props.minDate}
          endMonth={props.maxDate}
        />
      </PopoverContent>
    </Popover>
  );
}
