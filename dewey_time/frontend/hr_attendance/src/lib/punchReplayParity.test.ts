import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { deriveSegments } from "@/lib/attendancePunches";
import { minutesFromDateTime } from "@/lib/attendanceTime";
import { liveWalk } from "@/lib/punchLiveVerbs";
import type { Checkin } from "@/types/calendar";

// The SAME file dewey_time/tests/test_telegram_receipt.py reads. The Telegram
// receipt replays this module's pairing rule mid-stream (receipt.py), and the
// fixture is the contract between them: this side pins what deriveSegments
// produces retrospectively, the Python side pins the per-prefix verbs and the
// hours figure, and the parity claim -- a printed figure always equals the
// timeline's total -- is asserted over there against the columns frozen here.
// attendance_segments.py once claimed to "mirror the frontend" with nothing
// holding the mirror up, and drifted the moment pairRun landed; this file is
// what was missing.
const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/fixtures/punch_replay_fixtures.json"
);

type FixtureCase = {
  name: string;
  case_comment: string;
  punches: Array<{
    name: string;
    time: string;
    log_type: string;
    custom_device_branch: string | null;
  }>;
  ts_segments: Array<[number, number]>;
  ts_total_minutes: number;
  py_verbs: string[];
};

const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  cases: FixtureCase[];
};

const helpers = {
  parseTime: (value: string) => new Date(value.replace(" ", "T")),
  minutesFromDateTime,
  clamp: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)),
};

function toCheckin(punch: FixtureCase["punches"][number]): Checkin {
  return {
    name: punch.name,
    time: punch.time,
    log_type: (punch.log_type || null) as Checkin["log_type"],
    custom_device_branch: punch.custom_device_branch,
  };
}

test("deriveSegments still produces exactly what the fixture froze", () => {
  assert.ok(fixtures.cases.length >= 8, "the fixture file must actually load");

  for (const fixtureCase of fixtures.cases) {
    const checkins = fixtureCase.punches.map(toCheckin);
    const segments = deriveSegments(checkins, helpers);

    const indexByName = new Map(fixtureCase.punches.map((p, i) => [p.name, i]));
    const got = segments.map((segment) => [
      indexByName.get(segment.start.name ?? ""),
      indexByName.get(segment.end.name ?? ""),
    ]);
    assert.deepEqual(
      got,
      fixtureCase.ts_segments,
      `${fixtureCase.name}: segment pairing moved — update the fixture AND re-check receipt.py's replay against it`
    );

    const total = segments.reduce((sum, segment) => sum + (segment.minutes ?? 0), 0);
    assert.equal(
      total,
      fixtureCase.ts_total_minutes,
      `${fixtureCase.name}: summed timeline minutes`
    );
  }
});

test("liveWalk speaks the receipt's verbs, from the same frozen columns", () => {
  // punchLiveVerbs.ts is the TypeScript twin of receipt.announce's verb walk,
  // and this is what holds the mirror up: the `py_verbs` column was frozen by
  // the Python side (test_telegram_receipt.py asserts announce() against it),
  // so the two implementations cannot drift without one of them failing here
  // or there. attendance_segments.py drifted for exactly the lack of this.
  for (const fixtureCase of fixtures.cases) {
    const checkins = fixtureCase.punches.map(toCheckin);
    assert.deepEqual(
      liveWalk(checkins).verbs,
      fixtureCase.py_verbs,
      `${fixtureCase.name}: the TS walk disagrees with receipt.py's frozen verbs`
    );
  }
});

test("the walk is causal: every prefix says what the full day says", () => {
  // The property the receipt's bounded query relies on, asserted on the TS
  // side too: a punch's verb depends only on the punches BEFORE it, so the
  // chip reading today-so-far can never disagree with the receipt that spoke
  // at each punch.
  for (const fixtureCase of fixtures.cases) {
    const checkins = fixtureCase.punches.map(toCheckin);
    const full = liveWalk(checkins).verbs;
    for (let k = 1; k <= checkins.length; k += 1) {
      assert.deepEqual(
        liveWalk(checkins.slice(0, k)).verbs,
        full.slice(0, k),
        `${fixtureCase.name}: prefix ${k} rewrote history`
      );
    }
  }
});
