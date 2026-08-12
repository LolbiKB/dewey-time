import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { AttentionStrip, FailureBlock } from "@/components/ui/notice";

// Role 2 is "polite". It must never interrupt a screen reader for data that is
// merely stale — that is what role="alert" would do.
test("AttentionStrip announces politely", () => {
  const html = renderToStaticMarkup(
    <AttentionStrip tone="amber" icon={<svg />}>
      Device data may be stale
    </AttentionStrip>
  );
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /role="alert"/);
});

// Without detail there is nothing to disclose, so no <details> wrapper and no
// chevron should appear at all.
test("AttentionStrip without detail renders no disclosure", () => {
  const html = renderToStaticMarkup(
    <AttentionStrip tone="amber" icon={<svg />}>
      Device data may be stale
    </AttentionStrip>
  );
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /<summary/);
});

// The whole point of the redesign: with detail present the strip is still ONE
// row at rest, because the header row itself is the <summary>. If the detail
// ever renders outside <details>, the strip has silently grown a second row.
test("AttentionStrip with detail puts the header row inside the summary", () => {
  const html = renderToStaticMarkup(
    <AttentionStrip
      tone="accent"
      icon={<svg />}
      count={3}
      detail={<ul><li>ZK-A4-014</li></ul>}
    >
      Device closeout pending
    </AttentionStrip>
  );
  assert.match(html, /<details/);
  const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
  assert.match(summary, /Device closeout pending/);
  assert.match(summary, />3</);
  // the detail is NOT in the summary — it lives after it
  assert.doesNotMatch(summary, /ZK-A4-014/);
  assert.match(html, /ZK-A4-014/);
});

test("AttentionStrip omits the count slot when no count is given", () => {
  const html = renderToStaticMarkup(
    <AttentionStrip tone="amber" icon={<svg />}>
      Device data may be stale
    </AttentionStrip>
  );
  assert.doesNotMatch(html, />\d+</);
});

// The collapsed branch (no `detail`) has its own count slot, independent of
// the one inside <summary> — this covers it directly instead of only via the
// disclosure branch.
test("AttentionStrip renders the count in the collapsed branch too", () => {
  const html = renderToStaticMarkup(
    <AttentionStrip tone="amber" icon={<svg />} count={3}>
      Device data may be stale
    </AttentionStrip>
  );
  assert.match(html, />3</);
});

// Role 3 is the one place role="alert" is correct — the user asked for
// something and it did not arrive.
test("FailureBlock announces assertively", () => {
  const html = renderToStaticMarkup(<FailureBlock title="Attendance data didn't load" />);
  assert.match(html, /role="alert"/);
  assert.match(html, /Attendance data didn&#x27;t load/);
});

// A retry button that does nothing is worse than no button, so it only renders
// when a handler is supplied.
test("FailureBlock omits the button when there is no retry handler", () => {
  const html = renderToStaticMarkup(<FailureBlock title="Coverage didn't load" />);
  assert.doesNotMatch(html, /<button/);
});

test("FailureBlock renders a retry button when given a handler", () => {
  const html = renderToStaticMarkup(
    <FailureBlock title="Attendance data didn't load" onRetry={() => {}} />
  );
  assert.match(html, /<button/);
  assert.match(html, /Retry/);
  // `Button`'s base class string always contains "disabled:pointer-events-none",
  // so a plain /disabled/ match can't tell a disabled button from an enabled
  // one — assert the actual rendered boolean attribute is absent instead.
  assert.doesNotMatch(html, /disabled=""/);
});

test("FailureBlock disables the button while retrying", () => {
  const html = renderToStaticMarkup(
    <FailureBlock title="Attendance data didn't load" onRetry={() => {}} retrying />
  );
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, />Retry</);
});

test("FailureBlock renders a ReactNode cause", () => {
  const html = renderToStaticMarkup(
    <FailureBlock
      title="Attendance data didn't load"
      cause={<><span>Confirm you have HR User access.</span><span>Detail line.</span></>}
    />
  );
  assert.match(html, /Confirm you have HR User access\./);
  assert.match(html, /Detail line\./);
});

// The block's 13rem minimum is right where it can scroll, but App.tsx renders
// it inside three nested non-scrolling clippers — on a landscape phone that
// minimum pushes the Retry button, the surface's only action, out of view. The
// call site needs to be able to hand down `min-h-0`.
test("FailureBlock merges a caller className onto its root", () => {
  const html = renderToStaticMarkup(
    <FailureBlock title="Attendance data didn't load" className="min-h-0" />
  );
  const root = html.slice(0, html.indexOf(">"));
  assert.match(root, /role="alert"/);
  assert.match(root, /\bmin-h-0\b/);
  // tailwind-merge keeps the caller's min-height, not both.
  assert.doesNotMatch(root, /min-h-\[13rem\]/);
});

// Resolve from this file, never the CWD — a repo-relative path passes locally
// and fails wherever the runner starts somewhere else.
const SRC = fileURLToPath(new URL("../../", import.meta.url));

// These three pages reported persistent conditions through <Alert>, whose root
// hardcodes role="alert" — an assertive live region that interrupts a screen
// reader. After the migration none of them should reach for it again.
test("migrated pages no longer import the Alert primitive", () => {
  for (const rel of [
    "ui/App.tsx",
    "ui/DeviceAlerts.tsx",
    "ui/schedule-coverage/CoverageRegisterPage.tsx",
  ]) {
    const source = readFileSync(SRC + rel, "utf8");
    assert.doesNotMatch(
      source,
      /from "@\/components\/ui\/alert"/,
      `${rel} still imports Alert — use AttentionStrip or FailureBlock`
    );
  }
});
