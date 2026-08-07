import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AVATAR_RING_DELAY_MS,
  initialAvatarPhase,
  nextAvatarPhase,
  showsPhoto,
  showsRing,
} from "@/lib/avatarLoading";

test("an employee with no photo starts settled, never loading", () => {
  assert.equal(initialAvatarPhase(null), "no-photo");
  assert.equal(initialAvatarPhase(undefined), "no-photo");
  assert.equal(initialAvatarPhase(""), "no-photo");
});

test("an employee with a photo starts loading", () => {
  assert.equal(initialAvatarPhase("/files/sokheng.jpg"), "loading");
});

test("a load settles to loaded and an error settles to failed", () => {
  assert.equal(nextAvatarPhase("loading", "load"), "loaded");
  assert.equal(nextAvatarPhase("loading", "error"), "failed");
});

test("a late event after settling changes nothing", () => {
  // A browser can fire error after load on a replaced src. Blanking a photo
  // that already painted would be a worse bug than the one this fixes.
  assert.equal(nextAvatarPhase("loaded", "error"), "loaded");
  assert.equal(nextAvatarPhase("failed", "load"), "failed");
  assert.equal(nextAvatarPhase("no-photo", "load"), "no-photo");
});

test("the photo shows only once it has fully loaded", () => {
  assert.equal(showsPhoto("loaded"), true);
  assert.equal(showsPhoto("loading"), false);
  assert.equal(showsPhoto("failed"), false);
  assert.equal(showsPhoto("no-photo"), false);
});

test("no ring before the delay elapses — the anti-flicker property", () => {
  // A cached photo resolves in tens of milliseconds. An indicator that appears
  // and disappears inside 50ms reads as a flicker; across forty rows, as the
  // page malfunctioning.
  assert.equal(showsRing("loading", false), false);
});

test("a photo still loading after the delay gets the ring", () => {
  assert.equal(showsRing("loading", true), true);
});

test("the ring clears on both load and error", () => {
  // A failed photo must not leave a row spinning forever — the failure mode the
  // happy path hides.
  assert.equal(showsRing("loaded", true), false);
  assert.equal(showsRing("failed", true), false);
});

test("an employee with no photo never rings, however long the page is open", () => {
  assert.equal(showsRing("no-photo", true), false);
});

test("the delay is short enough to be invisible and long enough to gate a cached hit", () => {
  assert.equal(AVATAR_RING_DELAY_MS, 150);
});
