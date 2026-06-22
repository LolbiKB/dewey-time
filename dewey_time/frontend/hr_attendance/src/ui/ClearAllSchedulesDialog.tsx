import {
  AlertTriangleIcon,
  CalendarRangeIcon,
  CheckCircle2Icon,
  FlagIcon,
  Loader2Icon,
  RadiationIcon,
  RefreshCwIcon,
  RepeatIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import {
  CLEAR_ALL_CONFIRM_PHRASE,
  useClearAllSchedules,
} from "@/hooks/useClearAllSchedules";
import { cn } from "@/lib/utils";
import type { ClearAllSchedulesPreview, ClearAllSchedulesResult } from "@/types/schedule";

export type ClearAllSchedulesDialogProps = {
  onSuccess?: () => void;
  disabled?: boolean;
  triggerClassName?: string;
};

export function ClearAllSchedulesDialog(props: ClearAllSchedulesDialogProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ClearAllSchedulesPreview | null>(null);
  const [result, setResult] = useState<ClearAllSchedulesResult | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const { loadPreview, clearAllSchedules, loading, status, clearStatus } = useClearAllSchedules();

  const refreshPreview = useCallback(() => {
    setPreview(null);
    void loadPreview().then(setPreview);
  }, [loadPreview]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next && props.disabled) return;
      setOpen(next);
      if (!next) {
        const hadResult = Boolean(result);
        setConfirmText("");
        setAcknowledged(false);
        setPreview(null);
        setResult(null);
        clearStatus();
        if (hadResult) props.onSuccess?.();
      }
    },
    [props, result, clearStatus]
  );

  useEffect(() => {
    if (!open) return;
    setConfirmText("");
    setAcknowledged(false);
    setResult(null);
    clearStatus();
    setPreview(null);
    let cancelled = false;
    void loadPreview().then((data) => {
      if (!cancelled) setPreview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, clearStatus, loadPreview]);

  const confirmMatch = confirmText.trim() === CLEAR_ALL_CONFIRM_PHRASE;

  const totalCount = preview
    ? preview.shift_assignment_count + preview.ssa_count + preview.attendance_flag_count
    : 0;

  const canClear =
    confirmMatch && acknowledged && totalCount > 0 && !loading && !result;

  const handleClear = async () => {
    if (!canClear) return;
    const cleared = await clearAllSchedules();
    if (cleared) setResult(cleared);
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
        disabled={props.disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => handleOpenChange(true)}
      >
        <RadiationIcon className="size-3.5" />
        Clear all (dev)
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="flex max-h-[min(90dvh,40rem)] flex-col gap-0 p-0 sm:max-w-lg"
          showCloseButton
        >
          <DialogHeader className="space-y-2 border-b border-border/60 px-5 py-4 text-left">
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <DialogTitle className="text-base">Nuclear clear — all employees</DialogTitle>
              <Badge variant="destructive" className="font-normal">
                Dev only
              </Badge>
            </div>
            <DialogDescription className="text-sm leading-relaxed">
              Permanently removes shift assignments, schedule assignments (SSAs), attendance flags,
              and linked HRMS check-ins/attendance for every employee with schedule data. Shared
              Shift Types and Patterns are not deleted.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {result ? (
              <div className="space-y-3 rounded-lg border px-3 py-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-primary">
                      {result.error_count ? "Partial clear completed" : "Site schedule data cleared"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {result.cleared_count} of {result.employee_count} employee(s) processed.
                    </p>
                  </div>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>{result.deleted_assignments} shift assignment(s) removed</li>
                  <li>
                    {result.deleted_ssas} SSA(s) deleted
                    {result.disabled_ssas
                      ? ` · ${result.disabled_ssas} disabled (linked in Desk)`
                      : null}
                  </li>
                  <li>{result.deleted_flags} attendance flag(s) deleted</li>
                  {result.error_count ? (
                    <li className="text-destructive">{result.error_count} employee(s) failed</li>
                  ) : null}
                </ul>
              </div>
            ) : (
              <>
                {loading && !preview ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Loading site-wide impact…
                  </div>
                ) : preview ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Will remove (site-wide)
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

                    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
                      <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
                      <p className="text-sm">
                        <span className="font-semibold tabular-nums">{preview.employee_count}</span>{" "}
                        employee{preview.employee_count !== 1 ? "s" : ""} with schedule data
                      </p>
                    </div>

                    {totalCount === 0 ? (
                      <div className="rounded-lg border border-dashed px-3 py-6 text-center">
                        <p className="text-sm font-medium">Nothing to clear</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          No shift assignments, SSAs, or flags on this site.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <ImpactStat
                          icon={UsersIcon}
                          label="Employees"
                          count={preview.employee_count}
                        />
                        <ImpactStat
                          icon={CalendarRangeIcon}
                          label="Shift assignments"
                          count={preview.shift_assignment_count}
                        />
                        <ImpactStat
                          icon={RepeatIcon}
                          label="SSAs"
                          count={preview.ssa_count}
                        />
                        <ImpactStat
                          icon={FlagIcon}
                          label="Attendance flags"
                          count={preview.attendance_flag_count}
                        />
                      </div>
                    )}

                    {preview.sample_employees.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Includes{" "}
                        <span className="font-mono text-foreground">
                          {preview.sample_employees.slice(0, 3).join(", ")}
                        </span>
                        {preview.employee_count > 3
                          ? ` and ${preview.employee_count - 3} more`
                          : null}
                      </p>
                    ) : null}

                    <div className="flex gap-2 rounded-lg border border-brand-accent/20 bg-brand-accent/10 px-3 py-2 text-xs text-brand-accent">
                      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                      <p>Requires System Manager. This cannot be undone.</p>
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
                        id="clear-all-ack"
                        checked={acknowledged}
                        onCheckedChange={(checked) => setAcknowledged(checked === true)}
                        disabled={loading}
                      />
                      <Label
                        htmlFor="clear-all-ack"
                        className="cursor-pointer text-sm leading-snug font-normal"
                      >
                        I understand this permanently removes schedule and flag data for every
                        affected employee on this site.
                      </Label>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="clear-all-confirm" className="text-xs text-muted-foreground">
                        Type{" "}
                        <span className="font-mono text-foreground">{CLEAR_ALL_CONFIRM_PHRASE}</span>{" "}
                        to confirm
                      </Label>
                      <Input
                        id="clear-all-confirm"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={CLEAR_ALL_CONFIRM_PHRASE}
                        disabled={loading}
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
                        <p className="text-xs text-destructive">Confirmation phrase does not match.</p>
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
                    Clear all schedules
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
