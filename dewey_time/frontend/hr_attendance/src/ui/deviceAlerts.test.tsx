import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DeviceAlert } from "@/types/calendar";

import { DeviceCloseoutBanner, DeviceSyncStalenessBanner } from "./DeviceAlerts";

const ALERTS: DeviceAlert[] = [
  { device_sn: "ZK-A4-014", local_date: "2026-07-29", status: "deferred_offline", last_error: null },
  { device_sn: "ZK-A4-021", local_date: "2026-07-29", status: "closure_failed", last_error: "timeout" },
];

// The banner used to grow a row per device. Now the count carries the volume
// and the rows hide behind the header row, so three bad devices cost the same
// vertical space as one.
test("closeout rows are disclosed, not stacked in the header", () => {
  const html = renderToStaticMarkup(<DeviceCloseoutBanner alerts={ALERTS} />);
  const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
  assert.match(summary, /Device closeout pending/);
  assert.match(summary, />2</);
  assert.doesNotMatch(summary, /ZK-A4-014/);
  assert.match(html, /ZK-A4-014/);
});

test("closeout banner is polite, not assertive", () => {
  const html = renderToStaticMarkup(<DeviceCloseoutBanner alerts={ALERTS} />);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /role="alert"/);
});

// Staleness has no detail to disclose, so it must stay a plain one-line strip.
test("staleness renders a single line with no disclosure", () => {
  const html = renderToStaticMarkup(<DeviceSyncStalenessBanner minutesSince={300} />);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /Device data may be stale/);
  assert.match(html, /last sync/);
});
