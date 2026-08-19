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
  /**
   * Whether this person is SUPPOSED to have a weekly schedule, resolved
   * server-side from the employment-type allowlist
   * (`coverage_api._schedule_expectation`). Optional because a cached payload
   * written before the field existed genuinely arrives without it — the
   * register reads that absence as silence, not as "scheduled".
   */
  schedule_expectation?: "scheduled" | "clock" | "unclassified" | null;
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
  /**
   * Where this employee stands in the Telegram rollout, resolved server-side.
   *
   * `id_on_file` means a prior notifier recorded their numeric Telegram id on
   * `Employee.custom_telegram_chat_id` but no binding exists yet. Optional and
   * nullable because the backend returns null for the whole roster when the
   * lookup fails — silence, which the register renders as a blank column
   * rather than as a few hundred people needing a link.
   */
  telegram?: TelegramState | null;
};

/** The Telegram rollout states, in the order HR works through them. */
export type TelegramState = "linked" | "id_on_file" | "none";

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
