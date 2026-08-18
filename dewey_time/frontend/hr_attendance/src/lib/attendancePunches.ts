import type { Checkin } from "@/types/calendar";

import { minutesFromDateTime, parseDateTimeLocal } from "@/lib/attendanceTime";

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
  kind: "lunch" | "away";
  source: "observed" | "scheduled" | "gap";
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


/**
 * Which way a punch goes: its own label if it has one, its position if not.
 *
 * `Employee Checkin.log_type` is an optional Select and a device that reports
 * only a timestamp leaves it empty on every row, so position has to remain the
 * fallback — that is what `inferCheckinDirection` is for, and every all-blank
 * day pairs exactly as it always did. What changes is that an EXPLICIT label is
 * now believed rather than overruled by where the punch happens to sit.
 */
function punchDirection(punch: Checkin, index: number, runLength: number): "IN" | "OUT" {
  const label = String(punch.log_type || "").trim().toUpperCase();
  if (label === "IN") return "IN";
  if (label === "OUT") return "OUT";
  return inferCheckinDirection(index, runLength);
}

export type RunPairing = {
  /** Arrivals matched to the departure that closed them. */
  pairs: Array<{ start: Checkin; end: Checkin }>;
  /** Punches that never matched: duplicates, stray departures, an open arrival. */
  unmatched: Checkin[];
  /** The arrival still open at the end of the run, if any. */
  openAt: Checkin | null;
};

/**
 * Walk one branch run and match arrivals to departures.
 *
 * ONE derivation, because there used to be two and they disagreed.
 * `deriveSegments` paired positionally (`i += 2`) while `deriveUnpairedPunches`
 * used run-length parity, so a run of two arrivals produced a sixty-minute
 * "segment" from one of them AND no unpaired punch from the other — a stretch
 * of work nobody did, drawn on the timeline and summed into the totals. See
 * issue #191.
 *
 * A second arrival with no departure between does NOT close the first: the
 * earlier one is when the person actually got there, and the duplicate is
 * noise. A departure with nothing open is stray and matches nothing. Both fall
 * through to `unmatched`, where the presentation layer already knows how to
 * draw them.
 */
export function pairRun(run: Checkin[]): RunPairing {
  const pairs: Array<{ start: Checkin; end: Checkin }> = [];
  const unmatched: Checkin[] = [];
  let open: Checkin | null = null;

  run.forEach((punch, index) => {
    if (punchDirection(punch, index, run.length) === "IN") {
      // Keep the FIRST arrival; a repeat is the duplicate, not the real one.
      if (open) unmatched.push(punch);
      else open = punch;
      return;
    }
    if (open) {
      pairs.push({ start: open, end: punch });
      open = null;
      return;
    }
    unmatched.push(punch);
  });

  if (open) unmatched.push(open);
  return { pairs, unmatched, openAt: open };
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

    for (const { start, end } of pairRun(run).pairs) {
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

    // The SAME pairing deriveSegments uses. Parity was the old rule and it
    // disagreed with positional pairing the moment a run held two arrivals:
    // an even run reported nothing unpaired while the segments quietly
    // invented a stretch of work. Now a punch is unpaired exactly when nothing
    // matched it.
    unpaired.push(...pairRun(run).unmatched);
  }

  return unpaired;
}

export type PunchPresentationKind = "rogue" | "openSession" | "unpairedError" | "offShiftPunch";

export type DeviceSyncStatus = {
  device_sn: string;
  branch?: string | null;
  local_date: string;
  last_device_log_at?: string | null;
  last_delivered_at?: string | null;
  pending_count?: number | null;
  last_error?: string | null;
};

export type PunchPresentation = {
  kind: PunchPresentationKind;
  checkin: Checkin;
  branch: string | null;
  startMin: number;
  confirmedEndMin: number;
  uncertainEndMin?: number | null;
  syncLagging?: boolean;
};

export function dateKeyFromDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isInsidePairedSegment(min: number, segments: Segment[]): boolean {
  for (const segment of segments) {
    if (segment.startMin == null || segment.endMin == null) continue;
    if (min >= segment.startMin && min < segment.endMin) return true;
  }
  return false;
}

