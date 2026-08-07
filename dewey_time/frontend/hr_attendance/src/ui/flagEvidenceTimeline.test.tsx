import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FlagEvidenceTimeline } from "@/ui/FlagEvidenceTimeline";
import type { FlagTimelineSpec } from "@/lib/flagNarrative";
import { hourTicks } from "@/lib/timelineAxis";

// This component is deliberately flag-blind — every fixture below is a bare
// FlagTimelineSpec, never a Flag or a Day, which is the whole point of the
// split (spine.md: "That separation is what lets tasks 2-5 be pure and
// testable without React").

test("a gap span renders the hatch texture; a worked span never does", () => {
  const base: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 }, // 8:00 AM - 10:00 AM
    band: null,
    lunch: null,
    threshold: null,
    spans: [{ startMin: 500, endMin: 520, tone: "gap" }],
    marks: [],
  };
  const gapHtml = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={base} ariaLabel="Gone from 8:20 AM to 8:40 AM" />
  );
  assert.match(gapHtml, /repeating-linear-gradient/, "a gap span must render the hatch");

  const workedHtml = renderToStaticMarkup(
    <FlagEvidenceTimeline
      spec={{ ...base, spans: [{ startMin: 500, endMin: 520, tone: "worked" }] }}
      ariaLabel="Worked from 8:20 AM to 8:40 AM"
    />
  );
  // The defect this whole redesign fixes is undifferentiated rows; a worked
  // span painted with the same hatch as a gap would recreate that ambiguity
  // on the one surface meant to resolve it — so assert absence too.
  assert.doesNotMatch(
    workedHtml,
    /repeating-linear-gradient/,
    "a worked span must not carry the hatch"
  );
});

test("the shift band renders only when the spec provides one", () => {
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: null,
    lunch: null,
    threshold: null,
    spans: [{ startMin: 480, endMin: 540, tone: "worked" }],
    marks: [],
  };
  const withoutBand = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Worked 8 to 9, no shift on record" />
  );
  assert.doesNotMatch(
    withoutBand,
    /border-2 border-dashed border-muted-foreground\/80/,
    "band is null, so no band chrome should render at all"
  );

  const withBand = renderToStaticMarkup(
    <FlagEvidenceTimeline
      spec={{ ...spec, band: { startMin: 480, endMin: 600 } }}
      ariaLabel="Worked 8 to 9 against an 8 to 10 shift"
    />
  );
  assert.match(
    withBand,
    /border-2 border-dashed border-muted-foreground\/80/,
    "matches DayTimeline.tsx:44-45's scheduledBandClass so the two surfaces read as one visual language"
  );
});

test("the lunch window renders only when the spec provides one", () => {
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: null,
    lunch: null,
    threshold: null,
    spans: [],
    marks: [],
  };
  const withoutLunch = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="No lunch relevant to this flag" />
  );
  assert.doesNotMatch(
    withoutLunch,
    /border-muted-foreground\/45/,
    "this flag is not about lunch, so no lunch band should render (rule 10: draw only the boundary the flag is about)"
  );

  const withLunch = renderToStaticMarkup(
    <FlagEvidenceTimeline
      spec={{ ...spec, lunch: { startMin: 540, endMin: 570 } }}
      ariaLabel="Scheduled lunch 9:00 AM to 9:30 AM"
    />
  );
  assert.match(
    withLunch,
    /border-muted-foreground\/45/,
    "matches DayTimeline.tsx:474's scheduled-lunch band treatment"
  );
});

test("marks sit at the exact percentage of the window their minute implies", () => {
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 }, // a clean 120-minute span
    band: null,
    lunch: null,
    threshold: null,
    spans: [],
    // 555 (9:15 AM) is deliberately NOT a whole hour: hourTicks only emits
    // whole-hour marks, so a whole-hour minute here (e.g. 540/9:00 AM, the
    // window's midpoint) would land an axis tick AND an hour label at the
    // same left:50% offset as the mark, and a regex keyed on that offset
    // alone would still match with the marks block deleted entirely.
    marks: [{ atMin: 555, tone: "alert" }],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Punched once at 9:15 AM, then never again" />
  );
  assert.match(
    html,
    // Anchored to the mark's own dot (its tone class immediately precedes
    // its style attribute), not to any element that merely happens to sit
    // at this offset, so deleting the marks block fails this assertion.
    /bg-destructive" style="left:clamp\(6px, 62\.5%, calc\(100% - 6px\)\)"/,
    "555 is 62.5% of the 480-600 window, and the mark's dot must sit there (pulled back from either edge by the edge-guard clamp)"
  );
});

