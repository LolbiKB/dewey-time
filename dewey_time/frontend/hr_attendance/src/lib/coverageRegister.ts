import type {
  CoverageAssignedEmployee,
  CoverageEmployee,
  ScheduleCoveragePayload,
} from "@/lib/scheduleCoverage";
import { isFeedConnected, type EnrollmentPayload, type EnrollmentRow } from "@/lib/enrollmentReport";

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
