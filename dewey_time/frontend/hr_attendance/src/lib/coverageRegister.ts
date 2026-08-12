import type {
  CoverageAssignedEmployee,
  CoverageEmployee,
  ScheduleCoveragePayload,
} from "@/lib/scheduleCoverage";
import type { EnrollmentPayload, EnrollmentRow } from "@/lib/enrollmentReport";

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
  biometric: "enrolled" | "none" | "still_enrolled" | null;
  fingerprint_count: number | null;
  days_since_relieving: number | null;
};

export type FeedHealth = { schedule: boolean; biometric: boolean };

function biometricOf(row: EnrollmentRow): RegisterRow["biometric"] {
  if (row.bucket === "LEAVER_STILL_ENROLLED") return "still_enrolled";
  if (row.bucket === "NEEDS_ENROLLMENT") return "none";
  return "enrolled";
}

/**
 * Join on employee id. The union of both feeds, not the intersection: coverage
 * returns Active employees only, so a leaver still holding a template exists in
 * the enrollment feed alone — and that row is the security finding this page
 * exists to show.
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
      branch: (emp as CoverageEmployee & { branch?: string | null }).branch ?? null,
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

  return [...byId.values()].sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}
