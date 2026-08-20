import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// SOURCE PINS, and named as such. The reducer's behaviour is pinned properly
// in telegramLinkState.test.ts; these pin that the hook and the dialog are
// actually WIRED to it. The original defect lived exactly in that gap — the
// guard existed in one place (revoke) while issue bypassed it — and a hook
// that quietly went back to bare useState would leave every reducer test
// green while reintroducing the cross-employee credential paint. Rendering
// the hook under node:test would need a DOM harness this suite does not
// carry; a pin on the seam is the honest second-best, stated as what it is.

const here = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(here, "useTelegramLink.ts"), "utf8");
const dialogSource = readFileSync(
  join(here, "../ui/telegram/TelegramDialog.tsx"),
  "utf8",
);

test("the hook's state IS the guarded reducer, with no useState beside it", () => {
  assert.match(hookSource, /useReducer\(linkReducer, INITIAL_LINK_STATE\)/);
  // A parallel useState for invite/error/busy is exactly how a settlement
  // would escape the generation guard.
  assert.doesNotMatch(hookSource, /useState/);
});

test("every settlement carries the generation it started under", () => {
  assert.match(hookSource, /\{ type: "issued", gen, invite:/);
  assert.match(hookSource, /type: "failed",\s*\n\s*gen,/);
  assert.match(hookSource, /\{ type: "revoked", gen \}/);
});

test("the dialog renders the dismissible error body, not a bare paragraph", () => {
  assert.match(
    dialogSource,
    /<TelegramErrorBody message=\{error\} onDismiss=\{dismissError\}/,
  );
  // The old dead end: static red text rendered INSTEAD of everything else,
  // with no way back but closing the dialog.
  assert.doesNotMatch(dialogSource, /text-destructive">\{error\}<\/p>/);
});
