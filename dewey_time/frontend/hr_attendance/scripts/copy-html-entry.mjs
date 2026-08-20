import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../../..");
const builtHtmlPath = path.join(appRoot, "public/hr_attendance/index.html");
const targetHtmlPaths = [
  path.join(appRoot, "www/hr-attendance.html"),
  path.join(appRoot, "www/hr-schedule.html"),
  path.join(appRoot, "www/hr-flags.html"),
];
// hr-personal serves via the www convention like the others but keeps its own
// head (no PWA block), so it is re-STAMPED in place rather than overwritten.
// Leaving it out entirely froze its ?v= at a June build: warm caches kept
// serving a stylesheet whose font URLs no longer exist.
const restampHtmlPaths = [path.join(appRoot, "www/hr-personal.html")];
const buildIdPath = path.join(appRoot, "public/hr_attendance/assets/build-id.txt");
const builtCssPath = path.join(appRoot, "public/hr_attendance/assets/index.css");

// The full stylesheet is ~172 kB. A build that scanned no component sources emits
// ~90 kB — everything Tailwind generates from this app's own markup, and nothing
// from the design system. 150 kB sits well clear of both.
const MIN_CSS_BYTES = 150_000;

if (!fs.existsSync(builtHtmlPath)) {
  console.error(`Build output not found: ${builtHtmlPath}`);
  process.exit(1);
}

// A silently unstyled SPA is the worst failure this build can produce, because
// `vite build` reports success for it. src/index.css's
// `@source "../node_modules/@lolbikb/dewey-ui/dist"` is a FILESYSTEM glob, and
// Tailwind does not walk up to a parent's node_modules the way JS resolution
// does — so in a git worktree with no node_modules at
// dewey_time/frontend/hr_attendance/, Tailwind scans nothing, emits a stylesheet
// with none of the dewey-ui/shadcn classes, and EXITS 0 WITH NO WARNING. That
// bundle is the deployed artifact (Frappe Cloud never rebuilds it), so it ships.
// This already happened once on this branch.
const cssBytes = fs.existsSync(builtCssPath) ? fs.statSync(builtCssPath).size : 0;
if (cssBytes < MIN_CSS_BYTES) {
  console.error(
    `index.css is ${cssBytes} bytes, under the ${MIN_CSS_BYTES} byte floor — this build is missing its component styles.\n` +
      `Most likely cause: no node_modules at ${path.join(appRoot, "frontend/hr_attendance")}, so Tailwind's @source glob for @lolbikb/dewey-ui matched nothing.\n` +
      `Fix the install (or symlink node_modules into this worktree) and rebuild; do NOT commit this bundle.`
  );
  process.exit(1);
}

// Literal cache-bust token — do NOT use Jinja {{ }} here; see docs/HR_ATTENDANCE_DEPLOY.md
const buildId = String(Math.floor(Date.now() / 1000));

function injectAssetVersion(html) {
  return html
    .replace(
      'src="/assets/dewey_time/hr_attendance/assets/index.js"',
      `src="/assets/dewey_time/hr_attendance/assets/index.js?v=${buildId}"`
    )
    .replace(
      'href="/assets/dewey_time/hr_attendance/assets/index.css"',
      `href="/assets/dewey_time/hr_attendance/assets/index.css?v=${buildId}"`
    );
}

const html = injectAssetVersion(fs.readFileSync(builtHtmlPath, "utf8"));
fs.writeFileSync(builtHtmlPath, html);
for (const targetHtmlPath of targetHtmlPaths) {
  const scheduleHtml =
    targetHtmlPath.endsWith("hr-schedule.html")
      ? html.replace("<title>HR Attendance</title>", "<title>Weekly Schedule</title>")
      : html;
  fs.writeFileSync(targetHtmlPath, scheduleHtml);
}
for (const restampPath of restampHtmlPaths) {
  if (!fs.existsSync(restampPath)) continue;
  const own = fs.readFileSync(restampPath, "utf8");
  const restamped = own.replace(
    /(\/assets\/dewey_time\/hr_attendance\/assets\/index\.(?:js|css))(\?v=\d+)?/g,
    `$1?v=${buildId}`
  );
  if (!restamped.includes(`?v=${buildId}`)) {
    console.error(`Could not restamp asset versions in ${restampPath}`);
    process.exit(1);
  }
  fs.writeFileSync(restampPath, restamped);
}
fs.writeFileSync(buildIdPath, `${buildId}\n`);
console.log(
  `Copied ${builtHtmlPath} -> ${targetHtmlPaths.join(", ")} (build v=${buildId})`
);
