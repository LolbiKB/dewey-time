/**
 * Pure decision-state logic for the flag triage page: whether a pending
 * decision has what it needs before "Decide" submits, and the two payload
 * builders that turn a person or a cause-group selection into the exact
 * `identities` array `decide_flags` expects.
 *
 * `groupPayload` is the safety property the design doc calls out under
 * "Per-member exclusion on group decisions"
 * (docs/superpowers/specs/2026-08-05-hr-flag-management-design.md): unchecking
 * one member of a 41-person BRANCH_NO_DEVICE_DATA group must remove ALL of
 * that employee's flags from the bulk write — not just the flag that put
 * them in the group — and must never sweep in a flag the queue already shows
 * as decided. Without both of those, one genuine no-show hidden among 41
 * device-fault rows could be silently excused by a checkbox that only
 * covered their headline flag, which the design doc calls "the single most
 * damaging thing this page could do".
 */
import type { FlagOut, Outcome, QueuePerson, Reason } from "@/types/flags";

export type PendingDecision = { outcome: Outcome; reason: Reason; note: string };

/**
 * A note is mandatory for `outcome: "UPHELD"` (an uncontested violation
 * still needs the "why" on the audit record) and for `reason: "OTHER"` (the
 * closed vocabulary's escape hatch is unreadable without free text) — see
 * the `Attendance Flag Decision.note` field spec. Every other combination
 * can submit with an empty note.
 */
export function decisionIsComplete(decision: PendingDecision): boolean {
  const noteRequired = decision.outcome === "UPHELD" || decision.reason === "OTHER";
  return !noteRequired || decision.note.trim().length > 0;
}

function isUndecided(flag: FlagOut): boolean {
  return flag.decision_state === "undecided";
}

/**
 * Builds the `identities` array (plus a live headcount for the group header)
 * for a bulk `decide_flags` call over a cause group's members.
 *
 * Two filters, both load-bearing:
 *   - an excluded employee contributes NOTHING: every flag of theirs is
 *     dropped, not just the one that put them in the group. A person can
 *     carry flags their `+N` badge never itemises, and all of them must
 *     stay out of the write.
 *   - only `undecided` flags are ever included, even for a checked-in
 *     member. A `matched` or `needs_re_review` flag already has a decision
 *     (or needs a human to look again, not a bulk repeat); including it
 *     would produce a spurious supersession nobody asked for.
 *
 * `employeeCount` counts every non-excluded member once, independent of
 * whether they end up contributing an identity — it backs the group
 * header's live count ("Excuse 39" when 2 of 41 are unchecked), which
 * tracks the checkboxes, not the write's contents.
 */
export function groupPayload(
  members: QueuePerson[],
  excluded: ReadonlySet<string>,
): { identities: string[]; employeeCount: number } {
  const identities: string[] = [];
  let employeeCount = 0;

  for (const person of members) {
    if (excluded.has(person.employee)) continue;
    employeeCount += 1;
    for (const f of person.flags) {
      if (isUndecided(f)) identities.push(f.flag_identity);
    }
  }

  return { identities, employeeCount };
}

/**
 * A person's undecided flag identities, worst-first. `person.flags` already
 * arrives worst-first per the queue contract (FlagOut[] — "worst-first, ALL
 * that person's flags that day"), so this only filters; it never re-sorts.
 * Backs "Apply to remaining N" once the panel's first decision has fired.
 */
export function remainingIdentities(person: QueuePerson): string[] {
  return person.flags.filter(isUndecided).map((f) => f.flag_identity);
}