export function syncHorizonForTimeline(
  deviceSync: DeviceSyncStatus[] | undefined,
  options: { dateKey: string; deviceIds?: Iterable<string | null | undefined> }
): { horizonMin: number | null; isLagging: boolean } {
  if (!deviceSync?.length) return { horizonMin: null, isLagging: false };

  const deviceFilter =
    options.deviceIds != null
      ? new Set(
          [...options.deviceIds]
            .map((id) => (id != null ? String(id).trim() : ""))
            .filter(Boolean)
        )
      : null;

  let horizonMin: number | null = null;
  let isLagging = false;

  for (const row of deviceSync) {
    if (row.local_date !== options.dateKey) continue;
    if (deviceFilter?.size && !deviceFilter.has(row.device_sn)) continue;

    const deliveredMin = minutesFromDateTime(row.last_delivered_at);
    const deviceLogMin = minutesFromDateTime(row.last_device_log_at);

    if (deliveredMin != null) {
      horizonMin = horizonMin == null ? deliveredMin : Math.min(horizonMin, deliveredMin);
    }
    if (deliveredMin != null && deviceLogMin != null && deviceLogMin > deliveredMin) {
      isLagging = true;
    }
    if ((row.pending_count ?? 0) > 0) {
      isLagging = true;
    }
  }

  return { horizonMin, isLagging };
}

function minutesNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

const punchPresentationHelpers = {
  parseTime: (value: string) => new Date(value.replace(" ", "T")),
  minutesFromDateTime,
  clamp: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)),
};

export function classifyUnpairedPresentations(
  checkins: Checkin[],
  options: {
    dateKey: string;
    now?: Date;
    shiftEndMin?: number | null;
    deviceSync?: DeviceSyncStatus[];
    /** When false, never show open session; unpaired punches are off-shift. */
    shiftAssigned?: boolean;
  },
  helpers: {
    parseTime: (value: string) => Date;
    minutesFromDateTime: (value: string | null | undefined) => number | null;
    clamp: (value: number, min: number, max: number) => number;
  } = punchPresentationHelpers
): PunchPresentation[] {
  const now = options.now ?? new Date();
  const todayKey = dateKeyFromDate(now);
  const sorted = sortCheckinsByTime(checkins, helpers.parseTime);
  const unpaired = deriveUnpairedPunches(checkins, helpers.parseTime);
  if (!unpaired.length) return [];

  const segments = deriveSegments(checkins, helpers);
  const lastCheckin = sorted[sorted.length - 1]!;
  const deviceIds = new Set(
    checkins.map((c) => c.device_id).filter((id): id is string => !!id?.trim())
  );
  const { horizonMin, isLagging: syncLagging } = syncHorizonForTimeline(options.deviceSync, {
    dateKey: options.dateKey,
    deviceIds: deviceIds.size ? deviceIds : undefined,
  });

  const nowMin = minutesNow(now);
  const capEnd = Math.min(nowMin, options.shiftEndMin ?? 24 * 60);
  const onShift = options.shiftAssigned === true;

  const presentations: PunchPresentation[] = [];

  for (const checkin of unpaired) {
    const startMin = helpers.minutesFromDateTime(checkin.time);
    if (startMin == null) continue;

    if (!hasPunchBranch(checkin)) {
      presentations.push({
        kind: "rogue",
        checkin,
        branch: null,
        startMin,
        confirmedEndMin: startMin,
      });
      continue;
    }

    const branch = punchBranch(checkin);
    const isLastPunch =
      checkin === lastCheckin ||
      (!!checkin.name && !!lastCheckin.name && checkin.name === lastCheckin.name) ||
      checkin.time === lastCheckin.time;

    const isOpenSession =
      onShift &&
      options.dateKey >= todayKey &&
      isLastPunch &&
      !isInsidePairedSegment(startMin, segments);

    if (isOpenSession) {
      let confirmedEndMin = Math.max(startMin, capEnd);
      if (horizonMin != null) {
        confirmedEndMin = Math.max(startMin, Math.min(capEnd, horizonMin));
      }
      const uncertainEndMin = syncLagging && confirmedEndMin < capEnd ? capEnd : null;

      presentations.push({
        kind: "openSession",
        checkin,
        branch,
        startMin,
        confirmedEndMin,
        uncertainEndMin,
        syncLagging: syncLagging || uncertainEndMin != null,
      });
      continue;
    }

    presentations.push({
      kind: onShift ? "unpairedError" : "offShiftPunch",
      checkin,
      branch,
      startMin,
      confirmedEndMin: startMin,
    });
  }

  return presentations;
}

export function hasTimelineErrorPunches(
  checkins: Checkin[],
  options: {
    dateKey: string;
    now?: Date;
    shiftEndMin?: number | null;
    deviceSync?: DeviceSyncStatus[];
  },
  helpers: {
    parseTime: (value: string) => Date;
    minutesFromDateTime: (value: string | null | undefined) => number | null;
    clamp: (value: number, min: number, max: number) => number;
  } = punchPresentationHelpers
): boolean {
  return classifyUnpairedPresentations(checkins, options, helpers).some(
    (row) => row.kind === "rogue" || row.kind === "unpairedError"
  );
}

