import { addDays, format, parseISO } from "date-fns";
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCalendarEmployees,
  useDefaultEmployee,
} from "@/hooks/useHrAttendanceData";
import {
  useApplyWeeklySchedule,
  useHolidayPreview,
  useScheduleContext,
  useWeeklyScheduleResolve,
} from "@/hooks/useWeeklySchedule";
import { employeeShortName } from "@/lib/employeeCard";
import { cn } from "@/lib/utils";
import type { WeekPattern, WeekPatternDay, Weekday } from "@/types/schedule";
import {
  apply55DayTemplate,
  cloneWeekPattern,
  emptyWeekPattern,
  formatDayList,
  formatTimeInput,
  validateWeekPattern,
} from "@/types/schedule";
import { ScheduleEmployeePicker } from "@/ui/ScheduleEmployeePicker";

export function WeeklySchedulePage() {
  const { currentUser, isLoading: authLoading } = useFrappeAuth();
  const [searchParams] = useSearchParams();
  const initialEmployee = searchParams.get("employee");

  const [employee, setEmployee] = useState<string | null>(initialEmployee);
  const [weekPattern, setWeekPattern] = useState<WeekPattern>(() => emptyWeekPattern());
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [generateThrough, setGenerateThrough] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingConfirmPlan, setPendingConfirmPlan] = useState<string[]>([]);
  const [saveSuccessUrl, setSaveSuccessUrl] = useState<string | null>(null);

  const { employees, isLoading: employeesLoading } = useCalendarEmployees();
  useDefaultEmployee(employees, employee, setEmployee);

  const { context, isLoading: contextLoading, refresh: refreshContext } = useScheduleContext(employee);

  useEffect(() => {
    if (!context) return;
    setWeekPattern(cloneWeekPattern(context.week_pattern));
    setEffectiveFrom(context.default_effective_from);
    setGenerateThrough(context.default_generate_through);
  }, [context?.employee]);

  const validationIssues = useMemo(() => validateWeekPattern(weekPattern), [weekPattern]);
  const {
    plan,
    resolving,
    resolveError,
    refreshPlan,
  } = useWeeklyScheduleResolve(employee, weekPattern, effectiveFrom || null);

  const { holidays, isLoading: holidaysLoading } = useHolidayPreview(
    employee,
    effectiveFrom || null,
    generateThrough || null
  );

  const { apply, applying, status, clearStatus } = useApplyWeeklySchedule();

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employee) ?? null,
    [employees, employee]
  );

  const canApply = context?.can_apply ?? false;
  const previewOnly = Boolean(context && !canApply);

  function updateDay(weekday: Weekday, patch: Partial<WeekPatternDay>) {
    setWeekPattern((prev) => ({
      ...prev,
      days: prev.days.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)),
    }));
  }

  async function handleSave(confirmCreate = false) {
    if (!employee || !effectiveFrom || !generateThrough) return;
    if (validationIssues.length || !canApply) return;

    clearStatus();
    const result = await apply({
      employee,
      week_pattern: weekPattern,
      create_shifts_after: effectiveFrom,
      generate_through: generateThrough,
      confirm_create: confirmCreate,
    });

    if (!result) return;

    if (result.needs_confirm && result.plan) {
      const creates = (result.plan.groups ?? []).flatMap((group) => {
        const items: string[] = [];
        if (group.shift_type.action === "create") {
          items.push(group.shift_type.proposed_name ?? "Shift Type");
        }
        if (group.shift_schedule.action === "create") {
          items.push(group.shift_schedule.proposed_name ?? "Shift Schedule");
        }
        return items;
      });
      setPendingConfirmPlan(creates);
      setConfirmOpen(true);
      return;
    }

    if (result.ok) {
      setSaveSuccessUrl(result.attendance_url ?? `/hr-attendance?employee=${employee}`);
      void refreshContext();
    }
  }

  if (authLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
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
              Weekly Schedule uses your Frappe session and HR permissions.
            </p>
            <Button asChild size="sm">
              <a href={`/login?redirect-to=${encodeURIComponent("/hr-schedule")}`}>Log in</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <Button asChild variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-xs">
              <Link to={employee ? `/hr-attendance?employee=${employee}` : "/hr-attendance"}>
                <ArrowLeftIcon className="mr-1.5 size-3.5" />
                Back to attendance
              </Link>
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">Weekly schedule</h1>
            <p className="text-sm text-muted-foreground">
              {previewOnly
                ? "Preview PAT matches for existing setups. Save is for employees with no active SSA."
                : "Configure shift patterns, match shared PATs, and generate assignments."}
            </p>
          </div>
          <ScheduleEmployeePicker
            employees={employees}
            value={employee}
            onChange={setEmployee}
            isLoading={employeesLoading || contextLoading}
            className="w-full sm:max-w-md"
          />
        </header>

        {employee ? (
          <>
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Current setup</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-2 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {context?.employee_name ?? employeeShortName(selectedEmployee, employee)}
                  </span>
                  {context?.company ? <span>· {context.company}</span> : null}
                  {context?.branch ? <span>· {context.branch}</span> : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(context?.ssas ?? []).length ? (
                    context!.ssas.map((ssa) => (
                      <Badge key={ssa.name} variant="secondary" className="font-normal">
                        {ssa.shift_schedule ?? ssa.name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground">No shift schedule assignments yet.</span>
                  )}
                </div>
                {context?.assignment_summary?.latest_end_date ? (
                  <p className="text-xs text-muted-foreground">
                    Assignments through{" "}
                    <span className="font-medium text-foreground">
                      {context.assignment_summary.latest_end_date}
                    </span>
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {previewOnly ? (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardContent className="space-y-3 py-4 text-sm">
                  <p className="font-medium text-amber-900 dark:text-amber-100">
                    Preview only — this employee already has{" "}
                    {context!.enabled_ssa_count === 1
                      ? "an active SSA"
                      : `${context!.enabled_ssa_count} active SSAs`}
                    .
                  </p>
                  <p className="text-muted-foreground">
                    Change schedules in Frappe Desk, then return here only for fresh setup after
                    old SSAs are disabled.
                  </p>
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                    <li>Disable existing Shift Schedule Assignment(s) for this employee.</li>
                    <li>Cancel or end future Shift Assignments tied to the old pattern.</li>
                    <li>Re-open this page when the employee has no active SSA to save a new plan.</li>
                  </ol>
                </CardContent>
              </Card>
            ) : null}

            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">Weekly pattern</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setWeekPattern((prev) => apply55DayTemplate(prev))}
                >
                  Apply 5.5-day template
                </Button>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="w-16">Work?</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Lunch start</TableHead>
                      <TableHead>Lunch end</TableHead>
                      <TableHead className="w-20">Grace</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weekPattern.days.map((row) => {
                      const issue = validationIssues.find((v) => v.weekday === row.weekday);
                      return (
                        <TableRow key={row.weekday} className={issue ? "bg-destructive/5" : undefined}>
                          <TableCell className="font-medium">{row.weekday.slice(0, 3)}</TableCell>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={row.works}
                              onChange={(e) =>
                                updateDay(row.weekday, {
                                  works: e.target.checked,
                                  ...(e.target.checked
                                    ? {
                                        grace_minutes: row.grace_minutes ?? 10,
                                      }
                                    : {}),
                                })
                              }
                              aria-label={`${row.weekday} working`}
                            />
                          </TableCell>
                          <TableCell>
                            <TimeCell
                              disabled={!row.works}
                              value={formatTimeInput(row.start_time)}
                              onChange={(v) => updateDay(row.weekday, { start_time: v })}
                            />
                          </TableCell>
                          <TableCell>
                            <TimeCell
                              disabled={!row.works}
                              value={formatTimeInput(row.end_time)}
                              onChange={(v) => updateDay(row.weekday, { end_time: v })}
                            />
                          </TableCell>
                          <TableCell>
                            <TimeCell
                              disabled={!row.works}
                              value={formatTimeInput(row.lunch_start)}
                              onChange={(v) => updateDay(row.weekday, { lunch_start: v || null })}
                            />
                          </TableCell>
                          <TableCell>
                            <TimeCell
                              disabled={!row.works}
                              value={formatTimeInput(row.lunch_end)}
                              onChange={(v) => updateDay(row.weekday, { lunch_end: v || null })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={0}
                              disabled={!row.works}
                              className="h-8 w-16 px-2"
                              value={row.works ? (row.grace_minutes ?? 10) : ""}
                              onChange={(e) =>
                                updateDay(row.weekday, {
                                  grace_minutes: Number(e.target.value || 0),
                                })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {validationIssues.length ? (
                  <ul className="mt-2 space-y-1 text-xs text-destructive">
                    {validationIssues.map((issue) => (
                      <li key={issue.weekday}>
                        {issue.weekday}: {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  Short shift (Saturday morning): use a shorter end time (e.g. 08:00–12:00, no lunch).
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">Resolved plan</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => refreshPlan()}
                  disabled={!employee || validationIssues.length > 0}
                >
                  <RefreshCwIcon className={cn("size-3.5", resolving && "animate-spin")} />
                  Refresh plan
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {resolveError ? (
                  <p className="text-destructive">{String(resolveError)}</p>
                ) : resolving ? (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Resolving…
                  </p>
                ) : plan?.groups?.length ? (
                  <ul className="space-y-2">
                    {plan.groups.map((group, index) => {
                      const pat =
                        group.shift_schedule.action === "use"
                          ? group.shift_schedule.name
                          : group.shift_schedule.proposed_name;
                      const ft =
                        group.shift_type.action === "use"
                          ? group.shift_type.name
                          : group.shift_type.proposed_name;
                      const isCreate =
                        group.shift_schedule.action === "create" ||
                        group.shift_type.action === "create";
                      return (
                        <li
                          key={`${index}-${pat}`}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 px-3 py-2"
                        >
                          <span className="font-medium">{formatDayList(group.days)}</span>
                          <span className="text-muted-foreground">→</span>
                          <Badge variant={isCreate ? "outline" : "secondary"} className="font-normal">
                            {isCreate ? "create" : "use"}
                          </Badge>
                          <span className="truncate text-xs">{pat ?? ft}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : validationIssues.length ? (
                  <p className="text-muted-foreground">Fix validation errors to preview the plan.</p>
                ) : (
                  <p className="text-muted-foreground">Fill the grid to preview matched PATs.</p>
                )}

                {plan?.warnings?.length ? (
                  <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
                    {plan.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Dates</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="effective-from">Effective from</Label>
                  <Input
                    id="effective-from"
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="generate-through">Generate through</Label>
                  <Input
                    id="generate-through"
                    type="date"
                    value={generateThrough}
                    min={effectiveFrom}
                    max={
                      effectiveFrom
                        ? format(addDays(parseISO(effectiveFrom), 365), "yyyy-MM-dd")
                        : undefined
                    }
                    onChange={(e) => setGenerateThrough(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <CalendarDaysIcon className="size-4 opacity-60" />
                  Holiday preview
                </CardTitle>
              </CardHeader>
              <CardContent>
                {holidaysLoading ? (
                  <p className="text-sm text-muted-foreground">Loading holidays…</p>
                ) : holidays.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {holidays.map((holiday) => (
                      <Badge
                        key={holiday.date}
                        variant="secondary"
                        className="font-normal text-muted-foreground"
                      >
                        {holiday.date}
                        {holiday.weekly_off ? " · weekly off" : ""} — {holiday.description}
                      </Badge>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No holidays in this range.</p>
                )}
              </CardContent>
            </Card>

            {status ? (
              <Card
                className={cn(
                  "border-border/60",
                  status.type === "error" ? "border-destructive/40 bg-destructive/5" : "border-emerald-500/30"
                )}
              >
                <CardContent className="py-3 text-sm">{status.message}</CardContent>
              </Card>
            ) : null}

            {saveSuccessUrl ? (
              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <span>Schedule saved successfully.</span>
                  <Button asChild size="sm" variant="outline">
                    <Link to={saveSuccessUrl}>Open attendance calendar</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 pb-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => refreshPlan()}
                disabled={!employee || validationIssues.length > 0 || resolving}
              >
                Refresh plan
              </Button>
              <Button
                type="button"
                onClick={() => void handleSave(false)}
                disabled={
                  !employee ||
                  !canApply ||
                  applying ||
                  validationIssues.length > 0 ||
                  !effectiveFrom ||
                  !generateThrough
                }
              >
                {applying ? (
                  <>
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                    Saving…
                  </>
                ) : previewOnly ? (
                  "Save disabled — use Desk"
                ) : (
                  "Save & generate"
                )}
              </Button>
            </div>
          </>
        ) : (
          <Card className="border-border/60">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Select an employee to edit their weekly schedule.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new shift records?</DialogTitle>
            <DialogDescription>
              No matching Shift Type or Shift Schedule exists for this plan. Confirm to create shared
              records on save.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {pendingConfirmPlan.map((name) => (
              <li key={name} className="flex items-center gap-2">
                <CheckIcon className="size-3.5 text-muted-foreground" />
                {name}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                void handleSave(true);
              }}
              disabled={applying}
            >
              Confirm & save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TimeCell(props: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="time"
      disabled={props.disabled}
      className="h-8 w-[7rem] px-2"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}
