/**
 * The clock the phone is allowed to believe.
 *
 * Every case here describes a real phone: one that lost NTP, one somebody set
 * by hand, one carried across a border. Before this module all three got an
 * app that argued confidently about their day in their own device's terms.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  noteServerNow,
  RESYNC_MS,
  siteClockKnown,
  siteClockOffsetMs,
  siteNow,
  subscribeSiteClock,
  __resetSiteClock,
} from "@/miniapp/siteClock";

/** A fixed device clock, so the arithmetic is checkable rather than racy. */
const DEVICE_NOW = new Date(2026, 7, 21, 9, 0, 0).getTime();

/**
 * A naive site-local string, the shape the payload carries.
 *
 * Built from LOCAL components, never toISOString(): the wire format has no
 * zone, and formatting it in UTC would hand these tests a fake offset equal to
 * whatever zone the runner happens to sit in.
 */
function wallClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

test("with nothing from the server the clock is the device's, exactly as before", () => {
  __resetSiteClock();
  assert.equal(siteClockKnown(), false);
  assert.equal(siteClockOffsetMs(), 0);
  // The degradation contract: an old server sends no server_now, and the app
  // must behave precisely as it shipped rather than guessing.
  const drift = Math.abs(siteNow().getTime() - Date.now());
  assert.ok(drift < 50, `the offset must be zero, was ${drift}ms`);
});

test("a phone an hour behind the site is corrected forward", () => {
  __resetSiteClock();
  // The site says 10:00 while the device believes it is 09:00.
  noteServerNow("2026-08-21 10:00:00", DEVICE_NOW);
  assert.equal(siteClockOffsetMs(), 60 * 60 * 1000);
  assert.equal(siteClockKnown(), true);
});

test("a phone an hour ahead is corrected back, which is the worse direction", () => {
  __resetSiteClock();
  noteServerNow("2026-08-21 08:00:00", DEVICE_NOW);
  assert.equal(siteClockOffsetMs(), -60 * 60 * 1000);
  // Worse because the live "so far" total subtracts a punch from `now` and
  // clamps a negative to zero: a device ahead inflates the figure, a device
  // behind zeroes it entirely while somebody is standing at the machine.
});

test("a whole day out is a whole day corrected", () => {
  __resetSiteClock();
  // A traveller's phone, or one whose date was set by hand. This is the case
  // that made the app fetch and caption a day the person was not in.
  noteServerNow("2026-08-22 09:00:00", DEVICE_NOW);
  assert.equal(siteClockOffsetMs(), 24 * 60 * 60 * 1000);
});

test("the offset is anchored to RECEIPT, so a stale cache cannot drag it backwards", () => {
  __resetSiteClock();
  // react-query hands back a cached payload instantly. Taking its server_now
  // as "now" would move the clock back by the age of the cache; anchoring to
  // the moment it arrived means the device clock keeps advancing underneath a
  // constant offset.
  noteServerNow("2026-08-21 09:00:00", DEVICE_NOW);
  assert.equal(siteClockOffsetMs(), 0, "a perfectly-set device gets no correction");

  // The same payload, replayed ten minutes later from cache.
  noteServerNow("2026-08-21 09:00:00", DEVICE_NOW + 10 * 60 * 1000);
  assert.equal(
    siteClockOffsetMs(), -10 * 60 * 1000,
    "and the offset it computes from a stale payload is the stale one",
  );
  // Which is why the caller notes it at fetch time, not from query.data — the
  // pin for that is in miniAppSession.test.ts.
});

test("nonsense from the server leaves the clock where it was", () => {
  __resetSiteClock();
  noteServerNow("2026-08-21 10:00:00", DEVICE_NOW);
  const before = siteClockOffsetMs();

  for (const bad of [null, undefined, "", "not-a-time", "0000-00-00 00:00:00"]) {
    noteServerNow(bad, DEVICE_NOW);
    assert.equal(siteClockOffsetMs(), before, `"${bad}" must not move the clock`);
  }
});

test("jitter does not repaint the app; a real change does", () => {
  __resetSiteClock();
  let repaints = 0;
  const stop = subscribeSiteClock(() => { repaints += 1; });

  noteServerNow("2026-08-21 10:00:00", DEVICE_NOW);
  assert.equal(repaints, 1, "the first answer is always news");

  // A second later, a few hundred ms of network jitter. The poll does this
  // every 60 seconds for the life of the session.
  noteServerNow("2026-08-21 10:00:01", DEVICE_NOW + 1_200);
  assert.equal(repaints, 1, "jitter is not a clock change");
  assert.ok(RESYNC_MS >= 1_000, "the threshold has to be bigger than jitter");

  // Somebody changes their phone's clock mid-session.
  noteServerNow("2026-08-21 10:05:00", DEVICE_NOW + 5 * 60 * 1000 + RESYNC_MS + 1_000);
  assert.equal(repaints, 2, "a real move is published");

  stop();
  noteServerNow("2026-08-21 12:00:00", DEVICE_NOW);
  assert.equal(repaints, 2, "and an unsubscribed listener hears nothing more");
});

test("a slow first response does not lock its own latency in for the session", () => {
  __resetSiteClock();
  // Every offset carries the response's one-way latency, and the FIRST one is
  // measured over whatever the link was doing at launch. Gating the stored
  // value on RESYNC_MS made that first sample permanent: each later, cleaner
  // one landed inside the band and was thrown away rather than merely not
  // announced. The threshold is about repainting, not about the truth.
  noteServerNow("2026-08-21 09:00:00", DEVICE_NOW + 20_000); // 20s of transit
  assert.equal(siteClockOffsetMs(), -20_000);

  for (let i = 1; i <= 20; i += 1) {
    // A healthy poll a minute later: 300ms of transit against a perfect device.
    noteServerNow(wallClock(DEVICE_NOW + i * 60_000), DEVICE_NOW + i * 60_000 + 300);
  }
  assert.equal(siteClockOffsetMs(), -300, "a better sample must replace a worse one");
});

test("a sub-threshold correction is applied silently, not discarded", () => {
  __resetSiteClock();
  let repaints = 0;
  const stop = subscribeSiteClock(() => { repaints += 1; });

  noteServerNow("2026-08-21 09:00:05", DEVICE_NOW);
  assert.equal(siteClockOffsetMs(), 5_000);
  assert.equal(repaints, 1);

  noteServerNow("2026-08-21 09:00:00", DEVICE_NOW);
  assert.equal(siteClockOffsetMs(), 0, "the newer measurement wins");
  assert.equal(repaints, 1, "but five seconds is not worth a re-render");
  stop();
});

test("siteNow reads as a WALL CLOCK, which is the space the payload lives in", () => {
  __resetSiteClock();
  // The one property everything else depends on: the Date it returns is not a
  // true instant, it is one whose device-zone reading equals the site's wall
  // clock. That is exactly what parseDateTimeLocal produces for a punch, which
  // is why every existing getHours()/isSameDay()/subtraction becomes correct
  // with no other edit — and why .toISOString() on one of these is a lie.
  const offsetHours = 3;
  noteServerNow("2026-08-21 12:00:00", DEVICE_NOW); // device says 09:00
  assert.equal(siteClockOffsetMs(), offsetHours * 60 * 60 * 1000);

  const projected = new Date(DEVICE_NOW + siteClockOffsetMs());
  assert.equal(projected.getHours(), 12);
  assert.equal(projected.getMinutes(), 0);
  assert.equal(projected.getDate(), 21);
});
