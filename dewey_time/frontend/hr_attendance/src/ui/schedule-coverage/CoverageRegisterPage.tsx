import { useCallback, useMemo, useState } from "react";
import {
  EmptyState,
  GenericDataTable,
  Page,
  Section,
  useIsMobile,
  type BaseTableMeta,
} from "@lolbikb/dewey-ui";
import { AlertTriangleIcon } from "lucide-react";
import { Navigate, useNavigate, useOutletContext } from "react-router-dom";

import { AttentionStrip, FailureBlock } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import type { HrAccessOutletContext } from "@/lib/hrAccess";
import { useCoverageRegister } from "@/hooks/useCoverageRegister";
import { useTelegramLink } from "@/hooks/useTelegramLink";
import { TelegramDialog } from "@/ui/telegram/TelegramDialog";
import {
  applyFilterChange,
  columnIdForSort,
  filterRegisterRows,
  paginateRegisterRows,
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
import {
  registerSearchPlaceholder,
  RegisterFilterBar,
} from "@/ui/schedule-coverage/RegisterFilterBar";

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
  onManageTelegram: (row: RegisterRow) => void;
  /**
   * Under 768px, where dewey-ui's toolbar row runs out of room.
   *
   * A prop rather than a `useIsMobile()` call in here, so both branches are
   * reachable from a suite with no DOM: `useIsMobile` reads `matchMedia` in an
   * effect, and under `renderToStaticMarkup` no effect runs, so it would
   * report the desktop branch forever and the phone toolbar would be pinned by
   * nothing but the e2e. The page above supplies it.
   */
  narrow?: boolean;
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
  const {
    rows,
    feeds,
    filters,
    isLoading,
    bothFailed,
    narrow = false,
    onFiltersChange,
    onOpen,
    onAddSchedule,
    onManageTelegram,
  } = props;

  // Memoised, and fed only stable callbacks: registerColumns allocates a new
  // array and new per-row closures on every call, and TanStack resets column
  // state whenever the `columns` reference changes.
  const columns = useMemo(
    () => registerColumns(onOpen, onAddSchedule, onManageTelegram),
    [onOpen, onAddSchedule, onManageTelegram],
  );

  // Columns are REMOVED when their feed is absent, never blanked — an empty
  // Biometric column reads as a whole roster who cannot clock in, which is a
  // bridge fault rendered as a workforce crisis.
  const visible = useMemo(() => new Set(visibleColumnIds(feeds)), [feeds]);
  const shownColumns = useMemo(
    () => columns.filter((column) => visible.has(column.id as string)),
    [columns, visible],
  );

  // `paginate(sort(filter(rows)))`, and the middle result is kept: `matching`
  // is every row the reader's filters admit, `data` is the one page of them the
  // table renders. The CSV and the export button's own count read `matching`,
  // because a reader on page 2 still needs the whole filtered truth and a file
  // holding one page of it would look exactly like a file holding all of it.
  const matching = useMemo(
    () => sortRegisterRows(filterRegisterRows(rows, filters), filters),
    [rows, filters],
  );
  const { rows: data, meta } = useMemo(
    () => paginateRegisterRows(matching, filters),
    [matching, filters],
  );

  // Translated at the boundary, in both directions — see RegisterTableFilters.
  const tableFilters = useMemo<RegisterTableFilters>(
    () => registerTableFilters(filters, narrow, meta),
    [filters, narrow, meta],
  );
  // NOT wrapped in applyFilterChange, unlike the bar's controls and the alert
  // dot: GenericDataTable already stamps `page: 1` on its own search, sort and
  // page-size writes, and its pager buttons write the one page change that must
  // survive. Resetting here would make the pager unable to leave page 1.
  const handleTableFiltersChange = useCallback(
    (next: RegisterTableFilters) => onFiltersChange(mergeTableFilters(filters, next, narrow)),
    [filters, narrow, onFiltersChange],
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
      {/* No PageHeader. It cost a whole block of vertical space to say
          "Coverage · 503 employees", and neither half was earning it: the tab
          the reader arrived through already reads Coverage, and the count now
          rides in the search placeholder, where it costs no height at all.
          /hr-attendance is the existing precedent for a routed page with no
          header (chromeMigration.test.tsx pins that one); `<Page>` stays, which
          is what the parity guard and page-insets.spec.ts actually require.

          The heading does NOT go with it. `sr-only` is zero pixels, so the
          space is still reclaimed, but screen-reader users navigate by heading
          and a route with none has no answer to "where am I". It is also a
          stabler e2e anchor than any column header. */}
      <h1 className="sr-only">Coverage</h1>

      {/* AttentionStrip, NOT FailureBlock: FailureBlock carries a 13rem
          min-height and is a full-region placeholder — as a banner above a
          working table it would squash the table. AttentionStrip's tone union
          is exactly "amber" | "accent"; there is no "destructive"/"warning".

          Suppressed when `bothFailed`, on top of the loading gate: notice.tsx's
          own rule is that a page showing both a banner and a replaced region
          reports one failure twice.

          ONE strip naming whichever feeds are down, not one per feed. A
          schedule outage used to get no notice at all — its columns vanished
          with the reason living only in the alert dot's accessible name, which
          a sighted reader never hears — and it is the likelier of the two, an
          app-server error rather than a bridge going quiet. Two strips would
          have stacked two banners over one table for the both-down case and
          each would have closed by promising the other half was fine. */}
      {answered && !bothFailed && feedNotice(feeds) !== null ? (
        <AttentionStrip
          tone="amber"
          icon={<AlertTriangleIcon className="size-4 text-amber-600" aria-hidden="true" />}
        >
          {feedNotice(feeds)}
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

      {/* `-m-1 p-1` is room for a focus ring inside the clip, and nothing else.
          It moves NOTHING: `overflow: hidden` clips at the PADDING box, so the
          padding pushes the clip edge 4px outwards and the equal negative
          margin puts the box back where it was.

          `Section grow` is `overflow-hidden`, and this page is the only one
          that puts focusable controls flush against all four of its edges —
          measured, at 1280 and at 375. With no PageHeader above it the toolbar
          starts at the section's exact top, and the table fills the rest, so
          the pager sits on its exact bottom. Every control there carries
          dewey-ui's `focus-visible:ring-3`, a 3px box-shadow OUTSIDE the border
          box, and every pixel of it above the alert dot, the facets, the search
          box, Columns and Export — and below the pager, and left of the dot,
          and right of Export — was being cut off. Keyboard focus is the one
          state with nowhere else to show itself: a half-drawn ring on the
          control you are standing on is the reader losing their place.

          4px, for a 3px ring, both smaller than the 20px page gutter the
          horizontal half spends and the 16px page padding the vertical half
          spends. The other four routes measured clean and take nothing. */}
      <Section grow className="-m-1 p-1">
        {bothFailed ? (
          // min-h-0 because `Section grow` is an overflow-hidden clipper that
          // would otherwise cut the Retry button off on a short viewport.
          <FailureBlock title="Coverage didn’t load" onRetry={props.onRetry} className="min-h-0" />
        ) : (
          <GenericDataTable
            // Remounted when the search box changes owner, and ONLY for that.
            //
            // GenericDataTable seeds its debounced copy of `filters.search`
            // once at mount and never resyncs it from props. Cross the
            // breakpoint with a search active and that copy is stranded: on
            // the way down `registerTableFilters` blanks what it is compared
            // against, and its input is hidden by then so nothing can move it
            // back into agreement. `filters` is a fresh object every render,
            // so its write-back effect re-fired every render —
            // onFiltersChange -> setFilters -> render — until React gave up
            // with "Maximum update depth exceeded" and the top-level
            // ErrorBoundary replaced the WHOLE app. On the way up the same
            // stranded `""` echoed back through the boundary and silently
            // erased a search the reader had typed on the phone.
            //
            // A remount re-seeds that copy from the filters in force at the
            // moment of the flip, which settles both directions. It is not a
            // substitute for the blanking below: typing while narrow never
            // crosses the breakpoint, so nothing remounts, and without the
            // blanking the same disagreement returns on the first keystroke.
            //
            // The cost is the primitive's internal column-visibility and
            // row-selection state, discarded at the crossing. Neither survives
            // the crossing meaningfully anyway — the column toggle is hidden
            // below 768, and this table selects no rows.
            //
            // One more thing rides in `toolbarActions` and so goes with it: an
            // OPEN export confirmation closes if the reader resizes across 768
            // while deciding. Checked rather than assumed — Radix tears down
            // cleanly, no overlay is stranded, the page stays usable, no error
            // is logged and the dialog reopens from the narrow toolbar. No file
            // is written either way, so the worst case is a decision to retake.
            // It goes when this key does.
            key={narrow ? "narrow" : "wide"}
            columns={shownColumns}
            data={data}
            meta={meta}
            loading={isLoading}
            filters={tableFilters}
            onFiltersChange={handleTableFiltersChange}
            getRowId={(row: RegisterRow) => row.id}
            layout="fill"
            columnWidths="fixed"
            // The size control was hidden for "fixed-page-size APIs", which
            // this stopped being the moment paginateRegisterRows started
            // slicing: with real pages it is the reader's own answer to a
            // 503-employee roster, so on a laptop it earns its place.
            // REGISTER_PAGE_SIZE has to stay inside the five sizes it offers —
            // see that constant for what a size outside them does to the
            // select.
            //
            // Below 768 it goes, for the same measured reason the search box
            // and the column toggle do: dewey-ui's footer row does not wrap
            // either, and adding "Rows per page" plus a `w-16` select to it
            // pushed the document 49px wider than a 375px viewport — measured,
            // and caught by the toolbar-fit spec. The reader keeps the pager
            // and the count; only the size choice waits for a wider screen.
            hidePageSize={narrow}
            // Under 768px both of these are handed off or dropped, because
            // dewey-ui's toolbar row does not wrap: measured at 375 and 412,
            // its `w-64` search input is drawn over this bar's Status facet
            // and its Columns dropdown sits ~57px off the right of the screen
            // (Section's overflow-hidden clips it, so the page never scrolls
            // and no scrollWidth check can see it). The search moves INTO the
            // bar, which wraps; the column toggle simply goes, and loses
            // nothing — which columns exist here is decided by feed health,
            // and a reader hiding one by hand would be quietly contradicting
            // the suppression rule this page is built on.
            hideSearch={narrow}
            hideColumnToggle={narrow}
            // Facet options come from `rows`, NOT `data` — see the bar's props.
            //
            // No `answered` gate here, unlike the export beside it. The bar
            // derives every control from the roster and drops any facet with no
            // options, so a pending load — which holds no rows — already
            // renders nothing; a gate would be a second copy of that rule that
            // no test could reach. And if a future load ever does hold rows
            // while refetching, leaving the reader's controls on screen is the
            // right answer anyway.
            //
            // The alert dot LEADS this slot, ahead of the facets. It used to
            // sit in PageHeader's actions, on the reasoning that an alarm
            // belongs with the title rather than among the filters — there is
            // no title now, and pressing it does filter the table, so the
            // toolbar is where it belongs. Its three shapes, its accessible
            // name and its toggle are unchanged.
            toolbarLeading={
              <>
                {answered ? (
                  <AlertDot
                    alert={props.alert}
                    active={filters.readiness === "not-ready"}
                    onToggle={() => onFiltersChange(toggleReadiness(filters))}
                  />
                ) : null}
                <RegisterFilterBar
                  rows={rows}
                  feeds={feeds}
                  filters={filters}
                  onFiltersChange={onFiltersChange}
                  showSearch={narrow}
                />
              </>
            }
            // The export DOES wait for the feeds, on the same rule as the alert
            // dot and the notices: mid-load it would offer a file built from an
            // unanswered roster and count it aloud as "0 employees".
            //
            // `matching`, NOT `data`: every filtered row, not the page in view.
            // A reader who narrowed to 80 problem rows and exported from page 2
            // would otherwise get 50 of them in a file that says nothing about
            // the other 30, and nothing downstream could tell that file from a
            // complete one.
            //
            // `filters` and `rosterSize` are for the confirmation only — what
            // narrowed the file, and what it was narrowed FROM. Nothing in the
            // export applies them; `matching` is already the answer.
            toolbarActions={
              answered ? (
                <RegisterExportButton
                  rows={matching}
                  rosterSize={rows.length}
                  feeds={feeds}
                  filters={filters}
                  truncated={props.truncated}
                />
              ) : null
            }
            config={{
              entityName: "employees",
              entityNameSingular: "employee",
              // Shared with the bar's own box, so the control reads and is
              // NAMED the same on either side of the breakpoint. `rows` is the
              // whole roster, so the count is the roster's and does not move
              // as the reader filters.
              searchPlaceholder: registerSearchPlaceholder(rows.length),
            }}
          />
        )}
      </Section>
    </Page>
  );
}

/**
 * What the notice says about the feeds that are down, or null when neither is.
 *
 * Names every down feed, on the same rule as `registerAlert`'s label: naming
 * only one when both are down asserts by omission that the other half is fine.
 * That is why the reassurance clause is dropped entirely in the both-down case
 * rather than being written twice.
 *
 * No roster size in the copy. It used to read "not 241 people losing their
 * fingerprints" — a number frozen at whatever the roster was the day it was
 * written, which would have aged silently and, on the day the biometric feed
 * was down, could not have been checked against anything on screen.
 *
 * Exported so both halves of the both-down wording are reachable without a
 * DOM; the strip itself is asserted in the rendered view.
 */
export function feedNotice(feeds: FeedHealth): string | null {
  if (feeds.schedule && feeds.biometric) return null;

  if (!feeds.schedule && !feeds.biometric) {
    return (
      "Schedule and biometric feeds are both unavailable — assignments, weekly hours, " +
      "enrolment and leaver detection are all hidden rather than shown as empty, and any " +
      "employee only one of these feeds knew about is not listed at all."
    );
  }

  if (!feeds.biometric) {
    return (
      "Biometric feed unavailable — enrolment and leaver detection are hidden rather than " +
      "shown as empty. Every employee would otherwise read as unenrolled, which is a bridge " +
      "fault rather than a workforce losing their fingerprints. Schedule coverage is unaffected."
    );
  }

  return (
    "Schedule feed unavailable — assignments and weekly hours are hidden rather than shown " +
    "as empty. Every employee would otherwise read as unscheduled, which is a coverage-service " +
    "fault rather than a workforce with no shifts. Biometric enrolment is unaffected."
  );
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
 * The register's filters as GenericDataTable must see them.
 *
 * `sort` is translated, per the note above.
 *
 * `page` and `limit` come from the META, not from `filters` — they are the page
 * and size ACTUALLY in force, after paginateRegisterRows has clamped and
 * defaulted them. The pager does its arithmetic on what it is given here
 * (`page: (filters.page || 1) - 1`), not on `meta.page`, so a stale page
 * handed straight through leaves the arrows stepping through pages that no
 * longer exist: sitting on 8 against a set that now makes 2, "‹" writes 7, then
 * 6, then 5 — three presses that visibly do nothing.
 *
 * That state is reachable even though every filter change resets to page 1: a
 * refetch can shrink the roster under a reader who is already on page 8, and so
 * can the bridge going stale mid-session, because the suppression pass in
 * coverageRegister.ts then drops every row that feed was the only witness to.
 *
 * `search` is BLANKED whenever the bar owns the search box. GenericDataTable
 * keeps its own debounced copy of `filters.search`, seeded once at mount, and
 * an effect writes that copy back through `onFiltersChange` whenever the two
 * differ — and it runs that effect whether or not `hideSearch` stopped it
 * rendering an input to change the copy with. Handed the bar's search it would
 * answer, ~300ms later, with the empty string it still believes in, so every
 * keystroke on a phone would undo itself. Blanked, its copy and this one agree
 * and it stays quiet.
 *
 * Blanked to `""`, not omitted: its copy is `useState(filters.search || "")`,
 * so `undefined` is the one value that does NOT match and would trigger
 * exactly the write-back this avoids.
 *
 * The table never needed the search anyway — `data` above is already filtered.
 */
export function registerTableFilters(
  filters: RegisterFilters,
  narrow: boolean,
  meta: BaseTableMeta,
): RegisterTableFilters {
  const table: RegisterTableFilters = {
    ...filters,
    sort: columnIdForSort(filters.sort),
    page: meta.page,
    limit: meta.limit,
  };
  return narrow ? { ...table, search: "" } : table;
}

/**
 * The register's filters after the table reported a change.
 *
 * While the bar owns the search box the table's `search` is the blank it was
 * given above, so the real one is carried over from what the register already
 * held. Without this, pressing any column header would wipe whatever the
 * reader had typed on a phone.
 */
export function mergeTableFilters(
  held: RegisterFilters,
  next: RegisterTableFilters,
  narrow: boolean,
): RegisterFilters {
  const merged = registerFiltersFromTable(next);
  if (!narrow) return merged;
  const { search: _tableCopy, ...rest } = merged;
  return held.search === undefined ? rest : { ...rest, search: held.search };
}

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
 *
 * Through `applyFilterChange`, because this narrows: filtering a 503-employee
 * roster down to its four findings while sitting on page 8 would otherwise
 * clamp the reader onto the last page of them.
 */
export function toggleReadiness(filters: RegisterFilters): RegisterFilters {
  return applyFilterChange(filters, {
    readiness: filters.readiness === "not-ready" ? undefined : "not-ready",
  });
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
  // dewey-ui's own breakpoint, 768 — which is exactly where the toolbar's
  // overlaps were measured to stop. Held here rather than in the view so the
  // view stays renderable, and testable, without a DOM.
  const narrow = useIsMobile();

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

  // The one control on this page that WRITES. Everything else navigates or
  // narrows; this mints and destroys credentials, so it stays in the routed
  // component beside the dialog that operates them rather than travelling
  // into the view.
  //
  // `refresh` on unlink and NOT on issue: unlinking changes the badge, issuing
  // does not — nobody is linked until the token is redeemed, which happens on
  // the employee's phone, minutes or hours later.
  const telegram = useTelegramLink({ onUnlinked: refresh });
  // `telegram.openFor`, not `telegram`. The hook returns a fresh object every
  // render, so depending on the whole thing would give this callback a new
  // identity every render — which invalidates the view's `registerColumns`
  // memo, and TanStack resets column state whenever the columns reference
  // changes. `openFor` is `useCallback(..., [])` and is stable.
  const openTelegram = telegram.openFor;
  const handleManageTelegram = useCallback(
    (row: RegisterRow) => {
      openTelegram({
        employee: row.id,
        employeeName: row.employee_name,
        // `?? "none"` is unreachable — the cell draws no button for a null
        // state — but the target type has no room for "we don't know", and
        // defaulting to "linked" would offer Unlink for an unknown state.
        status: row.telegram ?? "none",
      });
    },
    [openTelegram],
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
    <>
      <CoverageRegisterView
        rows={rows}
        feeds={feeds}
        alert={alert}
        truncated={truncated}
        isLoading={isLoading}
        bothFailed={bothFailed}
        filters={filters}
        narrow={narrow}
        onFiltersChange={setFilters}
        onRetry={refresh}
        onOpen={handleOpen}
        onAddSchedule={handleAddSchedule}
        onManageTelegram={handleManageTelegram}
      />
      <TelegramDialog link={telegram} />
    </>
  );
}
