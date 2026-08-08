/**
 * Payload types for the flag-queue feature — shared verbatim by
 * `services/flags.ts`, `hooks/useFlagQueue.ts` and the queue UI (later
 * tasks). These mirror the Python dict shapes `flag_queue_api.get_flag_queue`
 * and `flag_grouping.build_queue` return (see the plan's Interface Contract)
 * field for field. Do not add, rename, or reshape anything here without
 * updating that contract in the same change — every later frontend task is
 * built directly on these exact names.
 */

export type Tier = "act" | "review" | "routine";

export type DecisionState = "undecided" | "matched" | "needs_re_review";

export type Outcome = "EXCUSED" | "UPHELD";

export type Reason =
  | "APPROVED_LEAVE"
  | "DEVICE_OR_DATA_FAULT"
  | "MANAGER_APPROVED"
  | "SCHEDULE_WRONG"
  | "COVERING_OTHER_SITE"
  | "GENUINE_VIOLATION"
  | "OTHER";

export type FlagDecision = {
  name: string;
  outcome: Outcome;
  reason: Reason;
  note?: string | null;
  decided_by: string;
  decided_at: string;
  group_key?: string | null;
};

export type FlagOut = {
  flag_identity: string;
  flag_code: string;
  /** The flag's own date. An entry can span dates, so the person cannot answer this. */
  attendance_date: string;
  severity?: string;
  day_closed: number;
  evidence: Record<string, unknown>;
  rank: number;
  tier: Tier;
  decision_state: DecisionState;
  /** The live decision row, or null when this flag is still undecided. */
  decision: FlagDecision | null;
};

export type QueuePerson = {
  /**
   * Unique across the whole assembled entry set, stamped by the backend.
   * `p:<employee>` for a lone row, `<group_key>|p:<employee>` for a group
   * member. A person can appear in two entries under the per-flag invariant,
   * so a key derived from employee alone would collide with itself.
   */
  entry_key: string;
  employee: string;
  employee_name: string;
  employee_branch: string | null;
  /**
   * `Employee.image` — a site-relative path like "/files/sokheng.jpg", null for
   * the many employees who have no photo on file. The row renders initials in
   * that case, never an empty circle.
   */
  employee_image: string | null;
  /** The worst unresolved flag's date — the row's headline day. */
  attendance_date: string;
  /** Every distinct date THIS entry's flags fall on, ascending. */
  dates: string[];
  rank: number;
  tier: Tier;
  /** Worst-first, all of this person's flags **in this entry**. */
  flags: FlagOut[];
  undecided_count: number;
  /** Other entries this person also appears in. 0 means no badge. */
  also_count: number;
  /** How many of those other entries are lone person rows. */
  also_outlier_count: number;
};

export type QueueEntry =
  | ({ kind: "person" } & QueuePerson)
  | {
      kind: "group";
      group_type: "BRANCH_NO_DEVICE_DATA" | "REPEAT_PATTERN" | "ROUTINE_CODE";
      group_key: string;
      branch: string | null;
      flag_code: string | null;
      /** null for REPEAT_PATTERN, which spans dates by definition. */
      attendance_date: string | null;
      rank: number;
      tier: Tier;
      members: QueuePerson[];
    };

export type QueuePayload = {
  entries: QueueEntry[];
  counts: { open: number; needs_re_review: number; decided: number; people: number; rows: number };
  orphans: { orphaned_flag_gone: number; orphaned_evidence_changed: number };
  alerts: { branch: string; local_date: string; status: string; last_error?: string | null }[];
  /**
   * (branch, date) pairs where no device data arrived — the strip's grey cells.
   *
   * Required, and safe to rely on: the queue's cache prefix is versioned by
   * payload shape (`flag_queue:v2`, flag_queue_api.py) and was bumped when this
   * key and the person fields above were added, so a pre-deploy entry can never
   * be served to code that expects them. Adding a field here without bumping
   * that prefix reintroduces a 60-second window where cached responses arrive
   * one field short and the page throws.
   */
  outage_dates: { branch: string; date: string }[];
  truncated: boolean;
  start_date: string;
  end_date: string;
};
