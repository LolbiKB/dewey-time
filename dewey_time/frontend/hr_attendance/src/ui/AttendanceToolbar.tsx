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

import { attendancePickerTail } from "@/lib/employeeCard";
import { formatWeekRangeLabel } from "@/lib/weekSchedule";
import type { Severity } from "@/types/calendar";
import { AppTooltip } from "@/ui/AppTooltip";
import { ClockBadge, EmployeePicker } from "@/ui/EmployeePicker";
import { RunEngineDialog } from "@/ui/RunEngineDialog";
import { WeekFlagSummary } from "@/ui/WeekFlagSummary";
import { WeeklyScheduleSummary } from "@/ui/WeeklyScheduleSummary";

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
  employeeLabel?: string | null;
  canGoPrev: boolean;
  canGoNext: boolean;
  calendarMinDate: Date;
  calendarMaxDate: Date;
  isRefreshing: boolean;
  isCalendarLoading: boolean;
  hrStaff?: boolean;
  weekFlagCounts: Record<Severity, number>;
};

export function AttendanceToolbar(props: AttendanceToolbarProps) {
  const weekLabel = formatWeekRangeLabel(props.weekDates);
  const navDisabled = props.isCalendarLoading;
  const hrStaff = props.hrStaff !== false;
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const selectedEmployee = props.employees.find((e) => e.id === props.employee) ?? null;

  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      {/* The bordered box and the divider live HERE, not in EmployeePicker. The
          weekly-schedule button is a sibling control that happens to share a
          border with the picker, not part of it — pulling it into the shared
          component would make it a grab bag and hand /hr-schedule a prop it
          never uses. */}
      <div className="flex min-h-14 w-full min-w-0 overflow-hidden rounded-xl border border-border bg-background sm:max-w-lg sm:flex-1">
        <EmployeePicker
          size="lg"
          employees={props.employees}
          value={props.employee}
          onChange={props.onEmployeeChange}
          isLoading={props.employeeLoading}
          readOnly={!hrStaff}
          tail={attendancePickerTail}
          badge={(employee) => (employee.is_clock_based ? <ClockBadge /> : null)}
          // The wrapper owns the border and the width cap, so the picker gives
          // both up. `max-w-none` is required: twMerge would otherwise leave
          // `lg`'s max-w-lg in place and cap the picker inside an
          // already-capped box.
          className="min-w-0 max-w-none flex-1 rounded-none border-0"
        />
        {hrStaff ? (
          <>
            <div className="w-px shrink-0 self-stretch bg-border" aria-hidden="true" />
            <WeeklyScheduleSummary
              open={scheduleOpen}
              onOpenChange={setScheduleOpen}
              employee={selectedEmployee}
              weekDates={props.weekDates}
              daysByDate={props.daysByDate}
              weekAssignedShiftDays={props.weekAssignedShiftDays}
              showWeekDetail={props.showWeekScheduleHint === true}
            >
              <ScheduleAccessButton
                weekAssignedShiftDays={props.weekAssignedShiftDays}
                // `!selectedEmployee`, not `!props.employee`: an id that names
                // nobody in the current list has no schedule to show, and the
                // old picker gated on the RESOLVED employee for that reason.
                disabled={
                  !selectedEmployee || !props.employees.length || props.employeeLoading === true
                }
              />
            </WeeklyScheduleSummary>
          </>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 self-stretch sm:flex-none">
        <WeekFlagSummary
          counts={props.weekFlagCounts}
          loading={props.isCalendarLoading}
          className="min-w-0 justify-end"
        />

        <nav
          className="flex shrink-0 flex-wrap items-center gap-x-0.5 gap-y-1 sm:flex-nowrap"
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
            disabled={navDisabled}
          />
        ) : null}
        </nav>
      </div>
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

/**
 * The weekly-schedule button welded to the right of the employee picker.
 *
 * Lives here, not in EmployeePicker: it is a sibling control that shares the
 * bordered box with the picker, not part of it. Exported so
 * `weeklyScheduleSummary.test.tsx` can render the real summary + button
 * composition without dragging the whole picker in.
 */
export function ScheduleAccessButton(props: { weekAssignedShiftDays: number; disabled?: boolean }) {
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
