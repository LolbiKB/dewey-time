import {
  deviceAlertsByDate,
  deviceAlertsForWeek,
  formatDeviceAlertStatus,
  useCalendarEmployees,
  useDefaultEmployee,
  useEmployeeCalendar,
} from "@/hooks/useHrAttendanceData";
import type {
  CalendarEmployee,
  CalendarPayload,
  Day,
  DeviceAlert,
  Flag,
  ShiftContext,
} from "@/types/calendar";
import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfWeek,
} from "date-fns";
import { useFrappeAuth } from "frappe-react-sdk";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
  LogInIcon,
  LogOutIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  computeDayTimeWindow,
  deriveSegments as deriveSegmentsFromCheckins,
  deriveTimelineGaps,
  deriveUnpairedPunches,
  directionForCheckin,
  sortCheckinsByTime as sortCheckinsByTimeLib,
} from "@/lib/attendancePunches";
import {
  AttendanceHeaderSkeleton,
  AttendancePageSkeleton,
  LoadingIndicator,
  WeekViewAnimatedShell,
  WeekViewSkeleton,
} from "@/ui/AttendanceLoading";

type Severity = "INFO" | "WARNING" | "CRITICAL";
type Checkin = NonNullable<Day["checkins"]>[number];
type Segment = {
  start?: Checkin | null;
  end?: Checkin | null;
  minutes?: number | null;
  startMin?: number | null;
  endMin?: number | null;
  startPct?: number | null;
  endPct?: number | null;
  branch?: string | null;
};
type AwayGap = {
  start?: Checkin | null;
  end?: Checkin | null;
  minutes: number | null;
  startMin?: number | null;
  endMin?: number | null;
  topPct?: number;
  heightPct?: number;
};
type SegmentInspectorItem =
  | { kind: "segment"; segment: Segment }
  | { kind: "away"; gap: AwayGap };

const SEVERITY_ORDER: Severity[] = ["CRITICAL", "WARNING", "INFO"];

