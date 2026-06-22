import {
  detectObservedLunch,
  observedLunchMinuteRange,
  scheduledLunchMinuteRange,
} from "@/lib/lunchDetection";
import {
  clamp,
  minutesFromDateTime,
  parseDateTimeLocal,
  parseTimeToMinutes,
} from "@/lib/attendanceTime";
import {
  classifyUnpairedPresentations,
  deriveSegments as deriveSegmentsFromCheckins,
  deriveTimelineGaps,
  deriveUnpairedPunches,
  hasPunchBranch,
  shiftTimelinePolicyFromShift,
  sortCheckinsByTime as sortCheckinsByTimeLib,
  type Segment as AttendanceSegment,
} from "@/lib/attendancePunches";
import type { Day, DeviceSyncStatus, ObservedLunch, ShiftContext } from "@/types/calendar";

type Checkin = NonNullable<Day["checkins"]>[number];

export type SegmentInspectorItem =
  | { kind: "segment"; segment: AttendanceSegment }
  | { kind: "unpaired"; checkin: Checkin; isRogue: boolean; offShift?: boolean }
  | {
      kind: "openSession";
      checkin: Checkin;
      branch: string | null;
      startMin: number;
      confirmedEndMin: number;
      uncertainEndMin?: number | null;
      syncLagging?: boolean;
    }
  | {
      kind: "lunch";
      startMin: number;
      endMin: number;
      minutes: number;
      source: "observed" | "scheduled";
      observed?: ObservedLunch | null;
    }
  | { kind: "away"; startMin: number; endMin: number; minutes: number };

export function deriveSegments(checkins: Checkin[]): AttendanceSegment[] {
  return deriveSegmentsFromCheckins(checkins, {
    parseTime: parseDateTimeLocal,
    minutesFromDateTime,
    clamp,
  });
}

export function sortCheckinsByTime(checkins: Checkin[]): Checkin[] {
  return sortCheckinsByTimeLib(checkins, parseDateTimeLocal);
}

/** Inspector list: segments, lunch/away gaps, open sessions, and unpaired punches (chronological). */
export function buildSegmentInspectorItems(
  segments: AttendanceSegment[],
  checkins: Checkin[],
  options?: {
    dateKey?: string;
    shift?: ShiftContext;
    observedLunch?: ObservedLunch | null;
    deviceSync?: DeviceSyncStatus[];
  }
): SegmentInspectorItem[] {
  if (!segments.length && !checkins.length) return [];

  const sorted = [...segments].sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
  const unpaired = deriveUnpairedPunches(checkins, parseDateTimeLocal);
  const shiftEndMin =
    options?.shift?.shift_assigned && options.shift.end_time
      ? parseTimeToMinutes(options.shift.end_time)
      : null;
  const presentations =
    options?.dateKey != null
      ? classifyUnpairedPresentations(checkins, {
          dateKey: options.dateKey,
          shiftEndMin,
          deviceSync: options.deviceSync,
          shiftAssigned: options.shift?.shift_assigned === true,
        })
      : [];

  if (!sorted.length && !presentations.length && !unpaired.length) return [];

  const observed =
    options?.observedLunch ??
    (options?.dateKey && options?.shift
      ? detectObservedLunch(checkins, options.shift, options.dateKey)
      : null);
  const shiftPolicy = options?.shift ? shiftTimelinePolicyFromShift(options.shift) : null;
  const gaps = deriveTimelineGaps(sorted, unpaired, minutesFromDateTime, {
    shiftPolicy,
    observedLunchRange: observedLunchMinuteRange(observed),
    scheduledLunchRange: scheduledLunchMinuteRange(options?.shift),
  });

  type Sortable = { sortMin: number; item: SegmentInspectorItem };

  const items: Sortable[] = [];

  for (const segment of sorted) {
    if (segment.startMin == null) continue;
    items.push({
      sortMin: segment.startMin,
      item: { kind: "segment", segment },
    });
  }

  if (presentations.length) {
    for (const row of presentations) {
      if (row.kind === "openSession") {
        items.push({
          sortMin: row.startMin,
          item: {
            kind: "openSession",
            checkin: row.checkin,
            branch: row.branch,
            startMin: row.startMin,
            confirmedEndMin: row.confirmedEndMin,
            uncertainEndMin: row.uncertainEndMin,
            syncLagging: row.syncLagging,
          },
        });
        continue;
      }
      if (row.kind === "offShiftPunch") {
        items.push({
          sortMin: row.startMin,
          item: {
            kind: "unpaired",
            checkin: row.checkin,
            isRogue: false,
            offShift: true,
          },
        });
        continue;
      }
      items.push({
        sortMin: row.startMin,
        item: {
          kind: "unpaired",
          checkin: row.checkin,
          isRogue: row.kind === "rogue",
        },
      });
    }
  } else {
    for (const checkin of unpaired) {
      const min = minutesFromDateTime(checkin.time);
      if (min == null) continue;
      items.push({
        sortMin: min,
        item: {
          kind: "unpaired",
          checkin,
          isRogue: !hasPunchBranch(checkin),
        },
      });
    }
  }

  for (const gap of gaps) {
    if (gap.kind === "lunch") {
      items.push({
        sortMin: gap.startMin,
        item: {
          kind: "lunch",
          startMin: gap.startMin,
          endMin: gap.endMin,
          minutes: gap.minutes,
          source: gap.source === "observed" ? "observed" : "scheduled",
          observed: gap.source === "observed" ? observed : null,
        },
      });
      continue;
    }

    items.push({
      sortMin: gap.startMin,
      item: {
        kind: "away",
        startMin: gap.startMin,
        endMin: gap.endMin,
        minutes: gap.minutes,
      },
    });
  }

  items.sort((a, b) => a.sortMin - b.sortMin);
  return items.map((entry) => entry.item);
}
