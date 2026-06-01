import {
  AlertTriangleIcon,
  CalendarRangeIcon,
  CheckCircle2Icon,
  FlagIcon,
  Loader2Icon,
  RefreshCwIcon,
  RepeatIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useClearEmployeeSchedule } from "@/hooks/useClearEmployeeSchedule";
import { cn } from "@/lib/utils";
import type { CalendarEmployee } from "@/types/calendar";
import type { ClearSchedulePreview, ClearScheduleResult } from "@/types/schedule";
import { EmployeeAvatar } from "@/ui/EmployeeAvatar";

export type ClearEmployeeScheduleDialogProps = {
  employee: string | null;
  employeeLabel?: string | null;
  employeeRow?: CalendarEmployee | null;
  onSuccess?: () => void;
  disabled?: boolean;
  triggerClassName?: string;
};

export function ClearEmployeeScheduleDialog(props: ClearEmployeeScheduleDialogProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ClearSchedulePreview | null>(null);
  const [result, setResult] = useState<ClearScheduleResult | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const { loadPreview, clearSchedule, loading, status, clearStatus } = useClearEmployeeSchedule();

  const triggerDisabled = props.disabled || !props.employee;

  const refreshPreview = useCallback(() => {
    if (!props.employee) return;
    setPreview(null);
    void loadPreview(props.employee).then(setPreview);
  }, [loadPreview, props.employee]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next && triggerDisabled) return;
      setOpen(next);
      if (!next) {
        const hadResult = Boolean(result);
        setConfirmText("");
        setAcknowledged(false);
        setPreview(null);
        setResult(null);
        clearStatus();
        if (hadResult) {
          props.onSuccess?.();
        }
      }
    },
    [triggerDisabled, result, clearStatus, props]
  );

  useEffect(() => {
    if (!open || !props.employee) return;
    setConfirmText("");
    setAcknowledged(false);
    setResult(null);
    clearStatus();
    setPreview(null);
    let cancelled = false;
    void loadPreview(props.employee).then((data) => {
      if (!cancelled) setPreview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, props.employee, clearStatus, loadPreview]);

  const confirmMatch = useMemo(
    () => Boolean(props.employee && confirmText.trim() === props.employee),
    [confirmText, props.employee]
  );

  const totalCount = preview
    ? preview.shift_assignment_count + preview.ssa_count + preview.attendance_flag_count
    : 0;

  const canClear =
    Boolean(props.employee) &&
    confirmMatch &&
    acknowledged &&
    totalCount > 0 &&
    !loading &&
    !result;

  const handleClear = async () => {
    if (!props.employee || !canClear) return;
    const cleared = await clearSchedule(props.employee);
    if (cleared) {
      setResult(cleared);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn(
          "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive",
          props.triggerClassName ?? "h-9"
        )}
        disabled={triggerDisabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => handleOpenChange(true)}
      >
        <Trash2Icon className="size-3.5" />
        Clear schedule (dev)
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="flex max-h-[min(90dvh,40rem)] flex-col gap-0 p-0 sm:max-w-lg"
          showCloseButton
        >
          <DialogHeader className="space-y-2 border-b border-border/60 px-5 py-4 text-left">
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <DialogTitle className="text-base">Clear schedule data</DialogTitle>
              <Badge variant="destructive" className="font-normal">
                Dev only
              </Badge>
            </div>
            <DialogDescription className="text-sm leading-relaxed">
              Permanently removes this employee&apos;s shift assignments, schedule assignments, and
              attendance flags. Shared Shift Types and Patterns are not deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
              <EmployeeAvatar
                employee={props.employeeRow ?? null}
                fallbackId={props.employee}
                className="size-10"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {props.employeeLabel ?? props.employee ?? "—"}
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {props.employee ?? "—"}
                </p>
              </div>
            </div>

            {result ? (
              <div className="space-y-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      Schedule data cleared
                    </p>
                    <p className="text-xs text-emerald-700/90 dark:text-emerald-300/90">
                      Close this dialog to continue editing a fresh schedule.
                    </p>
                  </div>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>
                    {result.deleted_assignments.length} shift assignment(s) removed
                    {result.cancelled_assignments.length
                      ? ` (${result.cancelled_assignments.length} cancelled first)`
                      : null}
                  </li>
                  <li>
                    {result.deleted_ssas.length} SSA(s) deleted
                    {result.disabled_ssas.length
                      ? ` · ${result.disabled_ssas.length} disabled (linked in Desk)`
                      : null}
                  </li>
                  <li>{result.deleted_flags} attendance flag(s) deleted</li>
                </ul>
              </div>
            ) : (
              <>
                {loading && !preview ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Loading impact preview…
                  </div>
                ) : preview ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Will remove
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={refreshPreview}
                        disabled={loading}
                      >
                        <RefreshCwIcon className={cn("mr-1 size-3", loading && "animate-spin")} />
                        Refresh
                      </Button>
                    </div>

                    {totalCount === 0 ? (
                      <div className="rounded-lg border border-dashed px-3 py-6 text-center">
                        <p className="text-sm font-medium">Nothing to clear</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          This employee has no shift assignments, SSAs, or flags.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        <ImpactStat
                          icon={CalendarRangeIcon}
                          label="Shift assignments"
                          count={preview.shift_assignment_count}
                        />
                        <ImpactStat
                          icon={RepeatIcon}
                          label="Schedule assignments"
                          count={preview.ssa_count}
                        />
                        <ImpactStat
                          icon={FlagIcon}
                          label="Attendance flags"
                          count={preview.attendance_flag_count}
                        />
                      </div>
                    )}

                    <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">
                      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                      <p>
                        Requires System Manager. Shift Types and Patterns on the site are kept.
                      </p>
                    </div>
                  </div>
                ) : status?.type === "error" ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {status.message}
                  </div>
                ) : null}

                {totalCount > 0 && preview && !loading ? (
                  <div className="space-y-3 rounded-lg border px-3 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Confirm
                    </p>

                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="clear-schedule-ack"
                        checked={acknowledged}
                        onCheckedChange={(checked) => setAcknowledged(checked === true)}
                        disabled={loading}
                      />
                      <Label
                        htmlFor="clear-schedule-ack"
                        className="cursor-pointer text-sm leading-snug font-normal"
                      >
                        I understand this permanently removes schedule and flag data for this
                        employee.
                      </Label>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label
                          htmlFor="clear-schedule-confirm"
                          className="text-xs text-muted-foreground"
                        >
                          Type{" "}
                          <span className="font-mono text-foreground">{props.employee}</span> to
                          confirm
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => props.employee && setConfirmText(props.employee)}
                          disabled={!props.employee || loading}
                        >
                          Use ID
                        </Button>
                      </div>
                      <Input
                        id="clear-schedule-confirm"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={props.employee ?? "Employee ID"}
                        disabled={loading || !props.employee}
                        className={cn(
                          "h-9 font-mono text-sm",
                          confirmText.length > 0 &&
                            !confirmMatch &&
                            "border-destructive/50 focus-visible:ring-destructive/30"
                        )}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {confirmText.length > 0 && !confirmMatch ? (
                        <p className="text-xs text-destructive">Employee ID does not match.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {status?.type === "error" && !result ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {status.message}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 shrink-0 gap-2 border-t border-border/60 bg-muted/50 px-5 py-4 sm:justify-end">
            {result ? (
              <Button type="button" size="default" className="h-9" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            ) : (
              <Button
                type="button"
                size="default"
                className="h-9 min-w-[9rem] bg-destructive text-white hover:bg-destructive/90 hover:text-white disabled:bg-destructive/50 disabled:text-white/80"
                disabled={!canClear}
                onClick={() => void handleClear()}
              >
                {loading ? (
                  <>
                    <Loader2Icon className="size-3.5 animate-spin" />
                    Clearing…
                  </>
                ) : (
                  <>
                    <Trash2Icon className="size-3.5" />
                    {totalCount > 0 ? `Clear ${totalCount}` : "Clear all"}
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImpactStat(props: {
  icon: typeof CalendarRangeIcon;
  label: string;
  count: number;
}) {
  const Icon = props.icon;
  const active = props.count > 0;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        active ? "border-destructive/25 bg-destructive/5" : "border-border/60 bg-muted/20"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Icon
          className={cn("size-4 shrink-0", active ? "text-destructive" : "text-muted-foreground")}
        />
        <span
          className={cn(
            "text-lg font-semibold tabular-nums leading-none",
            active ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {props.count}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">{props.label}</p>
    </div>
  );
}
