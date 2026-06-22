# Dewey Time Brand Layer — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Dewey brand layer (green + signal tokens + motion + "Dewey Time" wordmark) and a new clock-dial app mark into the HR attendance SPA, with no per-screen restyle and no deploy.

**Architecture:** Copy the portable Dewey brand assets into `src/brand/`, import them after dewey-ui so a single `--brand-primary` knob retints `--primary`/`--ring`. Replace the header icon+title with a tested `DeweyTimeWordmark`. Add a transparent, color-scheme-adaptive clock-dial SVG and repoint the app-switcher tile + Dewey Time SPA favicons to it (DI-logo stays for Desk/website/adms).

**Tech Stack:** React 19 + Vite 6 + TypeScript + TailwindCSS v4 + `@lolbikb/dewey-ui`; tests via `node:test` run through `tsx` (`react-dom/server` `renderToStaticMarkup` for components — no DOM deps).

## Global Constraints

- **Test harness:** `node:test` via `tsx` only — **add no new dependencies** (no vitest/jsdom/testing-library; a fresh `npm install` hits a 401 on the private `@lolbikb` registry). Components are tested with `renderToStaticMarkup` from `react-dom/server` (already present). Verified: tsconfig is `"jsx": "react-jsx"`, and quoted globs that match nothing are tolerated.
- **Working branch:** `main` (default workflow — push straight to main, no PR unless asked). Commit locally per task; **do not push or deploy** in Phase 1.
- **Light-only:** override only the light `:root`. Do not touch dewey-ui's `.dark` block.
- **Internal desktop tool:** the touch-shell block in `base.css` stays commented out (it ships commented; copy verbatim).
- **Brand cascade:** brand layer imports MUST come after `@import "@lolbikb/dewey-ui/theme.css"`.
- **One knob:** the green is provisional and lives only in `--brand-primary` (`src/brand/tokens.css`).
- **App-scoped favicon:** the dial is the app-switcher tile + the favicon for `hr-attendance` / `hr-schedule` / `hr-personal`. `DI-logo.svg` stays for `app_logo_url` (Desk), `website_context` (favicon/splash), and `www/adms.html`.
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **All paths below are relative to the SPA package dir** `dewey_time/frontend/hr_attendance/` unless they start with `../../` (which reaches the Python package root `dewey_time/`). Run all `npm`/`npx` commands from the SPA package dir.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/brand/tokens.css` | The brand knob: green/ring/orange → dewey-ui `--primary`/`--ring` | Create (verbatim) |
| `src/brand/base.css` | Motion choreography + tactile press (touch-shell commented) | Create (verbatim) |
| `src/brand/Wordmark.tsx` | Generic wordmark-as-logo component | Create (verbatim) |
| `src/brand/DeweyTimeWordmark.tsx` | The Dewey Time mark (green D / orange T) — single source of truth | Create |
| `src/index.css` | Tailwind entry; adds brand imports after dewey-ui | Modify |
| `src/ui/HrAppShell.tsx` | Header chrome; swaps icon+title → wordmark | Modify |
| `public/images/dewey-time.svg` | The clock-dial app mark (adaptive light/dark) | Create |
| `src/lib/brand.ts` | TS branding paths | Modify |
| `index.html` | Vite root; SPA favicon source of truth | Modify |
| `../../www/hr-personal.html` | Hand-maintained SPA page favicon | Modify |
| `../../utils/sync_hr_attendance_assets.py` | Python branding constants + `_BRANDING_FILES` | Modify |
| `public/images/attendance-svgrepo-com.svg` | Old header/tile icon | Delete |
| `package.json` | Adds `src/brand/**` to the test glob | Modify |
| `src/brand/brandLayer.test.ts` | Guard: brand imports after dewey-ui; brand files exist | Create |
| `src/brand/DeweyTimeWordmark.test.tsx` | Render test: accessible name + two-tone tint | Create |
| `src/brand/brandWiring.test.ts` | Guards: dial asset, favicon/tile wiring, old icon retired | Create |

---

### Task 1: Brand CSS layer + import wiring + test runner

**Files:**
- Create: `src/brand/tokens.css`, `src/brand/base.css`
- Modify: `src/index.css`, `package.json`
- Test: `src/brand/brandLayer.test.ts`

**Interfaces:**
- Produces: `src/brand/tokens.css` (defines `--brand-primary`, `--brand-ring`, `--brand-accent`, and overrides `--primary`/`--primary-foreground`/`--ring`), `src/brand/base.css` (motion). The `npm run test:web` script now also runs `src/brand/*.test.ts` and `src/brand/*.test.tsx`.

- [ ] **Step 1: Broaden the test glob.** In `package.json`, replace the `test:web` script:

```json
"test:web": "tsx --test \"src/lib/*.test.ts\" \"src/brand/*.test.ts\" \"src/brand/*.test.tsx\"",
```

- [ ] **Step 2: Write the failing guard test** at `src/brand/brandLayer.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

test("brand layer is imported after dewey-ui and its files exist", () => {
  const css = readFileSync("src/index.css", "utf8");
  const dewey = css.indexOf("@lolbikb/dewey-ui/theme.css");
  const tokens = css.indexOf("./brand/tokens.css");
  const base = css.indexOf("./brand/base.css");

  assert.ok(dewey !== -1, "dewey-ui theme import present");
  assert.ok(tokens !== -1, "brand tokens import present");
  assert.ok(base !== -1, "brand base import present");
  assert.ok(tokens > dewey, "tokens.css imported AFTER dewey-ui theme");
  assert.ok(base > dewey, "base.css imported AFTER dewey-ui theme");

  assert.ok(existsSync("src/brand/tokens.css"), "tokens.css file exists");
  assert.ok(existsSync("src/brand/base.css"), "base.css file exists");
});
```

- [ ] **Step 3: Run the test — verify it fails**

Run: `npm run test:web`
Expected: FAIL — `brand tokens import present` (index.css has no `./brand/tokens.css` yet). The existing `src/lib/*.test.ts` keep passing.

- [ ] **Step 4: Copy the brand CSS verbatim**

```bash
cp /Users/lolbikb/.claude/skills/dewey-design/tokens.css src/brand/tokens.css
cp /Users/lolbikb/.claude/skills/dewey-design/base.css   src/brand/base.css
```

- [ ] **Step 5: Wire the imports** in `src/index.css` — add the two brand imports immediately after the dewey-ui theme import. The file becomes:

```css
/* Tailwind v4 entrypoint */
@import "tailwindcss";

