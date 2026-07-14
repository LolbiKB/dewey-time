import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  LayersIcon,
  Loader2Icon,
  RadiationIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ResponsiveModal } from "@/components/ResponsiveModal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CLEAR_SITE_PATTERNS_CONFIRM_PHRASE,
  useClearSitePatterns,
  type WipeStep,
} from "@/hooks/useClearSitePatterns";
import { cn } from "@/lib/utils";
import type { ClearSitePatternsPreview } from "@/types/schedule";

export type ClearSitePatternsDialogProps = {
  onSuccess?: () => void;
  disabled?: boolean;
  triggerClassName?: string;
};

export function ClearSitePatternsDialog(props: ClearSitePatternsDialogProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ClearSitePatternsPreview | null>(null);
  const [result, setResult] = useState<WipeStep | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [clearEmployeeData, setClearEmployeeData] = useState(true);
  const { loadPreview, clearSitePatterns, loading, running, progress, status, clearStatus } =
    useClearSitePatterns();

  const refreshPreview = useCallback(() => {
    setPreview(null);
    void loadPreview(clearEmployeeData).then(setPreview);
  }, [clearEmployeeData, loadPreview]);

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
    void loadPreview(clearEmployeeData).then((data) => {
      if (!cancelled) setPreview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, clearEmployeeData, clearStatus, loadPreview]);

  const confirmMatch = confirmText.trim() === CLEAR_SITE_PATTERNS_CONFIRM_PHRASE;

  const totalCount = preview
    ? preview.shift_schedule_count +
      preview.shift_type_count +
      (clearEmployeeData && preview.employee_preview
        ? preview.employee_preview.shift_assignment_count +
          preview.employee_preview.ssa_count +
          preview.employee_preview.attendance_flag_count
        : 0)
    : 0;

  const canClear = confirmMatch && acknowledged && totalCount > 0 && !loading && !result;

  const handleClear = async () => {
    if (!canClear) return;
    const cleared = await clearSitePatterns(clearEmployeeData);
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
        <LayersIcon className="size-3.5" />
        Wipe patterns (dev)
      </Button>

      <ResponsiveModal
        open={open}
        onOpenChange={handleOpenChange}
        size="md"
        title={
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <span className="text-base">Nuclear wipe — site patterns</span>
            <Badge variant="destructive" className="font-normal">
              Dev only
            </Badge>
          </div>
        }
        description={
          <span className="text-sm leading-relaxed">
            Deletes all Shift Schedules (PAT) and Shift Types on the site. Optionally clears
            every employee&apos;s SSAs, shift assignments, flags, and linked check-ins first —
            full reset before a clean bulk import.
          </span>
        }
        headerClassName="space-y-2 border-b border-border/60 px-5 py-4 text-left"
        bodyClassName="space-y-4 px-5 py-4"
        footer={
          result ? (
            <Button type="button" size="default" className="h-9" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          ) : (
            <Button
              type="button"
              size="default"
              className="h-9 min-w-[9rem] bg-destructive text-white hover:bg-destructive/90"
              disabled={!canClear}
              onClick={() => void handleClear()}
            >
              {loading ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Wiping…
                </>
              ) : (
                <>
                  <Trash2Icon className="size-3.5" />
                  Wipe site patterns
                </>
              )}
            </Button>
          )
        }
        footerClassName="mx-0 mb-0 shrink-0 gap-2 border-t border-border/60 bg-muted/50 px-5 py-4 sm:justify-end"
      >
        {result ? (
              <div className="space-y-3 rounded-lg border px-3 py-3">
                <div className="flex items-start gap-2">
                  {result.verified_empty ? (
                    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  ) : (
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="space-y-1">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        result.verified_empty ? "text-primary" : "text-destructive"
                      )}
                    >
                      {result.verified_empty ? "Site wipe verified clean" : "Wipe incomplete — rows remain"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {result.verified_empty
                        ? "All schedule tables confirmed empty."
                        : "Some rows could not be removed. Re-run to finish."}
                    </p>
                  </div>
                </div>
                {!result.verified_empty && result.remaining_counts ? (
                  <ul className="space-y-1 text-xs text-destructive">
                    {Object.entries(result.remaining_counts)
                      .filter(([, count]) => count > 0)
                      .map(([table, count]) => (
                        <li key={table}>
                          {count} {table} row(s) still present
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
            ) : running ? (
              <div className="space-y-3 rounded-lg border px-3 py-4">
                <div className="flex items-center gap-2">
                  <Loader2Icon className="size-4 animate-spin text-destructive" />
                  <p className="text-sm font-medium">Wiping site patterns…</p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive transition-all duration-300"
                    style={{
                      width: `${
                        progress && progress.total > 0
                          ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
                          : 5
                      }%`,
                    }}
                  />
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {progress?.currentTable ? `Clearing ${progress.currentTable} · ` : ""}
                  {(progress?.processed ?? 0).toLocaleString()} /{" "}
                  {(progress?.total ?? 0).toLocaleString()} rows
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Runs in batches — keep this tab open until it finishes.
                </p>
              </div>
            ) : (
              <>
                <label className="flex items-start gap-2 rounded-lg border px-3 py-2.5">
                  <Checkbox
                    checked={clearEmployeeData}
                    onCheckedChange={(checked) => setClearEmployeeData(checked === true)}
                    disabled={loading}
                    className="mt-0.5"
                  />
                  <span className="text-sm leading-snug">
                    Clear all employee SSAs, shift assignments, and flags first (recommended)
                  </span>
                </label>

                {loading && !preview ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-8 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Loading impact…
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

                    <div className="grid grid-cols-2 gap-2">
                      <ImpactStat label="Shift Schedules (PAT)" count={preview.shift_schedule_count} />
                      <ImpactStat label="Shift Types" count={preview.shift_type_count} />
                    </div>

                    {clearEmployeeData && preview.employee_preview ? (
                      <p className="text-xs text-muted-foreground">
                        Plus per employee: {preview.employee_preview.ssa_count} SSA(s),{" "}
                        {preview.employee_preview.shift_assignment_count} shift assignment(s),{" "}
                        {preview.employee_preview.attendance_flag_count} flag(s) across{" "}
                        {preview.employee_preview.employee_count} employee(s)
                      </p>
                    ) : null}

                    {preview.sample_shift_schedules.length > 0 ? (
                      <p className="font-mono text-[11px] text-muted-foreground">
                        PATs include {preview.sample_shift_schedules.slice(0, 3).join(", ")}
                        {preview.shift_schedule_count > 3
                          ? ` +${preview.shift_schedule_count - 3} more`
                          : ""}
                      </p>
                    ) : null}

                    <div className="flex gap-2 rounded-lg border border-brand-accent/20 bg-brand-accent/10 px-3 py-2 text-xs text-brand-accent">
                      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                      <p>
                        Requires System Manager. Import will recreate PATs/FTs on apply. Cannot be
                        undone.
                      </p>
                    </div>
                  </div>
                ) : status?.type === "error" ? (
                  <p className="text-sm text-destructive">{status.message}</p>
                ) : null}

                {totalCount > 0 && preview && !loading ? (
                  <div className="space-y-3 rounded-lg border px-3 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Confirm
                    </p>
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="clear-patterns-ack"
                        checked={acknowledged}
                        onCheckedChange={(checked) => setAcknowledged(checked === true)}
                        disabled={loading}
                      />
                      <Label
                        htmlFor="clear-patterns-ack"
                        className="cursor-pointer text-sm leading-snug font-normal"
                      >
                        I understand this deletes shared Shift Schedules and Shift Types for the
                        entire site.
                      </Label>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="clear-patterns-confirm" className="text-xs text-muted-foreground">
                        Type{" "}
                        <span className="font-mono text-foreground">
                          {CLEAR_SITE_PATTERNS_CONFIRM_PHRASE}
                        </span>{" "}
                        to confirm
                      </Label>
                      <Input
                        id="clear-patterns-confirm"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        disabled={loading}
                        className="h-9 font-mono text-sm"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                ) : null}

                {status?.type === "error" && !result ? (
                  <p className="text-sm text-destructive">{status.message}</p>
                ) : null}
              </>
            )}
      </ResponsiveModal>
    </>
  );
}

function ImpactStat(props: { label: string; count: number }) {
  const active = props.count > 0;
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        active ? "border-destructive/25 bg-destructive/5" : "border-border/60 bg-muted/20"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <RadiationIcon
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
