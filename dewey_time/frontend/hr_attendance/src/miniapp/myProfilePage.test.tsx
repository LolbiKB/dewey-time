import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProfileHeading, ProfileSection } from "@/miniapp/MiniProfileRow";

test("a row with no value is dropped rather than dashed", () => {
  // A dash reads as data the app failed to load. An absent row reads as a
  // field nobody filled in, which is what it is.
  const html = renderToStaticMarkup(
    <ProfileSection
      title="Your record"
      rows={[
        { label: "Department", value: "Retail" },
        { label: "Reports to", value: null },
        { label: "Employment", value: "" },
        { label: "Branch", value: undefined },
      ]}
    />,
  );
  assert.match(html, /Department/);
  assert.match(html, /Retail/);
  assert.doesNotMatch(html, /Reports to/);
  assert.doesNotMatch(html, /Employment/);
  assert.doesNotMatch(html, /—/);
});

test("a section whose every row was dropped renders nothing at all", () => {
  // Not an empty bordered box under a heading, which reads as broken.
  const html = renderToStaticMarkup(
    <ProfileSection
      title="Contact HR has for you"
      rows={[{ label: "Phone", value: null }, { label: "Email", value: "" }]}
    />,
  );
  assert.equal(html, "");
});

test("a section with no rows but a child still renders", () => {
  // The month stats are a grid, not rows.
  const html = renderToStaticMarkup(
    <ProfileSection title="August so far">
      <span>12 days worked</span>
    </ProfileSection>,
  );
  assert.match(html, /12 days worked/);
  assert.match(html, /August so far/);
});

test("a zero is a value, not an absence", () => {
  // `0` is falsy and would vanish under a naive truthiness check — which
  // matters here because a fingerprint count and a flag count are both
  // legitimately zero.
  const html = renderToStaticMarkup(
    <ProfileSection title="x" rows={[{ label: "Fingers", value: 0 }]} />,
  );
  assert.match(html, /Fingers/);
});

test("a heading is a heading, so the page has structure for a screen reader", () => {
  const html = renderToStaticMarkup(<ProfileHeading>Your roster</ProfileHeading>);
  assert.match(html, /<h2[^>]*>Your roster<\/h2>/);
});
