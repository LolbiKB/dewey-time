/**
 * HR flag-queue reads/writes. Plain async functions with no React, following
 * the same shape as `services/schedule.ts` — `hooks/useFlagQueue.ts` wraps
 * `getFlagQueue` with `useQuery`; the decide/reverse mutations are wired up
 * by a later task.
 *
 * Two backend modules split the read path from the write path
 * (`flag_queue_api.py` for `get_flag_queue`, `flag_decision_api.py` for
 * `decide_flags` / `reverse_decision_group` — see the plan's Interface
 * Contract), so this file carries two NS constants rather than one, the same
 * split `services/scheduleImport.ts` uses for IMPORT_NS/SCHEDULE_NS.
 */
import { frappeCall } from "@/lib/frappe";
import type { Outcome, QueuePayload, Reason, Tier } from "@/types/flags";

const QUEUE_NS = "dewey_time.attendance_engine.flag_queue_api";
const DECISION_NS = "dewey_time.attendance_engine.flag_decision_api";

/** One row of a bulk write's partial failure — Global Constraint 8's fan-out shape. */
export type DecideFlagsError = { flag_identity: string; error: string };

export type DecideFlagsResult =
  | { ok: boolean; written: number; group_key: string; errors: DecideFlagsError[] }
  | { needs_confirm: true; preview: { count: number; employees: number } };

/**
 * `reverse_decision_group` shares `decide_flags`'s preview/confirm two-step
 * (`flag_decision_api.py`'s `reverse_decision_group`), so this is a union for
 * the same reason `DecideFlagsResult` is: an unknown `group_key` returns
 * `{needs_confirm: true, preview: {count: 0, employees: 0}}` on the first
 * call, and `{ok: true, reversed: 0, ...}` — a successful no-op, not an
 * error — once the caller passes `confirm`. Field name is `reversed`
 * (matching the Python return dict), not `written`.
 */
export type ReverseDecisionResult =
  | { ok: boolean; reversed: number; group_key: string; errors: DecideFlagsError[] }
  | { needs_confirm: true; preview: { count: number; employees: number } };

export function getFlagQueue(args: {
  startDate: string;
  endDate: string;
  tier?: Tier | null;
  limit?: number;
  /**
   * Also return people whose flags are all settled, so an applied decision can
   * be reached and replaced. Sent only when true — omitted, the backend answers
   * exactly as it always has.
   */
  includeDecided?: boolean;
}) {
  return frappeCall<QueuePayload>(`${QUEUE_NS}.get_flag_queue`, {
    start_date: args.startDate,
    end_date: args.endDate,
    tier: args.tier ?? undefined,
    limit: args.limit,
    include_decided: args.includeDecided ? 1 : undefined,
  });
}

export function decideFlags(args: {
  identities: string[];
  outcome: Outcome;
  reason: Reason;
  note?: string | null;
  groupKey?: string | null;
  confirm?: boolean;
}) {
  return frappeCall<DecideFlagsResult>(
    `${DECISION_NS}.decide_flags`,
    {
      identities: args.identities,
      outcome: args.outcome,
      reason: args.reason,
      note: args.note ?? undefined,
      group_key: args.groupKey ?? undefined,
      confirm: args.confirm ?? undefined,
    },
    { method: "POST" },
  );
}

export function reverseDecisionGroup(args: { groupKey: string; note: string; confirm?: boolean }) {
  return frappeCall<ReverseDecisionResult>(
    `${DECISION_NS}.reverse_decision_group`,
    {
      group_key: args.groupKey,
      note: args.note,
      confirm: args.confirm ?? undefined,
    },
    { method: "POST" },
  );
}
