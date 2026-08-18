import type { BaseTableMeta } from "@lolbikb/dewey-ui";

import { khmerName } from "@/lib/employeeCard";
import { fingerLabel } from "@/lib/fingerLabels";
import type {
  CoverageAssignedEmployee,
  CoverageEmployee,
  ScheduleCoveragePayload,
  TelegramState,
} from "@/lib/scheduleCoverage";
import {
  isFeedConnected, parseFrappeDatetime, STALE_AFTER_MINUTES,
  type EnrollmentPayload, type EnrollmentRow,
} from "@/lib/enrollmentReport";

/**
 * One row per employee, joined from the two coverage feeds.
 *
 * Every field a feed cannot speak to is `null`, never a default. The two feeds
 * fail independently and a missing feed must remove facts, not invent them:
 * `biometric: "none"` means the bridge REPORTED no template, which is a
 * different statement from "we did not hear from the bridge".
 */
export type RegisterRow = {
  id: string;
  employee_name: string;
  /**
   * Composed by `khmerName()` at the join, not at each cell.
   *
   * The table, the CSV and the search all read one row; three call sites
   * composing separately is how these surfaces drifted apart the first time.
   */
  khmer_name: string | null;
  /**
   * Schedule-feed fact — the employee's photo URL, or null for the many who
   * have none.
   *
   * A schedule fact because that is the only feed that carries one: the
   * enrolment payload has an `is_registered` and a `face_count` but no image,
   * so a row the bridge alone vouches for has no photo to show and must say so
   * with null rather than borrow one. It follows the schedule feed's
   * provenance and suppression like `schedule` and `weekly_minutes` do.
   */
  image: string | null;
  branch: string | null;
  department: string | null;
  /** Biometric-feed fact. Coverage filters status:Active, so it cannot supply this. */
  status: string | null;
  schedule: "assigned" | "missing" | null;
  weekly_minutes: number | null;
  biometric: "enrolled" | "enrolled_not_punching" | "none" | "still_enrolled" | null;
  fingerprint_count: number | null;
  /**
   * Biometric-feed fact — the enrolled fingers as `finger_slots` slugs, or
   * null when the feed did not speak (or an older payload predates the field).
   *
   * Meaningful only through `accountedFingers`: a list that does not account
   * for every template must never be shown as if it did.
   */
  fingers: string[] | null;
  /** Biometric-feed fact — a face template exists on some device. */
  face: boolean | null;
  days_since_relieving: number | null;
  /**
   * Schedule-feed fact — where this person stands in the Telegram rollout.
   *
   * A schedule fact because the coverage endpoint is what resolves it; the
   * bridge knows nothing about Telegram, so a row only the enrolment feed
   * vouches for carries null here the way it carries null for `schedule`.
   *
   * Deliberately NOT part of `isNotReady`. See that function's comment: this
   * column tracks a rollout in progress, not whether someone can be tracked
   * today, and folding it in would turn the attention count into the roster
   * size on the day the column shipped.
   */
  telegram: TelegramState | null;
  /**
   * Which feeds vouched for this row EXISTING — not for any field on it.
   *
   * Required, not optional, so every construction site has to state it rather
   * than inherit a default that would be wrong for half of them.
   *
   * `suppressUnusableFacts` needs this and cannot derive it. Nulling a row's
   * fields is not enough for a row that only ONE feed ever knew about: the
   * leaver who exists in the enrolment feed alone (coverage returns Active
   * employees only) would otherwise survive a stale bridge as a row of em
   * dashes carrying her name, branch and department — three facts vouched for
   * by nothing but the feed the page has just declared unusable — counted in
   * the header's roster size and written into the CSV, under a banner saying
   * leaver detection is hidden.
   */
  sources: RowSources;
};

/** The feeds a row came from. See `RegisterRow["sources"]`. */
export type RowSources = { schedule: boolean; biometric: boolean };

export type FeedHealth = { schedule: boolean; biometric: boolean };

/**
 * The one wording for each biometric bucket.
 *
 * The column badge, the filter option and the CSV field all read from here, so
 * a reader who narrowed the table to "Not enrolled" gets a file that says the
 * same thing. Exhaustive by type: a fifth bucket is a compile error rather than
 * a blank badge, an unlabelled filter option and an empty CSV cell.
 */
export const BIOMETRIC_LABELS: Record<NonNullable<RegisterRow["biometric"]>, string> = {
  enrolled: "Enrolled",
  enrolled_not_punching: "Enrolled, not punching",
  // "Not enrolled", not "No fingerprint": the `none` bucket is
  // is_registered=0 — no fingerprint AND no face — so the old label
  // under-described the state. Also the wording the Mini App ("Not set up")
  // and the enrollment buckets already use.
  none: "Not enrolled",
  still_enrolled: "Still enrolled",
};

/**
 * The filter's vocabulary — every row label, plus the one option that is a
 * PREDICATE rather than a bucket: "Only one finger" narrows to the fragile
 * enrollments (`isFragileEnrollment`), which is how the re-enrollment drive
 * pulls its worklist. It has no row value of its own, which is why this is a
 * second record instead of a fifth BIOMETRIC_LABELS key — the CSV's Biometric
 * field and the cell read row values and must not learn a label no row can
 * carry.
 */
export const BIOMETRIC_FILTER_LABELS: Record<NonNullable<RegisterFilters["biometric"]>, string> = {
  ...BIOMETRIC_LABELS,
  single_finger: "Only one finger",
};

