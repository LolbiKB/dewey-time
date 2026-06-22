import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("brand layer is imported after dewey-ui and its files exist", () => {
  const css = readFileSync(resolve(PKG, "src/index.css"), "utf8");
  const dewey = css.indexOf("@lolbikb/dewey-ui/theme.css");
  const tokens = css.indexOf("./brand/tokens.css");
  const base = css.indexOf("./brand/base.css");

  assert.ok(dewey !== -1, "dewey-ui theme import present");
  assert.ok(tokens !== -1, "brand tokens import present");
  assert.ok(base !== -1, "brand base import present");
  assert.ok(tokens > dewey, "tokens.css imported AFTER dewey-ui theme");
  assert.ok(base > dewey, "base.css imported AFTER dewey-ui theme");

  assert.ok(existsSync(resolve(PKG, "src/brand/tokens.css")), "tokens.css file exists");
  assert.ok(existsSync(resolve(PKG, "src/brand/base.css")), "base.css file exists");
});

test("brand tokens define the ring + accent signals and wire --ring", () => {
  const css = readFileSync(resolve(PKG, "src/brand/tokens.css"), "utf8");
  assert.match(css, /--brand-ring:\s*oklch/, "defines --brand-ring (focus halo green)");
  assert.match(css, /--brand-accent:\s*#c2410c/i, "defines --brand-accent (International orange)");
  assert.match(css, /--ring:\s*var\(--brand-ring\)/, "wires dewey-ui --ring to --brand-ring");
  assert.match(css, /--color-brand-accent:\s*var\(--brand-accent\)/, "exposes --brand-accent as a Tailwind utility");
});