/* shadcn/ui extras */
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Canonical design tokens (palette, Geist, radius scale, dark variant) come
   from the shared Dewey design system — do not redeclare them here. */
@import "@lolbikb/dewey-ui/theme.css";

/* Dewey brand layer — MUST come after dewey-ui so the green wins the cascade. */
@import "./brand/tokens.css";
@import "./brand/base.css";

/* Tailwind must scan the package for the primitives' utility classes. */
@source "../node_modules/@lolbikb/dewey-ui/dist";
```

- [ ] **Step 6: Run the test — verify it passes**

Run: `npm run test:web`
Expected: PASS (all existing lib tests + the new guard).

- [ ] **Step 7: Commit**

```bash
git add src/brand/tokens.css src/brand/base.css src/index.css src/brand/brandLayer.test.ts package.json
git commit -m "feat(brand): wire Dewey brand layer (tokens + motion) after dewey-ui

Provisional Forest green via the single --brand-primary knob; motion
choreography from base.css. Guard test asserts brand imports land after
dewey-ui so the cascade override holds. Touch-shell stays commented (internal
desktop tool).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wordmark + DeweyTimeWordmark + render test

**Files:**
- Create: `src/brand/Wordmark.tsx` (verbatim), `src/brand/DeweyTimeWordmark.tsx`
- Test: `src/brand/DeweyTimeWordmark.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DeweyTimeWordmark` — a zero-prop component (`export function DeweyTimeWordmark(): JSX.Element`) rendering the generic `Wordmark` with `words=[['D','ewey '],['T','ime']]`, `title="Dewey Time"`, and `tint=(i)=> i===0 ? 'var(--brand-primary)' : 'var(--brand-accent)'`. Task 3 consumes it as the `AppShell` logo.