export type ShiftTimelinePolicy = {
  startMin?: number | null;
  endMin?: number | null;
  graceMinutes?: number;
  lunchStartMin?: number | null;
  lunchEndMin?: number | null;
};

export function parseShiftTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function shiftTimelinePolicyFromShift(shift: {
  shift_assigned?: boolean;
  start_time?: string | null;
  end_time?: string | null;
  grace_minutes?: number;
  lunch_start?: string | null;
  lunch_end?: string | null;
} | null | undefined): ShiftTimelinePolicy | null {
  if (!shift?.shift_assigned) return null;
  const graceMinutes = Number.isFinite(shift.grace_minutes) ? Number(shift.grace_minutes) : 0;
  return {
    startMin: parseShiftTimeToMinutes(shift.start_time ?? null),
    endMin: parseShiftTimeToMinutes(shift.end_time ?? null),
    graceMinutes,
    lunchStartMin: parseShiftTimeToMinutes(shift.lunch_start ?? null),
    lunchEndMin: parseShiftTimeToMinutes(shift.lunch_end ?? null),
  };
}

/** Minutes not counted as unaccounted away time (shift start grace + scheduled lunch + lunch-end grace). */
export function buildShiftExemptIntervals(
  policy: ShiftTimelinePolicy
): Array<{ startMin: number; endMin: number }> {
  const exempt: Array<{ startMin: number; endMin: number }> = [];
  const grace = Math.max(0, policy.graceMinutes ?? 0);

  if (policy.startMin != null && Number.isFinite(policy.startMin)) {
    exempt.push({ startMin: policy.startMin, endMin: policy.startMin + grace });
  }

  if (
    policy.lunchStartMin != null &&
    policy.lunchEndMin != null &&
    policy.lunchEndMin > policy.lunchStartMin
  ) {
    exempt.push({
      startMin: policy.lunchStartMin,
      endMin: policy.lunchEndMin + grace,
    });
  }

  return exempt;
}

export function subtractExemptFromGap(
  gap: { startMin: number; endMin: number },
  exemptIntervals: Array<{ startMin: number; endMin: number }>
): Array<{ startMin: number; endMin: number }> {
  let parts = [{ startMin: gap.startMin, endMin: gap.endMin }];

  for (const exempt of exemptIntervals) {
    const next: Array<{ startMin: number; endMin: number }> = [];
    for (const part of parts) {
      const overlapStart = Math.max(part.startMin, exempt.startMin);
      const overlapEnd = Math.min(part.endMin, exempt.endMin);
      if (overlapEnd <= overlapStart) {
        next.push(part);
        continue;
      }
      if (part.startMin < overlapStart) {
        next.push({ startMin: part.startMin, endMin: overlapStart });
      }
      if (overlapEnd < part.endMin) {
        next.push({ startMin: overlapEnd, endMin: part.endMin });
      }
    }
    parts = next;
  }

  return parts.filter((p) => p.endMin > p.startMin);
}

export type TimelineGapOptions = {
  shiftPolicy?: ShiftTimelinePolicy | null;
  /** Punch-derived lunch OUT→IN (same heuristic as closeout flags). */
  observedLunchRange?: { startMin: number; endMin: number } | null;
  /** Scheduled lunch window incl. return grace — used when no observed lunch. */
  scheduledLunchRange?: { startMin: number; endMin: number } | null;
};

/**
 * Lunch and away intervals on the timeline.
 * Away applies only between consecutive paired segments (segment end → next segment start).
 * Gaps involving unpaired punches are not labeled away — use missing expected instead.
 * Observed lunch from punches takes priority over schedule-only inference.
 */