/** Same rule as BIOMETRIC_LABELS, for the schedule fact. */
export const SCHEDULE_LABELS: Record<NonNullable<RegisterRow["schedule"]>, string> = {
  assigned: "Assigned",
  missing: "Missing",
};

/**
 * Same rule again, for the Telegram fact.
 *
 * "ID on file" is worded as a fact about the record rather than as an
 * instruction, because what to DO with it changes: today those employees still
 * need a link issued, and once auto-binding ships they need only to open the
 * bot. A label like "Just needs a nudge" would have to be rewritten then; this
 * one stays true either way.
 */
export const TELEGRAM_LABELS: Record<TelegramState, string> = {
  linked: "Linked",
  id_on_file: "ID on file",
  none: "Not linked",
};

/**
 * One register value per enrollment bucket — exhaustive, so a fifth bucket is a
 * compile error rather than something that silently renders as "Enrolled".
 *
 * ENROLLED_NOT_PUNCHING stays distinct. The register replaces the biometrics
 * page, which showed it as its own bucket, and the Global Constraint that drops
 * the Punches 30d column rests on this column carrying the zero/non-zero
 * distinction. It is NOT a readiness problem — see isNotReady in Task 3.
 */
function biometricOf(row: EnrollmentRow): NonNullable<RegisterRow["biometric"]> {
  switch (row.bucket) {
    case "LEAVER_STILL_ENROLLED":
      return "still_enrolled";
    case "NEEDS_ENROLLMENT":
      return "none";
    case "ENROLLED_NOT_PUNCHING":
      return "enrolled_not_punching";
    case "OK":
      return "enrolled";
  }
}

/**
 * Join on employee id. The union of both feeds, not the intersection: coverage
 * returns Active employees only, so a leaver still holding a template exists in
 * the enrollment feed alone — and that row is the security finding this page
 * exists to show.
 *
 * The enrollment merge is skipped entirely when the bridge has never reported
 * (`isFeedConnected` false): with no snapshot, every row would compute as
 * `NEEDS_ENROLLMENT` and mint `biometric: "none"` for the whole roster, which
 * is not a fact the bridge has actually told us. See enrollmentReport.ts's
 * `isFeedConnected` doc comment for the same failure mode on the source page.
 */
