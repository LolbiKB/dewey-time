import { addDays, format } from "date-fns";
import { FlagIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AppTooltip } from "@/ui/AppTooltip";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { type RunEngineMode, useRunEngine } from "@/hooks/useRunEngine";
import { cn } from "@/lib/utils";

export type RunEngineDialogProps = {
  employee: string | null;
  employeeLabel?: string | null;
  weekStart: Date;
  onSuccess?: () => void;
  disabled?: boolean;
};

const MODE_LABELS: Record<RunEngineMode, string> = {
  intraday: "Intraday",
  closeout: "Closeout",
  both: "Run both",
};

export function RunEngineDialog(props: RunEngineDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<RunEngineMode | null>(null);
  const defaultStart = format(props.weekStart, "yyyy-MM-dd");
  const defaultEnd = format(addDays(props.weekStart, 6), "yyyy-MM-dd");

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const { runEngine, loading, status, clearStatus } = useRunEngine();

  useEffect(() => {
    if (!open) return;
    setStartDate(defaultStart);
    setEndDate(defaultEnd);
    setActiveMode(null);
    clearStatus();
  }, [open, defaultStart, defaultEnd, clearStatus]);

  useEffect(() => {
    if (status?.type !== "success") return;
    const timer = setTimeout(() => setOpen(false), 1800);
    return () => clearTimeout(timer);
  }, [status]);

  const rangeInvalid = useMemo(() => endDate < startDate, [endDate, startDate]);
  const runDisabled = !props.employee || loading || rangeInvalid;

  const handleRun = async (mode: RunEngineMode) => {
    if (!props.employee || rangeInvalid) return;

    setActiveMode(mode);
    const result = await runEngine({
      employee: props.employee,
      start_date: startDate,
      end_date: endDate,
      mode,
    });
    setActiveMode(null);

    if (result) {
      props.onSuccess?.();
    }
  };

  const modeButtonLabel = (mode: RunEngineMode) => {
    if (loading && activeMode === mode) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
          <span className="truncate">Running</span>
        </span>
      );
    }
    return MODE_LABELS[mode];
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <AppTooltip content="Run flag engine (dev)" side="bottom">
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            disabled={props.disabled || !props.employee}
            aria-label="Run flag engine"
          >
            <FlagIcon className="size-4" />
          </Button>
        </DialogTrigger>
      </AppTooltip>

      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton>
        <DialogHeader className="space-y-2 px-5 pt-5 pr-12">
          <DialogTitle>Run flag engine</DialogTitle>
          <DialogDescription>
            Backfill AUTO flags from checkins and shift assignments. Re-running closeout is safe
            — only AUTO rows are replaced.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Employee
            </p>
            <p className="mt-0.5 truncate text-sm font-medium">
              {props.employeeLabel ?? props.employee ?? "—"}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Date range
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <DatePickerInput
                  id="run-engine-start"
                  label="From"
                  value={startDate}
                  onChange={setStartDate}
                  disabled={loading}
                  className="[&>button]:h-9"
                />
              </div>
              <div className="space-y-1.5">
                <DatePickerInput
                  id="run-engine-end"
                  label="To"
                  value={endDate}
                  onChange={setEndDate}
                  disabled={loading}
                  className="[&>button]:h-9"
                />
              </div>
            </div>
          </div>

          {rangeInvalid ? (
            <p className="text-sm text-destructive">End date must be on or after start date.</p>
          ) : null}

          {status ? (
            <div
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                status.type === "error"
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              )}
            >
              {status.message}
            </div>
          ) : null}
        </div>

        <Separator />

        <div className="space-y-3 px-5 py-4">
          <p className="text-xs text-muted-foreground">Max 31 days · HR flags untouched</p>
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 min-w-0 px-2"
              disabled={runDisabled}
              onClick={() => void handleRun("intraday")}
            >
              {modeButtonLabel("intraday")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 min-w-0 px-2"
              disabled={runDisabled}
              onClick={() => void handleRun("closeout")}
            >
              {modeButtonLabel("closeout")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 min-w-0 px-2"
              disabled={runDisabled}
              onClick={() => void handleRun("both")}
            >
              {modeButtonLabel("both")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
