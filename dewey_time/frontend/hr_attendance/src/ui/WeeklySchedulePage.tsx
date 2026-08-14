import { EmptyState, Page, Section } from "@lolbikb/dewey-ui";
import { addDays, parseISO } from "date-fns";
import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useOutletContext } from "react-router-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import {
  useCalendarEmployees,
} from "@/hooks/useHrAttendanceData";
import { useEmployeeSelection } from "@/hooks/useEmployeeSelection";
import { useSession } from "@/hooks/useSession";
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
import { IS_DEV_BUILD } from "@/lib/devBuild";
import { notifySuccess } from "@/lib/toast";
import {
  summarizeReconcile,
  reconcileRetiresShifts,
  confirmNameMatches,
  openingScheduleMode,
  scheduleFormStateFromContext,
  type ScheduleMode,
} from "@/lib/scheduleEdit";
import { plannedDaysFromWeekPattern, resolveWeekPatternWindow } from "@/lib/plannedDays";
import { formatScheduleDuration } from "@/lib/weekSchedule";
import { summarizeWeekPattern } from "@/types/schedule";
import { PlannedWeekCanvas } from "@/ui/PlannedWeekCanvas";
import type { ApplyScheduleResult, ReconcilePreview } from "@/types/schedule";
import {
  isWeeklyScheduleEligible,
  schedulePickerTail,
  weeklyScheduleIneligibleMessage,
} from "@/lib/employeeCard";
import {
  LoadingIndicator,
  WeeklyScheduleAnimatedShell,
  WeeklyScheduleEditorSkeleton,
  WeeklySchedulePageSkeleton,
} from "@/ui/AttendanceLoading";
import { ClearAllSchedulesDialog } from "@/ui/ClearAllSchedulesDialog";
import { ClearSitePatternsDialog } from "@/ui/ClearSitePatternsDialog";
import { ClearEmployeeScheduleDialog } from "@/ui/ClearEmployeeScheduleDialog";
import { EmployeePicker } from "@/ui/EmployeePicker";
import { SpreadsheetImportTrigger } from "@/ui/schedule-import/SpreadsheetImportTrigger";
import { WeekPatternGroupEditor } from "@/ui/WeekPatternGroupEditor";
import {
  WeeklyScheduleTemplatePickerDialog,
  type ScheduleTemplateOption,
} from "@/ui/WeeklyScheduleTemplatePickerDialog";
import type { HrAccessOutletContext } from "@/lib/hrAccess";

