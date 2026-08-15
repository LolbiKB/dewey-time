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

import { attendanceHealth } from "@/lib/dataHealth";
import { attendancePickerTail } from "@/lib/employeeCard";
import { formatWeekRangeLabel } from "@/lib/weekSchedule";
import type { DeviceAlert, Severity } from "@/types/calendar";
import { AppTooltip } from "@/ui/AppTooltip";
import { DataHealthButton } from "@/ui/DataHealthButton";
import { DeviceHealthDetail } from "@/ui/DeviceAlerts";
import { ClockBadge, EmployeePicker } from "@/ui/EmployeePicker";
import {
  TelegramLinkButton,
  TelegramLinkDialog,
  type LinkInvite,
} from "@/ui/TelegramLinkDialog";
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
  /** Minutes since the last device punch, or null when not stale. */
  staleSyncMinutes: number | null;
  /** Device Closeout Alerts for the week on screen. */
  deviceAlerts: DeviceAlert[];
};

export function AttendanceToolbar(props: AttendanceToolbarProps) {
  const weekLabel = formatWeekRangeLabel(props.weekDates);
  const navDisabled = props.isCalendarLoading;
  const hrStaff = props.hrStaff !== false;
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<LinkInvite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  async function issueTelegramLink(employee: string) {
    // Reset first: leaving the previous employee's link on screen while the
    // next one loads is how someone sends the wrong person's credential.
    setInvite(null);
    setInviteError(null);
    setInviteLoading(true);
    setInviteOpen(true);
    try {
      const response = await fetch(
        "/api/method/dewey_time.telegram.binding.create_link_invite",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Frappe-CSRF-Token": (window as { csrf_token?: string }).csrf_token ?? "",
          },
          body: JSON.stringify({ employee }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?._server_messages || body?.message || "Could not issue a link");
      }
      setInvite(body.message as LinkInvite);
    } catch (error) {
      setInviteError(
        error instanceof Error ? error.message : "Could not issue a link",
      );
    } finally {
      setInviteLoading(false);
    }
  }
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
            <div className="w-px shrink-0 self-stretch bg-border" aria-hidden="true" />
            <TelegramLinkButton
              disabled={!selectedEmployee || props.employeeLoading === true}
              onClick={() => selectedEmployee && issueTelegramLink(selectedEmployee.id)}
            />
          </>
        ) : null}
      </div>

      {/* From sm up it rides in the gap sm:justify-between already leaves
          between the picker block and the week nav, and costs no vertical
          space. BELOW sm this <header> is flex-col with the default
          align-items:stretch, so without `self-start` the h-9 button became a
          full-width amber bar on its own line — the banner shape this whole
          change exists to delete. Measured at 375: 335px wide before, its own
          content width after. It still takes a line there; see
          e2e/notice-arrangement.spec.ts for what that costs.

          Renders null when both counts are clean, which is the ordinary day. */}
      <DataHealthButton
        className="self-start"
        conditions={attendanceHealth({
          staleSyncMinutes: props.staleSyncMinutes,
          closeoutAlerts: props.deviceAlerts.length,
        })}
      >
        <DeviceHealthDetail
          alerts={props.deviceAlerts}
          staleSyncMinutes={props.staleSyncMinutes}
        />
      </DataHealthButton>

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
      {/* Inside <header> but outside the control group: Radix portals it to
          the body, so its position in the tree costs no layout. */}
      <TelegramLinkDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        employeeName={selectedEmployee?.employee_name ?? selectedEmployee?.id ?? null}
        invite={invite}
        error={inviteError}
        isLoading={inviteLoading}
      />
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
