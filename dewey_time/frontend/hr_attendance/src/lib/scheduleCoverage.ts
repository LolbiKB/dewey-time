// The wire shape of get_schedule_coverage, and nothing else.
//
// This file used to carry the Schedule Coverage page's presentation logic too —
// rounding to the nearest 30 minutes and grouping employees into weekly-hours
// buckets. Both went with the page: the readiness register reports an
// employee's hours on their own row rather than bucketing the roster, so
// nothing rounds any more. `weekly_minutes` is now formatted at the point of
// display, by registerColumns.

export type CoverageEmployee = {
  id: string;
  employee_name: string;
  department?: string | null;
  branch?: string | null;
  employment_type?: string | null;
  title?: string | null;
  image?: string | null;
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

export type CoverageAssignedEmployee = CoverageEmployee & {
  /** Scheduled minutes/week resolved server-side (0 when the SSA couldn't be resolved). */
  weekly_minutes: number;
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
