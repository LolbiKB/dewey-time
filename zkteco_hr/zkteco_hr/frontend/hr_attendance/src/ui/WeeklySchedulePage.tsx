import { addDays, parseISO } from "date-fns";
import { ArrowLeftIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { useFrappeAuth } from "frappe-react-sdk";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  cloneWeekPattern,
  emptyWeekPattern,
  validateWeekPattern,
  weekPatternFromBlocks,
  weekPatternToBlocks,
} from "@/types/schedule";
import {
  SchedulePlanPreviewDialog,
  SchedulePreviewTrigger,
} from "@/ui/SchedulePlanPreviewDialog";
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
  const [limitGenerateThrough, setLimitGenerateThrough] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingConfirmPlan, setPendingConfirmPlan] = useState<string[]>([]);
  const [saveSuccessUrl, setSaveSuccessUrl] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string>("manual");

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
    setGenerateThrough(context.default_generate_through ?? "");
    setLimitGenerateThrough(Boolean(context.default_generate_through));
    setSaveSuccessUrl(null);
  }, [context?.employee]);

  const validationIssues = useMemo(() => validateWeekPattern(weekPattern), [weekPattern]);
  const { plan, resolving, resolveError } = useWeeklyScheduleResolve(
    employee,
    weekPattern,
    effectiveFrom || null
  );

  const { apply, applying, status, clearStatus } = useApplyWeeklySchedule();
  const { templates: dynamicTemplates, isLoading: templatesLoading } = useWeeklyScheduleTemplates(12);

  const canApply = context?.can_apply ?? false;
  const previewOnly = Boolean(context && !canApply);

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

  if (authLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center overflow-hidden bg-background">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentUser || currentUser === "Guest") {
    return (
      <div className="flex h-[100dvh] items-center justify-center overflow-hidden bg-background px-4">
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
    (limitGenerateThrough && !generateThrough);

  const generateThroughMax = effectiveFrom
    ? addDays(parseISO(effectiveFrom), 365)
    : undefined;

  function clearShiftBlocks() {
    setShiftBlocks(weekPatternToBlocks(emptyWeekPattern()));
    setTemplateKey("manual");
  }

  const static55Blocks = useMemo<ShiftBlock[]>(
    () => weekPatternToBlocks(apply55DayTemplate(emptyWeekPattern())),
    []
  );

  const templateOptions = useMemo(() => {
    const options = dynamicTemplates.map((t) => ({
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
      });
    }
    return options;
  }, [dynamicTemplates, static55Blocks]);

  function applyTemplate(key: string) {
    setTemplateKey(key);
    if (key === "manual") return;
    if (key === "static:55") {
      setShiftBlocks(static55Blocks);
      return;
    }
    const template = templateOptions.find((t) => t.key === key);
    if (template) {
      setShiftBlocks(template.blocks);
    }
  }

  return (
    <>
      <div className="h-[100dvh] overflow-hidden bg-background text-foreground">
        <div className="mx-auto flex h-full max-w-7xl flex-col px-5 py-5 sm:px-8 sm:py-6">
          <header className="mb-3 shrink-0 space-y-2">
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
                    Configure shared shift patterns for an employee.
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
                <Select value={templateKey} onValueChange={applyTemplate} disabled={!employee}>
                  <SelectTrigger className="h-9 w-full sm:w-64">
                    <SelectValue placeholder={templatesLoading ? "Loading templates…" : "Template"} />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="manual">Manual</SelectItem>
                    {templateOptions.map((tpl) => (
                      <SelectItem key={tpl.key} value={tpl.key}>
                        {tpl.label}
                        {tpl.count ? ` · ${tpl.count}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearShiftBlocks}
                disabled={!employee}
              >
                Clear blocks
              </Button>
              </div>
            </div>

            {previewOnly ? (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardContent className="py-2.5 text-sm text-amber-950 dark:text-amber-100">
                  Active SSAs exist — preview only until cleared in Desk.
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
            {!employee ? (
              <Card className="flex min-h-0 flex-1 items-center justify-center border-dashed">
                <CardContent className="py-12 text-center">
                  <p className="font-medium">Select an employee</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Their current pattern loads when available.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <CardHeader className="shrink-0 space-y-0 px-5 pb-3 pt-5">
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
                </CardHeader>
                <ScrollArea className="min-h-0 flex-1">
                  <CardContent className="px-5 pb-5 pt-0">
                    <WeekPatternGroupEditor
                      blocks={shiftBlocks}
                      onChange={setShiftBlocks}
                      validationIssues={validationIssues}
                    />
                  </CardContent>
                </ScrollArea>
              </Card>
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
                      />
                    ) : (
                      <p className="flex h-10 items-center text-xs text-muted-foreground">
                        Open-ended — SSA cursor only; HRMS extends assignments later.
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
                    disabled={!employee}
                    resolving={resolving}
                    groupCount={plan?.groups?.length}
                  />
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
