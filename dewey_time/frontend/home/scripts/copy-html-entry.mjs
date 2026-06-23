import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../../..");
const builtHtmlPath = path.join(appRoot, "public/home/index.html");
const targetHtmlPaths = [
  path.join(appRoot, "www/home.html"),
];
const buildIdPath = path.join(appRoot, "public/home/assets/build-id.txt");

if (!fs.existsSync(builtHtmlPath)) {
  console.error(`Build output not found: ${builtHtmlPath}`);
  process.exit(1);
}

// Literal cache-bust token — do NOT use Jinja {{ }} here; see docs/HR_ATTENDANCE_DEPLOY.md
const buildId = String(Math.floor(Date.now() / 1000));

function injectAssetVersion(html) {
  return html
    .replace(
      'src="/assets/dewey_time/home/assets/index.js"',
      `src="/assets/dewey_time/home/assets/index.js?v=${buildId}"`
    )
    .replace(
      'href="/assets/dewey_time/home/assets/index.css"',
      `href="/assets/dewey_time/home/assets/index.css?v=${buildId}"`
    );
}

const html = injectAssetVersion(fs.readFileSync(builtHtmlPath, "utf8"));
fs.writeFileSync(builtHtmlPath, html);
for (const targetHtmlPath of targetHtmlPaths) {
  fs.writeFileSync(targetHtmlPath, html);
}
fs.writeFileSync(buildIdPath, `${buildId}\n`);
console.log(
  `Copied ${builtHtmlPath} -> ${targetHtmlPaths.join(", ")} (build v=${buildId})`
);
