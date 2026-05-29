import type { Checkin } from "@/types/calendar";

export type Segment = {
  start: Checkin;
  end: Checkin;
  minutes: number | null;
  startMin: number | null;
  endMin: number | null;
  startPct: number | null;
  endPct: number | null;
  branch: string | null;
};

export type TimelineGap = {
  startMin: number;
  endMin: number;
  minutes: number;
  startCheckin?: Checkin | null;
  endCheckin?: Checkin | null;
};

export function punchBranch(checkin: Checkin): string | null {
  const branch = checkin.custom_device_branch?.trim();
  return branch || null;
}

export function hasPunchBranch(checkin: Checkin): boolean {
  return punchBranch(checkin) != null;
}

/**
 * Consecutive punches at the same device branch (branch change starts a new run).
 * Punches without custom_device_branch are never grouped — each is its own run (rogue).
 */
export function groupCheckinsByBranchRuns(sorted: Checkin[]): Checkin[][] {
  const runs: Checkin[][] = [];

  for (const checkin of sorted) {
    if (!hasPunchBranch(checkin)) {
      runs.push([checkin]);
      continue;
    }

    const branch = punchBranch(checkin)!;
    const current = runs[runs.length - 1];

    if (!current?.length) {
      runs.push([checkin]);
      continue;
    }

    const currentBranch = punchBranch(current[0]!);
    if (currentBranch && currentBranch === branch) {
      current.push(checkin);
    } else {
      runs.push([checkin]);
    }
  }

  return runs;
}

export function sortCheckinsByTime(
  checkins: Checkin[],
  parseTime: (value: string) => Date
): Checkin[] {
  return [...checkins].sort(
    (a, b) => parseTime(a.time).getTime() - parseTime(b.time).getTime()
  );
}

/** MVP direction within a single branch run; ignores Employee Checkin.log_type. */
export function inferCheckinDirection(sortedIndex: number, totalCheckins: number): "IN" | "OUT" {
  if (totalCheckins <= 0) return "IN";
  if (sortedIndex === 0) return "IN";
  if (sortedIndex === totalCheckins - 1) return "OUT";
  return sortedIndex % 2 === 0 ? "IN" : "OUT";
}

export function directionForCheckin(sorted: Checkin[], checkin: Checkin): "IN" | "OUT" {
  for (const run of groupCheckinsByBranchRuns(sorted)) {
    const idx = run.findIndex(
      (row) =>
        row === checkin ||
        (row.name && checkin.name && row.name === checkin.name) ||
        row.time === checkin.time
    );
    if (idx >= 0) return inferCheckinDirection(idx, run.length);
  }
  return "IN";
}

export function deriveSegments(
  checkins: Checkin[],
  helpers: {
    parseTime: (value: string) => Date;
    minutesFromDateTime: (value: string | null | undefined) => number | null;
    clamp: (value: number, min: number, max: number) => number;
  }
): Segment[] {
  const sorted = sortCheckinsByTime(checkins, helpers.parseTime);
  const out: Segment[] = [];

  for (const run of groupCheckinsByBranchRuns(sorted)) {
    if (!run.length || !hasPunchBranch(run[0]!)) continue;

    for (let i = 0; i < run.length - 1; i += 2) {
      const start = run[i]!;
      const end = run[i + 1]!;
      const startBranch = punchBranch(start);
      const endBranch = punchBranch(end);

      if (!startBranch || !endBranch || startBranch !== endBranch) {
        continue;
      }

      let minutes: number | null = null;
      if (start.time && end.time) {
        const delta = helpers.parseTime(end.time).getTime() - helpers.parseTime(start.time).getTime();
        if (Number.isFinite(delta) && delta >= 0) minutes = Math.round(delta / 60000);
      }

      const startMin = helpers.minutesFromDateTime(start.time);
      const endMin = helpers.minutesFromDateTime(end.time);
      const dayMinutes = 24 * 60;

      out.push({
        start,
        end,
        minutes,
        startMin,
        endMin,
        startPct: startMin != null ? helpers.clamp((startMin / dayMinutes) * 100, 0, 100) : null,
        endPct: endMin != null ? helpers.clamp((endMin / dayMinutes) * 100, 0, 100) : null,
        branch: startBranch ?? endBranch,
      });
    }
  }

  return out;
}

/**
 * Unpaired punches: every punch without branch (rogue), plus last punch in a named
 * branch run when that run has an odd count.
 */
export function deriveUnpairedPunches(
  checkins: Checkin[],
  parseTime: (value: string) => Date
): Checkin[] {
  const sorted = sortCheckinsByTime(checkins, parseTime);
  const unpaired: Checkin[] = [];

  for (const run of groupCheckinsByBranchRuns(sorted)) {
    if (!run.length) continue;

    if (!hasPunchBranch(run[0]!)) {
      unpaired.push(...run);
      continue;
    }

    if (run.length % 2 === 1) {
      unpaired.push(run[run.length - 1]!);
    }
  }

  return unpaired;
}

/**
 * Away intervals between consecutive timeline blocks (segments and unpaired punches),
 * using minute-of-day positions so the UI can scale height linearly with elapsed time.
 */
export function deriveTimelineGaps(
  segments: Segment[],
  unpaired: Checkin[],
  minutesFromDateTime: (value: string | null | undefined) => number | null
): TimelineGap[] {
  type Block =
    | { kind: "segment"; startMin: number; endMin: number }
    | { kind: "unpaired"; min: number };

  const blocks: Block[] = [];

  for (const segment of segments) {
    if (segment.startMin == null || segment.endMin == null) continue;
    blocks.push({
      kind: "segment",
      startMin: segment.startMin,
      endMin: segment.endMin,
    });
  }

  for (const checkin of unpaired) {
    const min = minutesFromDateTime(checkin.time);
    if (min != null) blocks.push({ kind: "unpaired", min });
  }

  blocks.sort((a, b) => {
    const aStart = a.kind === "segment" ? a.startMin : a.min;
    const bStart = b.kind === "segment" ? b.startMin : b.min;
    return aStart - bStart;
  });

  const gaps: TimelineGap[] = [];

  for (let i = 0; i < blocks.length - 1; i++) {
    const current = blocks[i]!;
    const next = blocks[i + 1]!;
    const endMin = current.kind === "segment" ? current.endMin : current.min;
    const startMin = next.kind === "segment" ? next.startMin : next.min;
    if (startMin <= endMin) continue;

    gaps.push({
      startMin: endMin,
      endMin: startMin,
      minutes: startMin - endMin,
    });
  }

  return gaps;
}

export function computeDayTimeWindow(
  checkins: Checkin[],
  minutesFromDateTime: (value: string | null | undefined) => number | null,
  marginMinutes = 30
): { startMin: number; endMin: number; span: number } | null {
  const mins: number[] = [];
  for (const checkin of checkins) {
    const min = minutesFromDateTime(checkin.time);
    if (min != null) mins.push(min);
  }
  if (!mins.length) return null;

  const startMin = Math.max(0, Math.min(...mins) - marginMinutes);
  const endMin = Math.min(24 * 60, Math.max(...mins) + marginMinutes);
  if (endMin <= startMin) return null;

  return { startMin, endMin, span: endMin - startMin };
}
