#!/usr/bin/env node
/**
 * Post-build assertion: the webfonts are actually in the bundle.
 *
 * This exists because the failure it catches is invisible everywhere else. When
 * Tailwind ran through PostCSS, dewey-ui's `@import "@fontsource-variable/geist"`
 * was inlined with its `url(./files/*.woff2)` left package-relative, so Vite
 * emitted no font files and rewrote no paths. The build succeeded, `tsc` passed,
 * 586 unit tests passed, Playwright passed — and every font request 503'd in
 * production, including kantumruy-pro, the Khmer face this workforce's names are
 * written in. `font-display: swap` meant the page rendered in a fallback rather
 * than visibly breaking, so nothing surfaced it for as long as it shipped.
 *
 * Two independent checks, because either alone can pass while the bundle is wrong:
 * a stylesheet with no @font-face at all emits no files and would satisfy a
 * "no unrewritten urls" check; and files can be emitted while the CSS still
 * points somewhere else.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Which bundle(s) to check come from argv, because the two builds finish at
// different times: `npm run build` checks hr_attendance before the miniapp
// build has even started. No argument means both — the standalone invocation.
// This guard was hardcoded to hr_attendance for its first year, which left
// the Mini App bundle — the one whose users' names are ALL in Khmer —
// unguarded against the exact failure this file exists to catch.
// adms builds from frontend/adms with its own scripts, but its bundle lands in
// the same public/ layout and its Khmer face matters just as much — its
// build:frappe invokes this with "adms" after publishing.
const KNOWN = ["hr_attendance", "miniapp", "adms"];
const requested = process.argv.slice(2);
const bad = requested.filter((b) => !KNOWN.includes(b));
if (bad.length) {
  console.error(`\n  check-fonts: unknown bundle(s) ${bad.join(", ")} — expected ${KNOWN.join(" | ")}\n`);
  process.exit(1);
}
const bundles = requested.length ? requested : KNOWN;

const fail = (bundle, message) => {
  console.error(`\n  check-fonts [${bundle}]: ${message}\n`);
  process.exit(1);
};

for (const bundle of bundles) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), `../../../public/${bundle}`);
  const assets = join(outDir, "assets");
  const cssPath = join(assets, "index.css");

  if (!existsSync(cssPath)) fail(bundle, `no stylesheet at ${cssPath} — did the build run?`);

  const css = readFileSync(cssPath, "utf8");
  const emitted = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith(".woff2")) : [];

  // 1. Every url() the stylesheet references must have been rewritten off its
  //    package-relative form. This is the exact shape of the shipped defect.
  const unrewritten = [...css.matchAll(/url\(\.\/files\/[^)]+\)/g)].map((m) => m[0]);
  if (unrewritten.length > 0) {
    fail(
      bundle,
      `${unrewritten.length} font url(s) were never rewritten and will 404/503 at runtime:\n` +
        unrewritten.map((u) => `    ${u}`).join("\n") +
        `\n  Tailwind must run through @tailwindcss/vite, not @tailwindcss/postcss.`,
    );
  }

  // 2. Every font the stylesheet asks for was actually emitted. Counting faces
  //    would not do: a rewritten url pointing at a file the build never wrote is
  //    still a 404, and looks identical in the CSS to one that resolves.
  //    Filenames are content-hashed, and that is no obstacle: the hash is in
  //    the CSS reference and on the emitted file alike, so they still match.
  const referenced = [...css.matchAll(/url\(([^)]*\.woff2)[^)]*\)/g)].map((m) =>
    m[1].replace(/["']/g, "").split("/").pop(),
  );
  if (referenced.length === 0) fail(bundle, "the stylesheet references no .woff2 at all — the fonts were dropped.");

  const missing = [...new Set(referenced)].filter((f) => !emitted.includes(f));
  if (missing.length > 0) {
    fail(
      bundle,
      `the stylesheet references ${missing.length} font file(s) the build never emitted:\n` +
        missing.map((f) => `    ${f}`).join("\n"),
    );
  }

  // Khmer is not optional here: employee names are written in it, and a fallback
  // face changes their vertical metrics enough to clip stacked diacritics.
  if (!emitted.some((f) => f.includes("kantumruy"))) {
    fail(bundle, `no Kantumruy Pro (Khmer) font emitted. Got: ${emitted.join(", ")}`);
  }

  console.log(
    `  check-fonts [${bundle}]: ${emitted.length} woff2 emitted, ` +
      `${new Set(referenced).size} referenced, all present and rewritten.`,
  );
}
