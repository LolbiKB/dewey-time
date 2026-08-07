import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STRIP_MAX_CELLS,
  buildEmployeeFlagIndex,
  buildOutageSet,
  buildStrip,
  outageKey,
} from "@/lib/flagStrip";
import type { FlagOut, QueueEntry, QueuePerson } from "@/types/flags";

function flag(date: string, code: string, tier: FlagOut["tier"], rank: number): FlagOut {
  return {
    flag_identity: `AUTO-${code}-${date}`,
    flag_code: code,
    attendance_date: date,
    day_closed: 1,
    evidence: {},
    rank,
    tier,
    decision_state: "undecided",
    decision: null,
  };
}

function person(employee: string, flags: FlagOut[]): QueuePerson {
  return {
    entry_key: `p:${employee}`,
    employee,
    employee_name: employee,
    employee_branch: "HQ",
    employee_image: null,
    attendance_date: flags[0]?.attendance_date ?? "2026-08-01",
    dates: flags.map((f) => f.attendance_date),
    rank: flags[0]?.rank ?? 0,
    tier: flags[0]?.tier ?? "routine",
    flags,
    undecided_count: flags.length,
    also_count: 0,
    also_outlier_count: 0,
  };
}

const NONE: ReadonlySet<string> = new Set();

test("a range shorter than 14 days produces that many cells, not a padded strip", () => {
  // A padded cell would have to mean something, and there is nothing true for
  // it to mean.
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.equal(strip.cells.length, 7);
  assert.equal(strip.cells[0].date, "2026-08-01");
  assert.equal(strip.cells[6].date, "2026-08-07");
});

test("a range longer than 14 days keeps the most recent 14", () => {
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-07-15",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.equal(strip.cells.length, STRIP_MAX_CELLS);
  assert.equal(strip.cells[0].date, "2026-07-25");
  assert.equal(strip.cells[13].date, "2026-08-07");
});

test("an inverted range still produces one cell, not zero or negative", () => {
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-08-08",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.equal(strip.cells.length, 1);
  assert.equal(strip.cells[0].date, "2026-08-07");
});

test("flags older than the window are counted, not dropped", () => {
  const strip = buildStrip({
    flags: [flag("2026-07-16", "LATE_START", "routine", 20)],
    branch: "HQ",
    startDate: "2026-07-15",
    endDate: "2026-08-07",
    outage: NONE,
  });
  // The sub-line still names the worst flag across the whole range, so the strip
  // must say out loud that it is not showing everything.
  assert.equal(strip.earlierCount, 1);
  assert.equal(strip.flaggedCount, 0);
});

test("a day with a flag renders at that flag's tier", () => {
  const strip = buildStrip({
    flags: [flag("2026-08-03", "LATE_START", "routine", 20)],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  const cell = strip.cells.find((c) => c.date === "2026-08-03");
  assert.equal(cell?.state, "flagged");
  assert.equal(cell?.tier, "routine");
});

test("a day with several flags renders the worst", () => {
  const strip = buildStrip({
    flags: [
      flag("2026-08-03", "LATE_START", "routine", 20),
      flag("2026-08-03", "MISSING_TIME", "act", 133),
    ],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-03")?.tier, "act");
  // flaggedCount counts flagged DAYS, not flags — two flags on one day is 1.
  assert.equal(strip.flaggedCount, 1);
});

test("an in-range day with no flag renders clean", () => {
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.deepEqual(new Set(strip.cells.map((c) => c.state)), new Set(["clean"]));
  assert.deepEqual(new Set(strip.cells.map((c) => c.tier)), new Set([null]));
});

test("a day in the outage set renders no-data, not clean", () => {
  // The lie this state exists to stop: a branch with no device data produces no
  // flags, so a naive "no flag -> green" would tell HR someone was fine on a day
  // nobody measured them.
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: buildOutageSet([{ branch: "HQ", date: "2026-08-04" }]),
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-04")?.state, "no-data");
  assert.equal(strip.cells.find((c) => c.date === "2026-08-05")?.state, "clean");
});

test("an outage at another branch does not grey this person's day", () => {
  const strip = buildStrip({
    flags: [],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: buildOutageSet([{ branch: "Siem Reap", date: "2026-08-04" }]),
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-04")?.state, "clean");
});

test("a flag outranks an outage on the same day", () => {
  // Something WAS measured that day, whatever the watermark says.
  const strip = buildStrip({
    flags: [flag("2026-08-04", "LATE_START", "routine", 20)],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: buildOutageSet([{ branch: "HQ", date: "2026-08-04" }]),
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-04")?.state, "flagged");
});

test("an employee with no branch is never greyed", () => {
  // An empty branch string produces the same outage key as a null branch
  // (outageKey does `branch ?? ""`), so this is the fixture that actually
  // exercises the `branch !== null` guard: a `Device Closeout Alert` with an
  // empty branch reaches the payload unfiltered, and without the guard this
  // employee's day would grey.
  const strip = buildStrip({
    flags: [],
    branch: null,
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: buildOutageSet([{ branch: "", date: "2026-08-04" }]),
  });
  assert.deepEqual(new Set(strip.cells.map((c) => c.state)), new Set(["clean"]));
});

test("outage keys cannot collide across branch names", () => {
  assert.notEqual(outageKey("A", "B|2026-08-04"), outageKey("A|B", "2026-08-04"));
  assert.notEqual(outageKey("A", "B:2026-08-04"), outageKey("A:B", "2026-08-04"));
});

test("buildOutageSet tolerates undefined or missing rows without throwing", () => {
  // Callers hold a payload that may not have arrived yet — useFlagQueue zero-fills
  // before the first fetch resolves — so "no rows" has to mean "grey nothing"
  // rather than throw on the loading render.
  assert.deepEqual(buildOutageSet(undefined), new Set());
  assert.deepEqual(buildOutageSet(null), new Set());
});

test("the flag index gathers a person's flags from every entry they appear in", () => {
  // A group member's strip shows ALL their flags, including the act-tier outlier
  // that put them in a second entry. This is what makes the cross-reference
  // badge visible rather than merely counted.
  const entries: QueueEntry[] = [
    {
      kind: "group",
      group_type: "REPEAT_PATTERN",
      group_key: "REPEAT_PATTERN:LATE_START",
      branch: null,
      flag_code: "LATE_START",
      attendance_date: null,
      rank: 20,
      tier: "routine",
      members: [
        person("EMP-1", [flag("2026-08-03", "LATE_START", "routine", 20)]),
        person("EMP-2", [flag("2026-08-03", "LATE_START", "routine", 20)]),
      ],
    },
    {
      kind: "person",
      ...person("EMP-1", [flag("2026-08-06", "MISSING_TIME", "act", 133)]),
    },
  ];
  const index = buildEmployeeFlagIndex(entries);
  assert.equal(index.get("EMP-1")?.length, 2);
  assert.equal(index.get("EMP-2")?.length, 1);
});

test("a group member's strip shows the out-of-group flag", () => {
  const strip = buildStrip({
    flags: [
      flag("2026-08-03", "LATE_START", "routine", 20),
      flag("2026-08-06", "MISSING_TIME", "act", 133),
    ],
    branch: "HQ",
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    outage: NONE,
  });
  assert.equal(strip.cells.find((c) => c.date === "2026-08-06")?.tier, "act");
  assert.equal(strip.flaggedCount, 2);
});
