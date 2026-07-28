import assert from "node:assert/strict";
import test from "node:test";

import { ErrorBoundary } from "@/components/error-boundary";

// The boundary's whole job is the static reducer — a render throw must become
// state rather than an unmount. Testing it directly avoids needing a DOM.
test("getDerivedStateFromError captures the error into state", () => {
  const err = new Error("payload shape changed");
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(err), { error: err });
});

test("the boundary renders children when there is no error", () => {
  const instance = new ErrorBoundary({ children: "ok" });
  instance.state = { error: null };
  assert.equal(instance.render(), "ok");
});
