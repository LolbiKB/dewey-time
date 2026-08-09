import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ResponsiveModal } from "./ResponsiveModal";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("ResponsiveModal renders nothing when closed (SSR-safe, portal not mounted)", () => {
  const html = renderToStaticMarkup(
    <ResponsiveModal open={false} onOpenChange={() => {}} title="Confirm">
      <p>body</p>
    </ResponsiveModal>,
  );
  assert.equal(html, "", "closed modal mounts no portal content");
});

/**
 * Why the `aria-describedby` guard is NOT in this file.
 *
 * 89f6cf07 made ResponsiveModal pass `aria-describedby={undefined}` when it has
 * no `description`, so Radix stops pointing at an element that never renders.
 * That is an attribute on the portalled content — and Radix's Portal renders
 * `null` until its mount effect has run, which `renderToStaticMarkup` never
 * does. So an OPEN modal produces the same empty string a closed one does, and
 * any assertion here about the attribute would pass by looking for markup that
 * was never emitted at all.
 *
 * This test pins that fact rather than leaving it as a comment: if the portal
 * ever renders server-side, this fails, and the check below becomes possible
 * here. Until then it lives in e2e/flags.spec.ts — "a modal with no description
 * does not claim to have one", which drives real Radix in a real browser
 * against both of this page's callers (the panel modal has no description, the
 * confirm modal has one).
 */
test("an open modal renders nothing here either, so attribute checks cannot live in this suite", () => {
  const withoutDescription = renderToStaticMarkup(
    <ResponsiveModal open onOpenChange={() => {}} title="Confirm">
      <p>body</p>
    </ResponsiveModal>,
  );
  const withDescription = renderToStaticMarkup(
    <ResponsiveModal open onOpenChange={() => {}} title="Confirm" description="why">
      <p>body</p>
    </ResponsiveModal>,
  );
  assert.equal(withoutDescription, "", "Radix's portal emits nothing under renderToStaticMarkup");
  assert.equal(withDescription, "", "and a description does not change that");
});

test("ResponsiveModal is adaptive: Dialog on desktop, bottom Sheet on mobile", () => {
  const src = readFileSync(resolve(PKG, "src/components/ResponsiveModal.tsx"), "utf8");
  assert.match(src, /useIsMobile/, "surface chosen from the sync mobile hook");
  assert.match(src, /side="bottom"/, "mobile leg is a bottom sheet");
  assert.match(src, /onOpenAutoFocus=\{\(e\) => e\.preventDefault\(\)\}/, "mobile suppresses autofocus (no keyboard pop)");
  assert.match(src, /max-h-\[min\(85dvh,42rem\)\]/, "bounded height cap with dvh + rem");
  assert.match(src, /env\(safe-area-inset-bottom\)/, "mobile sheet pads the home indicator");
  assert.match(src, /rounded-t-2xl/, "mobile sheet has a rounded top");
  assert.match(src, /SheetTitle/, "renders SheetTitle on the mobile leg");
  assert.match(src, /DialogTitle/, "renders DialogTitle on the desktop leg");
});
