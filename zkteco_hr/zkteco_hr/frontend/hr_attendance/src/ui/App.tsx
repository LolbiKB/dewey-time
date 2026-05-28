import {
  useCalendarEmployees,
  useDefaultEmployee,
  useEmployeeCalendar,
} from "@/hooks/useHrAttendanceData";
import type { CalendarEmployee, CalendarPayload, Day, Flag, ShiftContext } from "@/types/calendar";
import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfWeek,
} from "date-fns";
import { useFrappeAuth } from "frappe-react-sdk";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterIcon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type Severity = "INFO" | "WARNING" | "CRITICAL";
type FlagStatus = "OPEN" | "EXPLAINED" | "APPROVED" | "REJECTED" | "CLOSED";
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

const SEVERITY_ORDER: Severity[] = ["CRITICAL", "WARNING", "INFO"];

export function App() {
  const view: "week" = "week";
  const { currentUser, isLoading: authLoading } = useFrappeAuth();
  const [employee, setEmployee] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Date>(() => new Date());

  const { employees, error: employeesError, isLoading: employeesLoading } = useCalendarEmployees();
  useDefaultEmployee(employees, employee, setEmployee);

  const {
    payload: apiPayload,
    monthStart,
    monthEnd,
    error: calendarError,
    isLoading: calendarLoading,
  } = useEmployeeCalendar(employee, anchor);

  const payload: CalendarPayload =
    apiPayload ??
    ({
      employee: employee ?? "",
      start_date: format(monthStart, "yyyy-MM-dd"),
      end_date: format(monthEnd, "yyyy-MM-dd"),
      days: [],
    } as CalendarPayload);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employee) ?? null,
    [employee, employees]
  );

  const [statusFilter, setStatusFilter] = useState<Set<FlagStatus>>(
    () => new Set<FlagStatus>(["OPEN", "EXPLAINED"])
  );
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(
    () => new Set<Severity>(["CRITICAL", "WARNING", "INFO"])
  );

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
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const scheduleStart = useMemo(() => monthStart, [monthStart]);
  const minWeekStart = startOfWeek(scheduleStart, { weekStartsOn: 1 });
  const maxWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // don't navigate beyond present week
  const title = `Week of ${format(weekStart, "MMM d, yyyy")}`;

  const canGoPrev = weekStart > minWeekStart;
  const canGoNext = weekStart < maxWeekStart;

  function goPrev() {
    if (!canGoPrev) return;
    setAnchor((d) => addDays(d, -7));
  }
  function goNext() {
    if (!canGoNext) return;
    setAnchor((d) => addDays(d, 7));
  }
  function goToday() {
    const today = new Date();
    const clamped = today < scheduleStart ? scheduleStart : today;
    setAnchor(clamped);
  }

  function toggleSetItem<T extends string>(set: Set<T>, v: T) {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  }

  const inspectingDay = inspectingDate ? daysByDate.get(inspectingDate) : undefined;
  const segments = useMemo(
    () => deriveSegments(inspectingDay?.checkins ?? []),
    [inspectingDay?.checkins]
  );

  const isLoading = authLoading || employeesLoading || calendarLoading;
  const loadError = employeesError ?? calendarError;

  if (authLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background text-sm text-muted-foreground">
        Loading session…
      </div>
    );
  }

  if (!currentUser || currentUser === "Guest") {
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
              <a href="/login?redirect-to=/hr-attendance">Log in</a>
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
            <Card className="mb-3 border-destructive/40 bg-destructive/5">
              <CardContent className="py-3 text-sm text-destructive">
                Could not load attendance data. Confirm you have HR User access and try again.
              </CardContent>
            </Card>
          ) : null}
          {isLoading ? (
            <div className="mb-3 text-sm text-muted-foreground">Loading attendance…</div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Card className="border-border/60">
              <CardContent className="py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative size-11 shrink-0 overflow-hidden rounded-full border border-border/60 bg-muted/20">
                      {selectedEmployee?.image ? (
                        <img
                          src={selectedEmployee.image}
                          alt={selectedEmployee.label}
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-muted-foreground">
                          {(selectedEmployee?.label.split("·")[1] ?? selectedEmployee?.id ?? employee ?? "?")
                            .trim()
                            .split(" ")
                            .slice(0, 2)
                            .map((p) => p[0])
                            .join("")
                            .toUpperCase()}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold tracking-tight">
                          {(selectedEmployee?.label.split("·")[1] ?? selectedEmployee?.id ?? employee ?? "Employee")
                            .trim()}
                        </div>
                        {selectedEmployee ? (
                          <Badge variant="secondary" className="h-6 rounded-full px-2 text-[11px]">
                            {selectedEmployee.id}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{title}</span>
                        {selectedEmployee?.title ? <span>{selectedEmployee.title}</span> : null}
                        {selectedEmployee?.department ? <span>· {selectedEmployee.department}</span> : null}
                        {selectedEmployee?.company ? <span>· {selectedEmployee.company}</span> : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <EmployeePicker employees={employees} value={employee} onChange={setEmployee} />
                    <DateJump anchor={anchor} onSelectDate={setAnchor} />

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          <FilterIcon className="mr-1 size-4" />
                          Filters
                          {(statusFilter.size !== 2 || severityFilter.size !== 3) && (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              active
                            </span>
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuLabel>Status</DropdownMenuLabel>
                        {(["OPEN", "EXPLAINED", "APPROVED", "REJECTED", "CLOSED"] as const).map((s) => (
                          <DropdownMenuCheckboxItem
                            key={s}
                            checked={statusFilter.has(s)}
                            onCheckedChange={() => setStatusFilter((cur) => toggleSetItem(cur, s))}
                          >
                            {s}
                          </DropdownMenuCheckboxItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Severity</DropdownMenuLabel>
                        {(["CRITICAL", "WARNING", "INFO"] as const).map((s) => (
                          <DropdownMenuCheckboxItem
                            key={s}
                            checked={severityFilter.has(s)}
                            onCheckedChange={() => setSeverityFilter((cur) => toggleSetItem(cur, s))}
                          >
                            {s}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Separator orientation="vertical" className="hidden h-7 md:block" />

                    <Button variant="outline" size="sm" onClick={goToday}>
                      Today
                    </Button>
                    <Button variant="outline" size="sm" onClick={goPrev} disabled={!canGoPrev}>
                      <ChevronLeftIcon className="mr-1 size-4" /> Prev
                    </Button>
                    <Button variant="outline" size="sm" onClick={goNext} disabled={!canGoNext}>
                      Next <ChevronRightIcon className="ml-1 size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="min-h-0 flex-1">
              <WeekView
                weekDates={weekDates}
                anchor={anchor}
                daysByDate={daysByDate}
                statusFilter={statusFilter}
                severityFilter={severityFilter}
                onInspectDay={(date) => {
                  setInspectingDate(date);
                  setInspectingFlag(null);
                }}
                onInspectFlag={(date, flag) => {
                  setInspectingDate(date);
                  setInspectingFlag(flag);
                }}
              />
            </div>
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
                const punches = inspectingDay?.checkins ?? [];
                const flags = (inspectingDay?.flags ?? [])
                  .filter((f) => statusFilter.has(f.status ?? "OPEN"))
                  .filter((f) => severityFilter.has((f.severity ?? "WARNING") as Severity))
                  .sort((a, b) => {
                    const aIdx = SEVERITY_ORDER.indexOf((a.severity ?? "WARNING") as Severity);
                    const bIdx = SEVERITY_ORDER.indexOf((b.severity ?? "WARNING") as Severity);
                    if (aIdx !== bIdx) return aIdx - bIdx;
                    return (a.flag_code ?? "").localeCompare(b.flag_code ?? "");
                  });

                return (
                  <Tabs defaultValue="timeline" className="min-h-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Day summary</div>
                        <div className="mt-1 font-mono text-[12px] leading-relaxed text-muted-foreground">
                          <span className="text-foreground/85">{inspectingDay?.first_in ?? "—"}</span>{" "}
                          <span className="text-muted-foreground">→</span>{" "}
                          <span className="text-foreground/85">{inspectingDay?.last_out ?? "—"}</span>
                        </div>
                      </div>
                      <div className="w-28">
                        <DaySpanTrack
                          firstIn={inspectingDay?.first_in ?? null}
                          lastOut={inspectingDay?.last_out ?? null}
                          worst={worstSeverity(inspectingDay?.flags ?? [])}
                        />
                      </div>
                    </div>

                    <TabsList className="mt-3 grid w-full grid-cols-3">
                      <TabsTrigger value="timeline" className="gap-2">
                        Timeline
                        <Badge variant="secondary" className="h-5 rounded-full px-2 text-[11px]">
                          {segments.length}
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
                          {flags.length}
                        </Badge>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="timeline" className="mt-3 min-h-0">
                      <Card className="border-border/60">
                        <CardContent className="pt-4">
                          <div className="grid grid-cols-[1fr_auto] gap-3">
                            <div className="min-w-0">
                              <div className="text-xs text-muted-foreground">Segments</div>
                              {segments.length === 0 ? (
                                <div className="mt-2 rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                                  No segments (missing pairs or no data).
                                </div>
                              ) : (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {segments.slice(0, 8).map((s, idx) => (
                                    <Tooltip key={idx}>
                                      <TooltipTrigger asChild>
                                        <span className="inline-flex">
                                          <Badge variant="outline" className="rounded-full bg-muted/20">
                                            {s.start?.time ? format(parseDateTimeLocal(s.start.time), "h:mm a") : "—"}–
                                            {s.end?.time ? format(parseDateTimeLocal(s.end.time), "h:mm a") : "—"}
                                          </Badge>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <div className="text-xs">
                                          <div className="font-medium">{s.minutes != null ? `${s.minutes} min` : "—"}</div>
                                          <div className="text-muted-foreground">
                                            {s.branch ? `Branch: ${s.branch}` : "Branch: —"}
                                          </div>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="w-10">
                              <DayStackTrack checkins={punches} worst={worstSeverity(inspectingDay?.flags ?? [])} />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="punches" className="mt-3 min-h-0">
                      <Card className="border-border/60">
                        <CardContent className="pt-4">
                          <div className="text-xs text-muted-foreground">Punches</div>
                          {punches.length === 0 ? (
                            <div className="mt-2 rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center">
                              <div className="text-sm font-medium">No punches</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                There are no checkins recorded for this day.
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {punches.map((c, idx) => (
                                <Badge
                                  key={(c as any).custom_supabase_log_id ?? `${c.time}-${idx}`}
                                  variant="secondary"
                                  className="rounded-full"
                                >
                                  {format(parseDateTimeLocal(c.time), "h:mm a")}
                                  {c.log_type ? ` ${c.log_type}` : ""}
                                </Badge>
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
                          {flags.length === 0 ? (
                            <div className="mt-3 rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6 text-center">
                              <div className="text-sm font-medium">No flags</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Nothing to review for the current filters.
                              </div>
                            </div>
                          ) : (
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
                          )}

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

function WeekView(props: {
  weekDates: Date[];
  anchor: Date;
  daysByDate: Map<string, Day>;
  statusFilter: Set<FlagStatus>;
  severityFilter: Set<Severity>;
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
  const canvasHeightRatio = weekSpanMinutes / (visibleHours * 60); // 1.0 = exactly 10h
  const canvasHeightPct = canvasHeightRatio * 100;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Snap scroll to the top of the week window when the week changes.
    el.scrollTop = 0;
  }, [weekWindow.startMin, weekWindow.endMin]);
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] rounded-2xl border border-border/60 bg-card">
      <div className="grid grid-cols-7 border-b border-border/60">
        {props.weekDates.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const info = props.daysByDate.get(key);
          const isToday = isSameDay(d, new Date());
          const hasPair = !!(info?.first_in && info?.last_out);
          const counts = countFlagsBySeverity(info?.flags ?? []);
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
                {hasPair ? (
                  <span>
                    {format(parseDateTimeLocal(info!.first_in as string), "h:mm a")} –{" "}
                    {format(parseDateTimeLocal(info!.last_out as string), "h:mm a")}
                  </span>
                ) : null}
              </div>

              <div className="mt-1 flex items-center gap-1.5">
                {counts.CRITICAL > 0 ? (
                  <span
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground"
                    title={`${counts.CRITICAL} critical flags`}
                  >
                    {counts.CRITICAL}
                  </span>
                ) : null}
                {counts.WARNING > 0 ? (
                  <span
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white"
                    title={`${counts.WARNING} warning flags`}
                  >
                    {counts.WARNING}
                  </span>
                ) : null}
                {counts.INFO > 0 ? (
                  <span
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/30 px-1 text-[10px] font-semibold text-foreground"
                    title={`${counts.INFO} info flags`}
                  >
                    {counts.INFO}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 h-full max-h-full overflow-y-auto overscroll-contain"
      >
        <div
          className="grid grid-cols-7"
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
                statusFilter={props.statusFilter}
                severityFilter={props.severityFilter}
                windowStartMin={weekWindow.startMin}
                windowEndMin={weekWindow.endMin}
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
  statusFilter: Set<FlagStatus>;
  severityFilter: Set<Severity>;
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
              statusFilter={props.statusFilter}
              severityFilter={props.severityFilter}
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
  statusFilter: Set<FlagStatus>;
  severityFilter: Set<Severity>;
  windowStartMin?: number;
  windowEndMin?: number;
  onInspectDay: () => void;
  onInspectFlag: (flag: Flag) => void;
}) {
  const worst = worstSeverity(props.info?.flags ?? []);
  const flags = (props.info?.flags ?? [])
    .filter((f) => props.statusFilter.has(f.status ?? "OPEN"))
    .filter((f) => props.severityFilter.has((f.severity ?? "WARNING") as Severity));
  const sortedFlags = [...flags].sort((a, b) => {
    const aIdx = SEVERITY_ORDER.indexOf((a.severity ?? "WARNING") as Severity);
    const bIdx = SEVERITY_ORDER.indexOf((b.severity ?? "WARNING") as Severity);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (a.flag_code ?? "").localeCompare(b.flag_code ?? "");
  });

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
      <div className={cn("grid h-full gap-2", props.dense ? "grid-rows-[20px_1fr_16px]" : "grid-rows-[1fr_16px]")}>
        {props.dense ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-4 w-1 rounded-full",
                  worst === "CRITICAL"
                    ? "bg-destructive"
                    : worst === "WARNING"
                      ? "bg-amber-500"
                      : worst === "INFO"
                        ? "bg-foreground/30"
                        : "bg-muted/40"
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

        <div className="min-h-0">
          <DayDayTrack
            firstIn={props.info?.first_in ?? null}
            lastOut={props.info?.last_out ?? null}
            checkins={props.info?.checkins ?? []}
            worst={worst}
            flags={props.info?.flags ?? []}
            shift={props.info?.shift ?? { shift_assigned: false }}
            grossMinutes={props.info?.gross_minutes ?? null}
            dense={props.dense}
            windowStartMin={props.windowStartMin}
            windowEndMin={props.windowEndMin}
          />
        </div>

        {/* Indicators anchored at bottom (week + month) */}
        <div className="min-h-0 overflow-hidden">
          <DayIndicators
            flags={sortedFlags}
            dense={props.dense}
            onClickFlag={(f) => props.onInspectFlag(f)}
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
  worst: Severity | null;
  flags: Flag[];
  shift: ShiftContext;
  grossMinutes: number | null;
  dense: boolean;
  windowStartMin?: number;
  windowEndMin?: number;
}) {
  const color =
    props.worst === "CRITICAL"
      ? "bg-destructive"
      : props.worst === "WARNING"
        ? "bg-amber-500"
        : props.worst === "INFO"
          ? "bg-foreground/30"
          : "bg-emerald-600";

  const span = computeDaySpan(props.firstIn, props.lastOut);
  const segments = deriveSegments(props.checkins);
  const gaps = deriveGaps(segments);
  const expected = computeExpectedWindowPct(props.shift);
  const lunch = computeLunchWindowPct(props.shift);
  const hasMissingLunch = (props.flags ?? []).some((f) => f.flag_code === "MISSING_LUNCH");
  const hasLateFromLunch = (props.flags ?? []).some((f) => f.flag_code === "LATE_FROM_LUNCH");
  const lateness = computeLateness(props.shift, props.firstIn);
  const adherence = computeAdherenceOpacity(props.shift, props.grossMinutes);
  const outline = severityOutlineClass(props.worst);
  const unnotifiedAbsenceFlag = (props.flags ?? []).find((f) => f.flag_code === "UNNOTIFIED_ABSENCE") ?? null;
  const absenceStartMin = parseTimeToMinutes(props.shift.start_time ?? null);
  const firstInMin = minutesFromDateTime(props.firstIn);
  const shouldShowUnnotifiedAbsence =
    !!unnotifiedAbsenceFlag &&
    props.shift.shift_assigned &&
    ((props.checkins ?? []).length === 0 ||
      (absenceStartMin != null && firstInMin != null && firstInMin > absenceStartMin + 120));
  const absenceKind = !shouldShowUnnotifiedAbsence
    ? null
    : (props.checkins ?? []).length === 0
      ? ("FULL_DAY" as const)
      : ("PARTIAL_DAY" as const);
  const roguePunches = useMemo(() => {
    const checkins = props.checkins ?? [];
    if (checkins.length === 0) return [] as Checkin[];
    const sorted = [...checkins].sort(
      (a, b) => parseDateTimeLocal(a.time).getTime() - parseDateTimeLocal(b.time).getTime()
    );
    // If checkins are odd, the last one is unpaired (common real-world rogue case).
    if (sorted.length % 2 === 1) return [sorted[sorted.length - 1]];
    return [] as Checkin[];
  }, [props.checkins]);

  const window = useMemo(() => {
    if (props.dense) return null;
    const startMin = props.windowStartMin ?? 0;
    const endMin = props.windowEndMin ?? 24 * 60;
    if (endMin <= startMin) return null;
    return { startMin, endMin, span: endMin - startMin };
  }, [props.dense, props.windowEndMin, props.windowStartMin]);

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

        {/* UNNOTIFIED_ABSENCE (clean but unmistakable) */}
        {shouldShowUnnotifiedAbsence ? (
          <>
            <div
              className="pointer-events-none absolute inset-0 rounded-xl bg-destructive/6"
              aria-hidden="true"
            />
            <div className="pointer-events-none absolute left-2 top-2 z-10" aria-hidden="true">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-destructive/25 bg-background/70 px-2 py-1 text-[11px] font-semibold text-destructive backdrop-blur">
                <span className="uppercase tracking-wide">Absent</span>
                <span className="text-destructive/70">
                  {absenceKind === "FULL_DAY" ? "Full day" : "Partial"}
                </span>
              </div>
            </div>
          </>
        ) : null}

        {/* Unpaired punch marker(s): single red vertical tick at punch time */}
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
          >
            {hasMissingLunch || hasLateFromLunch ? (
              <div
                className={cn(
                  "absolute inset-x-0 top-0 h-0.5 rounded-t-md",
                  hasMissingLunch ? "bg-destructive" : "bg-amber-500"
                )}
                aria-hidden="true"
              />
            ) : null}
          </div>
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
          const topPct = g.startMin != null ? pctFromMinute(g.startMin) : g.topPct;
          const endPct = g.endMin != null ? pctFromMinute(g.endMin) : g.topPct + g.heightPct;
          const heightPct = Math.max(0.5, endPct - topPct);
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
                <div className="text-xs">Away{g.minutes != null ? ` · ${g.minutes}m` : ""}</div>
              </HoverCardContent>
            </HoverCard>
          );
        })}

        {/* Rectangular segments (primary) */}
        {segments.length === 0 ? null : (
          segments.slice(0, props.dense ? 3 : 6).map((s, idx) => {
            const topPct = s.startMin != null ? pctFromMinute(s.startMin) : (s.startPct ?? null);
            const endPct = s.endMin != null ? pctFromMinute(s.endMin) : (s.endPct ?? null);
            if (topPct == null || endPct == null) return null;
            const heightPct = Math.max(1.5, endPct - topPct);
            const branch = s.branch ?? null;
            const branchShort = branch ? branch.replace(/^BRANCH-/, "") : "";
            const startLabel = s.start?.time ? format(new Date(s.start.time), "h:mma") : "—";
            const endLabel = s.end?.time ? format(new Date(s.end.time), "h:mma") : "—";
            const compactTip = [
              `${startLabel}–${endLabel}`,
              s.minutes != null ? `${s.minutes}m` : null,
              branchShort ? `Branch ${branchShort}` : null,
              lateness?.isLate && lateness.deltaMinutes != null ? `Late +${lateness.deltaMinutes}m` : null,
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
                            {s.minutes != null ? `${s.minutes}m` : "—"}
                          </div>
                        ) : null}
                        {heightPct >= 22 && lateness?.isLate && lateness.deltaMinutes != null ? (
                          <div className="absolute right-2 bottom-1.5 text-[10px] font-medium text-white/85">
                            +{lateness.deltaMinutes}m
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

function DaySpanTrack(props: { firstIn: string | null; lastOut: string | null; worst: Severity | null }) {
  const span = computeDaySpan(props.firstIn, props.lastOut);
  const color =
    props.worst === "CRITICAL"
      ? "bg-destructive"
      : props.worst === "WARNING"
        ? "bg-amber-500"
        : props.worst === "INFO"
          ? "bg-foreground/30"
          : "bg-primary/40";

  return (
    <div className="relative h-10 w-full rounded-xl bg-muted/25">
      {span ? (
        <div
          className={cn("absolute inset-y-2 rounded-lg", color)}
          style={{
            left: `${span.topPct}%`,
            right: `${100 - (span.topPct + span.heightPct)}%`,
          }}
        />
      ) : (
        <div className="absolute inset-2 rounded-lg border border-dashed border-border/60" />
      )}
    </div>
  );
}

function DayStackTrack(props: { checkins: Checkin[]; worst: Severity | null }) {
  const rail =
    props.worst === "CRITICAL"
      ? "bg-destructive/20"
      : props.worst === "WARNING"
        ? "bg-amber-500/15"
        : "bg-muted/25";

  return (
    <div className={cn("relative h-24 w-full rounded-xl", rail)}>
      <div
        className="absolute inset-y-2 w-px bg-border/60"
        style={{ left: "calc(50% - 0.5px)" }}
      />
    </div>
  );
}

function FlagBadge({ flag }: { flag: Flag }) {
  const sev = flag.severity ?? "WARNING";
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full border-transparent",
        sev === "CRITICAL" && "bg-destructive text-destructive-foreground",
        sev === "WARNING" && "bg-amber-500/15 text-amber-900 dark:text-amber-200",
        sev === "INFO" && "bg-foreground/5 text-foreground"
      )}
      title={flag.status ?? ""}
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

function worstSeverity(flags: Flag[]): Severity | null {
  const present = new Set((flags ?? []).map((f) => (f.severity ?? "WARNING") as Severity));
  for (const s of SEVERITY_ORDER) {
    if (present.has(s)) return s;
  }
  return null;
}

function DayIndicators(props: {
  flags: Flag[];
  dense: boolean;
  onClickFlag: (f: Flag) => void;
}) {
  return null;
}

function severityOutlineClass(sev: Severity | null) {
  if (sev === "CRITICAL") return "border-destructive/60";
  if (sev === "WARNING") return "border-amber-500/50";
  if (sev === "INFO") return "border-foreground/20";
  return "border-border/70";
}

function getRoguePunchKind(flags: Flag[], shift: ShiftContext) {
  if (!shift.shift_assigned) {
    if ((flags ?? []).some((f) => f.flag_code === "OFF_SHIFT_PUNCH")) return "OFF_SHIFT" as const;
  }
  if ((flags ?? []).some((f) => f.flag_code === "UNKNOWN_DEVICE_BRANCH")) return "UNKNOWN_BRANCH" as const;
  if ((flags ?? []).some((f) => f.flag_code === "NON_PRIMARY_SITE_PUNCH")) return "NON_PRIMARY" as const;
  return null;
}

function countFlagsBySeverity(flags: Flag[]) {
  const out = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const f of flags ?? []) {
    const s = (f.severity ?? "WARNING") as Severity;
    if (s === "CRITICAL") out.CRITICAL++;
    else if (s === "WARNING") out.WARNING++;
    else out.INFO++;
  }
  return out;
}

function deriveSegments(checkins: Checkin[]): Segment[] {
  if (!checkins || checkins.length < 2) return [];
  const sorted = [...checkins].sort(
    (a, b) => parseDateTimeLocal(a.time).getTime() - parseDateTimeLocal(b.time).getTime()
  );

  const out: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i += 2) {
    const start = sorted[i] ?? null;
    const end = sorted[i + 1] ?? null;
    let minutes: number | null = null;
    if (start?.time && end?.time) {
      const delta = parseDateTimeLocal(end.time).getTime() - parseDateTimeLocal(start.time).getTime();
      if (Number.isFinite(delta) && delta >= 0) minutes = Math.round(delta / 60000);
    }
    const startMin = minutesFromDateTime(start?.time);
    const endMin = minutesFromDateTime(end?.time);
    const startPct = startMin != null ? clamp((startMin / (24 * 60)) * 100, 0, 100) : null;
    const endPct = endMin != null ? clamp((endMin / (24 * 60)) * 100, 0, 100) : null;
    const branch = start?.custom_device_branch ?? end?.custom_device_branch ?? null;
    out.push({ start, end, minutes, startMin, endMin, startPct, endPct, branch });
  }
  return out;
}

function deriveGaps(segments: Segment[]) {
  const gaps: Array<{
    startMin: number | null;
    endMin: number | null;
    topPct: number;
    heightPct: number;
    minutes: number | null;
  }> = [];
  if (!segments || segments.length < 2) return gaps;

  const sorted = [...segments].sort((a, b) => (a.startMin ?? a.startPct ?? 0) - (b.startMin ?? b.startPct ?? 0));
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const aEndPct = a.endPct ?? null;
    const bStartPct = b.startPct ?? null;
    if (aEndPct == null || bStartPct == null) continue;
    if (bStartPct <= aEndPct) continue;
    const heightPct = bStartPct - aEndPct;
    if (heightPct < 0.5) continue;

    let minutes: number | null = null;
    if (a.end?.time && b.start?.time) {
      const delta = parseDateTimeLocal(b.start.time).getTime() - parseDateTimeLocal(a.end.time).getTime();
      if (Number.isFinite(delta) && delta >= 0) minutes = Math.round(delta / 60000);
    }

    gaps.push({
      startMin: a.endMin ?? null,
      endMin: b.startMin ?? null,
      topPct: aEndPct,
      heightPct,
      minutes,
    });
  }
  return gaps;
}

function EmployeePicker(props: {
  employees: CalendarEmployee[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  const selected = props.employees.find((e) => e.id === props.value) ?? props.employees[0];
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[260px] justify-start" disabled={!props.employees.length}>
          <UserRoundIcon className="mr-1 size-4" />
          <span className="truncate">{selected?.label ?? "Select employee"}</span>
        </Button>
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
                  <span className="truncate">{e.label}</span>
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

function cn(...parts: Array<string | undefined | null | false>) {
  return parts.filter(Boolean).join(" ");
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

function minutesFromDateTime(value: string | null | undefined) {
  if (!value) return null;
  const d = parseDateTimeLocal(value);
  const m = minutesSinceMidnight(d);
  return Number.isFinite(m) ? m : null;
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