test("marks paint after spans and bands, so DOM order puts them on top", () => {
  // TimelineAxis.tsx's HourGrid carries the same convention this component
  // reuses: nothing here sets a z-index, so stacking is purely DOM order — a
  // mark inserted before its band would be painted underneath it, silently.
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: { startMin: 480, endMin: 600 },
    lunch: null,
    threshold: null,
    spans: [{ startMin: 480, endMin: 540, tone: "worked" }],
    marks: [{ atMin: 570, tone: "alert" }],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Band, a worked span, and a mark" />
  );
  const bandIdx = html.indexOf("border-2 border-dashed border-muted-foreground/80");
  const spanIdx = html.indexOf("bg-primary");
  const markIdx = html.lastIndexOf("bg-destructive");
  assert.ok(
    bandIdx !== -1 && spanIdx !== -1 && markIdx !== -1,
    "fixture must render all three, or this test proves nothing"
  );
  assert.ok(markIdx > bandIdx && markIdx > spanIdx, "the mark must be the last of the three in DOM order");
});

test("the container carries one label; the graphic itself is hidden from assistive tech", () => {
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: { startMin: 480, endMin: 600 },
    lunch: null,
    threshold: null,
    spans: [{ startMin: 480, endMin: 540, tone: "worked" }],
    marks: [{ atMin: 540, tone: "alert" }],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Clocked in at 9:00 AM, 12 minutes late" />
  );
  const rootTag = html.slice(0, html.indexOf(">") + 1);
  assert.match(rootTag, /role="img"/);
  assert.match(rootTag, /aria-label="Clocked in at 9:00 AM, 12 minutes late"/);
  // The headline already states the finding in words — the root carries the
  // one label that matters and must not also be hidden from the tree that
  // reads it.
  assert.doesNotMatch(rootTag, /aria-hidden/);
  // Everything drawn inside the root is decorative reinforcement of that
  // headline, so it must be hidden rather than announced div-by-div.
  assert.match(html, /aria-hidden="true"/);
});

// --- Tolerances beyond the six above, drawn from reviewing what Tasks 2-5's
// builders actually ship (per the Task 6 brief) rather than from the
// contract's TypeScript shape alone. ---

test("threshold renders a cutoff line only when the spec provides one", () => {
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: null,
    lunch: null,
    threshold: null,
    spans: [],
    marks: [],
  };
  const withoutThreshold = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="No threshold relevant to this flag" />
  );
  assert.doesNotMatch(
    withoutThreshold,
    /bg-destructive\/70/,
    "threshold is null, so no cutoff line should render"
  );

  const withThreshold = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={{ ...spec, threshold: 510 }} ariaLabel="Late cutoff at 8:30 AM" />
  );
  assert.match(withThreshold, /bg-destructive\/70/, "threshold present, so the cutoff line renders");
  assert.match(withThreshold, /left:25%/, "510 is 25% of the 480-600 window");
});

test("a mark with a label and a mark without one both render the same dot, with no leaked empty label text", () => {
  // Task 4's marks omit `label`; Task 5's carry one (e.g. formatMinuteOnDay
  // output). The panel's headline already states the finding in words, so
  // this component never surfaces mark.label as visible text either way —
  // assert that holds for both shapes, not just the label-less one the six
  // base tests happen to use.
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: null,
    lunch: null,
    threshold: null,
    spans: [],
    marks: [
      { atMin: 500, tone: "normal" },
      { atMin: 540, tone: "alert", label: "9:00 AM" },
    ],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Two marks, one labelled, one not" />
  );
  assert.doesNotMatch(html, />9:00 AM</, "mark.label text must never appear as rendered content");
  // Both marks still paint a dot: bg-primary for "normal", bg-destructive for
  // "alert" tone (the same class the DOM-order test above keys off).
  assert.match(html, /bg-primary/);
  assert.match(html, /bg-destructive/);
});

test("an overnight window (minutes past 1440) renders correct hour labels and a bounded number of ticks", () => {
  // Real MISSING_TIME overnight output (flagNarrative.test.ts:1030-1068):
  // an 18.8-hour window because the gap's punches roll well past midnight.
  // hourTicks doubles its step above 17 hours specifically so a window this
  // wide degrades to something readable instead of a wall of collisions.
  const window = { startMin: 325, endMin: 1455 };
  const spec: FlagTimelineSpec = {
    window,
    band: null,
    lunch: null,
    threshold: null,
    spans: [{ startMin: 1410, endMin: 1455, tone: "gap" }],
    marks: [],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Gone from 11:30 PM to 12:15 AM" />
  );
  assert.doesNotMatch(html, /NaN/, "no coordinate should ever compute to NaN");
  // Midnight (1440) must read "12 AM", never "24 AM" — hourLabel's `% 24`
  // guard is what this component leans on instead of re-deriving the axis.
  assert.match(html, />12 AM</);
  const expectedTicks = hourTicks(window.startMin, window.endMin);
  const tickCount = (html.match(/class="absolute inset-y-0 w-px bg-border"/g) ?? []).length;
  assert.equal(
    tickCount,
    expectedTicks.length,
    "tick count must come from hourTicks' own step-doubling, not a second axis invented here"
  );
  assert.ok(tickCount <= 12, "hourTicks' doubled step keeps a ~19h window to a readable number of ticks");
});

