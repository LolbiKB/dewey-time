import { format, isValid, parseISO } from "date-fns";

import type { RolloutBlock, RolloutWindow } from "@/types/flags";

/**
 * The tail every TESTING banner shares. The point of the banner is not that a
 * pilot exists, it is that HR should not treat what they are reading as the
 * official record.
 */
const CALIBRATION_TAIL = " — calibration data, not the official record.";

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = parseISO(iso);
  return isValid(parsed) ? format(parsed, "MMM d") : null;
}

/**
 * "Aug 15 – Sep 1 is" / "Aug 15 onward is" / null when there is no usable start.
 *
 * The open-ended form is not an edge case: a window with no go-live is TESTING
 * indefinitely (rollout.phase_for), which is the state between setting a
 * testing start and picking a go-live date.
 */
function periodPhrase(window: RolloutWindow): string | null {
  const start = shortDate(window.testing_start);
  if (!start) return null;
  const end = shortDate(window.go_live);
  return end ? `${start} – ${end} is` : `${start} onward is`;
}

/**
 * What the flag queue should say about rollout phases, or null for silence.
 *
 * Pure so every state in the spec's table -- plus the two nullable-date cases
 * it did not cover -- is testable without rendering anything.
 */
export function rolloutBannerMessage(rollout: RolloutBlock | undefined): string | null {
  if (!rollout || !rollout.phases_configured) return null;
  if (rollout.range_phase === "LIVE") return null;

  if (rollout.range_phase === "MIXED") {
    return (
      `This range spans go-live. ${rollout.testing_flag_count} of ` +
      `${rollout.total_flag_count} flags are from the pilot period.`
    );
  }

  const windows = rollout.windows ?? [];

  if (windows.length > 1) {
    // A count, not a list. Branches roll out on different timetables by
    // design, so naming four date ranges would be worse than naming none. The
    // count includes a null (global) window when one is present: those are
    // people in the pilot on the global timetable.
    return `This range falls in the pilot period for ${windows.length} branches${CALIBRATION_TAIL}`;
  }

  const window = windows[0];
  const scope = window?.branch ? ` for ${window.branch}` : "";
  const phrase = window ? periodPhrase(window) : null;

  // No usable dates -- cleared config, an unparseable value, or (defensively)
  // no window at all. Still announce it: range_phase is TESTING because real
  // pilot flags are in range, and silence would hide that. Only the dates go.
  if (!phrase) return `This range falls in the pilot period${scope}${CALIBRATION_TAIL}`;

  return `${phrase} the pilot period${scope}${CALIBRATION_TAIL}`;
}
