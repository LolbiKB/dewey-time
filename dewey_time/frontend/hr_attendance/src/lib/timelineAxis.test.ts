import { test } from "node:test";
import assert from "node:assert/strict";

import { hourLabel, hourTicks, pctOfWindow } from "./timelineAxis";

const H = (h: number) => h * 60;

test("hourTicks marks every whole hour inclusive of both bounds", () => {
  const ticks = hourTicks(H(7), H(18));
  assert.equal(ticks.length, 12);
  assert.equal(ticks[0], H(7));
  assert.equal(ticks[ticks.length - 1], H(18), "the terminal tick renders; it closes the axis");
});

test("hourTicks steps to 2h only once the window exceeds 17h", () => {
  // The boundary itself, both sides — 20px/hour is where hourly labels collide.
  const at17 = hourTicks(H(5), H(22));
  assert.equal(at17[1]! - at17[0]!, 60, "exactly 17h still steps hourly");

  const at18 = hourTicks(H(5), H(23));
  assert.equal(at18[1]! - at18[0]!, 120, "18h steps two-hourly");
});

test("the 2h step is phased from the first whole hour, not from even clock hours", () => {
  const ticks = hourTicks(H(5), H(23));
  assert.deepEqual(ticks.slice(0, 3), [H(5), H(7), H(9)], "05, 07, 09 — not 06, 08, 10");
});

test("hourTicks handles bounds that are not hour-aligned", () => {
  // The window is hour-quantized in practice, but this must not assume it.
  const ticks = hourTicks(430, 1085);
  assert.equal(ticks[0], H(8), "first whole hour at or after 07:10");
  assert.equal(ticks[ticks.length - 1], H(18), "last whole hour at or before 18:05");
  assert.ok(ticks.every((m) => m >= 430 && m <= 1085), "no tick outside the window");
});

test("hourTicks returns nothing for an empty or inverted window", () => {
  assert.deepEqual(hourTicks(H(9), H(9)), []);
  assert.deepEqual(hourTicks(H(18), H(7)), []);
});

test("hourLabel reads as a clock, including the two cases naive maths gets wrong", () => {
  assert.equal(hourLabel(H(7)), "7 AM");
  assert.equal(hourLabel(H(11)), "11 AM");
  assert.equal(hourLabel(H(23)), "11 PM");
  // `% 12` gives 0 for both of these.
  assert.equal(hourLabel(0), "12 AM");
  assert.equal(hourLabel(H(12)), "12 PM");
  // Reachable: a 23:30 punch widens endMin to 24:00, and that tick is labelled.
  assert.equal(hourLabel(H(24)), "12 AM");
});

test("pctOfWindow maps the window onto 0-100", () => {
  const w = { startMin: H(7), endMin: H(19) };
  assert.equal(pctOfWindow(H(7), w), 0);
  assert.equal(pctOfWindow(H(19), w), 100);
  assert.equal(pctOfWindow(H(13), w), 50);
});

test("pctOfWindow does not divide by zero", () => {
  assert.equal(pctOfWindow(H(9), { startMin: H(9), endMin: H(9) }), 0);
});