test("a span reaching past the window's own end still renders without overflowing the strip's bounding box", () => {
  // Real LEFT_EARLY overnight output (flagNarrative.test.ts:546-581): the
  // window clamps to 1440 while the gap span and threshold — already
  // normalised past midnight — legitimately land beyond it. Rule 5: clip to
  // the window rather than let the strip grow past its container.
  const spec: FlagTimelineSpec = {
    window: { startMin: 1375, endMin: 1440 },
    band: null,
    lunch: null,
    threshold: 1790,
    spans: [{ startMin: 1420, endMin: 1800, tone: "gap" }],
    marks: [{ atMin: 1420, tone: "alert", label: "Clocked out" }],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Clocked out early" />
  );
  assert.doesNotMatch(html, /NaN/, "no coordinate should ever compute to NaN");
  // The strip itself must clip anything positioned or sized past its edges —
  // this is the mechanism that keeps an out-of-window span from blowing out
  // the panel's layout, so assert it is actually present rather than assumed.
  assert.match(html, /overflow-hidden/, "the strip must clip content that overflows its bounds");
  // overflow-hidden alone is a static class present on every render — even
  // an empty spec — so it cannot by itself detect a regression that clamps
  // percentages to 100 or drops out-of-window geometry instead of clipping
  // it visually. Pin the actual unclamped numbers this window computes for
  // the gap span and the threshold, so a future change to either fails here.
  assert.match(
    html,
    /style="left:69\.23076923076923%;width:584\.6153846153845%/,
    "the gap span's left/width must be the raw, unclamped percentages this window implies, not clipped by the math itself"
  );
  assert.match(
    html,
    /bg-destructive\/70" style="left:638\.4615384615385%"/,
    "the threshold line's left must be the raw, unclamped percentage this window implies"
  );
});

test("a band and a lunch window that start before window.startMin render with a negative left and an unclamped width, not pulled to the visible edge", () => {
  // Requirement 3(e) names band and lunch, not just span/threshold, as able
  // to extend outside window — and FlagEvidenceTimeline.tsx's band/lunch
  // branches take a different code path (Math.max(0, ...) on the width,
  // no clamp on the left) than spans/threshold do, so this needs its own
  // fixture rather than reusing the span/threshold case above.
  const spec: FlagTimelineSpec = {
    window: { startMin: 600, endMin: 720 }, // 10 AM - 12 PM
    band: { startMin: 540, endMin: 660 }, // starts 60 min before window.startMin
    lunch: { startMin: 570, endMin: 630 }, // starts 30 min before window.startMin
    threshold: null,
    spans: [],
    marks: [],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Band and lunch both start before this window" />
  );
  assert.doesNotMatch(html, /NaN/, "no coordinate should ever compute to NaN");
  assert.match(
    html,
    /border-2 border-dashed border-muted-foreground\/80 bg-muted\/50" style="left:-50%;width:100%"/,
    "the band's left goes negative and its width is the raw Math.max(0, ...) difference, not pulled to the visible edge"
  );
  assert.match(
    html,
    /border border-muted-foreground\/45 bg-muted\/35" style="left:-25%;width:50%"/,
    "the lunch band's left goes negative the same way, on its own separate code path"
  );
});

test("a mark at either edge of the window keeps its full dot inside the strip, instead of being sheared by overflow-hidden", () => {
  // A mark at exactly window.endMin (or window.startMin) is a real shape,
  // not a hypothetical: LEFT_EARLY-style specs anchor the window on their
  // own last mark (buildLeftEarlyTimeline), so a dot centered via
  // -translate-x-1/2 at a bare left:100%/0% would sit ON the clip edge and
  // overflow-hidden would shear off its far half plus its ring-2 ring.
  const spec: FlagTimelineSpec = {
    window: { startMin: 480, endMin: 600 },
    band: null,
    lunch: null,
    threshold: null,
    spans: [],
    marks: [
      { atMin: 600, tone: "alert" }, // window.endMin
      { atMin: 480, tone: "normal" }, // window.startMin
    ],
  };
  const html = renderToStaticMarkup(
    <FlagEvidenceTimeline spec={spec} ariaLabel="Marks at both edges" />
  );
  assert.match(
    html,
    /bg-destructive" style="left:clamp\(6px, 100%, calc\(100% - 6px\)\)"/,
    "the mark at window.endMin must be pulled back from the edge by the guard clamp, not sit at a bare left:100%"
  );
  assert.match(
    html,
    /bg-primary" style="left:clamp\(6px, 0%, calc\(100% - 6px\)\)"/,
    "the mark at window.startMin must be pulled forward from the edge by the same clamp"
  );
  assert.doesNotMatch(
    html,
    /bg-destructive" style="left:100%"/,
    "the old unclamped bare percentage must not appear for the end-edge mark"
  );
  assert.doesNotMatch(
    html,
    /bg-primary" style="left:0%"/,
    "the old unclamped bare percentage must not appear for the start-edge mark"
  );
});
