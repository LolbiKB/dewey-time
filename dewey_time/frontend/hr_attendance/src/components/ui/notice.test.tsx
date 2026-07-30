import assert from "node:assert/strict";
import test from "node:test";
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
  assert.doesNotMatch(html, /tabular-nums/);
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
});

test("FailureBlock disables the button while retrying", () => {
  const html = renderToStaticMarkup(
    <FailureBlock title="Attendance data didn't load" onRetry={() => {}} retrying />
  );
  assert.match(html, /disabled/);
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
