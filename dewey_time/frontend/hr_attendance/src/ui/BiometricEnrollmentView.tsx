import { FingerprintIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { AttentionStrip, FailureBlock } from "@/components/ui/notice";
import { Button } from "@/components/ui/button";
import { toEnrollmentCsv } from "@/lib/enrollmentCsv";
import {
  BUCKET_LABELS,
  filterRows,
  groupRows,
  isFeedConnected,
  snapshotNotice,
  type EnrollmentBucket,
  type EnrollmentFilters,
  type EnrollmentPayload,
  type GroupBy,
} from "@/lib/enrollmentReport";

const NO_FILTERS: EnrollmentFilters = { branches: [], departments: [], buckets: [] };

function download(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type BiometricEnrollmentViewProps = {
  payload: EnrollmentPayload | undefined;
  /** Injected so the snapshot age is deterministic in tests. */
  nowMs: number;
};

export function BiometricEnrollmentView(props: BiometricEnrollmentViewProps) {
  const [filters, setFilters] = useState<EnrollmentFilters>(NO_FILTERS);
  const [groupBy, setGroupBy] = useState<GroupBy>("branch");

  const notice = useMemo(
    () => snapshotNotice(props.payload, props.nowMs),
    [props.payload, props.nowMs],
  );
  const visible = useMemo(
    () => filterRows(props.payload?.rows ?? [], filters),
    [props.payload, filters],
  );
  const groups = useMemo(() => groupRows(visible, groupBy), [visible, groupBy]);

  // The gate. Without a snapshot every employee computes as unenrolled, so
  // rendering the list would turn a plumbing failure into a roster-sized
  // worklist. FailureBlock, not a strip: this IS broken, and it already
  // carries role="alert".
  if (!isFeedConnected(props.payload)) {
    return (
      <div className="flex h-full flex-col p-4">
        <FailureBlock
          title="The device feed is not connected"
          cause="No enrollment snapshot has ever been received. Until the bridge reports, this page cannot tell who is enrolled — every employee would read as unenrolled."
        />
      </div>
    );
  }

  const payload = props.payload!;
  const counts = payload.counts;
  const filterLabel =
    filters.branches.length || filters.departments.length || filters.buckets.length
      ? [
          filters.branches.length ? `Branch: ${filters.branches.join(", ")}` : null,
          filters.departments.length ? `Department: ${filters.departments.join(", ")}` : null,
          filters.buckets.length
            ? `State: ${filters.buckets.map((b) => BUCKET_LABELS[b]).join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join(" | ")
      : "All employees";

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {notice ? (
        <AttentionStrip
          tone={notice.stale ? "amber" : "accent"}
          icon={<FingerprintIcon className="size-4" aria-hidden="true" />}
        >
          {notice.text}
        </AttentionStrip>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(BUCKET_LABELS) as EnrollmentBucket[]).map((bucket) => (
          <button
            key={bucket}
            type="button"
            aria-pressed={filters.buckets.includes(bucket)}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                buckets: prev.buckets.includes(bucket)
                  ? prev.buckets.filter((b) => b !== bucket)
                  : [...prev.buckets, bucket],
              }))
            }
            className="rounded-full border border-border px-2.5 py-1 text-xs aria-pressed:bg-muted"
          >
            {BUCKET_LABELS[bucket]}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGroupBy(groupBy === "branch" ? "department" : "branch")}
            className="rounded-full border border-border px-2.5 py-1 text-xs"
          >
            Group by {groupBy === "branch" ? "branch" : "department"}
          </button>
          <Button
            size="sm"
            variant="outline"
            disabled={counts.truncated}
            title={
              counts.truncated
                ? "The roster is partial — exporting would produce a file that looks complete"
                : undefined
            }
            onClick={() =>
              download(
                toEnrollmentCsv(visible, {
                  snapshotAt: payload.last_snapshot_at,
                  filterLabel,
                }),
                `biometric-enrollment-${payload.last_snapshot_at?.slice(0, 10) ?? "unknown"}.csv`,
              )
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {groups.map((group) => (
          <section key={group.key} className="mb-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.key} · {group.rows.length}
            </h3>
            <ul className="divide-y divide-border rounded-md border border-border">
              {group.rows.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1 truncate">{entry.employee_name}</span>
                  <span
                    className={
                      entry.bucket === "LEAVER_STILL_ENROLLED"
                        ? "rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {BUCKET_LABELS[entry.bucket]}
                  </span>
                  {entry.days_since_relieving !== null ? (
                    <span className="text-xs tabular-nums text-destructive">
                      {entry.days_since_relieving} days
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {counts.excluded_status > 0 ? (
        <p className="text-xs text-muted-foreground">
          {counts.excluded_status} employees are not shown — their status is Inactive or
          Suspended, where "should they be able to clock in?" has no clear answer.
        </p>
      ) : null}
    </div>
  );
}
