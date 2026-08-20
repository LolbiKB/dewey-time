/**
 * The LIVE reading of a punch stream — the TypeScript twin of
 * dewey_time/telegram/receipt.py's verb walk.
 *
 * Retrospective pairing (`pairRun`) sees the whole day and may call the last
 * punch of a run a departure; a live surface cannot know a punch is anyone's
 * last. The Telegram receipt solved this once: a causal walk where a punch's
 * verb depends only on the punches before it, an explicit label always wins,
 * and where retrospection would have to guess, the walk says NOTHING
 * (`NO_VERB`) rather than guessing. The status chip asks the same question the
 * receipt just answered on the person's phone — "did that punch put me in or
 * out?" — so it must use the same rule, or the chip contradicts the message.
 *
 * PORTED LINE FOR LINE from receipt.announce's verb logic, and pinned against
 * the same fixture file (dewey_time/tests/fixtures/punch_replay_fixtures.json,
 * `py_verbs` column) by punchReplayParity.test.ts, so the two implementations
 * cannot drift silently. The fixture pins the VERBS; the walk-state fields a
 * caller reads (`openTime`, `openClaimable`, `lastKeptVerb`) are pinned by
 * the chip's own tests. If a rule changes here it must change there, and the
 * fixture is where that argument is had.
 *
 * The walk's decisions, in order (receipt.py documents the reasoning):
 *  - A blank punch within DUP_WINDOW_SECONDS of the previous kept punch at
 *    the same branch is a bounced read: dropped, NO_VERB.
 *  - A branchless punch is its own run and breaks the current one. Its verb:
 *    label, else IN if it is the day's first punch, else NO_VERB.
 *  - An explicit label is believed outright.
 *  - A blank punch with an arrival open in the current run closes it: OUT.
 *  - A blank first punch of the day is an arrival: IN.
 *  - A blank same-branch continuation with nothing open is the
 *    lunch-comeback: IN.
 *  - A blank punch OPENING a fresh run mid-day is indistinguishable from a
 *    departure through that campus's exit device: NO_VERB. It still opens an
 *    arrival for later pairing, but its own verb is not claimable.
 */
import type { Checkin } from "@/types/calendar";

export const NO_VERB = "";
export type LiveVerb = "IN" | "OUT" | typeof NO_VERB;

/** Same physical constant as receipt.DUP_WINDOW_SECONDS, same reasoning. */
export const DUP_WINDOW_SECONDS = 10;

function label(punch: Checkin): "IN" | "OUT" | "" {
  const value = String(punch.log_type || "").trim().toUpperCase();
  return value === "IN" || value === "OUT" ? value : "";
}

function branchOf(punch: Checkin): string | null {
  const value = (punch.custom_device_branch || "").trim();
  return value || null;
}

function timeOf(punch: Checkin): Date | null {
  if (!punch.time) return null;
  // The [:19] truncation is receipt.py's, kept so the twins cannot disagree
  // about whether a microsecond-stamped punch sits inside the dup window.
  const parsed = new Date(String(punch.time).replace(" ", "T").slice(0, 19));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type LiveWalk = {
  /** One verb per punch, in the given order. NO_VERB is a refusal, not a gap. */
  verbs: LiveVerb[];
  /**
   * The arrival currently open at the end of the walk, as the punch's own
   * datetime string — the FIRST arrival of the open stretch, so a labelled
   * repeat does not move it (issue #191). Non-null does NOT mean the person
   * is claimably at work: a fresh-run opener opens for later pairing while
   * its own verb stays unclaimable. Live claims gate on `openClaimable`.
   */
  openTime: string | null;
  /**
   * The open arrival was opened by a punch whose OWN verb was IN — a label,
   * the day's first punch, or a same-branch return. False when nothing is
   * open, and false when the opener was a fresh-run NO_VERB: that punch is
   * indistinguishable from a departure, so nothing live may ride on it.
   */
  openClaimable: boolean;
  /**
   * The verb of the last punch the walk KEPT — a dropped bounce is a
   * non-event and must not erase the state under it. NO_VERB here means the
   * stream's current state is genuinely not claimable, not that the last
   * physical tap bounced.
   */
  lastKeptVerb: LiveVerb;
};

/** Walk `punches` (already in time order) exactly as the receipt does. */
export function liveWalk(punches: Checkin[]): LiveWalk {
  const verbs: LiveVerb[] = [];

  let runBranch: string | null = null;
  let runLen = 0;
  let open: Checkin | null = null;
  let openClaimable = false;
  let lastKeptVerb: LiveVerb = NO_VERB;
  let firstSeen = false;
  let prevKeptTime: Date | null = null;
  let prevKeptBranch: string | null = null;

  for (const punch of punches) {
    const punchLabel = label(punch);
    const branch = branchOf(punch);
    const when = timeOf(punch);

    if (
      !punchLabel &&
      branch !== null &&
      branch === prevKeptBranch &&
      when !== null &&
      prevKeptTime !== null &&
      (when.getTime() - prevKeptTime.getTime()) / 1000 >= 0 &&
      (when.getTime() - prevKeptTime.getTime()) / 1000 <= DUP_WINDOW_SECONDS
    ) {
      verbs.push(NO_VERB);
      continue;
    }

    if (branch === null) {
      if (punchLabel) lastKeptVerb = punchLabel;
      else if (!firstSeen) lastKeptVerb = "IN";
      else lastKeptVerb = NO_VERB;
      verbs.push(lastKeptVerb);
      firstSeen = true;
      runBranch = null;
      runLen = 0;
      open = null;
      openClaimable = false;
      prevKeptTime = when;
      prevKeptBranch = null;
      continue;
    }

    if (runBranch === null || branch !== runBranch) {
      // Abandoning an open arrival here is the retrospective rule too:
      // nothing in a later run can close it.
      runBranch = branch;
      runLen = 0;
      open = null;
      openClaimable = false;
    }
    runLen += 1;

    if (punchLabel === "OUT") {
      open = null;
      openClaimable = false;
      lastKeptVerb = "OUT";
    } else if (punchLabel === "IN") {
      // First arrival stays open; a labelled repeat is noise. An explicit IN
      // also CONFIRMS an open stretch whose opener was unclaimable — the
      // receipt says "Checked in" here, so the state is claimable too.
      // (`when !== null` on every open-setting arm mirrors the receipt, whose
      // open_time IS the parsed time: a punch whose time will not parse can
      // never open anything, there or here.)
      if (open === null && when !== null) open = punch;
      openClaimable = true;
      lastKeptVerb = "IN";
    } else if (open !== null) {
      open = null;
      openClaimable = false;
      lastKeptVerb = "OUT";
    } else if (!firstSeen) {
      open = when !== null ? punch : null;
      openClaimable = true;
      lastKeptVerb = "IN";
    } else if (runLen > 1) {
      // Same-branch continuation with nothing open: the lunch-comeback.
      open = when !== null ? punch : null;
      openClaimable = true;
      lastKeptVerb = "IN";
    } else {
      // Fresh run opened mid-day: opens for later pairing, verb unclaimable.
      open = when !== null ? punch : null;
      openClaimable = false;
      lastKeptVerb = NO_VERB;
    }
    verbs.push(lastKeptVerb);

    firstSeen = true;
    prevKeptTime = when;
    prevKeptBranch = branch;
  }

  return {
    verbs,
    openTime: open?.time ?? null,
    openClaimable: open !== null && openClaimable,
    lastKeptVerb,
  };
}

