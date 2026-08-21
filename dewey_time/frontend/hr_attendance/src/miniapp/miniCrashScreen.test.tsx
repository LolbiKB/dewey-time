/**
 * The screen an employee gets when the app cannot draw itself.
 *
 * Everything asserted here is a property the OLD screen violated: it was
 * English-only on a surface with a Khmer mode, it printed the JavaScript error
 * into the visible tree, it was sized 100vh inside a sheet that is not 100vh,
 * and it imported the design system — which is one of the things that can
 * break and take the crash screen down with it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MiniCrashScreen } from "@/miniapp/MiniCrashScreen";
import { ErrorBoundary } from "@/components/error-boundary";

const SRC = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * The same file with its comments removed.
 *
 * Both guards below failed on their first run against the file's own notes,
 * which name the very things they forbid — a file documenting why it does not
 * import the design system contains the words "@lolbikb/dewey-ui". A guard a
 * sentence can trip is a guard nobody can write a comment near.
 */
const CODE = (path: string) =>
  SRC(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("it speaks both languages, because there is nobody left to ask", () => {
  // The provider is inside the tree that just threw, and the SDK that reports
  // the reader's language may be the very thing that never loaded. Defaulting
  // to English hands an unreadable screen to the people least able to report
  // it — so this screen says it twice, Khmer first.
  const html = renderToStaticMarkup(<MiniCrashScreen onRetry={() => {}} />);
  assert.match(html, /អេក្រង់នេះមិនអាចបង្ហាញបានទេ/);
  assert.match(html, /This screen could not be shown/);
  assert.match(html, /ព្យាយាមម្តងទៀត/);
  assert.match(html, /Try again/);
});

test("both bodies carry the sentence the reader actually needs", () => {
  // These screens are read by somebody worried about being marked absent. A
  // failure with no reassurance is read as a failure of the RECORD.
  const html = renderToStaticMarkup(<MiniCrashScreen onRetry={() => {}} />);
  assert.match(html, /attendance record is not affected/);
  assert.match(html, /កំណត់ត្រាវត្តមានរបស់អ្នកមិនរងផលប៉ះពាល់ទេ/);
});

test("nothing technical reaches the screen", () => {
  // `{this.state.error.message}` was rendered into the visible tree — a stack
  // trace's worth of English sitting where the reassurance should be, on a
  // phone, in a factory. It goes to console.error and nowhere else.
  const code = CODE("./MiniCrashScreen.tsx");
  assert.ok(!/error\.message/.test(code), "the error text must not be rendered");
  assert.ok(!/props\.error/.test(code), "the screen does not take one at all");
});

test("it imports nothing that could have been what broke", () => {
  // A bad @lolbikb/dewey-ui release or a theme-token change is exactly the
  // crash this screen exists for. Re-importing the suspect inside the fallback
  // means the fallback throws too, React finds no boundary above it, and the
  // employee gets a blank sheet with no message at all.
  const src = CODE("./MiniCrashScreen.tsx");
  for (const forbidden of [
    "@/components/ui/button",
    "@lolbikb/dewey-ui",
    "@/lib/utils",
    "@/miniapp/MiniLocale",
  ]) {
    assert.ok(!src.includes(forbidden), `MiniCrashScreen must not import ${forbidden}`);
  }
  // And no hook that needs a provider — useT is the tempting one.
  assert.ok(!/useT\(/.test(src));
});

test("it is sized to Telegram's sheet, not to the viewport", () => {
  // h-screen is 100vh, which inside a Telegram sheet is taller than the sheet:
  // the retry button — the only control on the screen — sits below the fold.
  const html = renderToStaticMarkup(<MiniCrashScreen onRetry={() => {}} />);
  assert.match(html, /--tg-viewport-stable-height/);
  assert.ok(!/h-screen/.test(html));
});

test("the shared boundary still draws its own card when nobody passes a fallback", () => {
  // RENDERED, not grepped. The first version of this test was four regexes
  // over the source — including one that pinned a type annotation, which is
  // formatting rather than behaviour — for a component the test right below
  // it demonstrably CAN render. What matters is that the HR console's card is
  // untouched, and that is a render or it is nothing.
  const boundary = new ErrorBoundary({ children: null });
  boundary.state = { error: new Error("a payload nobody expected") };
  const html = renderToStaticMarkup(<>{boundary.render()}</>);

  assert.match(html, /Something went wrong/, "the HR card is still there");
  assert.match(html, /a payload nobody expected/, "and still shows the error, for HR");
  assert.match(html, /h-screen/, "sized for a desktop, which is who it is for");
});

test("the Mini App entry point wires its own screen in", () => {
  // A source read: main.tsx renders a React root at module scope, which no
  // node:test can drive. The wiring is the whole fix — the component alone
  // changes nothing.
  const src = SRC("./main.tsx");
  assert.match(src, /<ErrorBoundary fallback=\{[^}]*MiniCrashScreen/s);
});

test("the boundary renders a fallback in place of its own card", () => {
  // The class's own render(), driven directly. Not a subtree that throws:
  // renderToStaticMarkup has no error boundaries — it rethrows — so an
  // "ErrorBoundary catches a throwing child" test cannot exist in this suite,
  // and writing one that appears to would be worse than none.
  const boundary = new ErrorBoundary({
    children: null,
    fallback: (error, reload) => (
      <button type="button" onClick={reload}>
        replacement for {error.name}
      </button>
    ),
  });
  boundary.state = { error: new Error("secret internals") };

  const html = renderToStaticMarkup(<>{boundary.render()}</>);
  assert.match(html, /replacement for Error/);
  assert.ok(!/secret internals/.test(html), "and never the error's own words");
  // And the fallback is handed the reload, or the screen is a dead end.
  assert.match(html, /<button/);
});