export function App() {
  const view: "week" = "week";
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

  // Keep anchor within the loaded month when employee or month changes.
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

  const scheduleStart = useMemo(() => monthStart, [monthStart]);
  const minWeekStart = startOfWeek(scheduleStart, { weekStartsOn: 1 });
  const maxWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // don't navigate beyond present week

  const canGoPrev = weekStart > minWeekStart;
  const canGoNext = weekStart < maxWeekStart;
  const isBootstrapping = employeesLoading && employees.length === 0;
  const isCalendarLoading = calendarLoading && !!employee;
  const loadError = employeesError ?? calendarError;

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
    const clamped = today < scheduleStart ? scheduleStart : today;
    setAnchor(clamped);
  }

  function selectAnchor(date: Date) {
    if (isCalendarLoading) return;
    setWeekNavDirection("jump");
    setAnchor(date);
  }

  const inspectingDay = inspectingDate ? daysByDate.get(inspectingDate) : undefined;
  const segments = useMemo(
    () => deriveSegments(inspectingDay?.checkins ?? []),
    [inspectingDay?.checkins]
  );
  const segmentInspectorItems = useMemo(
    () => buildSegmentInspectorItems(segments, inspectingDay?.checkins ?? []),
    [inspectingDay?.checkins, segments]
  );

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
                Could not load attendance data. Confirm you have HR User access and try again.
              </CardContent>
            </Card>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {isBootstrapping ? (
              <AttendanceHeaderSkeleton />
            ) : (
              <Card className="animate-in fade-in slide-in-from-top-1 border-border/60 duration-300">
                <CardContent className="py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <EmployeePicker
                      employees={employees}
                      value={employee}
                      onChange={setEmployee}
                      isLoading={employeeLoading && isCalendarLoading}
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <DateJump anchor={anchor} onSelectDate={selectAnchor} />

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void refetchPage()}
                      disabled={isRefreshing || isCalendarLoading}
                      title="Reload attendance data"
                    >
                      <RefreshCwIcon
                        className={cn("mr-1 size-4", isRefreshing && "animate-spin")}
                      />
                      Refresh
                    </Button>

                    <Separator orientation="vertical" className="hidden h-7 md:block" />

                    <Button variant="outline" size="sm" onClick={goToday} disabled={isCalendarLoading}>
                      Today
                    </Button>
                    <Button variant="outline" size="sm" onClick={goPrev} disabled={!canGoPrev || isCalendarLoading}>
                      <ChevronLeftIcon className="mr-1 size-4" /> Prev
                    </Button>
                    <Button variant="outline" size="sm" onClick={goNext} disabled={!canGoNext || isCalendarLoading}>
                      Next <ChevronRightIcon className="ml-1 size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
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
                    anchor={anchor}
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

      <Sheet open={!!inspectingDate} onOpenChange={(o) => !o && setInspectingDate(null)}>
        <SheetContent side="right" className="flex w-[440px] flex-col overflow-hidden sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {inspectingDate ? format(new Date(inspectingDate), "EEE, MMM d") : "Day"}
            </SheetTitle>
            <SheetDescription className="flex items-center gap-2">
              <span className="text-foreground">{employee}</span>
              <Separator orientation="vertical" className="h-4" />
              <span>Inspector</span>
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1 px-4 pb-5">
            <div className="grid h-full grid-rows-[auto_1fr_auto] gap-3">
              {(() => {
                const punches = sortCheckinsByTime(inspectingDay?.checkins ?? []);
                const dayAlerts = inspectingDate ? (alertsByDate.get(inspectingDate) ?? []) : [];
                const flags = [...(inspectingDay?.flags ?? [])].sort((a, b) => {
                    const aIdx = SEVERITY_ORDER.indexOf((a.severity ?? "WARNING") as Severity);
                    const bIdx = SEVERITY_ORDER.indexOf((b.severity ?? "WARNING") as Severity);
                    if (aIdx !== bIdx) return aIdx - bIdx;
                    return (a.flag_code ?? "").localeCompare(b.flag_code ?? "");
                  });

                return (
                  <Tabs defaultValue="timeline" className="min-h-0">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="timeline" className="gap-2">
                        Segments
                        <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
                          {segmentInspectorItems.length}
                        </Badge>
                      </TabsTrigger>
                      <TabsTrigger value="punches" className="gap-2">
                        Punches
                        <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
                          {punches.length}
                        </Badge>
                      </TabsTrigger>
                      <TabsTrigger value="flags" className="gap-2">
                        Flags
                        <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
                          {flags.length + dayAlerts.length}
                        </Badge>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="timeline" className="mt-3 min-h-0">
                      <Card className="border-border/60">
                        <CardContent className="space-y-3 pt-4">
                          {segments.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center">
                              <div className="text-sm font-medium">No segments</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Not enough punches to form segments for this day.
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {segmentInspectorItems.map((item, idx) =>
                                item.kind === "segment" ? (
                                  <SegmentInspectorRow key={`segment-${idx}`} segment={item.segment} />
                                ) : (
                                  <AwayInspectorRow key={`away-${idx}`} gap={item.gap} />
                                )
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="punches" className="mt-3 min-h-0">
                      <Card className="border-border/60">
                        <CardContent className="pt-4">
                          {punches.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center">
                              <div className="text-sm font-medium">No punches</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                There are no checkins recorded for this day.
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {punches.map((checkin, idx) => (
                                <PunchInspectorRow
                                  key={checkin.name ?? `${checkin.time}-${idx}`}
                                  checkin={checkin}
                                  index={idx + 1}
                                  direction={directionForCheckin(punches, checkin)}
                                />
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="flags" className="mt-3 min-h-0">
                      <Card className="border-border/60">
                        <CardContent className="pt-4">
                          <div className="text-sm font-medium">Flags</div>
                          {dayAlerts.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">
                                Device closeout
                              </div>
                              {dayAlerts.map((alert) => (
                                <DeviceAlertRow key={`${alert.device_sn}-${alert.local_date}`} alert={alert} />
                              ))}
                            </div>
                          ) : null}
                          {flags.length === 0 && dayAlerts.length === 0 ? (
                            <div className="mt-3 rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center">
                              <div className="text-sm font-medium">No flags</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                No attendance flags for this day.
                              </div>
                            </div>
                          ) : flags.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {flags.slice(0, 14).map((f) => (
                                <Tooltip key={f.name}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="rounded-full focus:outline-hidden focus:ring-2 focus:ring-ring/40"
                                      onClick={() => setInspectingFlag(f)}
                                    >
                                      <FlagBadge flag={f} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="text-xs">
                                      <div className="font-medium">{f.flag_code}</div>
                                      <div className="text-muted-foreground">
                                        {f.status ?? "OPEN"} · {f.severity ?? "WARNING"}
                                      </div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              ))}
                            </div>
                          ) : null}

                          {inspectingFlag ? (
                            <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
                              <div className="text-xs font-medium">Selected</div>
                              <div className="mt-1 flex items-center gap-2">
                                <FlagBadge flag={inspectingFlag} />
                                <div className="text-xs text-muted-foreground">{inspectingFlag.status ?? "OPEN"}</div>
                              </div>
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                );
              })()}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DeviceCloseoutBanner({ alerts }: { alerts: DeviceAlert[] }) {
  return (
    <Card className="border-amber-500/40 bg-amber-500/5 animate-in fade-in duration-300">
      <CardContent className="flex gap-3 py-3">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-2 text-sm">
          <div className="font-medium text-amber-950 dark:text-amber-100">
            Device closeout pending ({alerts.length})
          </div>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {alerts.map((alert) => (
              <li key={`${alert.device_sn}-${alert.local_date}`} className="truncate">
                <span className="font-medium text-foreground">{alert.local_date}</span>
                {" · "}
                {alert.device_sn}
                {" · "}
                {formatDeviceAlertStatus(alert.status)}
                {alert.last_error ? ` — ${alert.last_error}` : null}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function DeviceAlertRow({ alert }: { alert: DeviceAlert }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
      <div className="font-medium text-foreground">{alert.device_sn}</div>
      <div className="mt-0.5 text-muted-foreground">
        {formatDeviceAlertStatus(alert.status)}
        {alert.branch ? ` · ${alert.branch}` : null}
      </div>
      {alert.last_error ? (
        <div className="mt-1 text-muted-foreground">{alert.last_error}</div>
      ) : null}
    </div>
  );
}

function WeekView(props: {
  weekDates: Date[];
  anchor: Date;
  daysByDate: Map<string, Day>;
  alertsByDate: Map<string, DeviceAlert[]>;
  onInspectDay: (date: string) => void;
  onInspectFlag: (date: string, flag: Flag) => void;
}) {
  // Calendar-style working-hours viewport.
  // The scroll viewport = card section height. We map exactly `visibleHours` of time onto that
  // height by sizing the inner canvas to (weekSpan / visibleHours) × 100% of the viewport.
  // This guarantees overflow whenever the week span exceeds `visibleHours` — no JS measurement needed.
  const visibleHours = 10;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const weekWindow = useMemo(() => {
    const mins: number[] = [];
    for (const d of props.weekDates) {
      const key = format(d, "yyyy-MM-dd");
      const info = props.daysByDate.get(key);
      for (const c of info?.checkins ?? []) {
        const m = minutesFromDateTime(c.time);
        if (m != null) mins.push(m);
      }
      if (info?.first_in) {
        const m = minutesFromDateTime(info.first_in);
        if (m != null) mins.push(m);
      }
      if (info?.last_out) {
        const m = minutesFromDateTime(info.last_out);
        if (m != null) mins.push(m);
      }
    }
    if (mins.length === 0) {
      // fallback to a reasonable "workday" window
      return { startMin: 8 * 60, endMin: 18 * 60 };
    }
    const min = Math.min(...mins);
    const max = Math.max(...mins);
    const margin = 30;
    return {
      startMin: clamp(min - margin, 0, 24 * 60),
      endMin: clamp(max + margin, 0, 24 * 60),
    };
  }, [props.daysByDate, props.weekDates]);

  const weekSpanMinutes = Math.max(60, weekWindow.endMin - weekWindow.startMin);
  // Map 10 hours of time to the full scroll viewport height; grow taller when the week spans >10h.
  const canvasHeightPct = Math.max(100, (weekSpanMinutes / (visibleHours * 60)) * 100);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Snap scroll to the top of the week window when the week changes.
    el.scrollTop = 0;
  }, [weekWindow.startMin, weekWindow.endMin]);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="grid shrink-0 grid-cols-7 border-b border-border/60">
        {props.weekDates.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const info = props.daysByDate.get(key);
          const isToday = isSameDay(d, new Date());
          const timeRange = formatDayCheckinTimeRange(info);
          return (
            <div key={key} className="px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    {format(d, "EEE")}
                  </div>
                  <div
                    className={cn(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-semibold tracking-tight",
                      isToday ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground"
                    )}
                    title={isToday ? "Today" : undefined}
                  >
                    {format(d, "d")}
                  </div>
                </div>
                {isToday ? <span className="text-[11px] font-medium text-primary/80">Today</span> : null}
              </div>

              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {timeRange ? <span>{timeRange}</span> : null}
              </div>

              <div className="mt-1 flex items-center gap-1.5">
                {(props.alertsByDate.get(key) ?? []).length > 0 ? (
                  <span
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-amber-500/50 bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-800 dark:text-amber-200"
                    title="Device closeout pending"
                  >
                    !
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div
          className="grid min-h-full grid-cols-7"
          style={{ height: `${canvasHeightPct}%` }}
        >
          {props.weekDates.map((d) => {
            const key = format(d, "yyyy-MM-dd");
            const info = props.daysByDate.get(key);
            const isToday = isSameDay(d, new Date());
            return (
              <DayCell
                key={key}
                date={d}
                outside={false}
                today={isToday}
                info={info}
                dense={false}
                onInspectDay={() => props.onInspectDay(key)}
                onInspectFlag={(flag) => props.onInspectFlag(key, flag)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthView(props: {
  monthGrid: Date[];
  anchor: Date;
  daysByDate: Map<string, Day>;
  onInspectDay: (date: string) => void;
  onInspectFlag: (date: string, flag: Flag) => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/60 bg-card">
      <div className="grid flex-none grid-cols-7 border-b border-border/60 text-xs font-medium text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-3 py-2">
            {d}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7">
        {props.monthGrid.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const info = props.daysByDate.get(key);
          const outside = !isSameMonth(d, props.anchor);
          const isToday = isSameDay(d, new Date());
          return (
            <DayCell
              key={key}
              date={d}
              outside={outside}
              today={isToday}
              info={info}
              dense={true}
              onInspectDay={() => props.onInspectDay(key)}
              onInspectFlag={(flag) => props.onInspectFlag(key, flag)}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayCell(props: {
  date: Date;
  outside: boolean;
  today: boolean;
  info?: Day;
  dense: boolean;
  onInspectDay: () => void;
  onInspectFlag: (flag: Flag) => void;
}) {
  const checkins = props.info?.checkins ?? [];
  const hasUnpairedPunch = deriveUnpairedPunches(checkins, parseDateTimeLocal).length > 0;

  return (
    <button
      type="button"
      onClick={props.onInspectDay}
      className={cn(
        "group relative min-h-0 border-b border-r border-border/60 p-3 text-left outline-hidden transition-colors hover:bg-muted/20 focus:bg-muted/20 focus:ring-2 focus:ring-ring/40",
        props.dense ? "h-full" : "h-full",
        props.outside && "bg-muted/10 text-muted-foreground",
        props.today && "bg-primary/3 ring-1 ring-primary/20"
      )}
    >
      <div className={cn("grid h-full gap-2", props.dense ? "grid-rows-[20px_1fr]" : "grid-rows-[1fr]")}>
        {props.dense ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-4 w-1 rounded-full",
                  hasUnpairedPunch ? "bg-destructive" : "bg-muted/40"
                )}
                aria-hidden="true"
              />
              <div className="text-xs font-semibold">{format(props.date, "d")}</div>
            </div>
            <div className="opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-[11px] text-muted-foreground">Inspect</span>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 h-full">
          <DayDayTrack
            firstIn={props.info?.first_in ?? null}
            lastOut={props.info?.last_out ?? null}
            checkins={checkins}
            shift={props.info?.shift ?? { shift_assigned: false }}
            grossMinutes={props.info?.gross_minutes ?? null}
            dense={props.dense}
          />
        </div>
      </div>
    </button>
  );
}

function DayDayTrack(props: {
  firstIn: string | null;
  lastOut: string | null;
  checkins: Checkin[];
  shift: ShiftContext;
  grossMinutes: number | null;
  dense: boolean;
  windowStartMin?: number;
  windowEndMin?: number;
}) {
  const color = "bg-emerald-600";

  const span = computeDaySpan(props.firstIn, props.lastOut);
  const segments = deriveSegments(props.checkins);
  const roguePunches = useMemo(
    () => deriveUnpairedPunches(props.checkins ?? [], parseDateTimeLocal),
    [props.checkins]
  );
  const gaps = useMemo(
    () => deriveTimelineGaps(segments, roguePunches, minutesFromDateTime),
    [roguePunches, segments]
  );
  const expected = computeExpectedWindowPct(props.shift);
  const lunch = computeLunchWindowPct(props.shift);
  const lateness = computeLateness(props.shift, props.firstIn);
  const adherence = computeAdherenceOpacity(props.shift, props.grossMinutes);

  const window = useMemo(() => {
    if (props.dense) return null;
    return computeDayTimeWindow(props.checkins ?? [], minutesFromDateTime);
  }, [props.checkins, props.dense]);

  function pctFromMinute(min: number) {
    if (!window) return clamp((min / (24 * 60)) * 100, 0, 100);
    return clamp(((min - window.startMin) / window.span) * 100, 0, 100);
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Week view: fill available height. Month view: keep compact. */}
      <div
        className={cn("relative rounded-xl bg-muted/25", props.dense ? "" : "min-h-0 flex-1")}
        style={props.dense ? { height: 96 } : undefined}
      >
        {/* Center guide line (pixel-snapped to avoid looking thicker on some DPIs) */}
        <div
          className="absolute inset-y-2 w-px bg-border/60"
          style={{ left: "calc(50% - 0.5px)" }}
        />

        {/* Unpaired punch marker(s): single red tick at punch time */}
        {roguePunches.map((c, idx) => {
          const m = minutesFromDateTime(c.time);
          if (m == null) return null;
          const topPct = pctFromMinute(m);
          return (
            <div
              key={`${c.time}-${idx}`}
              className="absolute inset-x-2 h-1 rounded-full bg-destructive shadow-sm"
              style={{ top: `calc(${topPct}% - 2px)` }}
              title={`Unpaired punch · ${format(parseDateTimeLocal(c.time), "h:mm a")}`}
            />
          );
        })}

        {/* Expected shift window (ghost rail) */}
        {expected && !window ? (
          <div
            className="absolute inset-x-3 rounded-md border border-dashed border-border/70 bg-background/10"
            style={{
              top: `calc(${expected.topPct}% + 8px)`,
              height: `calc(${expected.heightPct}% - 16px)`,
            }}
            title={`Expected: ${props.shift.start_time ?? ""}–${props.shift.end_time ?? ""}`}
          />
        ) : null}

        {/* Lunch window band (full-day only) */}
        {lunch && !window ? (
          <div
            className="absolute inset-x-3 rounded-md bg-muted/20"
            style={{
              top: `calc(${lunch.topPct}% + 8px)`,
              height: `calc(${lunch.heightPct}% - 16px)`,
            }}
            title={`Lunch: ${props.shift.lunch_start ?? ""}–${props.shift.lunch_end ?? ""}`}
          />
        ) : null}

        {/* (Intentionally no lateness threshold hairline marker) */}

        {/* Shift overlays inside the week window (minute-based mapping) */}
        {window && props.shift.shift_assigned ? (
          <>
            {(() => {
              const startMin = parseTimeToMinutes(props.shift.start_time ?? null);
              const endMin = parseTimeToMinutes(props.shift.end_time ?? null);
              if (startMin == null || endMin == null || endMin <= startMin) return null;
              const topPct = pctFromMinute(startMin);
              const bottomPct = pctFromMinute(endMin);
              const heightPct = Math.max(2, bottomPct - topPct);
              return (
                <div
                  className="absolute inset-x-3 rounded-md border border-dashed border-border/70 bg-background/10"
                  style={{ top: `calc(${topPct}% + 8px)`, height: `calc(${heightPct}% - 16px)` }}
                />
              );
            })()}
            {(() => {
              const ls = parseTimeToMinutes(props.shift.lunch_start ?? null);
              const le = parseTimeToMinutes(props.shift.lunch_end ?? null);
              if (ls == null || le == null || le <= ls) return null;
              const topPct = pctFromMinute(ls);
              const bottomPct = pctFromMinute(le);
              const heightPct = Math.max(2, bottomPct - topPct);
              return (
                <div
                  className="absolute inset-x-3 rounded-md bg-muted/20"
                  style={{ top: `calc(${topPct}% + 8px)`, height: `calc(${heightPct}% - 16px)` }}
                />
              );
            })()}
            {/* (Intentionally no lateness threshold hairline marker) */}
          </>
        ) : null}

        {/* Presence rail (quiet). Month-only; week view relies on segments/gaps. */}
        {props.dense && span && segments.length === 0 ? (
          <div
            className={cn("absolute left-1/2 w-[12px] -translate-x-1/2 rounded-sm opacity-20", color)}
            style={{
              top: `calc(${span.topPct}% + 8px)`,
              height: `calc(${span.heightPct}% - 16px)`,
            }}
          />
        ) : null}

        {/* Away gaps (solid + thicker outline). Edge-to-edge with adjacent segments. */}
        {gaps.slice(0, props.dense ? 3 : 6).map((g, idx) => {
          const topPct = pctFromMinute(g.startMin);
          const endPct = pctFromMinute(g.endMin);
          const heightPct = endPct - topPct;
          if (heightPct <= 0) return null;
          return (
            <HoverCard key={idx} openDelay={220} closeDelay={120}>
              <HoverCardTrigger asChild>
                <div
                  className="absolute inset-x-2 rounded-sm border-2 border-solid border-destructive/70 bg-destructive/5"
                  style={{
                    top: `${topPct}%`,
                    height: `${heightPct}%`,
                  }}
                />
              </HoverCardTrigger>
              <HoverCardContent className="w-auto p-2">
                <div className="text-xs">
                  Away · {formatDurationMinutes(g.minutes)}
                </div>
              </HoverCardContent>
            </HoverCard>
          );
        })}

        {/* Rectangular segments (primary) */}
        {segments.length === 0 ? null : (
          segments.slice(0, props.dense ? 3 : 6).map((s, idx) => {
            if (s.startMin == null || s.endMin == null) return null;
            const topPct = pctFromMinute(s.startMin);
            const endPct = pctFromMinute(s.endMin);
            const heightPct = endPct - topPct;
            if (heightPct <= 0) return null;
            const branch = s.branch ?? null;
            const branchShort = branch ? branch.replace(/^BRANCH-/, "") : "";
            const startLabel = s.start?.time ? format(new Date(s.start.time), "h:mma") : "—";
            const endLabel = s.end?.time ? format(new Date(s.end.time), "h:mma") : "—";
            const compactTip = [
              `${startLabel}–${endLabel}`,
              s.minutes != null ? formatDurationMinutes(s.minutes) : null,
              branchShort ? `Branch ${branchShort}` : null,
              lateness?.isLate && lateness.deltaMinutes != null
                ? `Late ${formatDurationMinutes(lateness.deltaMinutes, { signed: true })}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <HoverCard key={idx} openDelay={220} closeDelay={120}>
                <HoverCardTrigger asChild>
                  <div
                    className={cn(
                      "absolute inset-x-2 rounded-sm shadow-sm ring-1 ring-foreground/10",
                      color
                    )}
                    style={{
                      top: `${topPct}%`,
                      height: `${heightPct}%`,
                      opacity: adherence,
                    }}
                  >
                    {/* Compact in-block info when there's room */}
                    {!props.dense && heightPct >= 12 ? (
                      <div className="pointer-events-none absolute inset-0 px-2 pt-1.5 text-white/95">
                        <div className="absolute left-2 top-1.5 text-[11px] font-semibold leading-tight">
                          {startLabel}
                        </div>
                        {heightPct >= 18 ? (
                          <div className="absolute right-2 top-1.5 text-[10px] font-medium text-white/85">
                            {formatDurationMinutes(s.minutes)}
                          </div>
                        ) : null}
                        {heightPct >= 22 && lateness?.isLate && lateness.deltaMinutes != null ? (
                          <div className="absolute right-2 bottom-1.5 text-[10px] font-medium text-white/85">
                            {formatDurationMinutes(lateness.deltaMinutes, { signed: true })}
                          </div>
                        ) : null}
                        {heightPct >= 24 ? (
                          <div className="absolute left-2 right-2 top-[22px] truncate text-[10px] font-medium text-white/85">
                            {branchShort ? `Branch ${branchShort}` : "Branch —"}
                          </div>
                        ) : null}
                        <div className="absolute bottom-1.5 left-2 text-[11px] font-semibold leading-tight">
                          {endLabel}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </HoverCardTrigger>
                <HoverCardContent className="w-auto max-w-[320px] p-2">
                  <div className="text-xs">{compactTip || "Segment"}</div>
                </HoverCardContent>
              </HoverCard>
            );
          })
        )}

        {/* Intentionally no punch markers here (blocks + gaps only). */}
      </div>
    </div>
  );
}

/** First–last time label; only when there are at least two punches and they differ. */
function formatDayCheckinTimeRange(day?: Day): string | null {
  const checkins = day?.checkins ?? [];
  if (checkins.length < 2 || !day?.first_in || !day?.last_out) return null;

  const first = parseDateTimeLocal(day.first_in);
  const last = parseDateTimeLocal(day.last_out);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())) return null;
  if (first.getTime() === last.getTime()) return null;

  return `${format(first, "h:mm a")} – ${format(last, "h:mm a")}`;
}

function formatBranchLabel(branch: string | null | undefined) {
  if (!branch) return null;
  return branch.replace(/^BRANCH-/i, "");
}

function formatCheckinTime(value: string | null | undefined) {
  if (!value) return "—";
  return format(parseDateTimeLocal(value), "h:mm a");
}

function SegmentInspectorRow(props: { segment: Segment }) {
  const { segment } = props;
  const branch = formatBranchLabel(segment.branch);
  const startType = "IN";
  const endType = "OUT";

  return (
    <div className="flex gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 shadow-xs">
      <div className="mt-0.5 flex w-8 shrink-0 flex-col items-center gap-1">
        <div className="h-full min-h-10 w-1 rounded-full bg-emerald-600" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold tracking-tight">
              <span>{formatCheckinTime(segment.start?.time ?? null)}</span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{formatCheckinTime(segment.end?.time ?? null)}</span>
            </div>
          </div>
          <Badge variant="secondary" className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold">
            {formatDurationMinutes(segment.minutes)}
          </Badge>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px] font-semibold">
              {startType}
            </Badge>
            <ArrowRightIcon className="size-3 text-muted-foreground" aria-hidden="true" />
            <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px] font-semibold">
              {endType}
            </Badge>
          </div>
          {branch ? (
            <span className="shrink-0 text-right text-xs text-muted-foreground">{branch}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AwayInspectorRow(props: { gap: AwayGap }) {
  const { gap } = props;

  return (
    <div className="flex gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-3 shadow-xs">
      <div className="mt-0.5 flex w-8 shrink-0 flex-col items-center gap-1">
        <div className="h-full min-h-10 w-1 rounded-full bg-destructive/60" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold tracking-tight text-destructive">
              <span>{formatCheckinTime(gap.start?.time ?? null)}</span>
              <ArrowRightIcon className="size-3.5 text-destructive/70" aria-hidden="true" />
              <span>{formatCheckinTime(gap.end?.time ?? null)}</span>
            </div>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 rounded-md border-destructive/30 bg-background/80 px-2 py-0.5 text-[11px] font-semibold text-destructive"
          >
            {formatDurationMinutes(gap.minutes)}
          </Badge>
        </div>
        <div className="flex items-end justify-between gap-3">
          <Badge
            variant="outline"
            className="h-5 rounded-md border-destructive/30 bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive"
          >
            Away
          </Badge>
          <span className="shrink-0 text-right text-xs text-muted-foreground">Unaccounted time</span>
        </div>
      </div>
    </div>
  );
}

function PunchInspectorRow(props: { checkin: Checkin; index: number; direction: "IN" | "OUT" }) {
  const { checkin, index, direction } = props;
  const isIn = direction === "IN";
  const branch = formatBranchLabel(checkin.custom_device_branch);
  const Icon = isIn ? LogInIcon : LogOutIcon;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-3 py-3 shadow-xs">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
          isIn
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200"
        )}
        aria-label={direction}
      >
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold tracking-tight">{formatCheckinTime(checkin.time)}</div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">#{index}</span>
          {branch ? (
            <span className="shrink-0 text-right text-xs text-muted-foreground">{branch}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FlagBadge({ flag }: { flag: Flag }) {
  const sev = flag.severity ?? "WARNING";
  const provisional = flag.is_provisional === true || flag.day_closed === 0;

  if (provisional) {
    return (
      <Badge
        variant="outline"
        className="rounded-full border border-dashed border-amber-500/70 bg-amber-500/10 text-[11px] text-amber-950 dark:text-amber-100"
        title="Provisional (intraday)"
      >
        {flag.flag_code}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full border text-[11px]",
        sev === "CRITICAL" &&
          "border-destructive bg-destructive text-destructive-foreground",
        sev === "WARNING" &&
          "border-amber-600 bg-amber-500/20 text-amber-950 dark:text-amber-100",
        sev === "INFO" && "border-border bg-foreground/5 text-foreground"
      )}
      title={`Final · ${flag.status ?? "OPEN"}`}
    >
      {flag.flag_code}
    </Badge>
  );
}

function LegendPill({ severity }: { severity: Severity }) {
  const sample: Flag = { name: severity, flag_code: severity, severity };
  return (
    <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-2 py-1">
      <FlagBadge flag={sample} />
      <div className="text-xs text-muted-foreground">severity</div>
    </div>
  );
}

function buildSegmentInspectorItems(segments: Segment[], checkins: Checkin[]): SegmentInspectorItem[] {
  if (!segments.length && !checkins.length) return [];

  const sorted = [...segments].sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
  const unpaired = deriveUnpairedPunches(checkins, parseDateTimeLocal);
  const timelineGaps = deriveTimelineGaps(sorted, unpaired, minutesFromDateTime);
  const items: SegmentInspectorItem[] = [];

  type Entry =
    | { kind: "segment"; segment: Segment; orderMin: number }
    | { kind: "away"; gap: AwayGap; orderMin: number };

  const entries: Entry[] = [];

  for (const segment of sorted) {
    entries.push({ kind: "segment", segment, orderMin: segment.startMin ?? 0 });
  }

  for (const gap of timelineGaps) {
    entries.push({
      kind: "away",
      orderMin: gap.startMin,
      gap: {
        start: checkinAtMinuteOfDay(checkins, gap.startMin),
        end: checkinAtMinuteOfDay(checkins, gap.endMin),
        minutes: gap.minutes,
        startMin: gap.startMin,
        endMin: gap.endMin,
      },
    });
  }

  entries.sort((a, b) => a.orderMin - b.orderMin);

  for (const entry of entries) {
    if (entry.kind === "segment") items.push({ kind: "segment", segment: entry.segment });
    else items.push({ kind: "away", gap: entry.gap });
  }

  return items;
}

function employeeDisplayName(employee: CalendarEmployee | null | undefined, fallbackId?: string | null) {
  if (!employee) return fallbackId ?? "Select employee";
  const parts = employee.label.split("·");
  return (parts[1] ?? parts[0] ?? employee.id).trim();
}

function employeeInitials(employee: CalendarEmployee | null | undefined, fallbackId?: string | null) {
  const name = employeeDisplayName(employee, fallbackId);
  return (
    name
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

function EmployeePicker(props: {
  employees: CalendarEmployee[];
  value: string | null;
  onChange: (v: string) => void;
  isLoading?: boolean;
}) {
  const selected = props.employees.find((e) => e.id === props.value) ?? props.employees[0] ?? null;
  const [open, setOpen] = useState(false);
  const displayName = employeeDisplayName(selected, props.value);
  const subtitle = [selected?.title, selected?.department].filter(Boolean).join(" · ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!props.employees.length || props.isLoading}
          className={cn(
            "group flex min-w-0 max-w-full items-center gap-3 rounded-xl border border-transparent px-1 py-1 text-left transition-colors",
            "hover:border-border/60 hover:bg-muted/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40",
            (!props.employees.length || props.isLoading) && "pointer-events-none opacity-80"
          )}
        >
          <div
            className={cn(
              "relative size-11 shrink-0 overflow-hidden rounded-full border border-border/60 bg-muted/20",
              props.isLoading && "ring-2 ring-primary/20 ring-offset-2 ring-offset-background"
            )}
          >
            {selected?.image ? (
              <img
                src={selected.image}
                alt={displayName}
                className={cn("h-full w-full object-cover transition-opacity", props.isLoading && "opacity-70")}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-muted-foreground">
                {employeeInitials(selected, props.value)}
              </div>
            )}
            {props.isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background/35">
                <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-tight">{displayName}</span>
              {selected ? (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{selected.id}</span>
              ) : null}
              {props.isLoading ? (
                <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronsUpDownIcon
                  className="size-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </div>
            {subtitle ? (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-2">
        <Command>
          <CommandInput placeholder="Search employee…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Employees">
              {props.employees.map((e) => (
                <CommandItem
                  key={e.id}
                  data-checked={e.id === props.value}
                  onSelect={() => {
                    props.onChange(e.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{employeeDisplayName(e)}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">{e.id}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DateJump(props: { anchor: Date; onSelectDate: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarIcon className="mr-1 size-4" />
          {format(props.anchor, "MMM d, yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={props.anchor}
          onSelect={(d) => {
            if (!d) return;
            props.onSelectDate(d);
            setOpen(false);
          }}
          weekStartsOn={1}
        />
      </PopoverContent>
    </Popover>
  );
}

function formatDurationMinutes(
  totalMinutes: number | null | undefined,
  options?: { signed?: boolean }
): string {
  if (totalMinutes == null || !Number.isFinite(totalMinutes)) return "—";

  const rounded = Math.round(Math.abs(totalMinutes));
  const days = Math.floor(rounded / (24 * 60));
  let remainder = rounded % (24 * 60);
  const hours = Math.floor(remainder / 60);
  const minutes = remainder % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  const body = parts.join(" ");
  if (!options?.signed) return body;
  if (totalMinutes > 0) return `+${body}`;
  if (totalMinutes < 0) return `-${body}`;
  return body;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function minutesSinceMidnight(d: Date) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return NaN;
  return d.getHours() * 60 + d.getMinutes();
}

function parseDateTimeLocal(value: string) {
  // Accept "YYYY-MM-DD HH:mm:ss" by normalizing to ISO-ish local time.
  const v = String(value || "").trim();
  if (!v) return new Date(NaN);
  const isoish = v.includes("T") ? v : v.replace(" ", "T");
  return new Date(isoish);
}

function deriveSegments(checkins: Checkin[]): Segment[] {
  return deriveSegmentsFromCheckins(checkins, {
    parseTime: parseDateTimeLocal,
    minutesFromDateTime,
    clamp,
  });
}

function sortCheckinsByTime(checkins: Checkin[]): Checkin[] {
  return sortCheckinsByTimeLib(checkins, parseDateTimeLocal);
}

function minutesFromDateTime(value: string | null | undefined) {
  if (!value) return null;
  const d = parseDateTimeLocal(value);
  const m = minutesSinceMidnight(d);
  return Number.isFinite(m) ? m : null;
}

/** Real punch at this minute, or a display-only stub using the day's date from checkins. */
function checkinAtMinuteOfDay(checkins: Checkin[], min: number): Checkin {
  const match = checkins.find((c) => minutesFromDateTime(c.time) === min);
  if (match) return match;

  const ref = checkins.find((c) => c.time)?.time;
  const base = ref ? parseDateTimeLocal(ref) : new Date();
  const d = new Date(base);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return { time: format(d, "yyyy-MM-dd HH:mm:ss") } as Checkin;
}

function computeDaySpan(firstIn: string | null, lastOut: string | null) {
  if (!firstIn || !lastOut) return null;
  const a = parseDateTimeLocal(firstIn);
  const b = parseDateTimeLocal(lastOut);
  const aMin = minutesSinceMidnight(a);
  const bMin = minutesSinceMidnight(b);
  if (!Number.isFinite(aMin) || !Number.isFinite(bMin) || bMin < aMin) return null;
  const topPct = clamp((aMin / (24 * 60)) * 100, 0, 100);
  const bottomPct = clamp((bMin / (24 * 60)) * 100, 0, 100);
  const heightPct = Math.max(2, bottomPct - topPct);
  return { topPct, heightPct };
}

function parseTimeToMinutes(time: string | undefined | null) {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function computeExpectedWindowPct(shift: ShiftContext) {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.start_time);
  const endMin = parseTimeToMinutes(shift.end_time);
  if (startMin == null || endMin == null) return null;
  if (endMin < startMin) return null;
  const topPct = clamp((startMin / (24 * 60)) * 100, 0, 100);
  const bottomPct = clamp((endMin / (24 * 60)) * 100, 0, 100);
  const heightPct = Math.max(2, bottomPct - topPct);
  return { topPct, heightPct, startMin, endMin };
}

function computeLunchWindowPct(shift: ShiftContext) {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.lunch_start ?? null);
  const endMin = parseTimeToMinutes(shift.lunch_end ?? null);
  if (startMin == null || endMin == null) return null;
  if (endMin < startMin) return null;
  const topPct = clamp((startMin / (24 * 60)) * 100, 0, 100);
  const bottomPct = clamp((endMin / (24 * 60)) * 100, 0, 100);
  const heightPct = Math.max(2, bottomPct - topPct);
  return { topPct, heightPct, startMin, endMin };
}

function computeLateness(shift: ShiftContext, firstIn: string | null) {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  if (startMin == null) return null;
  const grace = Number.isFinite(shift.grace_minutes) ? Number(shift.grace_minutes) : 0;
  const thresholdMin = startMin + grace;
  const thresholdPct = clamp((thresholdMin / (24 * 60)) * 100, 0, 100);

  if (!firstIn) return { thresholdPct, isLate: false, deltaMinutes: null };
  const fiMin = minutesFromDateTime(firstIn) ?? NaN;
  const deltaMinutes = fiMin - thresholdMin;
  return {
    thresholdPct,
    isLate: deltaMinutes > 0,
    deltaMinutes: deltaMinutes > 0 ? deltaMinutes : 0,
  };
}

function computeAdherenceOpacity(shift: ShiftContext, grossMinutes: number | null) {
  const expected = computeExpectedMinutes(shift);
  if (expected == null || expected <= 0) return 1;
  if (grossMinutes == null) return 0.55;
  const ratio = grossMinutes / expected;
  // Subtle only: keep within a tight band.
  return clamp(0.55 + clamp(ratio, 0, 1.1) * 0.35, 0.55, 0.92);
}

function computeExpectedMinutes(shift: ShiftContext) {
  if (!shift?.shift_assigned) return null;
  const startMin = parseTimeToMinutes(shift.start_time ?? null);
  const endMin = parseTimeToMinutes(shift.end_time ?? null);
  if (startMin == null || endMin == null) return null;
  if (endMin < startMin) return null;
  return endMin - startMin;
}

