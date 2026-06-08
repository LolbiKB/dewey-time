import { cn } from "@/lib/utils";
import type { Severity } from "@/types/calendar";

type FlagCounts = Record<Severity, number>;

export type WeekFlagSummaryProps = {
  counts: FlagCounts;
  loading: boolean;
  className?: string;
};

export function WeekFlagSummary(props: WeekFlagSummaryProps) {
  const { counts, loading, className } = props;
  const total = counts.CRITICAL + counts.WARNING + counts.INFO;

  if (loading || total === 0) return null;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 animate-in fade-in duration-200",
        className
      )}
      aria-label={`This week: ${counts.CRITICAL} critical, ${counts.WARNING} warning, ${counts.INFO} info`}
    >
      {counts.CRITICAL > 0 ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-semibold leading-none sm:px-2 sm:text-[11px]",
            "border-destructive/40 bg-destructive/10 text-destructive"
          )}
        >
          {counts.CRITICAL} Critical
        </span>
      ) : null}
      {counts.WARNING > 0 ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-semibold leading-none sm:px-2 sm:text-[11px]",
            "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100"
          )}
        >
          {counts.WARNING} Warning
        </span>
      ) : null}
      {counts.INFO > 0 ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-semibold leading-none sm:px-2 sm:text-[11px]",
            "border-border bg-muted/40 text-muted-foreground"
          )}
        >
          {counts.INFO} Info
        </span>
      ) : null}
    </div>
  );
}
