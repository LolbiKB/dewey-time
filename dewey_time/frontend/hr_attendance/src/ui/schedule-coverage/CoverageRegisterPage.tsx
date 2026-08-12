import { useCallback, useMemo, useState } from "react";
import { EmptyState, GenericDataTable, Page, PageHeader, Section } from "@lolbikb/dewey-ui";
import { AlertTriangleIcon } from "lucide-react";
import { Navigate, useNavigate, useOutletContext } from "react-router-dom";

import { AttentionStrip, FailureBlock } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { useCoverageRegister } from "@/hooks/useCoverageRegister";
import {
  columnIdForSort,
  filterRegisterRows,
  sortFromColumnId,
  sortRegisterRows,
  visibleColumnIds,
  type FeedHealth,
  type RegisterAlert,
  type RegisterFilters,
  type RegisterRow,
} from "@/lib/coverageRegister";
import { AlertDot } from "@/ui/schedule-coverage/AlertDot";
import { registerColumns } from "@/ui/schedule-coverage/registerColumns";
import { RegisterExportButton } from "@/ui/schedule-coverage/RegisterExportButton";
import { RegisterFilterBar } from "@/ui/schedule-coverage/RegisterFilterBar";

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

  // Translated at the boundary, in both directions — see RegisterTableFilters.
  const tableFilters = useMemo<RegisterTableFilters>(
    () => ({ ...filters, sort: columnIdForSort(filters.sort) }),
    [filters],
  );
  const handleTableFiltersChange = useCallback(
    (next: RegisterTableFilters) => onFiltersChange(registerFiltersFromTable(next)),
    [onFiltersChange],
  );

  // Without this GenericDataTable's footer reads "Showing 241 of 0 employees"
  // (`meta?.total || 0`) and its pager reads a permanent "Loading...". There is
  // one page: every row is already in hand, and the table is told
  // `manualPagination`, so nothing slices `data`.
  //
  // `limit` is the page SIZE, and one page holds the lot. It is not the
  // filtered count — GenericDataTable takes its page size from `filters.limit`
  // and never reads this field, so naming it after the filtered row count
  // would only mislead whoever reads it next.
  const meta = useMemo(
    () => ({
      total: rows.length,
      page: 1,
      limit: rows.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    }),
    [rows.length],
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
            filters={tableFilters}
            onFiltersChange={handleTableFiltersChange}
            getRowId={(row: RegisterRow) => row.id}
            layout="fill"
            columnWidths="fixed"
            hidePageSize
            // Facet options come from `rows`, NOT `data` — see the bar's props.
            //
            // No `answered` gate here, unlike the export beside it. The bar
            // derives every control from the roster and drops any facet with no
            // options, so a pending load — which holds no rows — already
            // renders nothing; a gate would be a second copy of that rule that
            // no test could reach. And if a future load ever does hold rows
            // while refetching, leaving the reader's controls on screen is the
            // right answer anyway.
            toolbarLeading={
              <RegisterFilterBar
                rows={rows}
                feeds={feeds}
                filters={filters}
                onFiltersChange={onFiltersChange}
              />
            }
            // The export DOES wait for the feeds, on the same rule as the alert
            // dot and the notices: mid-load it would offer a file built from an
            // unanswered roster and count it aloud as "0 employees".
            toolbarActions={
              answered ? (
                <RegisterExportButton rows={data} feeds={feeds} truncated={props.truncated} />
              ) : null
            }
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
 * RegisterFilters as GenericDataTable sees it.
 *
 * That primitive treats `sort` as one of its own COLUMN IDS in both
 * directions: it builds its sorting state as `[{ id: filters.sort, ... }]` and
 * hands the pressed column's id straight back through `onFiltersChange`. This
 * module's vocabulary is `"name" | "hours" | "prints"`, which sortRegisterRows
 * and its tests have used since the sort was written, so the two are
 * translated here at the boundary rather than smeared through the pure
 * functions. Without the inbound half, `column.getIsSorted()` is false on
 * every column: no header shows a direction, every press repeats the first
 * direction, and the sort can never be cleared.
 */
type RegisterTableFilters = Omit<RegisterFilters, "sort"> & { sort?: string };

/**
 * What the table just did, in this module's terms.
 *
 * A column id nothing sorts by clears the sort rather than storing a value
 * sortRegisterRows does not understand — which would look like no sort while
 * still suppressing severity order, since that is gated on `!filters.sort`.
 * `order` goes with it: an order with no sort is a half-instruction.
 *
 * Lifted out of the callback for the reason `toggleReadiness` is —
 * `renderToStaticMarkup` drops function props, so a body left inline there is
 * a line no test in this suite can reach.
 */
export function registerFiltersFromTable(next: RegisterTableFilters): RegisterFilters {
  const { sort: columnId, order, ...rest } = next;
  const resolved = columnId === undefined ? null : sortFromColumnId(columnId, order === "desc");
  return resolved === null ? rest : { ...rest, ...resolved };
}

/**
 * How the register opens: nothing filtered, nothing sorted.
 *
 * `status` in particular has NO default. Defaulting to Active would hide every
 * leaver still holding a template — the security finding this page exists to
 * show — while the alert dot beside it went on counting them, so the reader
 * would see a number they could not reach.
 *
 * `sort` is left undefined for a second reason: sortRegisterRows only applies
 * severity ordering while `filters.sort` is unset, so seeding it with "name"
 * would quietly retire "worst first" for the not-ready view.
 *
 * A constant rather than an inline literal so both claims are pinnable
 * directly — this suite has no jsdom and cannot read a component's useState.
 *
 * Frozen because useState holds this exact object as the first state: every
 * update goes through a spread today, but a single in-place write anywhere
 * would give the register a default status for the rest of the session, and
 * silently. This turns that into a throw.
 */
export const INITIAL_REGISTER_FILTERS: RegisterFilters = Object.freeze({});

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
  const [filters, setFilters] = useState<RegisterFilters>(INITIAL_REGISTER_FILTERS);

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
