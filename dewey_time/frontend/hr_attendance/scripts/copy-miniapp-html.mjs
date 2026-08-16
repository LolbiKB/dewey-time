import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../../..");
const builtHtml = path.join(appRoot, "public/miniapp/index.miniapp.html");
const builtCss = path.join(appRoot, "public/miniapp/assets/index.css");
const buildIdPath = path.join(appRoot, "public/miniapp/assets/build-id.txt");
const target = path.join(appRoot, "www/hr-me.html");

// The same trap copy-html-entry.mjs guards for the HR bundle: src/index.css's
// `@source "../node_modules/@lolbikb/dewey-ui/dist"` is a FILESYSTEM glob, and
// Tailwind does not walk up to a parent's node_modules the way JS resolution
// does. With no node_modules here, Tailwind scans nothing, emits a stylesheet
// with none of the design system's classes, and EXITS 0 WITH NO WARNING. That
// bundle is the deployed artifact — Frappe Cloud never rebuilds it — so it
// ships. This app's surface is smaller than the HR console's, so the floor is
// lower, but it is emphatically not zero.
const MIN_CSS_BYTES = 40_000;

if (!fs.existsSync(builtHtml)) {
  console.error(`Build output not found: ${builtHtml}`);
  process.exit(1);
}

const cssBytes = fs.existsSync(builtCss) ? fs.statSync(builtCss).size : 0;
if (cssBytes < MIN_CSS_BYTES) {
  console.error(
    `miniapp index.css is ${cssBytes} bytes, under the ${MIN_CSS_BYTES} byte floor — this build is missing its component styles.\n` +
      `Most likely cause: no node_modules at ${path.join(appRoot, "frontend/hr_attendance")}, so Tailwind's @source glob for @lolbikb/dewey-ui matched nothing.\n` +
      `Fix the install and rebuild; do NOT commit this bundle.`,
  );
  process.exit(1);
}

// sync_miniapp_assets compares this to decide whether sites/assets needs
// republishing, so a build that does not write it never reaches the browser.
const buildId = Date.now();
fs.writeFileSync(buildIdPath, `${buildId}\n`);

/**
 * Cache-bust the asset URLs, exactly as copy-html-entry.mjs does for the HR
 * bundle.
 *
 * This script wrote a build id from the beginning and never put it on the
 * URLs, so /hr-me served `assets/index.js` at a permanently stable path. The
 * bundle is immutable per deploy and served with far-future caching, so a
 * client that had ever loaded the Mini App kept the old one — and a Telegram
 * webview caches harder than a browser tab and has no reload button. The
 * symptom is the worst possible one: a deploy that verifiably shipped, with
 * the server returning the new bytes, and the app on the phone unchanged.
 * Confirmed live before this fix — the served bundle was byte-identical to
 * the new build while the app on screen was the old one.
 *
 * Throws rather than silently doing nothing if the markup it expects is not
 * there. A no-op replace would restore exactly the bug this exists to fix,
 * and the build would still exit 0.
 */
function injectAssetVersion(source) {
  const targets = [
    ['src="/assets/dewey_time/miniapp/assets/index.js"', "js"],
    ['href="/assets/dewey_time/miniapp/assets/index.css"', "css"],
  ];
  let out = source;
  for (const [needle, label] of targets) {
    if (!out.includes(needle)) {
      console.error(
        `miniapp html has no ${label} reference matching ${needle} — cache busting would be a silent no-op.\n` +
          `The vite output's asset naming has changed; update this script to match before shipping.`,
      );
      process.exit(1);
    }
    // Drop the closing quote, append the query, put the quote back.
    out = out.replace(needle, `${needle.slice(0, -1)}?v=${buildId}"`);
  }
  return out;
}

let html = injectAssetVersion(fs.readFileSync(builtHtml, "utf8"));
// Frappe renders www/*.html through Jinja, so the csrf token is injected the
// same way the HR pages do it.
html = html.replace(
  "</head>",
  '    <script>window.csrf_token = "{{ frappe.session.csrf_token }}";</script>\n  </head>',
);
fs.writeFileSync(target, html);
console.log(`Wrote ${target} (css ${cssBytes} bytes, build v=${buildId})`);
