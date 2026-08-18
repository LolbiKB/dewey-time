import assert from "node:assert/strict";
import test from "node:test";

import { formatCountdown } from "@/ui/telegram/expiry";

test("above an hour the seconds are dropped as noise", () => {
  assert.equal(formatCountdown(86_400), "24h 0m");
  assert.equal(formatCountdown(3_601), "1h 0m");
});

test("exactly one hour still reads as hours, not as 60m", () => {
  // The boundary. `> 3600` here would print "60m 0s", which reads as a bug.
  assert.equal(formatCountdown(3_600), "1h 0m");
});

test("below an hour the seconds are the point", () => {
  // This is the window where HR decides whether to send this link or
  // regenerate, so a minute-only display would hide the decision.
  assert.equal(formatCountdown(3_599), "59m 59s");
  assert.equal(formatCountdown(72), "1m 12s");
  assert.equal(formatCountdown(9), "0m 9s");
});

test("zero and past-zero are Expired, never a negative duration", () => {
  // A dead credential must never render as a live one. Negative input is
  // reachable: a laptop that slept past the deadline wakes with one.
  assert.equal(formatCountdown(0), "Expired");
  assert.equal(formatCountdown(-5), "Expired");
  assert.equal(formatCountdown(-86_400), "Expired");
});
