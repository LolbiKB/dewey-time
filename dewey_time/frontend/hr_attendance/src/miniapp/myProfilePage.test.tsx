import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProfileHeading, ProfileSection } from "@/miniapp/MiniProfileRow";

/** Source with `//` comments stripped, so a guard cannot match its own note. */
function source(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

test("the month query is not polled, unlike the day's", () => {
  // A source guard because the alternative is a React test environment with a
  // fake clock, for one option object.
  //
  // The 60s interval on useMiniAppCalendar exists for the Day tab's claim about
  // the PRESENT — "In" goes false while somebody walks to the terminal. Nothing
  // on Profile makes such a claim, and this range is a whole month: left
  // polling it re-fetches thirty-odd days every minute, on an employee's mobile
  // data, to maintain a days-worked count that changes twice a day.
  const src = source("./MyProfilePage.tsx");
  // Bounded lookahead rather than [^)]*: the arguments contain format(...)
  // calls, so a negated-paren class stops at the first inner ")".
  assert.match(
    src,
    /useMiniAppCalendar\([\s\S]{0,200}?\{\s*poll:\s*false\s*\}/,
    "MyProfilePage's month query must pass { poll: false }",
  );
});

test("the opt-out stays out of the query key, so the cache is still shared", () => {
  // The calendar sheet fetches the same month under the same key. If `opts` ever
  // reached the key, opening Profile and then the calendar would fetch the same
  // month twice and show two independently-aged copies of it.
  const src = source("./useMiniAppSession.ts");
  const key = /queryKey:\s*\["mini-calendar",\s*startDate,\s*endDate\]/.exec(src);
  assert.ok(key, "the mini-calendar query key has changed shape");
});

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
