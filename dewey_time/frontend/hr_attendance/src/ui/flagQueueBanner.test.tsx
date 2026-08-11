import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { rolloutBannerMessage } from "@/lib/rolloutBanner";
import type { RolloutBlock } from "@/types/flags";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const LIVE: RolloutBlock = {
  phases_configured: true,
  range_phase: "LIVE",
  testing_flag_count: 0,
  total_flag_count: 12,
  windows: [],
};

test("FlagQueuePage asks rolloutBannerMessage rather than rebuilding the copy", () => {
  // The copy and every null-date rule live in one tested place. A second
  // formatting site in the page would drift from it silently -- the page has
  // no test that renders the real payload end to end.
  const src = readFileSync(resolve(PKG, "src/ui/FlagQueuePage.tsx"), "utf8");
  assert.match(src, /rolloutBannerMessage/, "the page calls the shared function");
  assert.doesNotMatch(
    src,
    /calibration data, not the official record/,
    "the page does not carry its own copy of the banner text",
  );
});

test("the banner is rendered through AttentionStrip, not a bespoke element", () => {
  // AttentionStrip is "Role 2 -- attention: the data may be stale or
  // incomplete, nothing is broken", which is exactly what "calibration data,
  // not the official record" says. It also already sets role="status", so
  // reusing it settles the accessibility question rather than re-answering it.
  const src = readFileSync(resolve(PKG, "src/ui/FlagQueuePage.tsx"), "utf8");
  assert.match(src, /rolloutBanner \?\s*\(\s*<AttentionStrip/, "rendered via AttentionStrip");
  assert.match(src, /tone="accent"/, "accent, not the amber the capped notice uses");
});

test("the hook hands the page the rollout block", () => {
  // Without this the page silently reads `undefined` and the banner never
  // appears, with nothing failing anywhere.
  const src = readFileSync(resolve(PKG, "src/hooks/useFlagQueue.ts"), "utf8");
  assert.match(src, /rollout/, "useFlagQueue exposes rollout");
});

test("an all-live queue renders no banner", () => {
  assert.equal(rolloutBannerMessage(LIVE), null);
});