- [ ] **Step 1: Write the failing render test** at `src/brand/DeweyTimeWordmark.test.tsx`:

```tsx
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { DeweyTimeWordmark } from "./DeweyTimeWordmark";

test("renders the Dewey Time mark with green D, orange T, accessible name", () => {
  const html = renderToStaticMarkup(<DeweyTimeWordmark />);

  // Accessible name on the mark
  assert.match(html, /aria-label="Dewey Time"/);
  // Both tints present, green (D) before orange (T)
  const green = html.indexOf("color:var(--brand-primary)");
  const orange = html.indexOf("color:var(--brand-accent)");
  assert.ok(green !== -1, "green tint applied");
  assert.ok(orange !== -1, "orange tint applied");
  assert.ok(green < orange, "green D precedes orange T");
  // Full name is present in the markup (collapsed tails included)
  assert.match(html, /Dewey/);
  assert.match(html, /Time/);
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm run test:web`
Expected: FAIL — cannot resolve `./DeweyTimeWordmark` (module not created yet).

- [ ] **Step 3: Copy the generic Wordmark verbatim**

```bash
cp /Users/lolbikb/.claude/skills/dewey-design/Wordmark.tsx src/brand/Wordmark.tsx
```

- [ ] **Step 4: Create the Dewey Time mark** at `src/brand/DeweyTimeWordmark.tsx`:

```tsx
import { Wordmark } from "./Wordmark";

/**
 * The Dewey Time house mark: monospace "DT" that expands to "Dewey Time" on
 * hover, D in brand green, T in brand orange. Single source of truth for the
 * header logo — keep the words/tint here, not inline in the shell.
 */
export function DeweyTimeWordmark() {
  return (
    <Wordmark
      words={[
        ["D", "ewey "],
        ["T", "ime"],
      ]}
      title="Dewey Time"
      tint={(i) => (i === 0 ? "var(--brand-primary)" : "var(--brand-accent)")}
    />
  );
}
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `npm run test:web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/brand/Wordmark.tsx src/brand/DeweyTimeWordmark.tsx src/brand/DeweyTimeWordmark.test.tsx
git commit -m "feat(brand): add Wordmark + DeweyTimeWordmark (green D / orange T)

Generic Wordmark copied verbatim from the dewey-design skill; DeweyTimeWordmark
wraps it with the Dewey Time words + explicit two-tone tint (the component's
default tint would leave a two-word name with no orange). Render-tested via
react-dom/server.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Swap the header icon+title for the wordmark

**Files:**
- Modify: `src/ui/HrAppShell.tsx`
- Test: `src/brand/brandWiring.test.ts` (created here; extended in Tasks 4–5)

**Interfaces:**
- Consumes: `DeweyTimeWordmark` from Task 2.
- Produces: `HrAppShell` renders `logo={<DeweyTimeWordmark />}`, no `title`, no `APP_LOGO` import, no `<img>`.

- [ ] **Step 1: Write the failing wiring guard** at `src/brand/brandWiring.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("HrAppShell uses the wordmark, not the old image logo/title", () => {
  const shell = readFileSync("src/ui/HrAppShell.tsx", "utf8");
  assert.match(shell, /DeweyTimeWordmark/, "uses DeweyTimeWordmark");
  assert.ok(!shell.includes("APP_LOGO"), "drops the APP_LOGO import/usage");
  assert.ok(!shell.includes("<img"), "no <img> logo in the header");
  assert.ok(!shell.includes('title="Dewey Time"'), "drops the text title");
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm run test:web`
Expected: FAIL — `uses DeweyTimeWordmark` (HrAppShell still imports `APP_LOGO` and renders `<img>` + `title="Dewey Time"`).

