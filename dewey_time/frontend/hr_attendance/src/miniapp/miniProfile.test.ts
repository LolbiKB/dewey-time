import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  biometricBodyKey, biometricStateKey, fingerKeys, KNOWN_FINGER_SLUGS,
  monthStats, parseDateOnly, serviceLength, type Biometric,
} from "@/miniapp/miniProfile";
import type { Day } from "@/types/calendar";

/** The server's half of the finger allowlist, read out of the Python. */
function serverSlugs(): string[] {
  const src = readFileSync(
    new URL("../../../../attendance_engine/finger_slots.py", import.meta.url),
    "utf8",
  );
  const table = /FINGER_SLUGS\s*=\s*\{([\s\S]*?)\}/.exec(src);
  assert.ok(table, "FINGER_SLUGS not found — has finger_slots.py moved?");
  const unknown = /UNKNOWN_SLUG\s*=\s*"([a-z_]+)"/.exec(src);
  assert.ok(unknown, "UNKNOWN_SLUG not found — has finger_slots.py moved?");
  return [
    ...[...table[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!),
    unknown[1]!,
  ];
}

const bio = (over: Partial<Biometric> = {}): Biometric => ({
  state: "enrolled", fingers: [], fingerprint_count: 0, face: false, ...over,
});

test("names are shown only when they account for every template", () => {
  // THE HONESTY GUARD. Two names beside a count of three states something
  // false about the third, and there is no way to render "and one more" that
  // does not read as a bug.
  assert.deepEqual(
    fingerKeys(bio({ fingers: ["left_index", "right_index"], fingerprint_count: 2 })),
    ["fingerLeftIndex", "fingerRightIndex"],
  );
  assert.equal(
    fingerKeys(bio({ fingers: ["left_index"], fingerprint_count: 3 })),
    null,
  );
});

test("no names at all is today's real state, not a failure", () => {
  // The bridge collapses templates to a count before Frappe sees them, so
  // `fingers` is empty for every employee until that changes.
  assert.equal(fingerKeys(bio({ fingers: [], fingerprint_count: 2 })), null);
  assert.equal(fingerKeys(undefined), null);
});

test("a slug this app has no word for renders as a finger, not as a crash", () => {
  assert.deepEqual(
    fingerKeys(bio({ fingers: ["left_index", "sixth_finger"], fingerprint_count: 2 })),
    ["fingerLeftIndex", "fingerOther"],
  );
});

test("the client and server halves of the finger table are the same list", () => {
  // READ OUT OF THE PYTHON, not copied from it. A comment asking the next
  // editor to keep two lists in step is not a guard — the server could gain a
  // slug and this would still pass, and that slug would reach a phone as a
  // blank finger name.
  assert.deepEqual(
    [...KNOWN_FINGER_SLUGS].sort(),
    serverSlugs().sort(),
    "finger_slots.FINGER_SLUGS and miniProfile.FINGER_TEXT have drifted",
  );
});

test("each state has a label, and only the two that need explaining have a body", () => {
  assert.equal(biometricStateKey("enrolled"), "bioEnrolled");
  assert.equal(biometricStateKey("not_enrolled"), "bioNotEnrolled");
  assert.equal(biometricStateKey("unknown"), "bioUnknown");
  assert.equal(biometricBodyKey("enrolled"), null);
  assert.equal(biometricBodyKey("not_enrolled"), "bioNotEnrolledBody");
  assert.equal(biometricBodyKey("unknown"), "bioUnknownBody");
});

test("a date-only string parses at local midnight, not UTC", () => {
  // new Date("2024-03-12") is parsed as UTC, and east of Greenwich that is the
  // 11th locally — a joining date off by one and a service length that flips a
  // day early. The e2e suite hit the same trap building day keys.
  const parsed = parseDateOnly("2024-03-12")!;
  assert.equal(parsed.getFullYear(), 2024);
  assert.equal(parsed.getMonth(), 2);
  assert.equal(parsed.getDate(), 12);
  assert.equal(parseDateOnly(""), null);
  assert.equal(parseDateOnly("not a date"), null);
  assert.equal(parseDateOnly(null), null);
});

test("service length counts whole months, not calendar months", () => {
  assert.deepEqual(
    serviceLength("2024-03-12", new Date(2026, 7, 17)), { years: 2, months: 5 },
  );
  // One day short of the anniversary is still the month before.
  assert.deepEqual(
    serviceLength("2024-03-18", new Date(2026, 2, 17)), { years: 1, months: 11 },
  );
  assert.deepEqual(
    serviceLength("2026-08-17", new Date(2026, 7, 17)), { years: 0, months: 0 },
  );
});

test("service length refuses to invent a past for a missing or future date", () => {
  assert.equal(serviceLength(null, new Date(2026, 7, 17)), null);
  assert.equal(serviceLength("2027-01-01", new Date(2026, 7, 17)), null);
});

const worked = (date: string, flags: unknown[] = []): Day => ({
  date,
  shift: {
    shift_assigned: true, shift_type: "FT", start_time: "08:00:00",
    end_time: "17:00:00", lunch_start: "12:00:00", lunch_end: "13:00:00",
  },
  first_in: `${date} 08:00:00`,
  last_out: `${date} 12:00:00`,
  // custom_device_branch is NOT decoration here. deriveSegments treats a punch
  // without one as rogue and never pairs it, so a fixture missing it reports
  // null minutes on a day that plainly has two punches — the same omission that
  // once made every punch on the Day timeline draw as an anomaly.
  checkins: [
    { time: `${date} 08:00:00`, log_type: "IN", custom_device_branch: "DIS Iconic" },
    { time: `${date} 12:00:00`, log_type: "OUT", custom_device_branch: "DIS Iconic" },
  ],
  flags,
}) as unknown as Day;

const off = (date: string): Day =>
  ({ date, shift: { shift_assigned: false }, checkins: [], flags: [] }) as unknown as Day;

test("the month stats count worked days, their minutes and their flags", () => {
  const today = new Date(2026, 7, 17);
  const stats = monthStats(
    [
      worked("2026-08-03"),
      worked("2026-08-04", [{ flag_code: "LATE_START" }]),
      off("2026-08-05"),
    ],
    today,
  );
  assert.equal(stats.daysWorked, 2);
  assert.equal(stats.minutes, 8 * 60);
  assert.equal(stats.flags, 1);
});

test("an empty month is zero days rather than a crash or a dash of hours", () => {
  const stats = monthStats([], new Date(2026, 7, 17));
  assert.equal(stats.daysWorked, 0);
  assert.equal(stats.minutes, null);
  assert.equal(stats.flags, 0);
});

test("only codes the employee has words for are counted as to-check", () => {
  // The same function behind this number as behind the Today tab's pill, so
  // the two can never disagree about how many flags somebody has — which is
  // exactly how the HR flag-queue header once contradicted its own rows.
  const stats = monthStats(
    [worked("2026-08-03", [{ flag_code: "UNKNOWN_DEVICE_BRANCH" }])],
    new Date(2026, 7, 17),
  );
  assert.equal(stats.flags, 0);
});
