import assert from "node:assert/strict";
import test from "node:test";

import { dismissTopLayer, pushLayer, resetLayers } from "@/miniapp/miniBackStack";

test("with nothing open, back belongs to whoever bound it", () => {
  resetLayers();
  assert.equal(dismissTopLayer(), false);
});

test("the topmost layer is the one that closes", () => {
  // THE DEFECT: the back button was bound to the day drill-in alone, so with a
  // sheet open it left the sheet exactly where it was and silently reset the
  // DATE UNDERNEATH — the one layer the reader could not see was the one that
  // moved.
  resetLayers();
  const closed: string[] = [];
  pushLayer(() => closed.push("picker"));
  pushLayer(() => closed.push("flags"));

  assert.equal(dismissTopLayer(), true);
  assert.deepEqual(closed, ["flags"], "the sheet on top goes first");
});

test("closing a layer hands the button back to the one beneath it", () => {
  resetLayers();
  const closed: string[] = [];
  pushLayer(() => closed.push("picker"));
  const removeFlags = pushLayer(() => closed.push("flags"));

  removeFlags();
  assert.equal(dismissTopLayer(), true);
  assert.deepEqual(closed, ["picker"]);
});

test("a layer that goes away stops claiming the back button", () => {
  // A sheet can unmount without its `open` flag going false — a tab switch —
  // and must not leave a handler reaching into a tree nobody is looking at.
  resetLayers();
  const remove = pushLayer(() => assert.fail("an unmounted layer must not be dismissed"));
  remove();
  assert.equal(dismissTopLayer(), false);
});

test("removing a middle layer does not disturb the order of the rest", () => {
  // Each layer removes itself when it unmounts, which is what walking the stack
  // actually looks like: dismiss, the component closes, its cleanup pops it.
  resetLayers();
  const closed: string[] = [];
  pushLayer(() => closed.push("a"));
  const removeB = pushLayer(() => closed.push("b"));
  const removeC = pushLayer(() => closed.push("c"));

  removeB();
  assert.equal(dismissTopLayer(), true);
  removeC();
  assert.equal(dismissTopLayer(), true);
  assert.deepEqual(closed, ["c", "a"], "b is gone; a is still underneath");
});

test("dismissing does not itself pop the layer", () => {
  // The layer removes itself by unmounting when its own state goes false. If
  // dismiss also popped it, a sheet whose close was animated would be gone from
  // the stack while still on screen, and back would skip past it.
  resetLayers();
  let closes = 0;
  pushLayer(() => { closes += 1; });
  dismissTopLayer();
  dismissTopLayer();
  assert.equal(closes, 2);
});
