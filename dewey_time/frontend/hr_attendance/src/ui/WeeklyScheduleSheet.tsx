import { CalendarRangeIcon } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  summarizeWeekSchedule,
} from "@/lib/weekSchedule";
import type { CalendarEmployee, Day } from "@/types/calendar";
import { WeekScheduleGantt } from "@/ui/WeekScheduleGantt";

export type WeeklyScheduleSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: CalendarEmployee | null;
  weekDates: Date[];
  daysByDate: Map<string, Day>;
  weekAssignedShiftDays: number;
  showWeekDetail: boolean;
};

export function WeeklyScheduleSheet(props: WeeklyScheduleSheetProps) {
  const week = buildWeekSchedule(props.weekDates, props.daysByDate);
  const summary = summarizeWeekSchedule(week);
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
  const hasSsa =
    props.employee?.has_shift_assignment === true ||
    props.employee?.has_shift_schedule_assignment === true;

  const summaryLine = [
    summary.workDays > 0 ? `${summary.workDays} work` : null,
    summary.offDays > 0 ? `${summary.offDays} off` : null,
    summary.leaveDays > 0 ? `${summary.leaveDays} leave` : null,
    summary.totalWorkMin > 0
      ? `${formatScheduleDuration(summary.totalWorkMin)} expected`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <SheetHeader className="space-y-1 border-b border-border/60 px-5 py-4 text-left">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarRangeIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base">{name}</SheetTitle>
              <SheetDescription className="text-xs">
                {rangeLabel}
                {scheduleCoverage ? (
                  <span className="text-muted-foreground"> · {scheduleCoverage}</span>
                ) : null}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <WeekScheduleGantt
            week={week}
            patternLabel={patternLabel}
            summaryLine={summaryLine || undefined}
          />

          {status.tone === "warn" ? (
            <p className="mt-4 rounded-lg border border-brand-accent/30 bg-brand-accent/8 px-3 py-2 text-xs leading-relaxed text-foreground">
              {status.detail ?? status.label}
              {!hasSsa ? " Assign a Shift Schedule Assignment in ERPNext to generate shifts." : null}
            </p>
          ) : (
            <p className="mt-4 text-center text-[10px] text-muted-foreground">
              Expected shifts from Shift Assignments
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
