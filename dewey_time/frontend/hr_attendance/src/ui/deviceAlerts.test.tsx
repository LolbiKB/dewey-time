import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import type { DeviceAlert } from "@/types/calendar";

import { DeviceHealthDetail } from "./DeviceAlerts";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const ALERTS: DeviceAlert[] = [
  { device_sn: "ZK-A4-014", local_date: "2026-07-29", status: "deferred_offline", last_error: null },
  { device_sn: "ZK-A4-021", local_date: "2026-07-29", status: "closure_failed", last_error: "timeout" },
];

test("the device banners are no longer AttentionStrips above the calendar", () => {
  // They rendered INSIDE Section grow (App.tsx), directly above the week view,
  // so they ate the calendar's height rather than the page's.
  const src = readFileSync(resolve(PKG_ROOT, "src/ui/App.tsx"), "utf8");
  assert.doesNotMatch(src, /DeviceCloseoutBanner|DeviceSyncStalenessBanner/);
});

test("the toolbar carries the chip instead", () => {
  const src = readFileSync(resolve(PKG_ROOT, "src/ui/AttendanceToolbar.tsx"), "utf8");
  assert.match(src, /<DataHealthButton/);
  assert.match(src, /attendanceHealth\(/);
});

test("the popover body still names every pending closeout", () => {
  const html = renderToStaticMarkup(
    <DeviceHealthDetail alerts={ALERTS} staleSyncMinutes={1323} />,
  );
  assert.match(html, /ZK-A4-014/);
  assert.match(html, /ZK-A4-021/);
  assert.match(html, /22h 3m/);
});

test("the staleness line survives the move, wording and all", () => {
  // Was DeviceSyncStalenessBanner's own assertion. The strip is gone; the
  // sentence it carried is the one thing about it worth keeping.
  const html = renderToStaticMarkup(
    <DeviceHealthDetail alerts={[]} staleSyncMinutes={300} />,
  );
  assert.match(html, /Device data may be stale/);
  assert.match(html, /last sync/);
  assert.match(html, /5h/);
});

test("the detail renders nothing it was not given", () => {
  const html = renderToStaticMarkup(
    <DeviceHealthDetail alerts={[]} staleSyncMinutes={null} />,
  );
  assert.doesNotMatch(html, /last sync/i);
});
