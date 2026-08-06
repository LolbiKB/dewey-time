import assert from "node:assert/strict";
import test from "node:test";

import { flagHrGuidance } from "@/lib/flagDetails";
import type { Flag, FlagStatus } from "@/types/calendar";

function flag(overrides: Partial<Flag>): Flag {
  return {
    name: "FLAG-TEST-0001",
    flag_code: "LATE_START",
    status: "OPEN",
    day_closed: 1,
    is_provisional: false,
    ...overrides,
  };
}

// Every flag_code branch flagHrGuidance can reach once a day is finalized
// (status still "OPEN", day_closed=1) — the exhaustive switch at
// flagDetails.ts:147-164 — plus one code absent from the switch, to hit `default`.
const FINALIZED_FLAG_CODES = [
  "UNNOTIFIED_ABSENCE",
  "OFF_SHIFT_PUNCH",
  "MISSING_TIME",
  "LATE_START",
  "LATE_FROM_LUNCH",
  "LEFT_EARLY",
  "ATTENDANCE_ISSUE",
  "MISSING_IN_OR_OUT",
  "DELIVERY_FAILED",
  "UNKNOWN_DEVICE_BRANCH",
  "SOME_FUTURE_CODE",
];

// Every terminal status branch — checked before flag_code, so flag_code is
// irrelevant for these.
const TERMINAL_STATUSES: FlagStatus[] = ["APPROVED", "REJECTED", "EXPLAINED", "CLOSED"];

// /hr-flags is now the only place HR decides — see the design doc's "Retiring the
// Desk decision path". Pre-change, every flag_code branch and three of the four
// status branches literally say "in Desk" or point at "the Attendance Flag
// record"; this loop fails loudly against that code the moment it reaches the
// first branch (UNNOTIFIED_ABSENCE).
test("flagHrGuidance never tells HR to act in Desk, for any flag_code", () => {
  for (const flag_code of FINALIZED_FLAG_CODES) {
    const guidance = flagHrGuidance(flag({ flag_code, status: "OPEN", day_closed: 1 }));
    assert.doesNotMatch(
      guidance,
      /desk/i,
      `flag_code ${flag_code} guidance still mentions Desk: "${guidance}"`
    );
  }
});

test("flagHrGuidance never tells HR to act in Desk, for any terminal status", () => {
  for (const status of TERMINAL_STATUSES) {
    const guidance = flagHrGuidance(flag({ status, flag_code: "LATE_START", day_closed: 1 }));
    assert.doesNotMatch(
      guidance,
      /desk/i,
      `status ${status} guidance still mentions Desk: "${guidance}"`
    );
  }
});

test("flagHrGuidance for a still-provisional flag also avoids Desk", () => {
  const guidance = flagHrGuidance(
    flag({ status: "OPEN", day_closed: 0, is_provisional: true, flag_code: "MISSING_TIME" })
  );
  assert.doesNotMatch(guidance, /desk/i, `provisional guidance mentions Desk: "${guidance}"`);
});
