/**
 * The one word on these sheets that came from the design system.
 *
 * Both bottom sheets are dismissed by an X whose accessible name was a
 * hardcoded English "Close" living in @lolbikb/dewey-ui — invisible to every
 * guard in this repo, because the Khmer e2e sweep reads innerText (which
 * excludes aria and sr-only text on other elements) and the source guards read
 * this app's files, which never contained the literal.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Sheet } from "@/components/ui/sheet";
import { MiniSheetClose } from "@/miniapp/MiniSheetClose";
import { MiniLocaleProvider } from "@/miniapp/MiniLocale";
import type { Locale } from "@/miniapp/miniStrings";

const SRC = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/**
 * Inside a `Sheet`, because the button is a Radix DialogClose and refuses to
 * render without the dialog context — which is the wiring this component
 * exists to keep, so the constraint is the point rather than a nuisance.
 */
function render(locale: Locale) {
  return renderToStaticMarkup(
    <MiniLocaleProvider locale={locale}>
      <Sheet open>
        <MiniSheetClose />
      </Sheet>
    </MiniLocaleProvider>,
  );
}

test("the close button says Close in English", () => {
  assert.match(render("en"), /<span class="sr-only">Close<\/span>/);
});

test("and បិទ in Khmer, which is the whole point", () => {
  const html = render("km");
  assert.match(html, /បិទ/);
  assert.ok(!/Close/.test(html), "no English word survives on a Khmer sheet");
});

test("it reproduces the design system's own button, not a different one", () => {
  // This is meant to BE the sheet close — same ghost icon button, same corner
  // — with one thing changed. A visually different X on the Mini App's sheets
  // would be a redesign nobody asked for, arriving through an a11y fix.
  const src = SRC("MiniSheetClose.tsx");
  assert.match(src, /variant="ghost"/);
  assert.match(src, /size="icon-sm"/);
  assert.match(src, /className="absolute top-3 right-3"/);
  // Through SheetClose, so Radix still owns the dismissal — a plain onClick
  // would need the sheet's state threaded down to it.
  assert.match(src, /<SheetClose asChild>/);
});

test("both sheets turn the design system's button off and render this one last", () => {
  // Two halves, and a half-done change is worse than none: showCloseButton
  // without the replacement leaves a sheet with no visible way out, and the
  // replacement without the flag leaves two X's in the same corner.
  for (const file of ["MiniCalendarSheet.tsx", "MiniFlagsSheet.tsx"]) {
    const src = SRC(file);
    assert.match(src, /showCloseButton=\{false\}/, `${file} keeps the DS button`);
    assert.match(
      src, /<MiniSheetClose \/>\s*<\/SheetContent>/,
      `${file} must render the replacement, last`,
    );
  }
});

test("the flags sheet has no other way out, which is why the button must exist", () => {
  // The calendar sheet at least has a grid to escape by. This one is a title
  // and a list: with showCloseButton={false} and no replacement, a reader
  // whose Telegram client draws no back button is stuck in it.
  const src = SRC("MiniFlagsSheet.tsx");
  assert.match(src, /MiniSheetClose/);
});