export function joinRegisterRows(
  coverage: ScheduleCoveragePayload | undefined,
  enrollment: EnrollmentPayload | undefined,
): RegisterRow[] {
  const byId = new Map<string, RegisterRow>();

  const seed = (emp: CoverageEmployee, schedule: "assigned" | "missing", minutes: number | null) => {
    byId.set(emp.id, {
      id: emp.id,
      employee_name: emp.employee_name || emp.id,
      khmer_name: khmerName(emp.custom_khmer_last_name, emp.custom_khmer_first_name),
      image: emp.image ?? null,
      branch: emp.branch ?? null,
      department: emp.department ?? null,
      status: null,
      schedule,
      weekly_minutes: minutes,
      biometric: null,
      fingerprint_count: null,
      fingers: null,
      face: null,
      days_since_relieving: null,
      // `?? null` and not a default: the backend omits this for the whole
      // roster when its lookup fails, and "none" would read as a positive
      // report that nobody is linked.
      telegram: emp.telegram ?? null,
      sources: { schedule: true, biometric: false },
    });
  };

  for (const emp of coverage?.unassigned ?? []) seed(emp, "missing", null);
  for (const emp of coverage?.assigned ?? []) {
    seed(emp, "assigned", (emp as CoverageAssignedEmployee).weekly_minutes);
  }

  if (isFeedConnected(enrollment)) {
    for (const row of enrollment?.rows ?? []) {
      const existing = byId.get(row.id);
      const merged: RegisterRow = existing ?? {
        id: row.id,
        employee_name: row.employee_name || row.id,
        khmer_name: khmerName(row.custom_khmer_last_name, row.custom_khmer_first_name),
        // The enrolment feed carries no photo, so a row only it knows about
        // has none — not a borrowed one, and not a guessed URL.
        image: null,
        branch: row.branch ?? null,
        department: row.department ?? null,
        status: null,
        // Coverage never returned this person, so no schedule fact is known.
        schedule: null,
        weekly_minutes: null,
        biometric: null,
        fingerprint_count: null,
        fingers: null,
        face: null,
        days_since_relieving: null,
        // The enrolment feed knows nothing about Telegram, so a row coverage
        // never returned has no state — the same silence it gets for
        // `schedule`.
        telegram: null,
        sources: { schedule: false, biometric: false },
      };
      // A NEW object rather than a mutation: `merged` may be the seeded row
      // still held in the map, and its `sources` would then be aliased.
      merged.sources = { schedule: merged.sources.schedule, biometric: true };
      merged.status = row.status ?? null;
      merged.biometric = biometricOf(row);
      merged.fingerprint_count = row.fingerprint_count;
      // `null`, not `[]`, when the payload predates the field: an old cached
      // body did not say "no names", it said nothing. A site without the
      // column sends a real [] and keeps it.
      merged.fingers = Array.isArray(row.fingers) ? row.fingers : null;
      // Derived here, once, so the cell and the CSV cannot disagree about
      // what counts as "has a face". Guarded the same way as `fingers`: an
      // absent count is silence, not "no face".
      merged.face = typeof row.face_count === "number" ? row.face_count > 0 : null;
      merged.days_since_relieving = row.days_since_relieving;
      // Coverage is authoritative for branch/department when it has the employee;
      // fall back to the enrollment copy for rows coverage never returned.
      merged.branch = merged.branch ?? row.branch ?? null;
      merged.department = merged.department ?? row.department ?? null;
      // Coverage wins when both feeds carry it, on the same precedence as
      // `branch`. The enrolment feed fills the gap for a leaver coverage
      // never returned -- the security finding this page exists for.
      if (merged.khmer_name === null) {
        merged.khmer_name = khmerName(row.custom_khmer_last_name, row.custom_khmer_first_name);
      }
      byId.set(row.id, merged);
    }
  }

  return [...byId.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}

export type RegisterFilters = {
  search?: string;
  branch?: string[];
  department?: string[];
  status?: "Active" | "Left";
  schedule?: "assigned" | "missing";
  /**
   * The four buckets, plus `single_finger` — a PREDICATE option, not a
   * bucket: it narrows to fragile enrollments across the two enrolled
   * buckets. See BIOMETRIC_FILTER_LABELS and `filterRegisterRows`.
   */
  biometric?: "enrolled" | "enrolled_not_punching" | "none" | "still_enrolled" | "single_finger";
  /**
   * The rollout filter, and the reason the column exists: narrowing to "Not
   * linked" is how the work gets done a branch at a time.
   */
  telegram?: TelegramState;
  readiness?: "not-ready";
  sort?: "name" | "hours" | "prints";
  order?: "asc" | "desc";
  /**
   * Which page, 1-based. Absent is the first page.
   *
   * The one field a control may change WITHOUT starting over — see
   * `applyFilterChange`. Everything else here narrows the list, and a page
   * number counted against a list that no longer exists is not a place.
   */
  page?: number;
  /** Rows per page. Absent means `REGISTER_PAGE_SIZE`. */
  limit?: number;
};

/**
 * Rows per page, and what the "Rows per page" control opens on.
 *
 * MUST stay inside GenericDataTable's own option list — [10, 20, 30, 40, 50].
 * That control is a raw `<select value={filters.limit || 10}>` over exactly
 * those five, so a size the list does not contain is not merely unusual: left
 * out of `limit` it leaves the control reading 10 beside a table showing
 * something else, and written into `limit` it matches no option at all, which
 * sets `selectedIndex` to -1 and renders the select BLANK. 25 was the first
 * choice for this register and is unreachable for exactly that reason.
 *
 * 50 of the five, because the behaviour being replaced was "every row on one
 * page": this is the gentlest step away from it — 11 pages over a 503-employee
 * roster rather than 26 — and this reader narrows far more often than they
 * page, which makes every page turn pure cost.
 */
export const REGISTER_PAGE_SIZE = 50;

/**
 * A filter change, and back to the first page with it.
 *
 * Every control on this page narrows the list, and a page number only means
 * anything against the list it was counted from: narrow 503 rows to 3 while
 * sitting on page 8 and page 8 has stopped existing. `paginateRegisterRows`
 * clamps rather than showing an empty table, but a clamp is a rescue, not an
 * answer — the reader asked for "everyone in DIU" and would be handed the last
 * page of them.
 *
 * Applied by the controls that NARROW — the facets, the bar's own search box
 * and the alert dot — rather than by the state setter they share, because the
 * one write that must not reset the page is a page change itself.
 * GenericDataTable already stamps `page: 1` on its own search, sort and
 * page-size writes and an explicit page on its pager buttons, so its side of
 * the boundary needs nothing from here.
 */
export function applyFilterChange(
  filters: RegisterFilters,
  change: Partial<RegisterFilters>,
): RegisterFilters {
  return { ...filters, ...change, page: 1 };
}

/**
 * Can this person be tracked today?
 *
 * A NULL fact is never a problem. Null means the feed did not speak, and
 * counting silence as a finding is how a bridge outage becomes 241 false
 * alarms. Only a positive statement of absence counts.
 *
 * ENROLLED_NOT_PUNCHING is deliberately absent: they can clock in and simply
 * have not, which is an attendance question, not a coverage one.
 *
 * `telegram` is absent for a stronger reason. This function feeds the alert
 * count and the not-ready filter, and Telegram is a rollout that STARTS at
 * ~90% unlinked: folding it in would have turned "4 need attention" into "467
 * need attention" the day the column shipped, drowning the two findings the
 * page exists for. Being unlinked also costs the employee a convenience, not
 * the company its attendance record — they are still tracked by the same
 * device and schedule as everyone else. The Telegram facet is how that work
 * gets found; the alert stays for people who cannot be tracked at all.
 */
export function isNotReady(row: RegisterRow): boolean {
  return row.schedule === "missing" || row.biometric === "none" || row.biometric === "still_enrolled";
}

/**
 * The finger names, ONLY when they account for every template.
 *
 * The Mini App's honesty guard (`miniProfile.fingerKeys`), applied to a
 * register row: two names beside a count of three states something false
 * about the third, and there is no way to render "and one more" that does
 * not read as a bug. Null is the fall-back-to-the-count answer, and it is
 * the ordinary one wherever the bridge sends counts without ids.
 */
export function accountedFingers(row: RegisterRow): string[] | null {
  const fingers = row.fingers ?? [];
  if (!fingers.length) return null;
  if (fingers.length !== row.fingerprint_count) return null;
  return fingers;
}

/**
 * A single usable template on someone expected to punch.
 *
 * One cut or burnt finger and that person cannot clock in — a quality nudge,
 * NOT a coverage failure: deliberately absent from `isNotReady` and
 * `severity`, because an enrolled-but-fragile employee is tracked today and
 * folding ~100 production single-finger rows into the attention count would
 * drown the two findings the alert exists for. Leavers are excluded — the
 * remedy for `still_enrolled` is revocation, not a second finger.
 *
 * Counted from `fingerprint_count`, not from `fingers`: the count is the
 * bridge's claim about how many templates exist, and it is present even when
 * the ids are not.
 */
export function isFragileEnrollment(row: RegisterRow): boolean {
  return (
    (row.biometric === "enrolled" || row.biometric === "enrolled_not_punching") &&
    row.fingerprint_count === 1
  );
}

/** Severity for the filtered view: worst first. Lower sorts earlier. */
function severity(row: RegisterRow): number {
  if (row.biometric === "still_enrolled") return 0;
  if (row.biometric === "none") return 1;
  if (row.schedule === "missing") return 2;
  return 3;
}

/**
 * The branch and department values the roster actually contains.
 *
 * DERIVED, never hardcoded. A branch that exists in the data must be offerable
 * and one that does not must not appear: an option that can only ever return
 * nothing is a fact the page does not have, and a branch missing from a
 * hardcoded list is a slice of the roster the reader cannot reach at all.
 *
 * `null` is excluded because there is nothing for such an option to select —
 * filterRegisterRows reads `row.branch ?? ""`, so a row with no branch fact
 * cannot satisfy "is in this branch" and is dropped by any branch filter.
 *
 * Callers must pass the UNFILTERED roster. Deriving from the filtered rows
 * would leave the chosen branch as the only surviving option the moment it was
 * picked, so the reader could no longer see — or clear — what they had done.
 */
export function registerFacets(rows: RegisterRow[]): { branch: string[]; department: string[] } {
  const branch = new Set<string>();
  const department = new Set<string>();
  for (const row of rows) {
    if (row.branch) branch.add(row.branch);
    if (row.department) department.add(row.department);
  }
  const sorted = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b));
  return { branch: sorted(branch), department: sorted(department) };
}

