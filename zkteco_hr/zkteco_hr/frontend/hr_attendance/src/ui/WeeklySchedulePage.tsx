import { addDays, parseISO } from "date-fns";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams, useOutletContext } from "react-router-dom";

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
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import {
  useCalendarEmployees,
  useDefaultEmployee,
} from "@/hooks/useHrAttendanceData";
import {
  useApplyWeeklySchedule,
  useScheduleContext,
  useWeeklyScheduleResolve,
} from "@/hooks/useWeeklySchedule";
import { useWeeklyScheduleTemplates } from "@/hooks/useWeeklySchedule";
import type { ShiftBlock, WeekPattern } from "@/types/schedule";
import {
  apply55DayTemplate,
  blocksFingerprint,
  cloneWeekPattern,
  emptyWeekPattern,
  findMatchingTemplateKey,
  validateWeekPattern,
  weekPatternFromBlocks,
  weekPatternToBlocks,
} from "@/types/schedule";
import {
  SchedulePlanPreviewDialog,
  SchedulePreviewTrigger,
} from "@/ui/SchedulePlanPreviewDialog";
import { cn } from "@/lib/utils";
import {
  LoadingIndicator,
  WeeklyScheduleAnimatedShell,
  WeeklyScheduleEditorSkeleton,
  WeeklyScheduleHeaderSkeleton,
  WeeklySchedulePageSkeleton,
} from "@/ui/AttendanceLoading";
import { ClearEmployeeScheduleDialog } from "@/ui/ClearEmployeeScheduleDialog";
import { ScheduleEmployeePicker } from "@/ui/ScheduleEmployeePicker";
import { WeekPatternGroupEditor } from "@/ui/WeekPatternGroupEditor";
import {
  WeeklyScheduleTemplatePickerDialog,
  type ScheduleTemplateOption,
} from "@/ui/WeeklyScheduleTemplatePickerDialog";
import type { HrAccessOutletContext } from "@/lib/hrAccess";

