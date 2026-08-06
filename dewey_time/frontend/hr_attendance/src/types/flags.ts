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
  employee: string;
  employee_name: string;
  employee_branch: string | null;
  attendance_date: string;
  rank: number;
  tier: Tier;
  /** Worst-first, ALL that person's flags that day. */
  flags: FlagOut[];
  undecided_count: number;
};

export type QueueEntry =
  | ({ kind: "person" } & QueuePerson)
  | {
      kind: "group";
      group_type: "BRANCH_NO_DEVICE_DATA" | "ROUTINE_CODE";
      group_key: string;
      branch: string | null;
      flag_code: string | null;
      attendance_date: string;
      rank: number;
      tier: Tier;
      members: QueuePerson[];
    };

export type QueuePayload = {
  entries: QueueEntry[];
  counts: { open: number; needs_re_review: number; decided: number; people: number };
  orphans: { orphaned_flag_gone: number; orphaned_evidence_changed: number };
  alerts: { branch: string; local_date: string; status: string; last_error?: string | null }[];
  truncated: boolean;
  start_date: string;
  end_date: string;
};
