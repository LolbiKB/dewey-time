import type {
  CoverageAssignedEmployee,
  CoverageEmployee,
  ScheduleCoveragePayload,
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
  branch: string | null;
  department: string | null;
  /** Biometric-feed fact. Coverage filters status:Active, so it cannot supply this. */
  status: string | null;
  schedule: "assigned" | "missing" | null;
  weekly_minutes: number | null;
  biometric: "enrolled" | "enrolled_not_punching" | "none" | "still_enrolled" | null;
  fingerprint_count: number | null;
  days_since_relieving: number | null;
};

export type FeedHealth = { schedule: boolean; biometric: boolean };

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
      branch: emp.branch ?? null,
      department: emp.department ?? null,
      status: null,
      schedule,
      weekly_minutes: minutes,
      biometric: null,
      fingerprint_count: null,
      days_since_relieving: null,
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
        branch: row.branch ?? null,
        department: row.department ?? null,
        status: null,
        // Coverage never returned this person, so no schedule fact is known.
        schedule: null,
        weekly_minutes: null,
        biometric: null,
        fingerprint_count: null,
        days_since_relieving: null,
      };
      merged.status = row.status ?? null;
      merged.biometric = biometricOf(row);
      merged.fingerprint_count = row.fingerprint_count;
      merged.days_since_relieving = row.days_since_relieving;
      // Coverage is authoritative for branch/department when it has the employee;
      // fall back to the enrollment copy for rows coverage never returned.
      merged.branch = merged.branch ?? row.branch ?? null;
      merged.department = merged.department ?? row.department ?? null;
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
  biometric?: "enrolled" | "enrolled_not_punching" | "none" | "still_enrolled";
  readiness?: "not-ready";
  sort?: "name" | "hours" | "prints";
  order?: "asc" | "desc";
};

/**
 * Can this person be tracked today?
 *
 * A NULL fact is never a problem. Null means the feed did not speak, and
 * counting silence as a finding is how a bridge outage becomes 241 false
 * alarms. Only a positive statement of absence counts.
 *
 * ENROLLED_NOT_PUNCHING is deliberately absent: they can clock in and simply
 * have not, which is an attendance question, not a coverage one.
 */
export function isNotReady(row: RegisterRow): boolean {
  return row.schedule === "missing" || row.biometric === "none" || row.biometric === "still_enrolled";
}

/** Severity for the filtered view: worst first. Lower sorts earlier. */
function severity(row: RegisterRow): number {
  if (row.biometric === "still_enrolled") return 0;
  if (row.biometric === "none") return 1;
  if (row.schedule === "missing") return 2;
  return 3;
}

export function filterRegisterRows(rows: RegisterRow[], filters: RegisterFilters): RegisterRow[] {
  const needle = (filters.search ?? "").trim().toLowerCase();

  return rows.filter((row) => {
    if (needle && !`${row.employee_name} ${row.id}`.toLowerCase().includes(needle)) return false;
    if (filters.branch?.length && !filters.branch.includes(row.branch ?? "")) return false;
    if (filters.department?.length && !filters.department.includes(row.department ?? "")) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.schedule && row.schedule !== filters.schedule) return false;
    if (filters.biometric && row.biometric !== filters.biometric) return false;
    if (filters.readiness === "not-ready" && !isNotReady(row)) return false;
    return true;
  });
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

export type RegisterAlert = {
  tone: "problem" | "clear" | "degraded";
  count: number;
  /** False when a feed is down, so the count covers only part of the roster. */
  knowable: boolean;
  /** The accessible name. Colour never carries meaning alone. */
  label: string;
};

/** Column ids that survive when a feed is unavailable. */
const SCHEDULE_COLUMNS = ["schedule", "weekly_minutes"];
const BIOMETRIC_COLUMNS = ["biometric", "fingerprint_count", "status"];
const ALWAYS = ["employee", "branch", "department", "action"];

export function feedHealth(
  coverage: ScheduleCoveragePayload | undefined,
  enrollment: EnrollmentPayload | undefined,
  nowMs: number,
): FeedHealth {
  const schedule = Boolean(coverage);
  if (!isFeedConnected(enrollment)) return { schedule, biometric: false };

  // Reuses parseFrappeDatetime — the same site-local reading snapshotNotice
  // uses — rather than a second, UTC-forcing parse of the same field. A
  // one-hour offset between the two readings would put a snapshot on
  // opposite sides of "stale" depending on which function asked.
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

/**
 * Blank the facts a feed cannot currently vouch for, so every consumer agrees.
 *
 * joinRegisterRows already does this for a bridge that has NEVER reported, by
 * gating on isFeedConnected. A bridge that reported but went stale needs the
 * same treatment and cannot get it there: staleness needs `now`, which the join
 * does not take. Without this, the columns vanish while the alert count and the
 * not-ready filter keep counting the hidden facts — so the reader is shown a
 * number they cannot verify, and filtering to it surfaces rows that look ready.
 */
export function suppressUnusableFacts(rows: RegisterRow[], feeds: FeedHealth): RegisterRow[] {
  if (feeds.schedule && feeds.biometric) return rows;
  return rows.map((row) => ({
    ...row,
    ...(feeds.schedule ? {} : { schedule: null, weekly_minutes: null }),
    ...(feeds.biometric
      ? {}
      : { status: null, biometric: null, fingerprint_count: null, days_since_relieving: null }),
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
    truncated: Boolean(coverage.data?.counts.truncated || enrollment.data?.counts.truncated),
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
