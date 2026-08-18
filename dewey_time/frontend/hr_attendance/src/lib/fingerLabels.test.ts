import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fingerLabel, KNOWN_FINGER_SLUGS } from "@/lib/fingerLabels";

/** The server's half of the finger allowlist, read out of the Python. */
function serverSlugs(): string[] {
  const src = readFileSync(
    new URL("../../../../attendance_engine/finger_slots.py", import.meta.url),
    "utf8",
  );
  const table = /FINGER_SLUGS\s*=\s*\{([\s\S]*?)\}/.exec(src);
  assert.ok(table, "FINGER_SLUGS not found — has finger_slots.py moved?");
  const unknown = /UNKNOWN_SLUG\s*=\s*"([a-z_]+)"/.exec(src);
  assert.ok(unknown, "UNKNOWN_SLUG not found — has finger_slots.py moved?");
  return [
    ...[...table[1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!),
    unknown[1]!,
  ];
}

test("the register's finger words and the server's slug table are the same list", () => {
  // READ OUT OF THE PYTHON, not copied from it — the same guard
  // miniProfile.test.ts applies to the Mini App's half. A server slug this
  // map lacks would reach the tooltip and CSV as "Other finger" for a finger
  // the device named precisely.
  assert.deepEqual(
    [...KNOWN_FINGER_SLUGS].sort(),
    serverSlugs().sort(),
    "finger_slots.FINGER_SLUGS and fingerLabels.FINGER_LABELS have drifted",
  );
});

test("a slug with no word renders as a finger, not a crash", () => {
  assert.equal(fingerLabel("right_thumb"), "Right thumb");
  assert.equal(fingerLabel("sixth_finger"), "Other finger");
});
