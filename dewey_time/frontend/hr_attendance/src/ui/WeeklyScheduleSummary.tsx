import type { ReactNode } from "react";
import { CalendarRangeIcon } from "lucide-react";

import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  employeeShortName,
  formatScheduleCoverage,
  shiftScheduleStatus,
} from "@/lib/employeeCard";
import {
  buildWeekSchedule,
  describeWeekSchedulePattern,
  formatScheduleDuration,
  formatWeekRangeLabel,
} from "@/lib/weekSchedule";
import type { CalendarEmployee, Day } from "@/types/calendar";

export type WeeklyScheduleSummaryProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: CalendarEmployee | null;
  weekDates: Date[];
  daysByDate: Map<string, Day>;
  weekAssignedShiftDays: number;
  showWeekDetail: boolean;
  /**
   * The trigger, rendered inside this component's `Popover` root. The caller
   * owns the `PopoverTrigger` so its tooltip can wrap it from the outside.
   */
  children?: ReactNode;
};

/**
 * The assigned week, stated rather than drawn. The attendance canvas already
 * draws it — dashed bands for today and the days ahead, missing-expected for
 * the days behind, on an axis derived from the assigned shift bounds — so this
 * panel carries only the facts that no drawing of a week can carry: the
 * pattern, the totals, and the ERP assignment behind them.
 *
 * Leave wins over an assigned shift for every number here, because a leave day
 * is neither worked nor expected. The day cards this panel replaced encoded
 * that precedence in their JSX and nowhere else, which is how it got lost.
 */
export function WeeklyScheduleSummary(props: WeeklyScheduleSummaryProps) {
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      {props.children}
      <PopoverContent
        align="end"
        aria-label="Weekly schedule"
        className="max-h-[min(70dvh,32rem)] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <WeeklyScheduleFacts
          employee={props.employee}
          weekDates={props.weekDates}
          daysByDate={props.daysByDate}
          weekAssignedShiftDays={props.weekAssignedShiftDays}
          showWeekDetail={props.showWeekDetail}
        />
      </PopoverContent>
    </Popover>
  );
}

export type WeeklyScheduleFactsProps = Omit<
  WeeklyScheduleSummaryProps,
  "open" | "onOpenChange" | "children"
>;

/** The popover body. Exported so its rendering can be tested directly. */
export function WeeklyScheduleFacts(props: WeeklyScheduleFactsProps) {
  const week = buildWeekSchedule(props.weekDates, props.daysByDate);
  const patternLabel = describeWeekSchedulePattern(week);
  const status = shiftScheduleStatus(
    props.employee,
    props.weekDates,
    props.weekAssignedShiftDays,
    props.showWeekDetail
  );
  const name = employeeShortName(props.employee, props.employee?.id ?? null);
  const rangeLabel = formatWeekRangeLabel(props.weekDates);
  const scheduleCoverage = props.employee ? formatScheduleCoverage(props.employee) : null;
  const assignmentId = props.employee?.shift_schedule_assignment ?? null;
  const hasSsa =
    props.employee?.has_shift_assignment === true ||
    props.employee?.has_shift_schedule_assignment === true;

  // `assigned` and `onLeave` are set independently upstream (an SSA row keeps
  // `shift_assigned` true on a day with approved leave), so counting each
  // without reference to the other would put a leave day in two buckets and
  // the rows would add to more than seven. Applying the precedence here keeps
  // every number below off the same set.
  const workedDays = week.filter((d) => d.assigned && d.onLeave !== true);
  const offDays = week.filter((d) => !d.assigned && d.onLeave !== true).length;
  const leaveDays = week.filter((d) => d.onLeave).length;
  const expectedMin = workedDays.reduce((total, d) => total + (d.durationMin ?? 0), 0);
  const supersededDays = week.filter((d) => d.shift.schedule_superseded === true).length;

  return (
    <div className="flex flex-col">
      <header className="flex items-start gap-3 border-b border-border/60 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <CalendarRangeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
      </header>

      <div className="px-4 py-3">
        {patternLabel ? (
          <p className="mb-2 text-sm font-medium leading-snug text-foreground">{patternLabel}</p>
        ) : null}

        <dl className="text-sm">
          <Fact label="Expected hours">{formatScheduleDuration(expectedMin)}</Fact>
          <Fact label="Working days">{workedDays.length}</Fact>
          <Fact label="Days off">{offDays}</Fact>
          <Fact label="Leave">{leaveDays}</Fact>
          {assignmentId || scheduleCoverage ? (
            <Fact label="Assignment">
              {assignmentId ? (
                <span className="block truncate font-normal">{assignmentId}</span>
              ) : null}
              {scheduleCoverage ? (
                <span className="block text-xs font-normal text-muted-foreground">
                  {scheduleCoverage}
                </span>
              ) : null}
            </Fact>
          ) : null}
        </dl>

        {supersededDays > 0 ? (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Superseded in ERP — the Shift Assignment covering{" "}
            {supersededDays === 1 ? "one day" : `${supersededDays} days`} this week is Inactive;
            past days still show it.
          </p>
        ) : null}

        {status.tone === "warn" ? (
          <p className="mt-3 rounded-lg border border-brand-accent/30 bg-brand-accent/8 px-3 py-2 text-xs leading-relaxed text-foreground">
            {status.detail ?? status.label}
            {!hasSsa ? " Assign a Shift Schedule Assignment in ERPNext to generate shifts." : null}
          </p>
        ) : (
          <p className="mt-3 text-center text-[10px] text-muted-foreground">
            Expected shifts from Shift Assignments
          </p>
        )}
      </div>
    </div>
  );
}

function Fact(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border/50 py-1.5 first:border-t-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 text-right font-medium tabular-nums text-foreground">
        {props.children}
      </dd>
    </div>
  );
}
