import { useState } from "react";
import { CalendarRangeIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { HoursBucket } from "@/lib/scheduleCoverage";
import { EmployeeLine } from "@/ui/schedule-coverage/EmployeeLine";

function peopleLabel(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function BucketCard({ bucket, defaultOpen }: { bucket: HoursBucket; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const unresolved = bucket.minutes <= 0;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card/40",
        unresolved ? "border-destructive/30" : "border-border/60",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            unresolved && "text-destructive",
          )}
        >
          {bucket.label}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {peopleLabel(bucket.employees.length)}
        </span>
      </button>

      {open ? (
        <ul className="space-y-2 border-t border-border/40 px-3.5 py-3">
          {bucket.employees.map((emp) => (
            <li key={emp.id}>
              <EmployeeLine employee={emp} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function HoursBuckets({ buckets }: { buckets: HoursBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
        <CalendarRangeIcon className="size-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">No assigned schedules yet</p>
        <p className="text-xs text-muted-foreground">
          Once employees have shift assignments, their weekly hours appear here.
        </p>
      </div>
    );
  }

  // Expand the largest bucket by default; collapse the rest to keep the spread scannable.
  return (
    <div className="space-y-2.5">
      {buckets.map((bucket, i) => (
        <BucketCard key={bucket.minutes} bucket={bucket} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
