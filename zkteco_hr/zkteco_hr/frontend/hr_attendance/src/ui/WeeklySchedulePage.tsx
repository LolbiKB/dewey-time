import { addDays, format, parseISO } from "date-fns";
import { ArrowLeftIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
import type { ScheduleContext } from "@/types/schedule";
import type { ResolvePlan, ShiftBlock, WeekPattern } from "@/types/schedule";
import {
  apply55DayTemplate,
  cloneWeekPattern,
  emptyWeekPattern,
  formatDayList,
  validateWeekPattern,
  weekPatternFromBlocks,
  weekPatternToBlocks,
} from "@/types/schedule";
import { ScheduleEmployeePicker } from "@/ui/ScheduleEmployeePicker";
import { WeekPatternGroupEditor } from "@/ui/WeekPatternGroupEditor";

export function WeeklySchedulePage() {
  const { currentUser, isLoading: authLoading } = useFrappeAuth();
  const [searchParams] = useSearchParams();
  const initialEmployee = searchParams.get("employee");

  const [employee, setEmployee] = useState<string | null>(initialEmployee);
  const [shiftBlocks, setShiftBlocks] = useState<ShiftBlock[]>(() =>
    weekPatternToBlocks(emptyWeekPattern())
  );
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [generateThrough, setGenerateThrough] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingConfirmPlan, setPendingConfirmPlan] = useState<string[]>([]);
  const [saveSuccessUrl, setSaveSuccessUrl] = useState<string | null>(null);

  const weekPattern = useMemo<WeekPattern>(
    () => weekPatternFromBlocks(shiftBlocks),
    [shiftBlocks]
  );

  const { employees, isLoading: employeesLoading } = useCalendarEmployees();
  useDefaultEmployee(employees, employee, setEmployee);

  const { context, isLoading: contextLoading, refresh: refreshContext } = useScheduleContext(employee);

  useEffect(() => {
    if (!context) return;
    setShiftBlocks(weekPatternToBlocks(cloneWeekPattern(context.week_pattern)));
    setEffectiveFrom(context.default_effective_from);
    setGenerateThrough(context.default_generate_through);
    setSaveSuccessUrl(null);
  }, [context?.employee]);

  const validationIssues = useMemo(() => validateWeekPattern(weekPattern), [weekPattern]);
  const { plan, resolving, resolveError } = useWeeklyScheduleResolve(
    employee,
    weekPattern,
    effectiveFrom || null
  );

  const { holidays, isLoading: holidaysLoading } = useHolidayPreview(
    employee,
    effectiveFrom || null,
    generateThrough || null
  );

  const { apply, applying, status, clearStatus } = useApplyWeeklySchedule();

  const canApply = context?.can_apply ?? false;
  const previewOnly = Boolean(context && !canApply);

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
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
            <CardDescription>Weekly Schedule uses your Frappe session and HR permissions.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm">
              <a href={`/login?redirect-to=${encodeURIComponent("/hr-schedule")}`}>Log in</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const saveDisabled =
    !employee ||
    !canApply ||
    applying ||
    validationIssues.length > 0 ||
    !effectiveFrom ||
    !generateThrough;

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 py-4 sm:px-6">
        <header className="mb-4 shrink-0 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Button asChild variant="ghost" size="icon-sm">
                <Link
                  to={employee ? `/hr-attendance?employee=${employee}` : "/hr-attendance"}
                  aria-label="Back to attendance"
                >
                  <ArrowLeftIcon />
                </Link>
              </Button>
              <div>
                <h1 className="text-lg font-semibold tracking-tight">Weekly Schedule</h1>
                <p className="text-sm text-muted-foreground">
                  Match shared patterns and generate assignments.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <ScheduleEmployeePicker
                employees={employees}
                value={employee}
                onChange={setEmployee}
                isLoading={employeesLoading || contextLoading}
                className="h-9 w-full sm:w-64"
                compact
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setShiftBlocks(weekPatternToBlocks(apply55DayTemplate(weekPattern)))
                }
                disabled={!employee}
              >
                5.5-day template
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave(false)}
                disabled={saveDisabled}
              >
                {applying ? (
                  <>
                    <Loader2Icon className="animate-spin" />
                    Saving
                  </>
                ) : previewOnly ? (
                  "Preview only"
                ) : (
                  "Save schedule"
                )}
              </Button>
            </div>
          </div>

          {previewOnly ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="py-3 text-sm text-amber-950 dark:text-amber-100">
                Active SSAs exist — preview matches here, then update live schedules in Desk before
                saving a fresh plan.
              </CardContent>
            </Card>
          ) : null}

          {saveSuccessUrl ? (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>Schedule saved successfully.</span>
                <Button asChild size="sm" variant="outline">
                  <Link to={saveSuccessUrl}>Open attendance</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          {!employee ? (
            <Card className="flex items-center justify-center border-dashed">
              <CardContent className="py-12 text-center">
                <p className="font-medium">Select an employee</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Their current pattern loads when available.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="flex min-h-0 min-w-0 flex-col">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="text-base">Shift blocks</CardTitle>
                    {validationIssues[0] ? (
                      <CardDescription className="text-destructive">
                        {validationIssues[0].message}
                      </CardDescription>
                    ) : (
                      <CardDescription>
                        One block per shared pattern — like Frappe Shift Schedule repeat days.
                      </CardDescription>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 pt-0">
                  <WeekPatternGroupEditor
                    blocks={shiftBlocks}
                    onChange={setShiftBlocks}
                    validationIssues={validationIssues}
                  />
                </CardContent>
              </Card>

              <ScheduleInspector
                context={context}
                employee={employee}
                plan={plan}
                resolving={resolving}
                resolveError={resolveError}
                effectiveFrom={effectiveFrom}
                generateThrough={generateThrough}
                onEffectiveFromChange={setEffectiveFrom}
                onGenerateThroughChange={setGenerateThrough}
                holidays={holidays}
                holidaysLoading={holidaysLoading}
                statusMessage={status?.type === "error" ? status.message : null}
                previewOnly={previewOnly}
              />
            </>
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create shared shift records?</DialogTitle>
            <DialogDescription>
              Confirm to create shared Shift Type and Shift Schedule records on save.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {pendingConfirmPlan.map((name) => (
              <li key={name} className="flex items-center gap-2">
                <CheckIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
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
              Create and save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScheduleInspector(props: {
  context: ScheduleContext | null;
  employee: string;
  plan: ResolvePlan | null;
  resolving: boolean;
  resolveError: unknown;
  effectiveFrom: string;
  generateThrough: string;
  onEffectiveFromChange: (value: string) => void;
  onGenerateThroughChange: (value: string) => void;
  holidays: Array<{ date: string; description: string; weekly_off: boolean }>;
  holidaysLoading: boolean;
  statusMessage: string | null;
  previewOnly: boolean;
}) {
  const activeSsas =
    props.context?.ssas?.filter(
      (ssa) => ssa.enabled !== 0 && (ssa.shift_status ?? "").toLowerCase() !== "inactive"
    ) ?? [];

  return (
    <Card className="flex min-h-0 flex-col lg:max-h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Summary</CardTitle>
        <CardDescription>
          {props.context?.employee_name ?? employeeShortName(null, props.employee)}
          {props.context?.company ? ` · ${props.context.company}` : ""}
        </CardDescription>
      </CardHeader>

      <ScrollArea className="min-h-0 flex-1 px-4">
        <div className="space-y-4 pb-4">
          <section className="space-y-2">
            <Label className="text-xs text-muted-foreground">Current assignments</Label>
            {activeSsas.length ? (
              <div className="flex flex-wrap gap-1.5">
                {activeSsas.slice(0, 4).map((ssa) => (
                  <Badge key={ssa.name} variant="secondary" className="max-w-full truncate font-normal">
                    {ssa.shift_schedule ?? ssa.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No active SSA — ready to save.</p>
            )}
            {props.context?.assignment_summary?.latest_end_date ? (
              <p className="text-xs text-muted-foreground">
                Through {props.context.assignment_summary.latest_end_date}
              </p>
            ) : null}
          </section>

          <Separator />

          <section className="space-y-2">
            <Label className="text-xs text-muted-foreground">Matched plan</Label>
            {props.resolveError ? (
              <p className="text-sm text-destructive">{String(props.resolveError)}</p>
            ) : props.resolving ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Matching…
              </p>
            ) : props.plan?.groups?.length ? (
              <ul className="space-y-2">
                {props.plan.groups.map((group, index) => {
                  const pat =
                    group.shift_schedule.action === "use"
                      ? group.shift_schedule.name
                      : group.shift_schedule.proposed_name;
                  const isCreate =
                    group.shift_schedule.action === "create" ||
                    group.shift_type.action === "create";
                  return (
                    <li key={`${index}-${pat}`} className="rounded-lg border border-border/60 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{formatDayList(group.days)}</span>
                        <Badge variant={isCreate ? "outline" : "secondary"} className="font-normal">
                          {isCreate ? "Create" : "Use"}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{pat}</p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Edit the work week to preview PATs.</p>
            )}
            {props.plan?.warnings?.[0] ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">{props.plan.warnings[0]}</p>
            ) : null}
          </section>

          <Separator />

          <section className="space-y-3">
            <Label className="text-xs text-muted-foreground">Generation range</Label>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="effective-from" className="text-xs font-normal">
                  Effective from
                </Label>
                <Input
                  id="effective-from"
                  type="date"
                  className="h-8"
                  value={props.effectiveFrom}
                  onChange={(e) => props.onEffectiveFromChange(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="generate-through" className="text-xs font-normal">
                  Generate through
                </Label>
                <Input
                  id="generate-through"
                  type="date"
                  className="h-8"
                  value={props.generateThrough}
                  min={props.effectiveFrom}
                  max={
                    props.effectiveFrom
                      ? format(addDays(parseISO(props.effectiveFrom), 365), "yyyy-MM-dd")
                      : undefined
                  }
                  onChange={(e) => props.onGenerateThroughChange(e.target.value)}
                />
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-2">
            <Label className="text-xs text-muted-foreground">Holidays</Label>
            {props.holidaysLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : props.holidays.length ? (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {props.holidays.slice(0, 4).map((holiday) => (
                  <li key={holiday.date} className="truncate">
                    {holiday.date} · {holiday.description}
                  </li>
                ))}
                {props.holidays.length > 4 ? (
                  <li className="text-xs">+{props.holidays.length - 4} more</li>
                ) : null}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None in range.</p>
            )}
          </section>

          {props.statusMessage ? (
            <p className="text-sm text-destructive">{props.statusMessage}</p>
          ) : props.previewOnly ? (
            <p className="text-xs text-muted-foreground">
              Save disabled until SSAs are cleared in Desk.
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </Card>
  );
}