export function deriveTimelineGaps(
  segments: Segment[],
  _unpaired: Checkin[],
  _minutesFromDateTime: (value: string | null | undefined) => number | null,
  shiftPolicyOrOptions?: ShiftTimelinePolicy | null | TimelineGapOptions
): TimelineGap[] {
  let options: TimelineGapOptions;
  if (
    shiftPolicyOrOptions != null &&
    typeof shiftPolicyOrOptions === "object" &&
    ("observedLunchRange" in shiftPolicyOrOptions ||
      "scheduledLunchRange" in shiftPolicyOrOptions)
  ) {
    options = shiftPolicyOrOptions;
  } else {
    options = { shiftPolicy: (shiftPolicyOrOptions as ShiftTimelinePolicy | null) ?? null };
  }

  const shiftPolicy = options.shiftPolicy ?? null;
  const observedLunchRange = options.observedLunchRange ?? null;
  const scheduledLunchRange =
    options.scheduledLunchRange ??
    (shiftPolicy?.lunchStartMin != null &&
    shiftPolicy?.lunchEndMin != null &&
    shiftPolicy.lunchEndMin > shiftPolicy.lunchStartMin
      ? {
          startMin: shiftPolicy.lunchStartMin,
          endMin: shiftPolicy.lunchEndMin + Math.max(0, shiftPolicy.graceMinutes ?? 0),
        }
      : null);

  const sortedSegments = segments
    .filter((segment) => segment.startMin != null && segment.endMin != null)
    .sort((a, b) => a.startMin! - b.startMin!);

  const results: TimelineGap[] = [];

  if (observedLunchRange) {
    const minutes = observedLunchRange.endMin - observedLunchRange.startMin;
    if (minutes > 0) {
      results.push({
        startMin: observedLunchRange.startMin,
        endMin: observedLunchRange.endMin,
        minutes,
        kind: "lunch",
        source: "observed",
      });
    }
  }

  const startGraceInterval =
    shiftPolicy?.startMin != null && Number.isFinite(shiftPolicy.startMin)
      ? {
          startMin: shiftPolicy.startMin,
          endMin: shiftPolicy.startMin + Math.max(0, shiftPolicy.graceMinutes ?? 0),
        }
      : null;

  for (let i = 0; i < sortedSegments.length - 1; i++) {
    const current = sortedSegments[i]!;
    const next = sortedSegments[i + 1]!;
    const endMin = current.endMin!;
    const startMin = next.startMin!;
    if (startMin <= endMin) continue;

    let parts = [{ startMin: endMin, endMin: startMin }];

    if (observedLunchRange) {
      parts = subtractExemptFromGap(
        { startMin: endMin, endMin: startMin },
        [observedLunchRange]
      );
    }

    if (startGraceInterval) {
      const trimmed: typeof parts = [];
      for (const part of parts) {
        trimmed.push(...subtractExemptFromGap(part, [startGraceInterval]));
      }
      parts = trimmed;
    }

    for (const part of parts) {
      if (scheduledLunchRange) {
        const lunchOverlapStart = Math.max(part.startMin, scheduledLunchRange.startMin);
        const lunchOverlapEnd = Math.min(part.endMin, scheduledLunchRange.endMin);
        if (lunchOverlapEnd > lunchOverlapStart) {
          results.push({
            startMin: lunchOverlapStart,
            endMin: lunchOverlapEnd,
            minutes: lunchOverlapEnd - lunchOverlapStart,
            kind: "lunch",
            source: "scheduled",
          });
        }
        for (const awayPart of subtractExemptFromGap(part, [scheduledLunchRange])) {
          const minutes = awayPart.endMin - awayPart.startMin;
          if (minutes <= 0) continue;
          results.push({
            startMin: awayPart.startMin,
            endMin: awayPart.endMin,
            minutes,
            kind: "away",
            source: "gap",
          });
        }
        continue;
      }

      const minutes = part.endMin - part.startMin;
      if (minutes <= 0) continue;
      results.push({
        startMin: part.startMin,
        endMin: part.endMin,
        minutes,
        kind: "away",
        source: "gap",
      });
    }
  }

  results.sort((a, b) => a.startMin - b.startMin);
  return results;
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

/**
 * Number of minutes without a device delivery that triggers the staleness banner.
 * 3 hours — conservative enough to catch a stalled Bridge before UNNOTIFIED_ABSENCE fires.
 */
export const SYNC_STALE_AFTER_MIN = 180;

/**
 * Compare the freshest `last_delivered_at` watermark across all device sync rows
 * against `now` and return whether it exceeds SYNC_STALE_AFTER_MIN.
 *
 * Pass `now` explicitly so the function is unit-testable without mocking Date.
 * No rows (device not registered for this view) → stale=false (no false positives).
 */
export function checkDeviceSyncStaleness(
  deviceSync: DeviceSyncStatus[] | undefined,
  now: Date
): { stale: boolean; lastDeliveredAt: string | null; minutesSince: number | null } {
  if (!deviceSync?.length) return { stale: false, lastDeliveredAt: null, minutesSince: null };

  let freshest: Date | null = null;
  let freshestStr: string | null = null;

  for (const row of deviceSync) {
    if (!row.last_delivered_at) continue;
    const d = parseDateTimeLocal(row.last_delivered_at);
    if (!Number.isFinite(d.getTime())) continue;
    if (freshest === null || d.getTime() > freshest.getTime()) {
      freshest = d;
      freshestStr = row.last_delivered_at;
    }
  }

  if (!freshest) return { stale: false, lastDeliveredAt: null, minutesSince: null };

  const minutesSince = (now.getTime() - freshest.getTime()) / 60000;
  const stale = minutesSince > SYNC_STALE_AFTER_MIN;

  return { stale, lastDeliveredAt: freshestStr, minutesSince };
}
