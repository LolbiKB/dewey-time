import {
  deviceAlertsByDate,
  deviceAlertsForWeek,
  formatAttendanceLoadError,
  useCalendarEmployees,
  useDefaultEmployee,
  useEmployeeCalendar,
} from "@/hooks/useHrAttendanceData";
import type { CalendarPayload, Day, Flag } from "@/types/calendar";
import { addDays, addMonths, format, parseISO, startOfWeek } from "date-fns";
import { useFrappeAuth } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { countWeekAssignedShiftDays } from "@/lib/weekCalendar";
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

export function App() {
  const { currentUser, isLoading: authLoading } = useFrappeAuth();
  const [employee, setEmployee] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [weekNavDirection, setWeekNavDirection] = useState<"prev" | "next" | "jump">("jump");
  const [employeeLoading, setEmployeeLoading] = useState(false);

  const {
    employees,
    error: employeesError,
    isLoading: employeesLoading,
    refresh: refreshEmployees,
  } = useCalendarEmployees();
  useDefaultEmployee(employees, employee, setEmployee);

  const {
    payload: apiPayload,
    monthStart,
    monthEnd,
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
      start_date: format(monthStart, "yyyy-MM-dd"),
      end_date: format(monthEnd, "yyyy-MM-dd"),
      days: [],
      device_alerts: [],
    } as CalendarPayload);

  const [inspectingDate, setInspectingDate] = useState<string | null>(null);
  const [inspectingFlag, setInspectingFlag] = useState<Flag | null>(null);

  const daysByDate = useMemo(() => {
    const m = new Map<string, Day>();
    for (const d of payload.days || []) m.set(d.date, d);
    return m;
  }, [payload.days]);

  const monthStartIso = format(monthStart, "yyyy-MM-dd");
  const monthEndIso = format(monthEnd, "yyyy-MM-dd");
  useEffect(() => {
    const cur = anchor;
    const start = new Date(monthStartIso);
    const end = new Date(monthEndIso);
    if (cur < start) setAnchor(start);
    else if (cur > end) setAnchor(end);
  }, [anchor, employee, monthEndIso, monthStartIso]);

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

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employee) ?? null,
    [employees, employee]
  );

  const scheduleStart = useMemo(() => {
    if (selectedEmployee?.schedule_min_date) {
      return parseISO(selectedEmployee.schedule_min_date);
    }
    return monthStart;
  }, [monthStart, selectedEmployee?.schedule_min_date]);

  const minWeekStart = useMemo(
    () => startOfWeek(scheduleStart, { weekStartsOn: 1 }),
    [scheduleStart]
  );

  const maxWeekStart = useMemo(() => {
    if (selectedEmployee?.schedule_max_date) {
      return startOfWeek(parseISO(selectedEmployee.schedule_max_date), { weekStartsOn: 1 });
    }
    if (selectedEmployee?.has_shift_assignment) {
      return startOfWeek(addMonths(new Date(), 12), { weekStartsOn: 1 });
    }
    return startOfWeek(new Date(), { weekStartsOn: 1 });
  }, [selectedEmployee]);

  const canGoPrev = weekStart > minWeekStart;
  const canGoNext = weekStart < maxWeekStart;

  const weekAssignedShiftDays = useMemo(
    () => countWeekAssignedShiftDays(weekDates, daysByDate),
    [daysByDate, weekDates]
  );

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
    if (!canGoPrev || isCalendarLoading) return;
    setWeekNavDirection("prev");
    setAnchor((d) => addDays(d, -7));
  }

  function goNext() {
    if (!canGoNext || isCalendarLoading) return;
    setWeekNavDirection("next");
    setAnchor((d) => addDays(d, 7));
  }

  function goToday() {
    if (isCalendarLoading) return;
    setWeekNavDirection("jump");
    const today = new Date();
    let target = today;
    if (target < scheduleStart) target = scheduleStart;
    const maxAnchor = addDays(maxWeekStart, 6);
    if (target > maxAnchor) target = maxAnchor;
    setAnchor(target);
  }

  function selectAnchor(date: Date) {
    if (isCalendarLoading) return;
    setWeekNavDirection("jump");
    setAnchor(date);
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
      <div className="flex h-[100dvh] items-center justify-center bg-background px-4">
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
      <div className="h-[100dvh] overflow-hidden bg-background text-foreground">
        <div className="mx-auto flex h-full max-w-7xl flex-col px-4 py-4 sm:px-6">
          {loadError ? (
            <Card className="mb-3 border-destructive/40 bg-destructive/5 animate-in fade-in duration-300">
              <CardContent className="py-3 text-sm text-destructive">
                <div>Could not load attendance data. Confirm you have HR User access and try again.</div>
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
              <div className="shrink-0 animate-in fade-in slide-in-from-top-1 duration-300">
                <AttendanceToolbar
                  employees={employees}
                  employee={employee}
                  onEmployeeChange={setEmployee}
                  employeeLoading={employeeLoading && isCalendarLoading}
                  weekDates={weekDates}
                  weekAssignedShiftDays={weekAssignedShiftDays}
                  showWeekScheduleHint={!!employee && !isCalendarLoading}
                  daysByDate={daysByDate}
                  anchor={anchor}
                  onSelectDate={selectAnchor}
                  onPrevWeek={goPrev}
                  onNextWeek={goNext}
                  onToday={goToday}
                  onRefresh={() => void refetchPage()}
                  canGoPrev={canGoPrev}
                  canGoNext={canGoNext}
                  isRefreshing={isRefreshing}
                  isCalendarLoading={isCalendarLoading}
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
                    onInspectDay={(date) => {
                      setInspectingDate(date);
                      setInspectingFlag(null);
                    }}
                    onInspectFlag={(date, flag) => {
                      setInspectingDate(date);
                      setInspectingFlag(flag);
                    }}
                  />
                </WeekViewAnimatedShell>
              </>
            )}
          </div>
        </div>
      </div>

      <DayInspectorSheet
        inspectingDate={inspectingDate}
        employee={employee}
        inspectingDay={inspectingDay}
        alertsByDate={alertsByDate}
        inspectingFlag={inspectingFlag}
        onInspectingFlagChange={setInspectingFlag}
        onClose={() => setInspectingDate(null)}
      />
    </>
  );
}
