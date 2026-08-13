// The enrollment feed's wire types, and the two readings of it that are not
// about presentation: has the bridge ever spoken, and how long ago.
//
// This file used to hold the Biometric Enrollment view's grouping, filtering
// and copy as well. That view was replaced by the coverage readiness register,
// which derives its own — so the rest went with it rather than sitting here as
// a second, drifting answer to the same questions.

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
  /**
   * ERPNext `Employee.custom_khmer_last_name` / `custom_khmer_first_name`.
   *
   * Raw and unordered on the wire; compose with `khmerName()` before display,
   * which puts the family name first. Optional because a site mid-migration may
   * not have the columns yet — the backend selects them behind a
   * `has_column` check.
   */
  custom_khmer_last_name?: string | null;
  custom_khmer_first_name?: string | null;
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

/**
 * Older than this and the feed is treated as having stopped reporting.
 *
 * Read by feedHealth in coverageRegister.ts, which blanks the biometric facts
 * once a snapshot passes it — a bridge that spoke yesterday and has said
 * nothing since cannot vouch for who is enrolled today.
 */
export const STALE_AFTER_MINUTES = 24 * 60;

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
export function parseFrappeDatetime(value: string): number | null {
  const ms = Date.parse(value.replace(" ", "T"));
  return Number.isNaN(ms) ? null : ms;
}