export function WeeklySchedulePage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const { currentUser, isLoading: authLoading } = useSession();
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
  const [pendingReconcile, setPendingReconcile] = useState<ReconcilePreview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [templateKey, setTemplateKey] = useState<string>("manual");
  const appliedTemplateFingerprint = useRef<string | null>(null);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  // "edit" only because no context has loaded yet; the effect below owns it
  // from the first context onwards.
  const [mode, setMode] = useState<ScheduleMode>("edit");

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

  const { context, isLoading: contextLoading, refresh: refetchContext } =
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
    const seeded = scheduleFormStateFromContext(context);
    setShiftBlocks(seeded.shiftBlocks);
    setEffectiveFrom(seeded.effectiveFrom);
    setGenerateThrough(seeded.generateThrough);
    setLimitGenerateThrough(seeded.limitGenerateThrough);
  }, [context?.employee]);

  // The mode is a property of the employee on screen, so it is re-derived
  // whenever the context that answers `hasLiveSchedule` arrives — including on
  // an employee switch, which reseeds the form in the effect above. Keyed on
  // the same `context?.employee` so the two never disagree about who is shown.
  //
  // Read `context.enabled_ssa_count` directly rather than the derived
  // `hasLiveSchedule`: that constant is not in the dependency array, and adding
  // it would re-run this on every context refetch — snapping someone out of
  // edit mode mid-edit whenever the schedule is refreshed.
  useEffect(() => {
    if (!context) return;
    setMode(openingScheduleMode((context.enabled_ssa_count ?? 0) > 0));
  }, [context?.employee]);

  const validationIssues = useMemo(() => validateWeekPattern(weekPattern), [weekPattern]);
  const { plan, resolving, resolveError } = useWeeklyScheduleResolve(
    scheduleEmployeeId,
    weekPattern,
    effectiveFrom || null
  );

  const { apply, applying, status, clearStatus } = useApplyWeeklySchedule();
  const { templates: dynamicTemplates, isLoading: templatesLoading } = useWeeklyScheduleTemplates(24);

  const hasLiveSchedule = (context?.enabled_ssa_count ?? 0) > 0;
  const scheduleReadOnly = false;
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

  /** Pull the server's fresh defaults back into the editor.
   *
   * The seeding effect below keys on context?.employee, so a refetched context
   * for the SAME employee never re-fires it. Every path that changes the
   * server's idea of this employee's schedule must therefore reseed by hand —
   * saving did, clearing did not, which left the page claiming the employee had
   * no schedule while still displaying the one just deleted, with Save enabled
   * to recreate it.
   */
  async function reseedFormFromServer() {
    const refetched = await refetchContext();
    if (!refetched.data) return;
    const seeded = scheduleFormStateFromContext(refetched.data);
    setShiftBlocks(seeded.shiftBlocks);
    setEffectiveFrom(seeded.effectiveFrom);
    setGenerateThrough(seeded.generateThrough);
    setLimitGenerateThrough(seeded.limitGenerateThrough);
  }

  async function handleSave(confirmCreate = false): Promise<boolean> {
    if (!scheduleEmployeeId || !effectiveFrom) return false;
    if (limitGenerateThrough && !generateThrough) return false;
    if (validationIssues.length) return false;

    clearStatus();
    const result = await apply({
      employee: scheduleEmployeeId,
      week_pattern: weekPattern,
      create_shifts_after: effectiveFrom,
      generate_through: limitGenerateThrough ? generateThrough : "",
      confirm_create: confirmCreate,
    });

    // apply() returns null on failure and has already set the error status.
    if (!result) return false;

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
      return false;
    }

    if (result.ok) {
      const url = result.attendance_url ?? `/hr-attendance?employee=${scheduleEmployeeId}`;
      const reconciled = result.reconciled;
      notifySuccess(
        reconciled &&
          (reconciled.inactivated_assignments.length || reconciled.trimmed_assignments.length)
          ? `Schedule updated — ${reconciled.inactivated_assignments.length} inactivated, ${reconciled.trimmed_assignments.length} trimmed.`
          : "Schedule saved successfully.",
        undefined,
        { action: { label: "Open attendance", onClick: () => navigate(url) } },
      );

      // Re-seed the form from the server's fresh defaults after a save. The
      // effect below only re-runs on context?.employee — a refetched context
      // for the *same* employee (new week_pattern/enabled_ssa_count/defaults)
      // doesn't change that string, so it wouldn't otherwise re-fire, leaving
      // stale pre-save values in the form (e.g. effectiveFrom falling below
      // the "Effective from" min once hasLiveSchedule flips true on this
      // refetch).
      await reseedFormFromServer();

      return true;
    }

    return false;
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
      <Page>
        {/* No PageHeader. The nav tab the reader arrived through already reads
            "Schedule", and a visible title costs roughly 40px of vertical
            space on the viewport that can least afford it. /hr-attendance
            (App.tsx) and /hr-schedule/coverage (CoverageRegisterPage.tsx) are
            the existing precedents; this route converges on them. `<Page>`
            stays — that is what page-insets.spec.ts and the chrome parity
            guard actually require.

            The heading does NOT go with it. `sr-only` is absolutely positioned
            and measures zero pixels, so the space is still reclaimed, but a
            nav tab is not a heading: it does not appear in a screen reader's
            heading list, and a route with none has no answer to "where am I". */}
        <h1 className="sr-only">Weekly Schedule</h1>

        {/* The picker leads the page rather than sitting beside a title. It is
            the page's subject selector — everything below operates on whatever
            it holds — and at `lg` it is wide enough to show the Khmer name,
            which the old header-actions slot never was: it was pinned at
            160px, where EmployeeIdentity's 200px Khmer threshold can never be
            reached. `lg` caps at 512px, which leaves the row's right-hand side
            free for the page's actions at desktop widths. */}
        <div className="flex flex-col gap-2">
          {/* Import rides in the picker's row. In production it was the only
              control in the row below — all three Clear* dialogs are dev-only
              and render null — so that row cost a full band of vertical space
              for one button. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <EmployeePicker
              size="lg"
              employees={employees}
              value={employee}
              onChange={selectEmployee}
              isLoading={employeesLoading || (employeeLoading && isScheduleLoading)}
              tail={schedulePickerTail}
              isDisabled={(candidate) => !isWeeklyScheduleEligible(candidate.employment_type)}
            />
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <SpreadsheetImportTrigger
                onClick={() => navigate("/hr-schedule/import")}
                className="w-full sm:w-auto"
              />
            </div>
          </div>

          {/* Gated HERE, not only inside each dialog. Each returns null in
              production, but an empty wrapper is still a flex child and still
              costs the parent's gap-2. */}
          {IS_DEV_BUILD ? (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <ClearEmployeeScheduleDialog
                employee={scheduleEmployeeId}
                employeeRow={selectedEmployee}
                employeeLabel={employeeLabel}
                triggerClassName="h-9 w-full shrink-0 sm:w-auto"
                disabled={!scheduleEmployeeId}
                onSuccess={() => void reseedFormFromServer()}
              />
              <ClearAllSchedulesDialog triggerClassName="h-9 w-full shrink-0 sm:w-auto" />
              <ClearSitePatternsDialog triggerClassName="h-9 w-full shrink-0 sm:w-auto" />
            </div>
          ) : null}
        </div>

        <Section grow>
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
            <EmptyState
              className="min-h-0 flex-1"
              title={ineligibleMessage ? "Employee not eligible" : "Select an employee"}
              description={ineligibleMessage ?? "Their current pattern loads when available."}
            />
          ) : (
            <WeeklyScheduleAnimatedShell
              loading={isScheduleLoading}
              employeeKey={scheduleEmployeeId}
            >
              {mode === "preview" ? (
                <SchedulePreview
                  weekPattern={weekPattern}
                  onEdit={() => setMode("edit")}
                />
              ) : (
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
              )}
            </WeeklyScheduleAnimatedShell>
          )}
        </Section>

        {mode === "edit" && scheduleEmployeeId ? (
          <footer className="shrink-0 border-t border-border/60 pt-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:max-w-2xl">
                <DatePickerInput
                  id="effective-from"
                  label="Effective from"
                  value={effectiveFrom}
                  onChange={setEffectiveFrom}
                  min={hasLiveSchedule ? addDays(new Date(), 1) : undefined}
                />
                <Field>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="generate-through-limit" className="text-xs font-normal">
                      Generate through
                    </FieldLabel>
                    <div className="flex items-center gap-2">
                      <FieldLabel
                        htmlFor="generate-through-limit"
                        className="text-xs font-normal text-muted-foreground"
                      >
                        Limit end date
                      </FieldLabel>
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
                    <FieldDescription className="flex h-10 items-center">
                      Open-ended — generates 90 days of Shift Assignments from the effective date. Re-save to extend.
                    </FieldDescription>
                  )}
                </Field>
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
                      <Spinner className="size-3.5" />
                      Saving
                    </>
                  ) : hasLiveSchedule ? (
                    "Review changes"
                  ) : (
                    "Save schedule"
                  )}
                </Button>
              </div>
            </div>
          </footer>
        ) : null}
      </Page>

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

      <ResponsiveModal
        open={confirmOpen}
        onOpenChange={(o) => {
          if (applying) return; // don't let an outside-click/Escape dismiss mid-save
          setConfirmOpen(o);
          if (!o) {
            setConfirmText("");
            if (status?.type === "error") clearStatus();
          }
        }}
        size="md"
        title={
          <span className="break-words">
            {hasLiveSchedule
              ? `Change ${employeeLabel ?? "this employee"}'s schedule?`
              : "Create shared shift records?"}
          </span>
        }
        description={
          hasLiveSchedule
            ? "Review what changes and confirm to apply."
            : "Confirm to create shared Shift Type and Shift Schedule records on save."
        }
        bodyClassName="px-6 py-2"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={applying}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={async () => {
                const saved = await handleSave(true);
                if (saved) setConfirmOpen(false);
              }}
              disabled={
                applying ||
                (reconcileRetiresShifts(pendingReconcile) &&
                  !confirmNameMatches(confirmText, employeeLabel))
              }
            >
              {applying ? (
                <>
                  <Spinner className="size-3.5" />
                  Saving
                </>
              ) : hasLiveSchedule ? (
                "Save changes"
              ) : (
                "Create and save"
              )}
            </Button>
          </>
        }
      >
        {pendingConfirmPlan.length ? (
          <div className="space-y-1.5 text-sm">
            {pendingConfirmPlan.map((item) => (
              <Item key={`${item.doctype}-${item.name}`} variant="outline" size="sm" className="min-w-0">
                <CheckIcon className="size-4 shrink-0 text-muted-foreground" />
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate font-normal" title={item.name}>
                    {item.name}
                  </ItemTitle>
                </ItemContent>
                <span className="shrink-0 text-xs text-muted-foreground">{item.doctype}</span>
              </Item>
            ))}
          </div>
        ) : null}
        {(() => {
          const summary = summarizeReconcile(pendingReconcile);
          if (!summary.hasChanges) return null;
          return (
            <div className="mt-1 min-w-0 space-y-1 rounded-md border border-border/60 bg-muted/30 p-3">
              <p className="text-xs font-medium text-foreground break-words">
                What changes on {pendingReconcile?.effective_from}
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {summary.lines.map((line, i) => (
                  <li key={i} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
        {reconcileRetiresShifts(pendingReconcile) ? (
          <div className="mt-2 min-w-0 space-y-1.5">
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
        {status?.type === "error" ? (
          <Alert variant="destructive">
            <AlertDescription className="break-words">{status.message}</AlertDescription>
          </Alert>
        ) : null}
      </ResponsiveModal>
    </>
  );
}

/**
 * The read-only week.
 *
 * Every part of this already existed inside `SchedulePlanPreviewDialog`:
 * the canvas, both adapters, and the summary. The only new thing is that it is
 * inline rather than in a modal. No Card header, no ScrollArea — those exist to
 * frame an editor, and this is a document.
 */
function SchedulePreview(props: { weekPattern: WeekPattern; onEdit: () => void }) {
  const { workDays, offDays, totalWeeklyMinutes } = summarizeWeekPattern(props.weekPattern);
  const weeklyHoursLabel =
    totalWeeklyMinutes > 0 ? formatScheduleDuration(totalWeeklyMinutes) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1">
        <PlannedWeekCanvas
          days={plannedDaysFromWeekPattern(props.weekPattern)}
          window={resolveWeekPatternWindow(props.weekPattern)}
          minDayWidth="3rem"
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {workDays} work · {offDays} off
          {weeklyHoursLabel ? ` · ${weeklyHoursLabel}/wk` : null}
        </p>
        <Button type="button" variant="outline" className="h-9" onClick={props.onEdit}>
          Edit schedule
        </Button>
      </div>
    </div>
  );
}
