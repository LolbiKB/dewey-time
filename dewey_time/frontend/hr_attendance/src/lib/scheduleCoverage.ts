import { formatScheduleDuration } from "@/lib/weekSchedule";

// Pure presentation logic for the Schedule Coverage page. The backend
// (get_schedule_coverage) returns raw weekly_minutes per assigned employee; the
// rounding-to-30 and bucket grouping live here so they stay unit-testable and
// adjustable without a backend deploy.

export type CoverageEmployee = {
  id: string;
  employee_name: string;
  department?: string | null;
  employment_type?: string | null;
  title?: string | null;
  image?: string | null;
};

export type CoverageAssignedEmployee = CoverageEmployee & {
  /** Scheduled minutes/week resolved server-side (0 when the SSA couldn't be resolved). */
  weekly_minutes: number;
};

export type HoursBucket = {
  /** Representative minutes for the bucket, rounded to the nearest 30 (0 = unresolved). */
  minutes: number;
  label: string;
  employees: CoverageAssignedEmployee[];
};

export type CoverageCounts = {
  active: number;
  unassigned: number;
  assigned: number;
  /** True when the active-employee scan hit its cap, so the roster is partial. */
  truncated: boolean;
};

/** Shape returned by the get_schedule_coverage whitelisted method. */
export type ScheduleCoveragePayload = {
  unassigned: CoverageEmployee[];
  assigned: CoverageAssignedEmployee[];
  counts: CoverageCounts;
};

const HALF_HOUR = 30;

/** Round scheduled minutes to the nearest 30 (half rounds up); bad input → 0. */
export function roundMinutesToHalfHour(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round(minutes / HALF_HOUR) * HALF_HOUR;
}

function bucketLabel(minutes: number): string {
  return minutes <= 0 ? "No resolved hours" : formatScheduleDuration(minutes);
}

/**
 * Group assigned employees by their rounded weekly hours, highest first. Assigned
 * employees whose hours couldn't be resolved (0 min) collect in a trailing bucket
 * rather than being dropped. Employees within a bucket are sorted by name.
 */
export function bucketByWeeklyHours(assigned: CoverageAssignedEmployee[]): HoursBucket[] {
  const byMinutes = new Map<number, CoverageAssignedEmployee[]>();
  for (const employee of assigned) {
    const key = roundMinutesToHalfHour(employee.weekly_minutes);
    const group = byMinutes.get(key);
    if (group) group.push(employee);
    else byMinutes.set(key, [employee]);
  }

  return [...byMinutes.entries()]
    .sort(([a], [b]) => b - a) // desc → 0 (unresolved) lands last
    .map(([minutes, employees]) => ({
      minutes,
      label: bucketLabel(minutes),
      employees: employees
        .slice()
        .sort((a, b) =>
          (a.employee_name || a.id).localeCompare(b.employee_name || b.id),
        ),
    }));
}
