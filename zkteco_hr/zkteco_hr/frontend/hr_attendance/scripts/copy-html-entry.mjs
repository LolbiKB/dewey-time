import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../../..");
const builtHtmlPath = path.join(appRoot, "public/hr_attendance/index.html");
const targetHtmlPath = path.join(appRoot, "www/hr-attendance.html");

if (!fs.existsSync(builtHtmlPath)) {
  console.error(`Build output not found: ${builtHtmlPath}`);
  process.exit(1);
}

fs.copyFileSync(builtHtmlPath, targetHtmlPath);
console.log(`Copied ${builtHtmlPath} -> ${targetHtmlPath}`);
