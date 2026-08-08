/**
 * Splits the queue payload into the two things it actually contains.
 *
 * `flag_grouping.py` already draws this line and then loses it: "A device
 * outage claims the whole day, before anything else looks at it." An outage is
 * a PRECONDITION — there is no evidence to weigh and nobody is being judged —
 * while every other entry asks a question about a person. Rendering both in
 * one ranked list made the queue report 147 rows when it held 3 decisions and
 * 144 acknowledgements, and pushed the one row genuinely needing review below
 * fourteen infrastructure rows.
 *
 * Pure, and deliberately outside any component: the unit suite renders with
 * renderToStaticMarkup and has no react-query harness, so arithmetic left
 * inside FlagQueuePage is arithmetic nothing can test.
 */
import { groupPayload } from "@/lib/flagDecisionState";
import type { QueueEntry } from "@/types/flags";

export type OutageGroup = Extract<QueueEntry, { kind: "group" }>;

/** No exclusions — the band excludes whole branches, never individuals. */
const NO_EXCLUSIONS: ReadonlySet<string> = new Set<string>();

export function isOutageGroup(entry: QueueEntry): boolean {
  return entry.kind === "group" && entry.group_type === "BRANCH_NO_DEVICE_DATA";
}

export function partitionQueue(entries: QueueEntry[]): {
  outages: OutageGroup[];
  queue: QueueEntry[];
} {
  const outages: OutageGroup[] = [];
  const queue: QueueEntry[] = [];
  for (const entry of entries) {
    if (isOutageGroup(entry)) outages.push(entry as OutageGroup);
    else queue.push(entry);
  }
  return { outages, queue };
}

/**
 * What "Excuse all" would actually write, for the branches still checked.
 *
 * Built from `groupPayload` rather than by hand so the two filters it owns
 * apply here too: only strictly `undecided` flags are ever included, and
 * `coveredEmployeeCount` counts only members who contribute an identity. A
 * member whose sole unresolved flag is `needs_re_review` is checked but writes
 * nothing, so a label reading `employeeCount` would promise a write that does
 * not happen for them.
 *
 * No dedupe: the per-flag invariant puts each flag in exactly one entry, so two
 * outage groups cannot both carry the same identity.
 */
export function outageWrite(
  outages: OutageGroup[],
  excludedBranches: ReadonlySet<string>,
): { identities: string[]; branchCount: number; employeeCount: number } {
  const identities: string[] = [];
  let branchCount = 0;
  let employeeCount = 0;

  for (const group of outages) {
    if (excludedBranches.has(group.group_key)) continue;
    branchCount += 1;
    const payload = groupPayload(group.members, NO_EXCLUSIONS);
    identities.push(...payload.identities);
    employeeCount += payload.coveredEmployeeCount;
  }

  return { identities, branchCount, employeeCount };
}

/**
 * Distinct employees across the judgment queue. `counts.people` from the
 * payload counts the whole thing including outage members, so it cannot answer
 * "how many people are actually waiting on a decision" once the band exists.
 */
export function queuePeopleCount(entries: QueueEntry[]): number {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "person") seen.add(entry.employee);
    else for (const member of entry.members) seen.add(member.employee);
  }
  return seen.size;
}