export function WeeklySchedulePage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const { currentUser, isLoading: authLoading } = useFrappeAuth();
  const [searchParams] = useSearchParams();
  const initialEmployee = searchParams.get("employee");

  const [employee, setEmployee] = useState<string | null>(initialEmployee);
  const [shiftBlocks, setShiftBlocks] = useState<ShiftBlock[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [generateThrough, setGenerateThrough] = useState("");
  const [limitGenerateThrough, setLimitGenerateThrough] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingConfirmPlan, setPendingConfirmPlan] = useState<string[]>([]);
  const [saveSuccessUrl, setSaveSuccessUrl] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string>("manual");
  const appliedTemplateFingerprint = useRef<string | null>(null);
  const [employeeLoading, setEmployeeLoading] = useState(false);

  const weekPattern = useMemo<WeekPattern>(
    () => weekPatternFromBlocks(shiftBlocks),
    [shiftBlocks]
  );

  const { employees, isLoading: employeesLoading } = useCalendarEmployees();
  useDefaultEmployee(employees, employee, setEmployee);

  const { context, isLoading: contextLoading, refresh: refreshContext } = useScheduleContext(employee);

  useEffect(() => {
    if (!employee) return;
    setEmployeeLoading(true);
  }, [employee]);

  useEffect(() => {
    if (!contextLoading) setEmployeeLoading(false);
  }, [contextLoading]);

  useEffect(() => {
    if (!context) return;
    setShiftBlocks(weekPatternToBlocks(cloneWeekPattern(context.week_pattern)));
    setEffectiveFrom(context.default_effective_from);
    setGenerateThrough(context.default_generate_through ?? "");
    setLimitGenerateThrough(false);
    setSaveSuccessUrl(null);
  }, [context?.employee]);

  const validationIssues = useMemo(() => validateWeekPattern(weekPattern), [weekPattern]);
  const { plan, resolving, resolveError } = useWeeklyScheduleResolve(
    employee,
    weekPattern,
    effectiveFrom || null
  );

  const { apply, applying, status, clearStatus } = useApplyWeeklySchedule();
  const { templates: dynamicTemplates, isLoading: templatesLoading } = useWeeklyScheduleTemplates(24);

  const canApply = context?.can_apply ?? false;
  const previewOnly = Boolean(context && !canApply);
  const scheduleReadOnly = previewOnly;
  const isBootstrapping = employeesLoading && employees.length === 0;
  const isScheduleLoading = contextLoading && !!employee;

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.name === employee) ?? null,
    [employees, employee]
  );

  const employeeLabel = useMemo(() => {
    if (!employee) return null;
    return selectedEmployee?.employee_name ?? context?.employee_name ?? employee;
  }, [employee, selectedEmployee, context?.employee_name]);

  const static55Blocks = useMemo<ShiftBlock[]>(
    () => weekPatternToBlocks(apply55DayTemplate(emptyWeekPattern())),
    []
  );

  const templateOptions = useMemo((): ScheduleTemplateOption[] => {
    const options: ScheduleTemplateOption[] = dynamicTemplates.map((t) => ({
      key: t.key,
      label: t.label,
      count: t.count,
      blocks: t.blocks,
    }));
    if (!options.length) {
      options.push({
        key: "static:55",
        label: "Mon–Fri + Sat AM (5.5-day)",
        count: 0,
        blocks: static55Blocks,
        builtin: true,
      });
    }
    return options;
  }, [dynamicTemplates, static55Blocks]);

  useEffect(() => {
    if (!employee) return;
    const match = findMatchingTemplateKey(shiftBlocks, templateOptions);
    setTemplateKey(match);
    appliedTemplateFingerprint.current =
      match === "manual" ? null : blocksFingerprint(shiftBlocks);
  }, [employee, shiftBlocks, templateOptions]);

  async function handleSave(confirmCreate = false) {
    if (!employee || !effectiveFrom) return;
    if (limitGenerateThrough && !generateThrough) return;
    if (validationIssues.length || !canApply) return;

    clearStatus();
    const result = await apply({
      employee,
      week_pattern: weekPattern,
      create_shifts_after: effectiveFrom,
      generate_through: limitGenerateThrough ? generateThrough : "",
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

  if (authLoading || sessionLoading) {
    return <WeeklySchedulePageSkeleton label="Starting session…" />;
  }

  if (!hrStaff) {
    return <Navigate to="/hr-attendance" replace />;
  }

  if (!currentUser || currentUser === "Guest") {
    return (
      <div className="flex h-full items-center justify-center overflow-hidden bg-background px-4">
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

  const hasWorkingDays = weekPattern.days.some((day) => day.works);

  const saveDisabled =
    !employee ||
    !canApply ||
    applying ||
    validationIssues.length > 0 ||
    !effectiveFrom ||
    !hasWorkingDays ||
    (limitGenerateThrough && !generateThrough);

  const generateThroughMax = effectiveFrom
    ? addDays(parseISO(effectiveFrom), 365)
    : undefined;

  function applyTemplate(key: string) {
    setTemplateKey(key);
    if (key === "manual") {
      appliedTemplateFingerprint.current = null;
      return;
    }

    const source =
      key === "static:55"
        ? static55Blocks
        : templateOptions.find((t) => t.key === key)?.blocks;
    if (!source?.length) {
      setShiftBlocks([]);
      appliedTemplateFingerprint.current = blocksFingerprint([]);
      return;
    }
    const blocks = weekPatternToBlocks(weekPatternFromBlocks(source));
    setShiftBlocks(blocks);
    appliedTemplateFingerprint.current = blocksFingerprint(blocks);
  }

  function handleShiftBlocksChange(blocks: ShiftBlock[]) {
    setShiftBlocks(blocks);
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-5 py-4 sm:px-8 sm:py-5">
          <header className="mb-3 shrink-0 space-y-2">
            {isBootstrapping ? (
              <WeeklyScheduleHeaderSkeleton />
            ) : (
              <div className="animate-in fade-in slide-in-from-top-1 duration-300">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-lg font-semibold tracking-tight">Weekly Schedule</h1>
                    <p className="text-sm text-muted-foreground">
                      Configure shared shift patterns for an employee.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <ScheduleEmployeePicker
                      employees={employees}
                      value={employee}
                      onChange={setEmployee}
                      isLoading={employeesLoading || (employeeLoading && isScheduleLoading)}
                      className="h-9 w-full sm:w-64"
                      compact
                    />
                    <ClearEmployeeScheduleDialog
                      employee={employee}
                      employeeRow={selectedEmployee}
                      employeeLabel={employeeLabel}
                      triggerClassName="h-9 w-full shrink-0 sm:w-auto"
                      onSuccess={() => {
                        setSaveSuccessUrl(null);
                        void refreshContext();
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {previewOnly ? (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardContent className="py-2.5 text-sm text-amber-950 dark:text-amber-100">
                  Active SSAs exist — preview only until cleared. Use Clear schedule data (dev) or Desk.
                </CardContent>
              </Card>
            ) : null}

            {saveSuccessUrl ? (
              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span>Schedule saved successfully.</span>
                  <Button asChild size="sm" variant="outline">
                    <Link to={saveSuccessUrl}>Open attendance</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </header>

          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {isBootstrapping ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <WeeklyScheduleEditorSkeleton />
                <LoadingIndicator label="Loading schedule…" className="justify-center pb-1" />
              </div>
            ) : !employee ? (
              <Card className="flex min-h-0 flex-1 items-center justify-center border-dashed">
                <CardContent className="py-12 text-center">
                  <p className="font-medium">Select an employee</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Their current pattern loads when available.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <WeeklyScheduleAnimatedShell loading={isScheduleLoading} employeeKey={employee}>
                <Card
                  className={cn(
                    "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                    scheduleReadOnly && "opacity-95"
                  )}
                >
                  <CardHeader className="shrink-0 gap-4 px-5 pb-3 pt-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-base">Shift blocks</CardTitle>
                      {validationIssues[0] && !scheduleReadOnly ? (
                        <CardDescription className="text-destructive">
                          {validationIssues[0].message}
                        </CardDescription>
                      ) : (
                        <CardDescription>
                          {scheduleReadOnly
                            ? "Preview only — clear existing SSAs to edit."
                            : "One block per shared pattern — like Frappe Shift Schedule repeat days."}
                        </CardDescription>
                      )}
                    </div>
                    <div className="w-full shrink-0 sm:min-w-[min(100%,22rem)] sm:max-w-md">
                      <WeeklyScheduleTemplatePickerDialog
                        value={templateKey}
                        options={templateOptions}
                        onSelect={applyTemplate}
                        loading={templatesLoading}
                        disabled={scheduleReadOnly}
                        triggerClassName="sm:min-w-[20rem] sm:max-w-md"
                      />
                    </div>
                  </CardHeader>
                  <ScrollArea className="min-h-0 flex-1">
                    <CardContent className="px-5 pb-5 pt-0">
                      <WeekPatternGroupEditor
                        blocks={shiftBlocks}
                        onChange={handleShiftBlocksChange}
                        validationIssues={validationIssues}
                        disabled={scheduleReadOnly}
                      />
                    </CardContent>
                  </ScrollArea>
                </Card>
              </WeeklyScheduleAnimatedShell>
            )}
          </main>

          {employee ? (
            <footer className="mt-3 shrink-0 border-t border-border/60 pt-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:max-w-2xl">
                  <DatePickerInput
                    id="effective-from"
                    label="Effective from"
                    value={effectiveFrom}
                    onChange={setEffectiveFrom}
                    disabled={scheduleReadOnly}
                  />
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="generate-through-limit" className="text-xs">
                        Generate through
                      </Label>
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor="generate-through-limit"
                          className="text-xs font-normal text-muted-foreground"
                        >
                          Limit end date
                        </Label>
                        <Switch
                          id="generate-through-limit"
                          checked={limitGenerateThrough}
                          disabled={scheduleReadOnly}
                          onCheckedChange={(checked) => {
                            setLimitGenerateThrough(checked);
                            if (!checked) setGenerateThrough("");
                          }}
                        />
                      </div>
                    </div>
                    {limitGenerateThrough ? (
                      <DatePickerInput
                        id="generate-through"
                        value={generateThrough}
                        onChange={setGenerateThrough}
                        placeholder="Pick end date"
                        min={effectiveFrom ? parseISO(effectiveFrom) : undefined}
                        max={generateThroughMax}
                        disabled={scheduleReadOnly}
                      />
                    ) : (
                      <p className="flex h-10 items-center text-xs text-muted-foreground">
                        Open-ended — generates shift assignments for 90 days; HRMS extends later.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  {status?.type === "error" ? (
                    <p className="text-sm text-destructive">{status.message}</p>
                  ) : null}
                  <SchedulePreviewTrigger
                    onClick={() => setPreviewOpen(true)}
                    disabled={!employee || shiftBlocks.length === 0}
                    resolving={resolving}
                    groupCount={plan?.groups?.length}
                  />
                  <Button
                    type="button"
                    size="default"
                    className="h-9 min-w-[7.5rem]"
                    onClick={() => void handleSave(false)}
                    disabled={saveDisabled}
                  >
                    {applying ? (
                      <>
                        <Loader2Icon className="size-3.5 animate-spin" />
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
            </footer>
          ) : null}
        </div>
      </div>

      <SchedulePlanPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        weekPattern={weekPattern}
        plan={plan}
        resolving={resolving}
        resolveError={resolveError}
        effectiveFrom={effectiveFrom}
        generateThrough={generateThrough}
      />

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
    </>
  );
}
