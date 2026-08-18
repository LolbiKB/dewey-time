/**
 * CHARACTERIZATION TESTS — pinning behaviour that must NOT move.
 *
 * `deriveSegments` is about to stop pairing two same-direction punches. The
 * overwhelmingly common case is a device that reports NO log_type at all
 * (Employee Checkin.log_type is an optional Select), where position is the
 * only signal there is. These tests pin that case exactly as it behaves today,
 * so the fix is provably confined to punches that carry an explicit label.
 *
 * Written BEFORE the change, against the old code, and expected to keep
 * passing after it. A failure here is a regression, not a new expectation.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { deriveSegments, deriveUnpairedPunches } from "@/lib/attendancePunches";
import { clamp, minutesFromDateTime, parseDateTimeLocal } from "@/lib/attendanceTime";
import type { Checkin } from "@/types/calendar";

const D = "2026-08-10";
const H = { parseTime: parseDateTimeLocal, minutesFromDateTime, clamp };
const seg = (c: Checkin[]) => deriveSegments(c, H).map((s) => s.minutes);
const unp = (c: Checkin[]) => deriveUnpairedPunches(c, parseDateTimeLocal).map((p) => p.time);

/** A punch with NO log_type — what most of the fleet actually sends. */
const blank = (t: string, br = "A") =>
  ({ time: `${D} ${t}`, custom_device_branch: br }) as unknown as Checkin;
const typed = (t: string, log_type: string, br = "A") =>
  ({ time: `${D} ${t}`, log_type, custom_device_branch: br }) as unknown as Checkin;

test("CHARACTERIZE: two blank punches pair into one segment", () => {
  assert.deepEqual(seg([blank("08:00:00"), blank("17:00:00")]), [540]);
  assert.deepEqual(unp([blank("08:00:00"), blank("17:00:00")]), []);
});

test("CHARACTERIZE: four blank punches pair into two segments", () => {
  const day = [blank("08:00:00"), blank("12:00:00"), blank("13:00:00"), blank("17:00:00")];
  assert.deepEqual(seg(day), [240, 240]);
  assert.deepEqual(unp(day), []);
});

test("CHARACTERIZE: three blank punches pair the first two, strand the third", () => {
  const day = [blank("08:00:00"), blank("12:00:00"), blank("13:00:00")];
  assert.deepEqual(seg(day), [240]);
  assert.deepEqual(unp(day), [`${D} 13:00:00`]);
});

test("CHARACTERIZE: a well-formed IN/OUT day is unchanged", () => {
  const day = [typed("08:00:00", "IN"), typed("17:00:00", "OUT")];
  assert.deepEqual(seg(day), [540]);
  assert.deepEqual(unp(day), []);
});

test("CHARACTERIZE: a well-formed two-run day is unchanged", () => {
  const day = [
    typed("08:00:00", "IN"), typed("12:00:00", "OUT"),
    typed("13:00:00", "IN"), typed("17:00:00", "OUT"),
  ];
  assert.deepEqual(seg(day), [240, 240]);
  assert.deepEqual(unp(day), []);
});

test("CHARACTERIZE: a branch change splits runs, and an odd run strands its last", () => {
  const day = [
    typed("08:00:00", "IN", "A"), typed("12:00:00", "OUT", "A"),
    typed("13:00:00", "IN", "B"),
  ];
  assert.deepEqual(seg(day), [240]);
  assert.deepEqual(unp(day), [`${D} 13:00:00`]);
});

test("CHARACTERIZE: a punch with no branch is rogue and never paired", () => {
  const day = [
    { time: `${D} 08:00:00`, log_type: "IN" } as unknown as Checkin,
    typed("17:00:00", "OUT"),
  ];
  assert.deepEqual(seg(day), []);
  assert.deepEqual(unp(day).length, 2);
});

/* ── THE FIX: an explicit label is believed ──────────────────────────────
 * Everything above pins what must not move. Everything below is issue #191.
 */

test("two arrivals never become a stretch of work", () => {
  // The defect: positional pairing turned IN,IN into a 60-minute segment,
  // drawn on the timeline and summed into the totals, for work nobody did.
  const day = [typed("08:00:00", "IN"), typed("09:00:00", "IN")];
  assert.deepEqual(seg(day), []);
  // Both are unmatched, so the canvas still draws them — they do not vanish.
  assert.deepEqual(unp(day).sort(), [`${D} 08:00:00`, `${D} 09:00:00`]);
});

test("a duplicate arrival does not displace the real one", () => {
  // Punched in at 08:00, the device repeated it at 09:00, left at 17:00.
  // The day is nine hours, not eight: 08:00 is when they actually got there.
  const day = [typed("08:00:00", "IN"), typed("09:00:00", "IN"), typed("17:00:00", "OUT")];
  assert.deepEqual(seg(day), [540]);
  assert.deepEqual(unp(day), [`${D} 09:00:00`]);
});

test("two departures never become a stretch of work either", () => {
  const day = [typed("08:00:00", "OUT"), typed("09:00:00", "OUT")];
  assert.deepEqual(seg(day), []);
  assert.deepEqual(unp(day).sort(), [`${D} 08:00:00`, `${D} 09:00:00`]);
});

test("a stray departure before any arrival matches nothing", () => {
  const day = [typed("08:00:00", "OUT"), typed("09:00:00", "IN"), typed("17:00:00", "OUT")];
  assert.deepEqual(seg(day), [480]);
  assert.deepEqual(unp(day), [`${D} 08:00:00`]);
});

test("an explicit label beats position, which is the whole point", () => {
  // Position alone calls index 0 an arrival and the last a departure. These
  // say otherwise, and they are believed.
  const day = [typed("08:00:00", "OUT"), typed("17:00:00", "OUT")];
  assert.deepEqual(seg(day), []);
});

test("a labelled day and a blank day of the same shape agree", () => {
  // The fallback must reproduce the old rule exactly, or every device that
  // reports no log_type changes behaviour on upgrade.
  const labelled = [typed("08:00:00", "IN"), typed("12:00:00", "OUT"),
                    typed("13:00:00", "IN"), typed("17:00:00", "OUT")];
  const blanks = [blank("08:00:00"), blank("12:00:00"), blank("13:00:00"), blank("17:00:00")];
  assert.deepEqual(seg(labelled), seg(blanks));
  assert.deepEqual(unp(labelled), unp(blanks));
});