- [ ] **Step 3: Edit `src/ui/HrAppShell.tsx`.** Replace the brand import (line 7):

```tsx
import { APP_LOGO } from "@/lib/brand";
```
with:
```tsx
import { DeweyTimeWordmark } from "@/brand/DeweyTimeWordmark";
```

Then replace the `logo`/`title` props (the current block is):

```tsx
      logo={
        <img src={APP_LOGO} alt="" className="size-6 shrink-0 rounded-sm" width={24} height={24} />
      }
      title="Dewey Time"
```
with:
```tsx
      logo={<DeweyTimeWordmark />}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npm run test:web`
Expected: PASS.

- [ ] **Step 5: Typecheck the edited shell**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `HrAppShell.tsx` or `DeweyTimeWordmark` (the dropped `APP_LOGO` import is gone, the new import resolves via the `@ → ./src` alias). If pre-existing unrelated errors appear, confirm they are not in the files this task touched.

- [ ] **Step 6: Commit**

```bash
git add src/ui/HrAppShell.tsx src/brand/brandWiring.test.ts
git commit -m "feat(brand): replace header icon+title with the Dewey Time wordmark

The AppShell logo slot now renders <DeweyTimeWordmark/> (type-as-mark, no
chrome icon per the Dewey language); the 'Dewey Time' text title is dropped.
Guard test asserts the swap.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add the Dewey Time dial SVG

**Files:**
- Create: `public/images/dewey-time.svg`
- Test: extend `src/brand/brandWiring.test.ts`

**Interfaces:**
- Produces: `public/images/dewey-time.svg` — published at `/assets/dewey_time/images/dewey-time.svg` by the existing branding sync.

- [ ] **Step 1: Add the failing asset guard** — append to `src/brand/brandWiring.test.ts`:

```ts
import { existsSync } from "node:fs";

