import assert from "node:assert/strict";
import test from "node:test";

import { IS_DEV_BUILD } from "./devBuild";

test("IS_DEV_BUILD is false when import.meta.env is absent", () => {
  // Under `tsx --test` there is no Vite, so `import.meta.env` is undefined.
  // That is deliberate and load-bearing: it makes the test environment behave
  // exactly like a production build, which is what lets the render tests in
  // devControlsHidden.test.tsx assert absence without mocking anything.
  //
  // It is also why devBuild.ts uses `import.meta.env?.DEV`. Without the
  // optional chain this import alone would throw a TypeError.
  assert.equal(IS_DEV_BUILD, false);
});

test("IS_DEV_BUILD is a boolean, not a truthy value", () => {
  // Boolean() rather than a bare read: `import.meta.env?.DEV` is `undefined`
  // here, and a component doing `if (!X) return null` on undefined works by
  // accident. Pinning the type keeps the constant honest for any future
  // consumer that renders it or compares with ===.
  assert.equal(typeof IS_DEV_BUILD, "boolean");
});
