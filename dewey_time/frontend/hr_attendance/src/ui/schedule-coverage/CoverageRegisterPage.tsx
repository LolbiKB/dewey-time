import { useCallback, useMemo, useState } from "react";
import { EmptyState, GenericDataTable, Page, PageHeader, Section } from "@lolbikb/dewey-ui";
import { AlertTriangleIcon } from "lucide-react";
import { Navigate, useNavigate, useOutletContext } from "react-router-dom";

import { AttentionStrip, FailureBlock } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { useCoverageRegister } from "@/hooks/useCoverageRegister";
import {
  filterRegisterRows,
  sortRegisterRows,
  visibleColumnIds,
  type FeedHealth,
  type RegisterAlert,
  type RegisterFilters,
  type RegisterRow,
} from "@/lib/coverageRegister";
import { AlertDot } from "@/ui/schedule-coverage/AlertDot";
import { registerColumns } from "@/ui/schedule-coverage/registerColumns";

export type CoverageRegisterViewProps = {
  /** Joined AND suppressed — the hook's `rows`, never a fresh join. */
  rows: RegisterRow[];
  feeds: FeedHealth;
  alert: RegisterAlert;
  truncated: boolean;
  isLoading: boolean;
  /** Neither feed answered AND neither holds data from a prior load. */
  bothFailed: boolean;
  filters: RegisterFilters;
  onFiltersChange: (next: RegisterFilters) => void;
  onRetry: () => void;
  onOpen: (row: RegisterRow) => void;
  onAddSchedule: (row: RegisterRow) => void;
};

/**
 * The register's whole surface — chrome, alert, notices and table — with no
 * router, no react-query and no data fetching, so it renders under
 * `renderToStaticMarkup` in the test suite. `CoverageRegisterPage` below is
 * the only piece that talks to either.
 *
 * Split for the same reason `FlagQueueView` is: this suite has no jsdom and no
 * React Testing Library, so anything left inside the routed component can only
 * ever be checked by reading the file as text. Gating decisions — which is
 * most of what this component does — are exactly what a grep cannot verify.
 */
export function CoverageRegisterView(props: CoverageRegisterViewProps) {
  const { rows, feeds, filters, isLoading, bothFailed, onFiltersChange, onOpen, onAddSchedule } =
    props;

  // Memoised, and fed only stable callbacks: registerColumns allocates a new
  // array and new per-row closures on every call, and TanStack resets column
  // state whenever the `columns` reference changes.
  const columns = useMemo(
    () => registerColumns(onOpen, onAddSchedule),
    [onOpen, onAddSchedule],
  );

  // Columns are REMOVED when their feed is absent, never blanked — an empty
  // Biometric column reads as a whole roster who cannot clock in, which is a
  // bridge fault rendered as a workforce crisis.
  const visible = useMemo(() => new Set(visibleColumnIds(feeds)), [feeds]);
  const shownColumns = useMemo(
    () => columns.filter((column) => visible.has(column.id as string)),
    [columns, visible],
  );

  const data = useMemo(
    () => sortRegisterRows(filterRegisterRows(rows, filters), filters),
    [rows, filters],
  );

  // Without this GenericDataTable's footer reads "Showing 241 of 0 employees"
  // (`meta?.total || 0`) and its pager reads a permanent "Loading...". There is
  // one page: every row is already in hand, and the table is told
  // `manualPagination`, so nothing slices `data`.
  const meta = useMemo(
    () => ({
      total: rows.length,
      page: 1,
      limit: data.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    }),
    [rows.length, data.length],
  );

  // Everything below is withheld until the feeds have actually answered.
  //
  // While either query is pending BOTH payloads are `undefined`, so feedHealth
  // reads {schedule:false, biometric:false}: the alert computes as `degraded`
  // ("… schedules and biometrics unavailable") and the biometric notice
  // renders. Ungated, every ordinary page load would open on an outage that is
  // not happening. Nothing is wrong yet, so nothing may say so yet.
  const answered = !isLoading;

  return (
    <Page>
      <PageHeader
        title="Coverage"
        // "0 employees" under a spinner is the same rendered non-fact as the
        // footer's zero — the roster size is not known yet.
        description={answered ? rosterDescription(rows.length) : "Loading…"}
        actions={
          answered ? (
            <AlertDot
              alert={props.alert}
              active={filters.readiness === "not-ready"}
              onToggle={() => onFiltersChange(toggleReadiness(filters))}
            />
          ) : null
        }
      />

      {/* AttentionStrip, NOT FailureBlock: FailureBlock carries a 13rem
          min-height and is a full-region placeholder — as a banner above a
          working table it would squash the table. AttentionStrip's tone union
          is exactly "amber" | "accent"; there is no "destructive"/"warning".

          Suppressed when `bothFailed`, on top of the loading gate. Its closing
          sentence promises the schedule half is fine, which is precisely what
          bothFailed denies — and notice.tsx's own rule is that a page showing
          both a banner and a replaced region reports one failure twice. */}
      {answered && !bothFailed && !feeds.biometric ? (
        <AttentionStrip
          tone="amber"
          icon={<AlertTriangleIcon className="size-4 text-amber-600" aria-hidden="true" />}
        >
          Biometric feed unavailable — enrolment <strong>and leaver detection</strong> are hidden
          rather than shown as empty. Every employee would otherwise read as unenrolled, which is a
          bridge fault, not 241 people losing their fingerprints. Schedule coverage is unaffected.
        </AttentionStrip>
      ) : null}

      {answered && !bothFailed && props.truncated ? (
        <AttentionStrip
          tone="accent"
          icon={<AlertTriangleIcon className="size-4 text-brand-accent" aria-hidden="true" />}
        >
          The roster is partial — some employees are not shown.
        </AttentionStrip>
      ) : null}

      <Section grow>
        {bothFailed ? (
          // min-h-0 because `Section grow` is an overflow-hidden clipper that
          // would otherwise cut the Retry button off on a short viewport.
          <FailureBlock title="Coverage didn’t load" onRetry={props.onRetry} className="min-h-0" />
        ) : (
          <GenericDataTable
            columns={shownColumns}
            data={data}
            meta={meta}
            loading={isLoading}
            filters={filters}
            onFiltersChange={onFiltersChange}
            getRowId={(row: RegisterRow) => row.id}
            layout="fill"
            columnWidths="fixed"
            hidePageSize
            config={{
              entityName: "employees",
              entityNameSingular: "employee",
              searchPlaceholder: "Search by name or employee ID…",
            }}
          />
        )}
      </Section>
    </Page>
  );
}

