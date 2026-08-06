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
 *
 * IMPORTANT — `undecided` (frontend) vs `unresolved` (backend) are different
 * sets. `flag_grouping.py`'s `UNRESOLVED_STATES = (STATE_UNDECIDED,
 * STATE_NEEDS_RE_REVIEW)` is what `QueuePerson.undecided_count` actually
 * counts (`_person`'s `unresolved = [f for f in person_flags if
 * f["decision_state"] in UNRESOLVED_STATES]`) — so it INCLUDES
 * `needs_re_review` flags (a stale prior decision whose evidence changed;
 * it needs a human to look again, not a bulk repeat of the old verdict).
 * Both `groupPayload` and `remainingIdentities` below deliberately filter to
 * the strict `"undecided"` state only, on purpose — a `needs_re_review` flag
 * must never be swept into a bulk write. That means the counts these two
 * functions return can be LOWER than `person.undecided_count` for the same
 * person. Do not pair `undecided_count` with either function's output in
 * user-facing copy (e.g. a button reading "Apply to remaining N" must read N
 * from `remainingIdentities(...).length`/`groupPayload(...)`'s own counts,
 * never from `undecided_count`) — see each function's docstring below.
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
 * Builds the `identities` array (plus two live headcounts for the group
 * header) for a bulk `decide_flags` call over a cause group's members.
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
 * Two counts come back, and they answer different questions:
 *   - `employeeCount` counts every non-excluded member once, independent of
 *     whether they end up contributing an identity — it backs the checkbox
 *     tally ("39 of 41 checked").
 *   - `coveredEmployeeCount` counts only the non-excluded members who
 *     actually contribute at least one identity to `identities`. A member
 *     whose only unresolved flag is `needs_re_review` is checked (counted in
 *     `employeeCount`) but writes nothing (excluded from
 *     `coveredEmployeeCount`), per the module docstring's `undecided` vs
 *     `unresolved` note above. The group header's action label ("Excuse 39")
 *     must read from `coveredEmployeeCount`, not `employeeCount`, or it
 *     promises a write that will not happen for some of those 39.
 */
export function groupPayload(
  members: QueuePerson[],
  excluded: ReadonlySet<string>,
): { identities: string[]; employeeCount: number; coveredEmployeeCount: number } {
  const identities: string[] = [];
  let employeeCount = 0;
  let coveredEmployeeCount = 0;

  for (const person of members) {
    if (excluded.has(person.employee)) continue;
    employeeCount += 1;
    const before = identities.length;
    for (const f of person.flags) {
      if (isUndecided(f)) identities.push(f.flag_identity);
    }
    if (identities.length > before) coveredEmployeeCount += 1;
  }

  return { identities, employeeCount, coveredEmployeeCount };
}

/**
 * A person's undecided flag identities, worst-first. `person.flags` already
 * arrives worst-first per the queue contract (FlagOut[] — "worst-first, ALL
 * that person's flags that day"), so this only filters; it never re-sorts.
 * Backs "Apply to remaining N" once the panel's first decision has fired —
 * N must be read as `remainingIdentities(person).length`, NEVER as
 * `person.undecided_count`. `undecided_count` counts `needs_re_review` flags
 * too (per the module docstring's `undecided` vs `unresolved` note above),
 * so it can be strictly higher than what this function returns for the same
 * person; labelling a button from it would promise more than the next
 * `decide_flags` call actually writes.
 */
export function remainingIdentities(person: QueuePerson): string[] {
  return person.flags.filter(isUndecided).map((f) => f.flag_identity);
}
