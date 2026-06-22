import { Page } from "@lolbikb/dewey-ui";
import {
  deviceAlertsByDate,
  deviceAlertsForWeek,
  deviceSyncByDate,
  formatAttendanceLoadError,
  useCalendarEmployees,
  useEmployeeCalendar,
} from "@/hooks/useHrAttendanceData";
import { useEmployeeSelection } from "@/hooks/useEmployeeSelection";
import type { CalendarPayload, Day, Flag, Severity } from "@/types/calendar";
import { addDays, format, startOfWeek } from "date-fns";
import { useFrappeAuth } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  clampDateToNavBounds,
  computeWeekNavBounds,
  countWeekAssignedShiftDays,
  earliestDayWithCheckins,
  pickEarliestDateKey,
} from "@/lib/weekCalendar";
import { employeeShortName } from "@/lib/employeeCard";
import {
  AttendanceHeaderSkeleton,
  AttendancePageSkeleton,
  LoadingIndicator,
  WeekViewAnimatedShell,
  WeekViewSkeleton,
} from "@/ui/AttendanceLoading";
import { AttendanceToolbar } from "@/ui/AttendanceToolbar";
import { DayInspectorSheet } from "@/ui/DayInspectorSheet";
import { DeviceCloseoutBanner } from "@/ui/DeviceAlerts";
import { WeekView } from "@/ui/WeekView";
import type { HrAccessOutletContext } from "@/lib/hrAccess";

export function App() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const { currentUser, isLoading: authLoading } = useFrappeAuth();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [weekNavDirection, setWeekNavDirection] = useState<"prev" | "next" | "jump">("jump");
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
          payload.has_shift_assignment ?? selectedEmployee?.has_shift_assignment,
      }),
    [
      firstCheckinDate,
      payload.has_shift_assignment,
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
  const loadError = employeesError ?? calendarError;
  const loadErrorMessage = loadError ? formatAttendanceLoadError(loadError) : null;

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
    setWeekNavDirection("prev");
    setAnchor((d) => addDays(d, -7));
  }

  function goNext() {
    if (!canGoNext) return;
    setWeekNavDirection("next");
    setAnchor((d) => addDays(d, 7));
  }

  function goToday() {
    setWeekNavDirection("jump");
    setAnchor(clampDateToNavBounds(new Date(), weekNavBounds));
  }

  function selectAnchor(date: Date) {
    setWeekNavDirection("jump");
    setAnchor(clampDateToNavBounds(date, weekNavBounds));
  }

  const inspectingDay = inspectingDate ? daysByDate.get(inspectingDate) : undefined;

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
        <Page className="gap-0">
          {loadError ? (
            <Card className="mb-3 border-destructive/40 bg-destructive/5 animate-in fade-in">
              <CardContent className="py-3 text-sm text-destructive">
                <div>
                  Could not load attendance data.{" "}
                  {hrStaff
                    ? "Confirm you have HR User access and try again."
                    : "Confirm your user is linked to an active Employee record."}
                </div>
                {loadErrorMessage ? (
                  <div className="mt-1 text-xs text-destructive/90">{loadErrorMessage}</div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {isBootstrapping ? (
              <AttendanceHeaderSkeleton />
            ) : (
              <div className="shrink-0 animate-in fade-in slide-in-from-top-1">
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
                  onRunEngineSuccess={() => void refreshCalendar()}
                  employeeLabel={employeeShortName(selectedEmployee, employee)}
                  canGoPrev={canGoPrev}
                  canGoNext={canGoNext}
                  calendarMinDate={calendarMinDate}
                  calendarMaxDate={calendarMaxDate}
                  isRefreshing={isRefreshing}
                  isCalendarLoading={isCalendarLoading}
                  weekFlagCounts={weekFlagCounts}
                />
              </div>
            )}

            {isBootstrapping ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <WeekViewSkeleton />
                <LoadingIndicator label="Loading attendance…" className="justify-center pb-1" />
              </div>
            ) : (
              <>
                {weekDeviceAlerts.length > 0 ? (
                  <DeviceCloseoutBanner alerts={weekDeviceAlerts} />
                ) : null}
                <WeekViewAnimatedShell
                  loading={isCalendarLoading}
                  weekKey={weekKey}
                  direction={weekNavDirection}
                >
                  <WeekView
                    weekDates={weekDates}
                    daysByDate={daysByDate}
                    alertsByDate={alertsByDate}
                    syncByDate={syncByDate}
                    onInspectDay={(date) => {
                      setInspectingDate(date);
                      setReviewingFlag(null);
                    }}
                    onInspectFlag={(date, flag) => {
                      setInspectingDate(date);
                      setReviewingFlag(flag);
                    }}
                  />
                </WeekViewAnimatedShell>
              </>
            )}
          </div>
        </Page>
      </div>

      <DayInspectorSheet
        inspectingDate={inspectingDate}
        employeeId={employee}
        employeeLabel={employeeShortName(selectedEmployee, employee)}
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
