import { addDays, parseISO } from "date-fns";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useOutletContext } from "react-router-dom";

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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import {
  useCalendarEmployees,
} from "@/hooks/useHrAttendanceData";
import { useEmployeeSelection } from "@/hooks/useEmployeeSelection";
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
import { summarizeReconcile, reconcileRetiresShifts, confirmNameMatches } from "@/lib/scheduleEdit";
import type { ApplyScheduleResult, ReconcilePreview } from "@/types/schedule";
import {
  isWeeklyScheduleEligible,
  weeklyScheduleIneligibleMessage,
} from "@/lib/employeeCard";
import {
  LoadingIndicator,
  WeeklyScheduleAnimatedShell,
  WeeklyScheduleEditorSkeleton,
  WeeklyScheduleHeaderSkeleton,
  WeeklySchedulePageSkeleton,
} from "@/ui/AttendanceLoading";
import { ClearAllSchedulesDialog } from "@/ui/ClearAllSchedulesDialog";
import { ClearSitePatternsDialog } from "@/ui/ClearSitePatternsDialog";
import { ClearEmployeeScheduleDialog } from "@/ui/ClearEmployeeScheduleDialog";
import { ScheduleEmployeePicker } from "@/ui/ScheduleEmployeePicker";
import { SpreadsheetImportTrigger } from "@/ui/schedule-import/SpreadsheetImportTrigger";
import { WeekPatternGroupEditor } from "@/ui/WeekPatternGroupEditor";
import {
  WeeklyScheduleTemplatePickerDialog,
  type ScheduleTemplateOption,
} from "@/ui/WeeklyScheduleTemplatePickerDialog";
import type { HrAccessOutletContext } from "@/lib/hrAccess";

