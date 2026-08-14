import { EmptyState, Page, Section } from "@lolbikb/dewey-ui";
import {
  deviceAlertsByDate,
  deviceAlertsForWeek,
  deviceSyncByDate,
  formatAttendanceLoadError,
  useCalendarEmployees,
  useEmployeeCalendar,
} from "@/hooks/useHrAttendanceData";
import { useEmployeeSelection } from "@/hooks/useEmployeeSelection";
import { useSession } from "@/hooks/useSession";
import type { CalendarPayload, Day, Flag, Severity } from "@/types/calendar";
import { addDays, format, startOfWeek } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FailureBlock } from "@/components/ui/notice";
import { gridLoadError } from "@/lib/attendanceLoadError";
import { checkDeviceSyncStaleness } from "@/lib/attendancePunches";
import {
  clampDateToNavBounds,
  computeWeekNavBounds,
  countWeekAssignedShiftDays,
  earliestDayWithCheckins,
  pickEarliestDateKey,
} from "@/lib/weekCalendar";
import { employeeDisplayName } from "@/lib/employeeCard";
import {
  AttendanceHeaderSkeleton,
  AttendancePageSkeleton,
  LoadingIndicator,
  WeekViewAnimatedShell,
  WeekViewSkeleton,
} from "@/ui/AttendanceLoading";
import { AttendanceToolbar } from "@/ui/AttendanceToolbar";
import { DayInspectorSheet } from "@/ui/DayInspectorSheet";
import { WeekView } from "@/ui/WeekView";
import { WeekDayView } from "@/ui/WeekDayView";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { useIsMobile } from "@/hooks/useIsMobile";

