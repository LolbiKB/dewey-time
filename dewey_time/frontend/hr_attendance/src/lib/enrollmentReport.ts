// Pure presentation logic for the Biometric Enrollment view. The backend
// returns flat rows and counts; every grouping, filtering and copy decision
// lives here so it stays unit-testable and adjustable without a backend deploy.

export type EnrollmentBucket =
  | "NEEDS_ENROLLMENT"
  | "ENROLLED_NOT_PUNCHING"
  | "OK"
  | "LEAVER_STILL_ENROLLED";

export type EnrollmentRow = {
  id: string;
  employee_name: string | null;
  branch: string | null;
  department: string | null;
  status: string;
  bucket: EnrollmentBucket;
  is_registered: boolean;
  fingerprint_count: number;
  /** Carried because the bridge computes it; no UI column — nobody enrolls faces. */
  face_count: number;
  days_since_relieving: number | null;
};

export type EnrollmentCounts = {
  reported: number;
  needs_enrollment: number;
  enrolled_not_punching: number;
  ok: number;
  leaver_still_enrolled: number;
  excluded_status: number;
  truncated: boolean;
};

/** Shape returned by the get_enrollment_report whitelisted method. */
export type EnrollmentPayload = {
  rows: EnrollmentRow[];
  counts: EnrollmentCounts;
  last_snapshot_at: string | null;
  window_days: number;
};

export const BUCKET_LABELS: Record<EnrollmentBucket, string> = {
  NEEDS_ENROLLMENT: "Needs enrolling",
  ENROLLED_NOT_PUNCHING: "Enrolled, not punching",
  OK: "Enrolled and punching",
  LEAVER_STILL_ENROLLED: "Left — still enrolled",
};

export type EnrollmentFilters = {
  branches: string[];
  departments: string[];
  buckets: EnrollmentBucket[];
};

export type GroupBy = "branch" | "department";

export type EnrollmentGroup = {
  key: string;
  rows: EnrollmentRow[];
};

/** Rows with no branch/department collect here rather than vanishing. */
const UNGROUPED = "Unassigned";

/** Older than this and the snapshot notice escalates from informational. */
const STALE_AFTER_MINUTES = 24 * 60;

/**
 * Has the bridge EVER reported? Gates the whole list.
 *
 * With no snapshot, every employee correctly computes as unenrolled — and that
 * is exactly the problem: a plumbing failure would render as 236 findings. The
 * page must say the feed is not connected instead.
 */
export function isFeedConnected(payload: EnrollmentPayload | undefined): boolean {
  return Boolean(payload?.last_snapshot_at);
}

/** Frappe datetimes are "YYYY-MM-DD HH:MM:SS" in site-local time. */
function parseFrappeDatetime(value: string): number | null {
  const ms = Date.parse(value.replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
}

function humaniseAge(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function snapshotNotice(
  payload: EnrollmentPayload | undefined,
  nowMs: number,
): { text: string; stale: boolean } | null {
  const raw = payload?.last_snapshot_at;
  if (!raw) return null;
  const at = parseFrappeDatetime(raw);
  if (at === null) return null;

  const minutes = Math.max(0, Math.round((nowMs - at) / 60000));
  return {
    text: `Device data as of ${humaniseAge(minutes)}.`,
    stale: minutes > STALE_AFTER_MINUTES,
  };
}

/** AND across axes, OR within one. An empty axis means "no constraint". */
export function filterRows(rows: EnrollmentRow[], filters: EnrollmentFilters): EnrollmentRow[] {
  return rows.filter((row) => {
    if (filters.branches.length && !filters.branches.includes(row.branch ?? UNGROUPED)) return false;
    if (filters.departments.length && !filters.departments.includes(row.department ?? UNGROUPED)) {
      return false;
    }
    if (filters.buckets.length && !filters.buckets.includes(row.bucket)) return false;
    return true;
  });
}

/** Group alphabetically, with the value-less group always last. */
export function groupRows(rows: EnrollmentRow[], by: GroupBy): EnrollmentGroup[] {
  const groups = new Map<string, EnrollmentRow[]>();
  for (const row of rows) {
    const key = (by === "branch" ? row.branch : row.department) || UNGROUPED;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .map(([key, groupRows_]) => ({ key, rows: groupRows_ }))
    .sort((a, b) => {
      if (a.key === UNGROUPED) return 1;
      if (b.key === UNGROUPED) return -1;
      return a.key.localeCompare(b.key);
    });
}

/**
 * Human description of the active filters, for the CSV provenance row. Lives
 * here rather than inline in the view so it is reachable by a unit test — the
 * view's own tests only ever see the default (no-filter) state, since filters
 * are internal `useState`, not a prop.
 */
export function describeFilters(filters: EnrollmentFilters): string {
  const parts = [
    filters.branches.length ? `Branch: ${filters.branches.join(", ")}` : null,
    filters.departments.length ? `Department: ${filters.departments.join(", ")}` : null,
    filters.buckets.length
      ? `State: ${filters.buckets.map((b) => BUCKET_LABELS[b]).join(", ")}`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : "All employees";
}