export function WeeklySchedulePage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const { currentUser, isLoading: authLoading } = useFrappeAuth();
  const navigate = useNavigate();

  const [shiftBlocks, setShiftBlocks] = useState<ShiftBlock[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [generateThrough, setGenerateThrough] = useState("");
  const [limitGenerateThrough, setLimitGenerateThrough] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingConfirmPlan, setPendingConfirmPlan] = useState<
    Array<{ name: string; doctype: string }>
  >([]);
  const [saveSuccessUrl, setSaveSuccessUrl] = useState<string | null>(null);
  const [pendingReconcile, setPendingReconcile] = useState<ReconcilePreview | null>(null);
  const [savedNonce, setSavedNonce] = useState(0);
  const [lastReconciled, setLastReconciled] = useState<ApplyScheduleResult["reconciled"] | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [templateKey, setTemplateKey] = useState<string>("manual");
  const appliedTemplateFingerprint = useRef<string | null>(null);
  const [employeeLoading, setEmployeeLoading] = useState(false);

  const weekPattern = useMemo<WeekPattern>(
    () => weekPatternFromBlocks(shiftBlocks),
    [shiftBlocks]
  );

  const { employees, currentUserEmployee, isLoading: employeesLoading } = useCalendarEmployees();
  const { employee, selectEmployee } = useEmployeeSelection(employees, currentUserEmployee);

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === employee) ?? null,
    [employees, employee]
  );

  const scheduleEmployeeId = useMemo(() => {
    if (!employee || !selectedEmployee) return null;
    if (!isWeeklyScheduleEligible(selectedEmployee.employment_type)) return null;
    return employee;
  }, [employee, selectedEmployee]);

  const ineligibleMessage = useMemo(
    () => weeklyScheduleIneligibleMessage(selectedEmployee, employee),
    [employee, selectedEmployee]
  );

  const awaitingEmployeeRow = Boolean(
    employee && !selectedEmployee && employeesLoading
  );

  const { context, isLoading: contextLoading, refresh: refreshContext } =
    useScheduleContext(scheduleEmployeeId);

  useEffect(() => {
    if (!scheduleEmployeeId) return;
    setEmployeeLoading(true);
  }, [scheduleEmployeeId]);

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
  }, [context?.employee, savedNonce]);

  const validationIssues = useMemo(() => validateWeekPattern(weekPattern), [weekPattern]);
  const { plan, resolving, resolveError } = useWeeklyScheduleResolve(
    scheduleEmployeeId,
    weekPattern,
    effectiveFrom || null
  );

  const { apply, applying, status, clearStatus } = useApplyWeeklySchedule();
  const { templates: dynamicTemplates, isLoading: templatesLoading } = useWeeklyScheduleTemplates(24);

  const isEditing = (context?.enabled_ssa_count ?? 0) > 0;
  const scheduleReadOnly = false;
  const previewOnly = false;
  const isBootstrapping = employeesLoading && employees.length === 0;
  const isScheduleLoading = contextLoading && !!scheduleEmployeeId;

  const employeeLabel = useMemo(() => {
    if (!scheduleEmployeeId) return null;
    return selectedEmployee?.employee_name ?? context?.employee_name ?? scheduleEmployeeId;
  }, [context?.employee_name, scheduleEmployeeId, selectedEmployee?.employee_name]);

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
    if (!scheduleEmployeeId || !effectiveFrom) return;
    if (limitGenerateThrough && !generateThrough) return;
    if (validationIssues.length) return;

    clearStatus();
    const result = await apply({
      employee: scheduleEmployeeId,
      week_pattern: weekPattern,
      create_shifts_after: effectiveFrom,
      generate_through: limitGenerateThrough ? generateThrough : "",
      confirm_create: confirmCreate,
    });

    if (!result) return;

    if (result.needs_confirm && result.plan) {
      const creates = (result.plan.groups ?? []).flatMap((group) => {
        const items: Array<{ name: string; doctype: string }> = [];
        if (group.shift_type.action === "create") {
          items.push({
            name: group.shift_type.proposed_name ?? "Shift Type",
            doctype: "Shift Type",
          });
        }
        if (group.shift_schedule.action === "create") {
          items.push({
            name: group.shift_schedule.proposed_name ?? "Shift Schedule",
            doctype: "Shift Schedule",
          });
        }
        return items;
      });
      setPendingConfirmPlan(creates);
      setPendingReconcile((result as ApplyScheduleResult).reconcile ?? null);
      setConfirmText("");
      setConfirmOpen(true);
      return;
    }

    if (result.ok) {
      setSaveSuccessUrl(result.attendance_url ?? `/hr-attendance?employee=${scheduleEmployeeId}`);
      setSavedNonce((n) => n + 1);
      setLastReconciled(result.reconciled ?? null);
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
    !scheduleEmployeeId ||
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
              <div className="animate-in fade-in slide-in-from-top-1">
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
                      onChange={selectEmployee}
                      isLoading={employeesLoading || (employeeLoading && isScheduleLoading)}
                      className="h-9 w-full sm:w-64"
                      compact
                    />
                    <SpreadsheetImportTrigger
                      onClick={() => navigate("/hr-schedule/import")}
                      className="w-full sm:w-auto"
                    />
                    <ClearEmployeeScheduleDialog
                      employee={scheduleEmployeeId}
                      employeeRow={selectedEmployee}
                      employeeLabel={employeeLabel}
                      triggerClassName="h-9 w-full shrink-0 sm:w-auto"
                      disabled={!scheduleEmployeeId}
                      onSuccess={() => {
                        setSaveSuccessUrl(null);
                        void refreshContext();
                      }}
                    />
                    <ClearAllSchedulesDialog
                      triggerClassName="h-9 w-full shrink-0 sm:w-auto"
                      onSuccess={() => {
                        setSaveSuccessUrl(null);
                        void refreshContext();
                      }}
                    />
                    <ClearSitePatternsDialog
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

            {ineligibleMessage ? (
              <Card className="border-brand-accent/30 bg-muted/40">
                <CardContent className="py-2.5 text-sm text-foreground">
                  {ineligibleMessage} Pick an eligible employee above to continue.
                </CardContent>
              </Card>
            ) : null}

            {isEditing && scheduleEmployeeId && !ineligibleMessage ? (
              <Card className="border-brand-accent/40 bg-brand-accent/10">
                <CardContent className="py-2.5 text-sm text-foreground">
                  <span className="font-medium">
                    Editing {employeeLabel ?? "this employee"}'s schedule.
                  </span>{" "}
                  Changes take effect {effectiveFrom || "the effective date"}. Existing future
                  shifts will be replaced.
                </CardContent>
              </Card>
            ) : null}

            {saveSuccessUrl ? (
              <Card className="border-primary/30 bg-muted/40">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="text-primary">
                    {lastReconciled &&
                    (lastReconciled.inactivated_assignments.length ||
                      lastReconciled.trimmed_assignments.length)
                      ? `Schedule updated — ${lastReconciled.inactivated_assignments.length} inactivated, ${lastReconciled.trimmed_assignments.length} trimmed.`
                      : "Schedule saved successfully."}
                  </span>
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
            ) : awaitingEmployeeRow ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <WeeklyScheduleEditorSkeleton />
                <LoadingIndicator label="Loading employee…" className="justify-center pb-1" />
              </div>
            ) : !scheduleEmployeeId ? (
              <Card className="flex min-h-0 flex-1 items-center justify-center border-dashed">
                <CardContent className="py-12 text-center">
                  <p className="font-medium">
                    {ineligibleMessage ? "Employee not eligible" : "Select an employee"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {ineligibleMessage ??
                      "Their current pattern loads when available."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <WeeklyScheduleAnimatedShell
                loading={isScheduleLoading}
                employeeKey={scheduleEmployeeId}
              >
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

          {scheduleEmployeeId ? (
            <footer className="mt-3 shrink-0 border-t border-border/60 pt-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:max-w-2xl">
                  <DatePickerInput
                    id="effective-from"
                    label="Effective from"
                    value={effectiveFrom}
                    onChange={setEffectiveFrom}
                    min={isEditing ? addDays(new Date(), 1) : undefined}
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
                        Open-ended — generates 90 days of Shift Assignments from the effective date. Re-save to extend.
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
                    disabled={!scheduleEmployeeId || shiftBlocks.length === 0}
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
                    ) : isEditing ? (
                      "Review changes"
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

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (!o) setConfirmText("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isEditing
                ? `Change ${employeeLabel ?? "this employee"}'s schedule?`
                : "Create shared shift records?"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Review what changes and confirm to apply."
                : "Confirm to create shared Shift Type and Shift Schedule records on save."}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {pendingConfirmPlan.map((item) => (
              <li key={`${item.doctype}-${item.name}`} className="flex items-center gap-2">
                <CheckIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.doctype}</span>
              </li>
            ))}
          </ul>
          {(() => {
            const summary = summarizeReconcile(pendingReconcile);
            if (!summary.hasChanges) return null;
            return (
              <div className="mt-1 space-y-1 rounded-md border border-border/60 bg-muted/30 p-3">
                <p className="text-xs font-medium text-foreground">
                  What changes on {pendingReconcile?.effective_from}
                </p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {summary.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {reconcileRetiresShifts(pendingReconcile) ? (
            <div className="mt-2 space-y-1.5">
              <Label htmlFor="schedule-change-confirm" className="text-xs text-muted-foreground">
                Type{" "}
                <span className="font-medium text-foreground">
                  {employeeLabel ?? "the employee's name"}
                </span>{" "}
                to confirm this change
              </Label>
              <Input
                id="schedule-change-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={employeeLabel ?? "Employee name"}
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  "h-9 text-sm",
                  confirmText.length > 0 &&
                    !confirmNameMatches(confirmText, employeeLabel) &&
                    "border-destructive/50 focus-visible:ring-destructive/30",
                )}
              />
              {confirmText.length > 0 && !confirmNameMatches(confirmText, employeeLabel) ? (
                <p className="text-xs text-destructive">Name doesn't match.</p>
              ) : null}
            </div>
          ) : null}
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
              disabled={
                applying ||
                (reconcileRetiresShifts(pendingReconcile) &&
                  !confirmNameMatches(confirmText, employeeLabel))
              }
            >
              {isEditing ? "Save changes" : "Create and save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