function rosterDescription(count: number): string {
  return `${count} ${count === 1 ? "employee" : "employees"}`;
}

/**
 * What pressing the alert dot does: show only the rows that need attention,
 * and press it again to go back.
 *
 * Exported and lifted out of the dot's `onToggle` for the reason `decideEffect`
 * and `stripInputs` are in FlagQueuePage — `renderToStaticMarkup` drops
 * function props from its output, so a spread left inline there is a line no
 * test in this suite can reach. Every other filter has to survive the toggle:
 * silently dropping a search the reader had typed would look like the dot
 * clearing their work.
 */
export function toggleReadiness(filters: RegisterFilters): RegisterFilters {
  return {
    ...filters,
    readiness: filters.readiness === "not-ready" ? undefined : "not-ready",
  };
}

/**
 * The one readiness register: who can be tracked today, and who cannot.
 *
 * Replaces the three surfaces that used to answer that in pieces — the
 * Needs-a-schedule list, the weekly-hours buckets and the biometrics page —
 * with a single audit table. It holds no derivation of its own: filtering,
 * sorting, column visibility, the alert and the join all come from
 * `lib/coverageRegister.ts` as pure, tested functions.
 */
export function CoverageRegisterPage() {
  const { hrStaff, sessionLoading } = useOutletContext<HrAccessOutletContext>();
  const navigate = useNavigate();
  // Empty, and `sort` in particular is left undefined rather than seeded with
  // "name". sortRegisterRows only applies severity ordering while
  // `filters.sort` is unset, so a seed here would silently retire "worst
  // first" for the not-ready view — pinned in coverageRegister.test.ts.
  const [filters, setFilters] = useState<RegisterFilters>({});

  // Computed once. An inline `Date.now()` would move the staleness boundary
  // feedHealth reads on every render, so a snapshot could flip either side of
  // "stale" mid-session, and the hook's memo — which keys on this value —
  // would never hit.
  const nowMs = useMemo(() => Date.now(), []);

  const { rows, feeds, alert, truncated, isLoading, bothFailed, refresh } =
    useCoverageRegister(nowMs);

  // useCallback so the view's `registerColumns` memo actually holds.
  const handleOpen = useCallback(
    (row: RegisterRow) => navigate(`/hr-attendance?employee=${encodeURIComponent(row.id)}`),
    [navigate],
  );
  const handleAddSchedule = useCallback(
    (row: RegisterRow) => navigate(`/hr-schedule?employee=${encodeURIComponent(row.id)}`),
    [navigate],
  );

  if (sessionLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={Spinner} title="Loading…" className="border-none" />
      </div>
    );
  }
  if (!hrStaff) return <Navigate to="/hr-attendance" replace />;

  return (
    <CoverageRegisterView
      rows={rows}
      feeds={feeds}
      alert={alert}
      truncated={truncated}
      isLoading={isLoading}
      bothFailed={bothFailed}
      filters={filters}
      onFiltersChange={setFilters}
      onRetry={refresh}
      onOpen={handleOpen}
      onAddSchedule={handleAddSchedule}
    />
  );
}