test("Dewey Time dial SVG exists and is the adaptive clock mark", () => {
  const p = "../../public/images/dewey-time.svg";
  assert.ok(existsSync(p), "public/images/dewey-time.svg present");
  const svg = readFileSync(p, "utf8");
  assert.match(svg, /<circle[^>]*r="32"/, "has the dial ring (r=32)");
  assert.match(svg, /prefers-color-scheme:\s*dark/, "has the light/dark swap");
  assert.match(svg, /#066031/, "Forest green present");
  assert.match(svg, /#C2410C/i, "brand orange present");
});
```

> Note: move the `existsSync` import up into the existing top-of-file import from `node:fs` instead of a second import line if your linter objects — i.e. `import { readFileSync, existsSync } from "node:fs";`.

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm run test:web`
Expected: FAIL — `public/images/dewey-time.svg present` (file not created yet).

- [ ] **Step 3: Create `public/images/dewey-time.svg`:**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="Dewey Time">
  <style>
    .ring, .hand-h { stroke: #066031; }
    .pivot { fill: #066031; }
    .hand-m { stroke: #C2410C; }
    @media (prefers-color-scheme: dark) {
      .ring, .hand-h { stroke: #3f9168; }
      .pivot { fill: #3f9168; }
      .hand-m { stroke: #F4A24B; }
    }
  </style>
  <circle class="ring"   cx="48" cy="48" r="32" fill="none" stroke-width="8"/>
  <line   class="hand-h" x1="48" y1="48" x2="35" y2="41" stroke-width="8" stroke-linecap="round"/>
  <line   class="hand-m" x1="48" y1="48" x2="66" y2="38" stroke-width="8" stroke-linecap="round"/>
  <circle class="pivot"  cx="48" cy="48" r="4.5"/>
</svg>
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npm run test:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/images/dewey-time.svg src/brand/brandWiring.test.ts
git commit -m "feat(brand): add Dewey Time clock-dial app mark (dewey-time.svg)

Transparent ring-only dial, hands at 10:10, with an embedded prefers-color-scheme
swap (Forest green / brand orange on light; lighter green / brightened orange on
dark) so it stays sharp on any browser chrome without a tile.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Repoint the app mark + SPA favicon to the dial; retire the old icon

**Files:**
- Modify: `src/lib/brand.ts`, `index.html`, `../../www/hr-personal.html`, `../../utils/sync_hr_attendance_assets.py`
- Delete: `public/images/attendance-svgrepo-com.svg`
- Test: extend `src/brand/brandWiring.test.ts`

**Interfaces:**
- Consumes: `dewey-time.svg` from Task 4.
- Produces: app-switcher tile (`ATTENDANCE_APP_LOGO`/`HR_APP_LOGO`) + `hr-attendance`/`hr-schedule`/`hr-personal` favicons resolve to the dial; `attendance-svgrepo-com.svg` no longer exists or is referenced.

- [ ] **Step 1: Add the failing wiring/retire guards** — append to `src/brand/brandWiring.test.ts`:

```ts
const DIAL = "dewey-time.svg";
const OLD = "attendance-svgrepo-com.svg";

test("app mark + Dewey Time SPA favicons point at the dial", () => {
  assert.match(readFileSync("src/lib/brand.ts", "utf8"), new RegExp(DIAL), "brand.ts → dial");
  assert.match(readFileSync("index.html", "utf8"), new RegExp(DIAL), "Vite index.html favicon → dial");
  assert.match(readFileSync("../../www/hr-personal.html", "utf8"), new RegExp(DIAL), "hr-personal favicon → dial");

  const py = readFileSync("../../utils/sync_hr_attendance_assets.py", "utf8");
  assert.match(py, new RegExp(`HR_APP_LOGO\\s*=\\s*"[^"]*${DIAL}"`), "HR_APP_LOGO → dial");
  assert.match(py, new RegExp(`_BRANDING_FILES[\\s\\S]{0,80}${DIAL}`), "_BRANDING_FILES has the dial");
});

test("attendance-svgrepo icon fully retired", () => {
  for (const p of [
    "src/lib/brand.ts",
    "src/ui/HrAppShell.tsx",
    "index.html",
    "../../www/hr-personal.html",
    "../../utils/sync_hr_attendance_assets.py",
  ]) {
    assert.ok(!readFileSync(p, "utf8").includes(OLD), `${p} free of ${OLD}`);
  }
  assert.ok(!existsSync("public/images/attendance-svgrepo-com.svg"), "old SVG deleted");
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `npm run test:web`
Expected: FAIL — `brand.ts → dial` (constants/HTML still reference DI-logo / attendance-svgrepo).

- [ ] **Step 3: Edit `src/lib/brand.ts`** — repoint the app logo (leave `SITE_FAVICON` = DI-logo):

```ts
export const HR_APP_LOGO = "/assets/dewey_time/images/dewey-time.svg";
```

- [ ] **Step 4: Edit `index.html`** — change the favicon `href` (keep `rel="icon" type="image/svg+xml"`):

```html
      href="/assets/dewey_time/images/dewey-time.svg"
```

- [ ] **Step 5: Edit `../../www/hr-personal.html`** — change its favicon `href` the same way:

```html
      href="/assets/dewey_time/images/dewey-time.svg"
```

- [ ] **Step 6: Edit `../../utils/sync_hr_attendance_assets.py`** — repoint the app logo and the synced-files list:

```python
HR_APP_LOGO = "/assets/dewey_time/images/dewey-time.svg"
```
and
```python
_BRANDING_FILES = ("DI-logo.svg", "dewey-time.svg")
```

- [ ] **Step 7: Delete the retired asset**

```bash
git rm public/images/attendance-svgrepo-com.svg
```

- [ ] **Step 8: Run the test — verify it passes**

Run: `npm run test:web`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/brand.ts index.html ../../www/hr-personal.html ../../utils/sync_hr_attendance_assets.py src/brand/brandWiring.test.ts
git commit -m "feat(brand): point app tile + Dewey Time SPA favicons at the dial; retire old icon

App-switcher tile (ATTENDANCE_APP_LOGO/HR_APP_LOGO) and the hr-attendance/
hr-schedule/hr-personal favicons now resolve to dewey-time.svg; DI-logo stays
for Desk (app_logo_url), website favicon/splash, and adms. attendance-svgrepo
is removed. (www/hr-attendance.html + www/hr-schedule.html are build-generated
from index.html and update in Task 6.)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Tune the green live, build, and commit the bundle + generated pages

**Files:**
- Modify (maybe): `src/brand/tokens.css` (`--brand-primary` final value)
- Generated: `public/hr_attendance/**`, `../../www/hr-attendance.html`, `../../www/hr-schedule.html`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: the built bundle (with the final green baked into `assets/index.css`) and the regenerated `www/*` SPA pages carrying the dial favicon.

- [ ] **Step 1: Run the SPA in dev and verify live**

Run: `npm run dev:hr`
Open `http://localhost:8080`. Confirm: primary buttons + focus rings are Forest green; the header shows the **Dewey Time** wordmark (DT → expands on hover, D green / T orange); dialogs/sheets/popovers animate; the browser tab favicon is the dial. Stop the dev server when done (Ctrl-C).

- [ ] **Step 2: HUMAN CHECKPOINT — tune the green.** Ask the user whether the Forest green is right. If not, edit **only** `--brand-primary` in `src/brand/tokens.css` and re-check on the dev server (HMR). Repeat until approved. (One knob; nothing else changes.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `vite build` succeeds, then `Copied .../public/hr_attendance/index.html -> .../www/hr-attendance.html, .../www/hr-schedule.html (build v=...)`. The brand layer is now bundled into `public/hr_attendance/assets/index.css`.

- [ ] **Step 4: Verify the favicon propagated to the generated pages**

Run: `grep -l "dewey-time.svg" ../../www/hr-attendance.html ../../www/hr-schedule.html`
Expected: both files listed. Also confirm `../../www/adms.html` still references `DI-logo.svg` (untouched):
Run: `grep -c "DI-logo.svg" ../../www/adms.html`
Expected: `1`.

- [ ] **Step 5: Run the full unit suite once more**

Run: `npm run test:web`
Expected: PASS (all guards + render test + existing lib tests).

- [ ] **Step 6: Commit the built artifacts**

```bash
git add src/brand/tokens.css public/hr_attendance ../../www/hr-attendance.html ../../www/hr-schedule.html
git commit -m "build(brand): bundle the brand layer + propagate the dial favicon

Final --brand-primary baked into the built CSS; www/hr-attendance.html and
www/hr-schedule.html regenerated from index.html with the dewey-time.svg
favicon. Verified live on npm run dev:hr. Not pushed/deployed (Phase 1).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Final status.** Phase 1 complete on `main`, local commits only. Report the commit range and remind that pushing/deploying is a separate, deliberate step (prod is Frappe v16; sequence with the PR #4 after-migrate fix). Phase 2 (per-screen conformance sweep) is the next spec.

---

## Notes for the implementer

- **Why `renderToStaticMarkup` and not testing-library?** Adding a DOM test stack needs an `@lolbikb`-registry `npm install` that 401s without a GitHub PAT. The existing `node:test`+`tsx` runner renders pure components to a string with zero new deps — confirmed working with this repo's `jsx: react-jsx` tsconfig.
- **Don't hand-edit `www/hr-attendance.html` / `www/hr-schedule.html`.** They are overwritten by `scripts/copy-html-entry.mjs` on build; the favicon comes from `index.html`. Only `www/hr-personal.html` is hand-maintained.
- **The green is provisional.** It lives only in `src/brand/tokens.css` `--brand-primary`. Retune there; never sprinkle greens elsewhere.
- **Out of scope:** per-screen restyle, applying the orange urgent signal to specific flags, and any deploy — those are Phase 2/3.
