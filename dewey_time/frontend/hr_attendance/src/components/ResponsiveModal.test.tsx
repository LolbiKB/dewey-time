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
