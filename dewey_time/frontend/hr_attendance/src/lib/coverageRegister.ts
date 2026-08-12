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
