/**
 * The site's clock, projected onto the device's.
 *
 * EVERY PRESENT-TENSE CLAIM THIS APP MAKES was device-clock arithmetic against
 * naive site-local strings, with nothing to check it against:
 *
 *   - the status chip compares the device's minute-of-day to the shift's, so a
 *     phone an hour out says "On lunch" at three in the afternoon;
 *   - the live "so far" total subtracts a punch time from a device `now` and
 *     CLAMPS A NEGATIVE TO ZERO, so a phone running behind the site shows 0m
 *     worked to somebody standing at the machine;
 *   - and which date is "today" is the device's answer too, so a traveller's
 *     phone — or one that lost NTP, or one somebody set by hand — opens on a
 *     day they were not in, fetches it, and captions it "Today".
 *
 * HOW IT WORKS, stated once so nobody re-derives it: the payload carries the
 * site's wall clock as a naive string, `offsetMs` is that minus the device's
 * clock AT THE MOMENT IT ARRIVED, and `siteNow()` is the device clock plus the
 * offset. The Date it returns is not a true instant — it is a Date whose
 * DEVICE-ZONE wall-clock reading equals the site's wall clock. That is exactly
 * the space every parsed payload datetime already lives in, which is why every
 * existing getHours()/isSameDay()/date-fns format()/subtraction becomes correct
 * with no other edit.
 *
 * THE RULE THAT FOLLOWS FROM THAT: never call `.toISOString()` on one of these,
 * never compare one against a true instant, and never pass an explicit timeZone
 * to Intl for one. All three would ask a projected wall clock what instant it
 * is, and it does not know.
 *
 * WHERE THE PROJECTION IS EXACT, stated because the paragraph above reads like
 * an unconditional promise and is not one: it holds while the DEVICE's UTC
 * offset is the same at receipt and at the moment being read. The site's zone
 * has no DST, so the only way to break that is a device parked in a zone that
 * does — and then, for the one hour the site's clock spends inside that zone's
 * spring-forward gap, the wall reading being resolved does not exist locally,
 * V8 normalises it forward, and `siteNow()` reads an hour fast. Re-fetching
 * does not help: every sample in that hour parses through the same gap. It
 * costs a night-shift status chip an hour, twice a year, on a phone that is
 * already in the wrong country; ending it properly means carrying the site's
 * IANA zone on the wire and projecting through it, which is a bigger change
 * than this one and is not pretended to be done here.
 *
 * ANCHORED TO RECEIPT, NOT TO THE PAYLOAD'S AGE. react-query hands back a
 * cached payload instantly, and taking its `server_now` as "now" would drag the
 * clock backwards by the cache age. Because the offset is a CONSTANT rather
 * than a timestamp, a ten-minute-old cache is harmless: the device clock keeps
 * advancing underneath it. One-way network latency is baked in as a fixed
 * error, well under the minute this app renders at.
 */
import { parseDateTimeLocal } from "@/lib/attendanceTime";

let offsetMs = 0;
let known = false;
const listeners = new Set<() => void>();

/**
 * How far the offset must move before anything is told about it.
 *
 * The poll re-learns the offset every 60 seconds and it will differ by a few
 * milliseconds every time — network jitter, not a clock change. Repainting the
 * whole app for that would be a re-render a minute for no visible difference,
 * so only a change big enough to matter at minute resolution is published.
 */
export const RESYNC_MS = 30_000;

/** The server's wall clock, as it arrived. Ignored if it will not parse. */
export function noteServerNow(
  serverNow: string | null | undefined,
  receivedAt: number = Date.now(),
): void {
  const parsed = parseDateTimeLocal(String(serverNow ?? "")).getTime();
  // An older server sends nothing, and an unparseable value is worse than
  // nothing. Leave the offset where it is: zero, which is exactly today's
  // behaviour.
  if (!Number.isFinite(parsed)) return;

  const next = parsed - receivedAt;
  // ALWAYS STORE, sometimes announce. The threshold below is about repainting,
  // and gating the stored value on it too made the FIRST sample permanent:
  // every offset carries that response's one-way latency, so a launch on a
  // congested link measured the offset over seconds and no later, cleaner
  // sample could correct it — each one landed inside the band and was dropped.
  // The guard suppresses re-renders; it was never meant to suppress the truth.
  const moved = !known || Math.abs(next - offsetMs) >= RESYNC_MS;
  offsetMs = next;
  known = true;
  if (!moved) return;
  for (const listener of listeners) listener();
}

/** Now, in the site's wall clock. */
export function siteNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** Whether the server has ever told us. Exposed for tests and for honesty. */
export function siteClockKnown(): boolean {
  return known;
}

/** How far the device is out, in ms. Positive means the device is BEHIND. */
export function siteClockOffsetMs(): number {
  return offsetMs;
}

/**
 * Repaint when a newly-learned offset moves the clock.
 *
 * Without this the correction waits for the next minute tick, so the first
 * screen after launch — the one somebody opened to check whether their punch
 * registered — is drawn with the device's own wrong idea of the time for up to
 * a minute.
 */
export function subscribeSiteClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: the module holds process-wide state by design. */
export function __resetSiteClock(): void {
  offsetMs = 0;
  known = false;
  listeners.clear();
}
