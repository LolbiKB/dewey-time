/**
 * The SDK load, and the hang it exists to survive.
 *
 * Every case here was unreachable while the SDK was a `<script defer>` in the
 * head: the browser owned the request, and the app's only options were "it was
 * there" or "it was not". The one that matters is the third — a request that
 * neither succeeds nor fails — which left main.tsx fetched-but-never-executed
 * and the employee looking at nothing at all.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadTelegramSdk, SDK_TIMEOUT_MS, SDK_URL } from "@/miniapp/telegramSdk";

type FakeScript = {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
};

/** A document that hands back the script element and never touches the DOM. */
function fakeDoc() {
  const scripts: FakeScript[] = [];
  const doc = {
    createElement: () => {
      const script: FakeScript = { src: "", async: false, onload: null, onerror: null };
      return script;
    },
    head: { appendChild: (script: FakeScript) => scripts.push(script) },
  } as unknown as Document;
  return { doc, scripts };
}

test("an SDK already on the window is not fetched again", async () => {
  // A native client that injects it, and every test in the e2e suite. No
  // request, no wait, no timer.
  const { doc, scripts } = fakeDoc();
  const w = { Telegram: { WebApp: {} } } as unknown as Window;
  assert.equal(await loadTelegramSdk(w, doc), true);
  assert.equal(scripts.length, 0, "nothing was appended");
});

test("a loaded script resolves true, and the URL carries its cache key", async () => {
  const { doc, scripts } = fakeDoc();
  const w = {} as unknown as Window;
  const pending = loadTelegramSdk(w, doc);

  assert.equal(scripts.length, 1);
  assert.equal(scripts[0]!.src, SDK_URL);
  assert.match(scripts[0]!.src, /\?63$/, "the version stamp IS the cache key");
  assert.equal(scripts[0]!.async, true);

  (w as { Telegram?: unknown }).Telegram = { WebApp: {} };
  scripts[0]!.onload!();
  assert.equal(await pending, true);
});

test("a failed request resolves false rather than hanging the app", async () => {
  // 404, DNS failure, connection refused, offline. This half always worked,
  // because a settled request lets the app render — it is the reason the
  // "open this from Telegram" screen appeared at all.
  const { doc, scripts } = fakeDoc();
  const pending = loadTelegramSdk({} as unknown as Window, doc);
  scripts[0]!.onerror!();
  assert.equal(await pending, false);
});

test("a script that loads without defining the SDK is not counted as loaded", async () => {
  // A captive portal answering 200 with its own login page is a load event
  // over a body that defines nothing.
  const { doc, scripts } = fakeDoc();
  const pending = loadTelegramSdk({} as unknown as Window, doc);
  scripts[0]!.onload!();
  assert.equal(await pending, false);
});

test("A HANG IS SETTLED BY THE CLOCK — the case the old script tag could not survive", async () => {
  // Neither onload nor onerror ever fires. As a `<script defer>` this state
  // left the module script fetched and never executed: no React, no error
  // boundary, no notice, for as long as the socket stayed open.
  const { doc, scripts } = fakeDoc();
  const started = Date.now();
  const settled = await loadTelegramSdk({} as unknown as Window, doc, { timeoutMs: 40 });
  assert.equal(settled, false);
  assert.ok(Date.now() - started >= 35, "it waited, rather than giving up instantly");
  assert.equal(scripts[0]!.onload !== null, true, "and the script is still listening");
});

test("a script that lands after the timeout redraws the real app", async () => {
  // The other half of bounding the wait: a slow-but-working link would
  // otherwise be stuck on "didn't finish loading" with a retry button, for an
  // app that is now perfectly able to start.
  const { doc, scripts } = fakeDoc();
  const w = {} as unknown as Window;
  let redrawn = 0;
  const settled = await loadTelegramSdk(w, doc, { timeoutMs: 20, onLate: () => { redrawn += 1; } });
  assert.equal(settled, false);

  (w as { Telegram?: unknown }).Telegram = { WebApp: {} };
  scripts[0]!.onload!();
  assert.equal(redrawn, 1, "the late arrival is not wasted");
});

test("a late script that STILL does not define the SDK redraws nothing", () => {
  const { doc, scripts } = fakeDoc();
  let redrawn = 0;
  void loadTelegramSdk({} as unknown as Window, doc, { timeoutMs: 0, onLate: () => { redrawn += 1; } });
  scripts[0]!.onload!();
  assert.equal(redrawn, 0);
});

test("the timeout is long enough for a slow link and short enough to explain itself", () => {
  // Pinned because it is a judgement, not an implementation detail: the file
  // is ~116KB, and somebody staring at a placeholder deserves an answer while
  // they still care.
  assert.ok(SDK_TIMEOUT_MS >= 4000 && SDK_TIMEOUT_MS <= 10000, "the wait is bounded and humane");
});

test("the entry point never renders before the question is settled", () => {
  // A source pin: main.tsx creates a React root at module scope, which no
  // node:test can drive. Rendering first and correcting later would flash this
  // app's light theme at a dark client — and, worse, take Telegram's own
  // placeholder down before there is anything behind it.
  const code = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  assert.match(code, /loadTelegramSdk\(window, document, \{ onLate: draw \}\)\.then/);
  assert.match(code, /initTelegramChrome\(window, document\);\s*\n\s*draw\(\);\s*\n/);

  // And the tag stays gone. A `<script defer>` here is not a stylistic
  // preference: it shares an execution list with the module script, so a
  // hanging request stops the app from running at all.
  // Comments stripped first: the note left in that file QUOTES the tag it
  // removed, and a guard its own explanation can trip is a guard nobody can
  // write a comment near.
  const html = readFileSync(new URL("../../index.miniapp.html", import.meta.url), "utf8")
    .replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(
    !/<script[^>]*telegram-web-app\.js/.test(html),
    "the script tag must not come back — its execution order is the whole bug",
  );
});