export function filterRegisterRows(rows: RegisterRow[], filters: RegisterFilters): RegisterRow[] {
  const needle = (filters.search ?? "").trim().toLowerCase();

  return rows.filter((row) => {
    // The Khmer name joins the haystack rather than getting its own branch:
    // one `includes` over one string is what makes a query of `សុភា` match
    // inside `ចាន់ សុភា`, where Khmer's lack of inter-word spaces means there
    // is no token boundary to anchor to.
    if (needle && !`${row.employee_name} ${row.id} ${row.khmer_name ?? ""}`
      .toLowerCase().includes(needle)) return false;
    if (filters.branch?.length && !filters.branch.includes(row.branch ?? "")) return false;
    if (filters.department?.length && !filters.department.includes(row.department ?? "")) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.schedule && row.schedule !== filters.schedule) return false;
    // `single_finger` is a predicate over the enrolled buckets, not a bucket
    // of its own — see BIOMETRIC_FILTER_LABELS.
    if (filters.biometric === "single_finger") {
      if (!isFragileEnrollment(row)) return false;
    } else if (filters.biometric && row.biometric !== filters.biometric) return false;
    if (filters.telegram && row.telegram !== filters.telegram) return false;
    if (filters.readiness === "not-ready" && !isNotReady(row)) return false;
    return true;
  });
}

/** One clause of the reader's narrowing, named the way its control is. */
export type RegisterNarrowing = { label: string; value: string };

/**
 * The filters in force, in the words the controls use.
 *
 * Exists for the export confirmation, and it is the whole point of that
 * surface: the file holds the FILTERED rows, so a filter the reader has
 * forgotten travels into a spreadsheet that looks like the whole roster and
 * carries no banner to say otherwise. The number alone cannot say that — "80
 * employees" reads as a fact about the workforce unless the narrowing that
 * produced it is beside it.
 *
 * Every clause that `filterRegisterRows` acts on appears here, and nothing
 * else. `sort`, `page` and `limit` are deliberately absent: none of them
 * changes WHO is in the file — the export takes every matching row, not the
 * page on screen.
 *
 * Ordered as the controls are met on screen, alert dot first.
 *
 * The labels are the CONTROLS' labels and the values are their option
 * labels — `BIOMETRIC_FILTER_LABELS` and `SCHEDULE_LABELS`, the same records
 * the facet menus read from — so a reader who picked "Not enrolled" is shown
 * "Not enrolled" here rather than the wire value `none`, and one who picked
 * "Only one finger" sees the predicate they chose.
 *
 * `search` is TRIMMED, and dropped when that leaves nothing, because
 * filterRegisterRows trims before it matches: a box holding only spaces
 * narrows nothing, and listing it as a narrowing would send the reader looking
 * for rows it had removed.
 */
