// Generate the PWA icon set from the Dewey Time dial.
//
// Dev-only, run on demand (not part of the build). It needs `sharp`, which is
// NOT a project dependency (the app's .npmrc scopes @lolbikb to GitHub Packages
// and a plain install would 401). Install it in a scratch dir and point NODE_PATH
// at it, e.g.:
//   d=$(mktemp -d) && (cd "$d" && npm i sharp >/dev/null) \
//     && NODE_PATH="$d/node_modules" node scripts/gen-pwa-icons.mjs
//
// Output: public/icons/*.png (Vite copies public/ into the build, surviving
// emptyOutDir). White substrate everywhere — the brand keeps color as signal,
// surfaces stay neutral (see dewey-design), so a green manifest/icon background
// would be off-brand.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const sharp = createRequire(import.meta.url)("sharp");
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

// The dial, in a 96-unit space (same geometry as public/images/dewey-time.svg,
// hands at 10:10). Fixed light colors — icons always sit on white.
const GREEN = "#066031";
const ORANGE = "#C2410C";
const DIAL = `
  <circle cx="48" cy="48" r="32" fill="none" stroke="${GREEN}" stroke-width="8"/>
  <line x1="48" y1="48" x2="35" y2="41" stroke="${GREEN}" stroke-width="8" stroke-linecap="round"/>
  <line x1="48" y1="48" x2="66" y2="38" stroke="${ORANGE}" stroke-width="8" stroke-linecap="round"/>
  <circle cx="48" cy="48" r="4.5" fill="${GREEN}"/>`;

/** size px square, white background, dial scaled to `scale` of the canvas, centred. */
function svg(size, scale) {
  const k = (size * scale) / 96;
  const off = (size - 96 * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#ffffff"/>
  <g transform="translate(${off} ${off}) scale(${k})">${DIAL}</g>
</svg>`;
}

// scale tuned per purpose: maskable keeps a wide safe-zone margin so circular /
// squircle masks never clip the dial; apple/any sit a touch larger.
const ICONS = [
  { file: "icon-192.png", size: 192, scale: 0.72 },
  { file: "icon-512.png", size: 512, scale: 0.72 },
  { file: "maskable-512.png", size: 512, scale: 0.56 },
  { file: "apple-touch-icon.png", size: 180, scale: 0.7 },
];

for (const { file, size, scale } of ICONS) {
  await sharp(Buffer.from(svg(size, scale)))
    .png({ compressionLevel: 9 })
    .toFile(resolve(OUT, file));
  console.log(`wrote ${file} (${size}px, dial ${Math.round(scale * 100)}%)`);
}