export function App() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const { currentUser, isLoading: authLoading } = useSession();
  const isMobile = useIsMobile();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [employeeLoading, setEmployeeLoading] = useState(false);

  const {
    employees,
    currentUserEmployee,
    error: employeesError,
    isLoading: employeesLoading,
    refresh: refreshEmployees,
  } = useCalendarEmployees();
  const { employee, selectEmployee } = useEmployeeSelection(employees, currentUserEmployee);

  useEffect(() => {
    if (sessionLoading || hrStaff || employees.length !== 1) return;
    const ownEmployee = employees[0]!.id;
    if (employee !== ownEmployee) selectEmployee(ownEmployee);
  }, [employee, employees, hrStaff, selectEmployee, sessionLoading]);

  const {
    payload: apiPayload,
    error: calendarError,
    isLoading: calendarLoading,
    refresh: refreshCalendar,
  } = useEmployeeCalendar(employee, anchor);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!employee) return;
    setEmployeeLoading(true);
  }, [employee]);

  useEffect(() => {
    if (!calendarLoading) setEmployeeLoading(false);
  }, [calendarLoading]);

  const payload: CalendarPayload =
    apiPayload ??
    ({
      employee: employee ?? "",
      start_date: "",
      end_date: "",
      days: [],
      device_alerts: [],
      device_sync: [],
    } as CalendarPayload);

  const earliestInPayload = useMemo(
    () => earliestDayWithCheckins(payload.days),
    [payload.days]
  );

  const [inspectingDate, setInspectingDate] = useState<string | null>(null);
  const [reviewingFlag, setReviewingFlag] = useState<Flag | null>(null);

  const daysByDate = useMemo(() => {
    const m = new Map<string, Day>();
    for (const d of payload.days || []) m.set(d.date, d);
    return m;
  }, [payload.days]);

  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekKey = format(weekStart, "yyyy-MM-dd");
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const weekDeviceAlerts = useMemo(
    () => deviceAlertsForWeek(payload.device_alerts, weekDates),
    [payload.device_alerts, weekDates]
  );
  const alertsByDate = useMemo(
    () => deviceAlertsByDate(payload.device_alerts ?? []),
    [payload.device_alerts]
  );
  const syncByDate = useMemo(
    () => deviceSyncByDate(payload.device_sync ?? []),
    [payload.device_sync]
  );

  const syncStaleness = useMemo(
    () => checkDeviceSyncStaleness(payload.device_sync, new Date()),
    [payload.device_sync]
  );

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employee) ?? null,
    [employees, employee]
  );

  const firstCheckinDate = useMemo(
    () =>
      pickEarliestDateKey(
        payload.first_checkin_date,
        selectedEmployee?.first_checkin_date,
        earliestInPayload
      ),
    [earliestInPayload, payload.first_checkin_date, selectedEmployee?.first_checkin_date]
  );

  const weekNavBounds = useMemo(
    () =>
      computeWeekNavBounds(selectedEmployee, new Date(), {
        firstCheckinDate,
        scheduleMaxDate: payload.schedule_max_date ?? selectedEmployee?.schedule_max_date,
        hasShiftAssignment:
          payload.has_shift_assignment_rows ?? selectedEmployee?.has_shift_assignment,
      }),
    [
      firstCheckinDate,
      payload.has_shift_assignment_rows,
      payload.schedule_max_date,
      selectedEmployee,
    ]
  );

  const { minWeekStart, maxWeekStart, calendarMinDate, calendarMaxDate } = weekNavBounds;

  const canGoPrev = weekStart.getTime() > minWeekStart.getTime();
  const canGoNext = weekStart.getTime() < maxWeekStart.getTime();

  useEffect(() => {
    if (!employee) return;
    setAnchor((current) => clampDateToNavBounds(current, weekNavBounds));
  }, [employee, calendarMinDate, calendarMaxDate, weekNavBounds]);

  const weekAssignedShiftDays = useMemo(
    () => countWeekAssignedShiftDays(weekDates, daysByDate),
    [daysByDate, weekDates]
  );

  const weekFlagCounts = useMemo(() => {
    const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
    for (const date of weekDates) {
      const day = daysByDate.get(format(date, "yyyy-MM-dd"));
      for (const flag of day?.flags ?? []) {
        if (flag.severity === "CRITICAL") counts.CRITICAL++;
        else if (flag.severity === "WARNING") counts.WARNING++;
        else if (flag.severity === "INFO") counts.INFO++;
      }
    }
    return counts;
  }, [weekDates, daysByDate]);

  const isBootstrapping = employeesLoading && employees.length === 0;
  const isCalendarLoading = calendarLoading && !!employee;
  const loadError = gridLoadError({
    employeesError,
    calendarError,
    employeeCount: employees.length,
  });
  const loadErrorDetail = loadError ? formatAttendanceLoadError(loadError) : null;

  async function refetchPage() {
    setIsRefreshing(true);
    try {
      const tasks: Promise<unknown>[] = [refreshEmployees()];
      if (employee) tasks.push(refreshCalendar());
      await Promise.all(tasks);
    } finally {
      setIsRefreshing(false);
    }
  }

  function goPrev() {
    if (!canGoPrev) return;
    setAnchor((d) => addDays(d, -7));
  }

  function goNext() {
    if (!canGoNext) return;
    setAnchor((d) => addDays(d, 7));
  }

  function goToday() {
    setAnchor(clampDateToNavBounds(new Date(), weekNavBounds));
  }

  function selectAnchor(date: Date) {
    setAnchor(clampDateToNavBounds(date, weekNavBounds));
  }

  const inspectingDay = inspectingDate ? daysByDate.get(inspectingDate) : undefined;

  const handleInspectDay = (date: string) => {
    setInspectingDate(date);
    setReviewingFlag(null);
  };
  const handleInspectFlag = (date: string, flag: Flag) => {
    setInspectingDate(date);
    setReviewingFlag(flag);
  };

  if (authLoading) {
    return <AttendancePageSkeleton label="Starting session…" />;
  }

  if (!currentUser || currentUser === "Guest") {
    const loginRedirect = import.meta.env.DEV
      ? `${window.location.origin}${window.location.pathname}`
      : "/hr-attendance";
    return (
      <div className="flex h-full items-center justify-center bg-background px-4">
        <Card className="max-w-md border-border/60">
          <CardContent className="space-y-3 py-6 text-sm">
            <div className="font-semibold">Sign in required</div>
            <p className="text-muted-foreground">
              HR Attendance uses your Frappe session and HR permissions. Log in to view live
              checkins and flags.
            </p>
            <Button asChild size="sm">
              <a href={`/login?redirect-to=${encodeURIComponent(loginRedirect)}`}>Log in</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        <Page>
          {/* No PageHeader here, unlike the other three routes — this is the one
              screen that never had a heading to convert. Its nav tab already
              reads "Attendance" (top strip on desktop, bottom bar on phone), so
              a visible title would only duplicate that label while taking ~40px
              off the week grid on the viewport that can least afford it.

              An sr-only heading was declined here once, on those same two
              grounds. Both were wrong for THIS form of it. The 40px is a cost
              of a visible title, and `sr-only` is absolutely positioned, so it
              is not a flex item and measures zero — the register's identical
              heading was checked in a browser at 0px. And a nav tab is not a
              heading: it does not appear in a screen reader's heading list, so
              a reader pressing H on this route got nothing at all and had no
              answer to "where am I". /hr-schedule/coverage now carries the same
              sr-only h1 for the same reason; this route converges on it rather
              than being the one page with no heading. */}
          <h1 className="sr-only">Attendance</h1>

          {isBootstrapping ? (
            <AttendanceHeaderSkeleton />
          ) : (
            <div className="shrink-0 animate-in fade-in">
              <AttendanceToolbar
                employees={employees}
                employee={employee}
                onEmployeeChange={selectEmployee}
                hrStaff={hrStaff}
                employeeLoading={employeeLoading && isCalendarLoading}
                weekDates={weekDates}
                weekStart={weekStart}
                weekAssignedShiftDays={weekAssignedShiftDays}
                showWeekScheduleHint={!!employee && !isCalendarLoading}
                daysByDate={daysByDate}
                anchor={anchor}
                onSelectDate={selectAnchor}
                onPrevWeek={goPrev}
                onNextWeek={goNext}
                onToday={goToday}
                onRefresh={() => void refetchPage()}
                employeeLabel={employeeDisplayName(selectedEmployee, employee)}
                canGoPrev={canGoPrev}
                canGoNext={canGoNext}
                calendarMinDate={calendarMinDate}
                calendarMaxDate={calendarMaxDate}
                isRefreshing={isRefreshing}
                isCalendarLoading={isCalendarLoading}
                weekFlagCounts={weekFlagCounts}
                // Withheld on a failed load, the same guard FlagQueueView
                // applies to its own chip. Both are derived from `payload`,
                // which react-query keeps at its last good value when a refetch
                // fails — so without this the grid says "Attendance data didn't
                // load" while an amber chip above it reports a sync age
                // computed from a frozen watermark that only grows staler.
                deviceAlerts={loadError ? [] : weekDeviceAlerts}
                // `stale ? … : null` is the contract attendanceHealth
                // documents: null means "nothing to report", not "zero minutes
                // ago". Passing minutesSince unconditionally would light the
                // chip on every healthy page load.
                staleSyncMinutes={
                  loadError || !syncStaleness.stale
                    ? null
                    : (syncStaleness.minutesSince ?? null)
                }
              />
            </div>
          )}

          <Section grow>
            {isBootstrapping ? (
              <>
                <WeekViewSkeleton />
                <LoadingIndicator label="Loading attendance…" className="justify-center pb-1" />
              </>
            ) : (
              <>
                <WeekViewAnimatedShell
                  loading={isCalendarLoading}
                  weekKey={weekKey}
                >
                  {loadError ? (
                    <FailureBlock
                      // Three nested clippers above this slot (the shell's
                      // overflow-hidden, AppShell's content, Section grow) do
                      // not scroll, so the block's default 13rem minimum would
                      // cut off Retry on a landscape phone.
                      className="min-h-0"
                      title="Attendance data didn't load"
                      cause={
                        <>
                          {hrStaff
                            ? "Confirm you have HR User access and try again."
                            : "Confirm your user is linked to an active Employee record."}
                          {/* The guidance above is a guess; the server usually knows
                              exactly what went wrong. Without this, a 500 and a bad
                              date range both read as a permission problem and send
                              HR chasing access they already have. */}
                          {loadErrorDetail ? (
                            <span className="mt-1 block text-xs opacity-90">{loadErrorDetail}</span>
                          ) : null}
                        </>
                      }
                      onRetry={() => void refetchPage()}
                      retrying={isRefreshing}
                    />
                  ) : selectedEmployee?.has_shift_assignment === false &&
                    payload.has_shift_assignment_rows !== true &&
                    !selectedEmployee?.is_clock_based ? (
                    <EmptyState
                      className="min-h-0 flex-1 animate-in fade-in"
                      title="No schedule configured"
                      description="Assign a Shift Schedule Assignment in ERPNext to enable expected hours, lunch, and grace rules."
                    />
                  ) : isMobile ? (
                    <WeekDayView
                      weekDates={weekDates}
                      daysByDate={daysByDate}
                      alertsByDate={alertsByDate}
                      syncByDate={syncByDate}
                      isClockBased={payload.is_clock_based ?? selectedEmployee?.is_clock_based}
                      employeeBranch={payload.employee_branch ?? null}
                      now={new Date()}
                      onInspectDay={handleInspectDay}
                      onInspectFlag={handleInspectFlag}
                    />
                  ) : (
                    <WeekView
                      weekDates={weekDates}
                      daysByDate={daysByDate}
                      alertsByDate={alertsByDate}
                      syncByDate={syncByDate}
                      isClockBased={payload.is_clock_based ?? selectedEmployee?.is_clock_based}
                      employeeBranch={payload.employee_branch ?? null}
                      now={new Date()}
                      onInspectDay={handleInspectDay}
                      onInspectFlag={handleInspectFlag}
                    />
                  )}
                </WeekViewAnimatedShell>
              </>
            )}
          </Section>
        </Page>
      </div>

      <DayInspectorSheet
        inspectingDate={inspectingDate}
        employeeId={employee}
        employeeLabel={employeeDisplayName(selectedEmployee, employee)}
        inspectingDay={inspectingDay}
        alertsByDate={alertsByDate}
        syncByDate={syncByDate}
        reviewingFlag={reviewingFlag}
        onReviewingFlagChange={setReviewingFlag}
        showDeskReview={hrStaff}
        onClose={() => {
          setInspectingDate(null);
          setReviewingFlag(null);
        }}
      />
    </>
  );
}