export function describeRegisterFilters(filters: RegisterFilters): RegisterNarrowing[] {
  const out: RegisterNarrowing[] = [];
  const search = (filters.search ?? "").trim();

  if (filters.readiness === "not-ready") {
    out.push({ label: "Needs attention", value: "Only employees with a problem" });
  }
  if (search) out.push({ label: "Search", value: `“${search}”` });
  if (filters.branch?.length) out.push({ label: "Branch", value: filters.branch.join(", ") });
  if (filters.department?.length) {
    out.push({ label: "Department", value: filters.department.join(", ") });
  }
  if (filters.status) out.push({ label: "Status", value: filters.status });
  if (filters.schedule) {
    out.push({ label: "Schedule", value: SCHEDULE_LABELS[filters.schedule] });
  }
  if (filters.biometric) {
    out.push({ label: "Biometric", value: BIOMETRIC_FILTER_LABELS[filters.biometric] });
  }
  if (filters.telegram) {
    out.push({ label: "Telegram", value: TELEGRAM_LABELS[filters.telegram] });
  }

  return out;
}

export function sortRegisterRows(rows: RegisterRow[], filters: RegisterFilters): RegisterRow[] {
  const out = [...rows];
  const dir = filters.order === "desc" ? -1 : 1;

  // A flat filter cannot group the way a modal would; severity ordering while
  // filtered is what recovers "worst first".
  if (filters.readiness === "not-ready" && !filters.sort) {
    return out.sort(
      (a, b) => severity(a) - severity(b) || a.employee_name.localeCompare(b.employee_name),
    );
  }

  if (filters.sort === "hours" || filters.sort === "prints") {
    const key = filters.sort === "hours" ? "weekly_minutes" : "fingerprint_count";
    return out.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      // Unknown sorts last in BOTH directions — an absent value is not a small
      // one, and flipping it to the top on desc would read as a finding.
      if (av === null && bv === null) return a.employee_name.localeCompare(b.employee_name);
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir || a.employee_name.localeCompare(b.employee_name);
    });
  }

  return out.sort((a, b) => a.employee_name.localeCompare(b.employee_name) * dir);
}

/**
 * One page of the register, and the pager's reading of where that page sits.
 *
 * Composed LAST — `paginate(sort(filter(rows)))`. GenericDataTable is told
 * `manualPagination` and never slices `data`: it renders whatever array it is
 * handed and takes every number under it from `meta`. Given the whole list and
 * a hardcoded one-page meta — which is what shipped — all 503 rows drew into a
 * single scrolling frame, the pager read "Page 1 of 1" and every button was
 * dead, because they are `disabled: !meta?.hasNext`.
 *
 * `meta.total` is the FILTERED count, not the roster. The footer reads
 * "Showing {data.length} of {meta.total}", so the second number has to be the
 * size of the set the first is a page of, or the two do not describe the same
 * thing. The roster total moved to the search placeholder.
 *
 * The page is CLAMPED to the last one that exists, and `meta.page` reports the
 * clamp so the pager and the slice agree about where the reader is. An empty
 * result is page 1 of 1 — never page 0, and never "Page 1 of 0".
 *
 * The alert count, the CSV and the roster figure all keep reading the UNPAGED
 * rows: a reader on page 2 still needs the whole-roster truth, and a file that
 * quietly held one page of a filtered set would be indistinguishable from one
 * that held all of it.
 */
export function paginateRegisterRows(
  rows: RegisterRow[],
  filters: RegisterFilters,
): { rows: RegisterRow[]; meta: BaseTableMeta } {
  // A non-positive size is not a smaller page, it is no instruction at all —
  // and `ceil(n / 0)` is Infinity, which the pager would render as "Page 1 of
  // Infinity" above a permanently empty slice.
  const requested = filters.limit ?? REGISTER_PAGE_SIZE;
  const limit = requested > 0 ? requested : REGISTER_PAGE_SIZE;

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // `Number.isFinite` for the same reason `limit` rejects a non-positive size
  // two lines up: `Math.max(1, NaN)` is NaN, so a NaN page would reach
  // `meta.page` intact, empty the slice, and leave the footer reading "Page NaN
  // of 2" with BOTH arrows dead — `NaN < totalPages` and `NaN > 1` are each
  // false, so hasNext and hasPrev would both be false and there would be no way
  // off the page at all. Unreachable through the pager, which only ever writes
  // integers, but guarding one end of this and not the other reads as an
  // oversight rather than a decision.
  const requestedPage = filters.page ?? 1;
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(1, requestedPage), totalPages)
    : 1;
  const start = (page - 1) * limit;

  return {
    rows: rows.slice(start, start + limit),
    meta: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

/**
 * Which table column each sort key belongs to.
 *
 * Exhaustive over the sort union by type, so a fourth key cannot be added
 * without deciding which column it sorts — and the round-trip test iterates
 * these keys, so it cannot be added without teaching sortFromColumnId either.
 */
export const SORT_COLUMN_IDS: Record<NonNullable<RegisterFilters["sort"]>, string> = {
  name: "employee",
  hours: "weekly_minutes",
  // "prints" sorts the FUSED biometric column: the print count is evidence for
  // the biometric state rather than a fact of its own, so it lost its column
  // and kept its sort. The header says so out loud — a column labelled
  // "Biometric" that orders by print count is otherwise a surprise.
  prints: "biometric",
};

/**
 * A pressed column header, translated into this module's own vocabulary.
 *
 * An id nothing sorts by yields null rather than a guess: a wrong sort silently
 * reorders the register, and — because sortRegisterRows only applies severity
 * ordering while `filters.sort` is unset — it would also retire "worst first"
 * for the not-ready view.
 */
export function sortFromColumnId(
  id: string,
  desc: boolean,
): Pick<RegisterFilters, "sort" | "order"> | null {
  const order = desc ? "desc" : "asc";
  switch (id) {
    case "employee":
      return { sort: "name", order };
    case "weekly_minutes":
      return { sort: "hours", order };
    case "biometric":
      return { sort: "prints", order };
    default:
      return null;
  }
}

/**
 * The inverse, for the boundary with GenericDataTable.
 *
 * That primitive derives its own sorting STATE from `filters.sort`, reading it
 * as a column id — `sorting: filters.sort ? [{ id: filters.sort, ... }] : []`.
 * Handing it "hours" leaves `column.getIsSorted()` false on every column, so
 * the header shows no direction, `getNextSortingOrder()` returns the first
 * direction forever, and the sort can be neither reversed nor cleared.
 *
 * Undefined maps to undefined: an unsorted register is a real state (it is the
 * one where severity ordering runs) and must round-trip as one, not fall back
 * to some default column.
 */
export function columnIdForSort(sort: RegisterFilters["sort"]): string | undefined {
  return sort === undefined ? undefined : SORT_COLUMN_IDS[sort];
}

export type RegisterAlert = {
  tone: "problem" | "clear" | "degraded";
  count: number;
  /** False when a feed is down, so the count covers only part of the roster. */
  knowable: boolean;
  /** The accessible name. Colour never carries meaning alone. */
  label: string;
};

/**
 * Column ids that survive when a feed is unavailable.
 *
 * `fingerprint_count` is NOT here, and has no column at all: the print count is
 * evidence for the biometric state rather than an independent fact, so it was
 * fused into the biometric cell and the column it cost was given back. It is
 * still exported to the CSV — see CSV_FIELDS, which is keyed off feed health
 * rather than off this list for exactly that reason.
 */
/**
 * `telegram` is here because these lists are keyed by FEED, not by subject
 * matter: the coverage endpoint resolves the Telegram state, so a coverage
 * outage must take that column with it exactly as it takes Schedule and
 * Hrs/wk. Leaving it visible would show "Not linked" for a roster the page has
 * just stopped hearing about.
 */
const SCHEDULE_COLUMNS = ["schedule", "weekly_minutes", "telegram"];
const BIOMETRIC_COLUMNS = ["biometric", "status"];
const ALWAYS = ["employee", "branch", "department", "action"];

export function feedHealth(
  coverage: ScheduleCoveragePayload | undefined,
  enrollment: EnrollmentPayload | undefined,
  nowMs: number,
): FeedHealth {
  const schedule = Boolean(coverage);
  if (!isFeedConnected(enrollment)) return { schedule, biometric: false };

  // Reuses parseFrappeDatetime — the shared site-local reading of this field —
  // rather than a second, UTC-forcing parse of it here. A one-hour offset
  // between two readings would put the same snapshot on opposite sides of
  // "stale" depending on which one asked.
  const reportedAt = parseFrappeDatetime(enrollment?.last_snapshot_at ?? "");
  const minutes = reportedAt === null ? Infinity : (nowMs - reportedAt) / 60000;

  return { schedule, biometric: minutes <= STALE_AFTER_MINUTES };
}

/** "needs"/"need" — the label is the accessible name, so it must agree with the count everywhere it appears. */
function attentionVerb(count: number): string {
  return count === 1 ? "needs" : "need";
}

export function registerAlert(rows: RegisterRow[], feeds: FeedHealth): RegisterAlert {
  const count = rows.filter(isNotReady).length;
  const knowable = feeds.schedule && feeds.biometric;

  if (!knowable) {
    // Names every down feed, not just one — naming only the biometric feed
    // when the schedule feed is ALSO down would assert by omission that the
    // schedule half is fine, which is exactly the over-reassurance this
    // alert exists to avoid.
    const missingFeeds = [
      feeds.schedule ? null : "schedules",
      feeds.biometric ? null : "biometrics",
    ].filter((feed): feed is string => feed !== null);

    return {
      tone: "degraded",
      count,
      knowable: false,
      // Says what it cannot see. A bare count here reads as reassurance at
      // exactly the moment the page knows least.
      label: `${count} ${attentionVerb(count)} attention · ${missingFeeds.join(" and ")} unavailable`,
    };
  }

  if (count === 0) {
    return { tone: "clear", count: 0, knowable: true, label: `All ${rows.length} ready` };
  }

  return {
    tone: "problem",
    count,
    knowable: true,
    label: `${count} ${attentionVerb(count)} attention — show ${count === 1 ? "it" : "them"}`,
  };
}

/**
 * Columns are REMOVED when their feed is absent, never blanked. An empty
 * Biometric column reads as 241 people who cannot clock in — a bridge fault
 * rendered as a workforce crisis.
 *
 * `status` counts as biometric: coverage filters status:Active server-side, so
 * it cannot supply the field and leavers never appear in it.
 */
export function visibleColumnIds(feeds: FeedHealth): string[] {
  return [
    ...ALWAYS,
    ...(feeds.schedule ? SCHEDULE_COLUMNS : []),
    ...(feeds.biometric ? BIOMETRIC_COLUMNS : []),
  ];
}

/** Which feed vouches for a CSV field — or neither, for the two the join owns. */
type CsvFeed = keyof FeedHealth | "always";

type CsvField = {
  /** The feed this field's value comes from; exported only while that feed is healthy. */
  feed: CsvFeed;
  header: string;
  value: (row: RegisterRow) => string | number | null;
};

/**
 * The exportable fields, in the order a reader expects to meet them.
 *
 * Keyed by FEED, not by table column — and that is a deliberate change, not a
 * convenience. The file must still drop everything a downed feed cannot vouch
 * for, because writing a fact the page is refusing to show puts it into a
 * document that outlives the outage. But the table and the file no longer have
 * the same columns: the print count was fused into the biometric cell to save a
 * column, and a spreadsheet has no width pressure and does want a numeric
 * column to sort and total. Deriving this list from `visibleColumnIds` would
 * have silently dropped Fingerprints from every export the moment that fusion
 * landed. Feed health is what the suppression rule was always really about.
 *
 * Several fields may share a feed, and two of them are drawn as one cell: the
 * employee cell shows a name over an id, and jamming those into one field would
 * make neither sortable in a spreadsheet. `action` is a control rather than a
 * fact, so it has no field here at all.
 */
const CSV_FIELDS: CsvField[] = [
  { feed: "always", header: "Employee ID", value: (row) => row.id },
  { feed: "always", header: "Name", value: (row) => row.employee_name },
  { feed: "always", header: "Branch", value: (row) => row.branch },
  { feed: "always", header: "Department", value: (row) => row.department },
  { feed: "biometric", header: "Employment status", value: (row) => row.status },
  {
    feed: "schedule",
    header: "Schedule",
    value: (row) => (row.schedule === null ? null : SCHEDULE_LABELS[row.schedule]),
  },
  { feed: "schedule", header: "Weekly minutes", value: (row) => row.weekly_minutes },
  {
    feed: "biometric",
    header: "Biometric",
    value: (row) => (row.biometric === null ? null : BIOMETRIC_LABELS[row.biometric]),
  },
  // No biometric COLUMN any more — the count lives inside the biometric cell
  // on screen. It keeps its own field here on purpose; see the note above.
  { feed: "biometric", header: "Fingerprints", value: (row) => row.fingerprint_count },
  {
    feed: "biometric",
    header: "Fingers",
    // The accounted rule, not the raw list: a file naming two fingers on a
    // count-of-three row states something false about the third, and a
    // spreadsheet is where that lie outlives the page. Empty when the names
    // cannot account for every template — the count column beside it still
    // carries the number.
    value: (row) => accountedFingers(row)?.map(fingerLabel).join(", ") ?? null,
  },
  {
    feed: "biometric",
    header: "Face",
    // "Yes"/"No" are both positive reports; only null — feed silence — is an
    // empty field, per the rule below.
    value: (row) => (row.face === null ? null : row.face ? "Yes" : "No"),
  },
  { feed: "biometric", header: "Days since leaving", value: (row) => row.days_since_relieving },
  {
    feed: "schedule",
    header: "Telegram",
    value: (row) => (row.telegram === null ? null : TELEGRAM_LABELS[row.telegram]),
  },
];

/**
 * The export as a grid — a header row, then one row per employee — before any
 * CSV quoting. Split from the serialisation so the column-suppression and
 * empty-cell rules are testable without parsing a string back apart.
 *
 * A null cell is an EMPTY field, never `0` and never "None": zero fingerprints
 * is a finding and no report of fingerprints is not, and a file that renders
 * one as the other is the page's central rule broken where it is least
 * recoverable — nothing downstream can tell the two apart afterwards.
 */
/** Whether a downed feed has taken this field out of the file. */
function isExportable(field: CsvField, feeds: FeedHealth): boolean {
  return field.feed === "always" || feeds[field.feed];
}

/**
 * The file's columns, and the ones a downed feed has taken out of it.
 *
 * Both halves, from the one list, so they cannot drift apart: a column named
 * as omitted while it is still being written would be a worse lie than saying
 * nothing.
 *
 * `omitted` is what the export confirmation shows. The suppression rule is
 * right — a fact the page is refusing to display must not travel in a document
 * that outlives the outage — but it is SILENT at the point it takes effect,
 * and a spreadsheet with no Biometric column looks exactly like one from a
 * build that never had it. The banner on the page says a feed is down; only
 * this says what that did to the file.
 */
export function registerCsvColumns(feeds: FeedHealth): {
  included: string[];
  omitted: string[];
} {
  return {
    included: CSV_FIELDS.filter((field) => isExportable(field, feeds)).map((f) => f.header),
    omitted: CSV_FIELDS.filter((field) => !isExportable(field, feeds)).map((f) => f.header),
  };
}

export function registerCsvRows(rows: RegisterRow[], feeds: FeedHealth): string[][] {
  const fields = CSV_FIELDS.filter((field) => isExportable(field, feeds));

  return [
    fields.map((field) => field.header),
    ...rows.map((row) =>
      fields.map((field) => {
        const value = field.value(row);
        return value === null ? "" : String(value);
      }),
    ),
  ];
}

/** Is this row still vouched for by a feed the page can currently believe? */
function hasHealthySource(row: RegisterRow, feeds: FeedHealth): boolean {
  return (row.sources.schedule && feeds.schedule) || (row.sources.biometric && feeds.biometric);
}

/**
 * Blank the facts a feed cannot currently vouch for — and DROP the rows it was
 * the only witness to — so every consumer agrees.
 *
 * joinRegisterRows already does both for a bridge that has NEVER reported, by
 * gating the whole enrolment merge on isFeedConnected. A bridge that reported
 * and then went stale needs the same treatment and cannot get it there:
 * staleness needs `now`, which the join does not take.
 *
 * Blanking alone was not the same treatment, and the difference was visible. A
 * stale bridge passes isFeedConnected, so its rows are joined; blanking then
 * nulls their fields but keeps the rows. Coverage returns Active employees
 * only, so a leaver still holding a template exists in the enrolment feed
 * ALONE — and she survived as a row of em dashes still carrying her name,
 * branch and department, three facts vouched for by nothing but the feed the
 * page had just declared unusable. She was counted in the header's roster size
 * and written into the CSV as a near-blank line, under a banner saying leaver
 * detection was hidden. Stale and never-reported now behave identically, which
 * is what the failure table always claimed.
 *
 * Without the blanking half, the columns vanish while the alert count and the
 * not-ready filter keep counting the hidden facts — so the reader is shown a
 * number they cannot verify, and filtering to it surfaces rows that look ready.
 */
export function suppressUnusableFacts(rows: RegisterRow[], feeds: FeedHealth): RegisterRow[] {
  // Every row has at least one source, so with both feeds healthy the filter
  // below is a no-op and this is only skipping the copy.
  if (feeds.schedule && feeds.biometric) return rows;

  return rows
    .filter((row) => hasHealthySource(row, feeds))
    .map((row) => ({
      ...row,
      ...(feeds.schedule
        ? {}
        : { schedule: null, weekly_minutes: null, image: null, telegram: null }),
      ...(feeds.biometric
        ? {}
        : {
            status: null,
            biometric: null,
            fingerprint_count: null,
            fingers: null,
            face: null,
            days_since_relieving: null,
          }),
    }));
}

export type ComposedRegister = {
  /** Joined AND suppressed — never the raw join. See the ordering note below. */
  rows: RegisterRow[];
  feeds: FeedHealth;
  alert: RegisterAlert;
};

/**
 * The one true composition order, extracted so it is unit-testable without a
 * DOM: join, then suppress, then alert on the SUPPRESSED rows.
 *
 * feedHealth must run first — both suppression and the alert take it, and it
 * is the only one of the three that also needs `now`. Suppression must run
 * before the alert: registerAlert counts isNotReady over whatever rows it is
 * given, and joinRegisterRows alone cannot detect a bridge that reported and
 * then went stale (it only gates on isFeedConnected, which a stale-but-once-
 * seen bridge still passes). Alerting on the join's output would count facts
 * that suppressUnusableFacts is about to hide from the same rows the caller
 * renders — a number the reader could not verify, and a `readiness: "not-
 * ready"` filter that would surface rows the table shows as fine.
 */
export function composeRegister(
  coverage: ScheduleCoveragePayload | undefined,
  enrollment: EnrollmentPayload | undefined,
  nowMs: number,
): ComposedRegister {
  const feeds = feedHealth(coverage, enrollment, nowMs);
  const rows = suppressUnusableFacts(joinRegisterRows(coverage, enrollment), feeds);
  return { rows, feeds, alert: registerAlert(rows, feeds) };
}

/** The bits of a react-query result registerFeedState needs — payload, error, loading. */
export type FeedQueryState<T> = {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
};

export type RegisterFeedState = {
  truncated: boolean;
  isLoading: boolean;
  bothFailed: boolean;
};

/**
 * Loading/failure/truncation bookkeeping for the two feed queries. Extracted
 * out of the hook so it is unit-testable without rendering — there is no
 * jsdom or React Testing Library in this suite, so a hook cannot be rendered
 * in a test, only its non-React logic.
 */
export function registerFeedState(
  coverage: FeedQueryState<ScheduleCoveragePayload>,
  enrollment: FeedQueryState<EnrollmentPayload>,
): RegisterFeedState {
  return {
    // `?.` on `counts` as well as on `data`, on BOTH sides, and deliberately so
    // — it is not dead code just because `counts` is required on the payload
    // types. Those types are a compile-time claim about what the server sends;
    // `frappeCall` casts the response to them without checking, so a partial
    // body (`{}` is what an unmatched endpoint returns) reaches here intact and
    // `data?.counts.truncated` throws on it. That exception escapes to the
    // ErrorBoundary and takes the whole register down, schedule half included —
    // destroying the independent-failure property the two-query split and the
    // per-column suppression exist to provide. A partial payload must degrade.
    truncated: Boolean(coverage.data?.counts?.truncated || enrollment.data?.counts?.truncated),
    // OR, deliberately: the default retry policy (count < 2, 1s/2s backoff)
    // means a single-feed outage can still be retrying for ~3s after the
    // healthy feed has already answered. AND would drop isLoading the moment
    // the first feed resolves, flashing the degraded/failure state before the
    // retry budget on the other feed is spent.
    isLoading: coverage.isLoading || enrollment.isLoading,
    // Both feeds erroring is necessary but not sufficient: react-query's
    // "error" reducer case spreads ...state and only overwrites error/status,
    // so `data` survives a failed refetch. Without the `!data` guard, a
    // refresh() that fails on both feeds after a prior successful load would
    // report bothFailed while `rows` is still fully joined — replacing a
    // working table with a full-region failure placeholder over data that is
    // still in hand. Mirrors react-query's own isLoadingError (isError &&
    // !hasData).
    bothFailed:
      Boolean(coverage.error) && Boolean(enrollment.error) && !coverage.data && !enrollment.data,
  };
}
