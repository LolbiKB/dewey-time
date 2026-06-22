# Phase 1 — Dewey Time brand layer + app mark

- **Date:** 2026-06-20
- **Status:** Approved (design) — pending spec review, then implementation plan
- **Scope:** Phase 1 of a 3-phase program to apply the Dewey design language to the HR attendance SPA (`frontend/hr_attendance/`).

## Background

The SPA imports dewey-ui's neutral substrate (`@lolbikb/dewey-ui/theme.css`) but **not** the Dewey *brand layer* — the green, the signal system, the motion choreography, or the wordmark. The header uses a generic icon + the text title "Dewey Time". This phase installs the brand-layer foundation and a purpose-designed app mark, so later phases (a per-screen conformance sweep; net-new surfaces) build on a real brand.

This spec covers **Phase 1 only** — one implementation plan's worth of work. Phases 2–3 get their own spec → plan → build cycles.

### Decisions captured (from brainstorming)

| Question | Decision |
|---|---|
| Overall goal | Apply Dewey to the whole app, **phased**; this is Phase 1 (foundation). |
| Change appetite | **Full brand layer in**, but the Forest green is **provisional** — land it, eyeball live, retune `--brand-primary` before it's final. |
| Audience / device | **HR staff, desktop** (internal tool). ⇒ no touch shell, English-only, compact density. |
| Header mark | **Wordmark-as-logo** — "Dewey Time" (DT), green D / orange T. Replaces the icon + title. |
| Tune-the-green path | **Local dev server** (`npm run dev:hr`) with HMR. No deploy. |
| Branding icon | A new **Dewey Time dial** mark (designed via the visual companion; see below). |
| Favicon scope | **App-scoped** — dial = app-switcher tile + Dewey Time SPA tab favicon; DI-logo keeps Desk, website favicon/splash, and adms. |

## Goal

Wire in the Dewey brand layer and a new app mark so that, after Phase 1:

- Primary buttons + focus rings render Forest green (one knob: `--brand-primary`).
- The header shows the **Dewey Time** wordmark instead of the icon + "Dewey Time".
- Dialogs / sheets / popovers / tooltips animate on the one house easing; action buttons get a tactile press.
- The **Dewey Time dial** is the app-switcher tile and the browser-tab favicon for the Dewey Time SPA pages.

## Non-goals (explicit)

- **No per-screen restyle** — App / WeekView / DayTimeline / FlagDetailPanel / WeeklySchedulePage / dialogs keep their current markup. Applying the orange signal to specific flags, fixing tinted surfaces, etc. is **Phase 2**.
- **No deploy** — Phase 1 lands as local commits and is verified locally (`npm run dev:hr`). Pushing/shipping is a separate, deliberate step (prod is Frappe v16; recent asset-outage history warrants care).
- **No dark mode** — the app is light-only. The brand layer only overrides the light `:root`; the dewey-ui `.dark` block is left untouched (nothing sets `.dark`).

## Design

### Part A — Brand layer

**New files (verbatim copies of the dewey-design skill assets):**

- `src/brand/tokens.css` — defines `--brand-primary` (Forest `oklch(0.43 0.108 153)`, provisional), `--brand-ring`, `--brand-accent` (`#c2410c`), and wires them into dewey-ui's `--primary` / `--primary-foreground` / `--ring`. The single brand knob.
- `src/brand/base.css` — motion choreography keyed to dewey-ui's Radix `data-slot` / `data-state`, the tactile button press, and the reduced-motion blanket-off. **The optional touch-shell block stays commented out** (internal desktop tool).
- `src/brand/Wordmark.tsx` — the generic wordmark component.

**`src/index.css`** — add the brand imports **after** dewey-ui so they win the cascade (dewey-ui is shadcn-v4: `@theme inline { --color-primary: var(--primary) }` over `:root { --primary: oklch(0.205 0 0) }`, so a later `:root` override of `--primary` retints every `bg-primary`/`ring` utility):

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@lolbikb/dewey-ui/theme.css";
@import "./brand/tokens.css";   /* AFTER dewey-ui — overrides --primary/--ring */
@import "./brand/base.css";     /* motion */
@source "../node_modules/@lolbikb/dewey-ui/dist";
```

**`src/ui/HrAppShell.tsx`** — replace the `logo={<img APP_LOGO>}` + `title="Dewey Time"` with the wordmark; keep `homeHref` (it links the mark home); drop the now-dead `APP_LOGO` import:

```tsx
logo={
  <Wordmark
    words={[['D', 'ewey '], ['T', 'ime']]}
    title="Dewey Time"
    tint={(i) => (i === 0 ? 'var(--brand-primary)' : 'var(--brand-accent)')}
  />
}
// `title` prop removed
```

> Note on the Wordmark `tint`: its default tints word index 1 green / index 2 orange — for a two-word name that would give D=plain, T=green, **no orange**. The explicit `tint` above is required to get the approved green-D / orange-T.

### Part B — Dewey Time dial mark

**New asset `public/images/dewey-time.svg`** — transparent ring-only dial, hands at 10:10, with an embedded `prefers-color-scheme` swap so it stays sharp on light or dark browser chrome without a tile:

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

**Wiring (app-scoped):**

- **App-switcher tile** — repoint the app-logo constant to the dial:
  - PY `utils/sync_hr_attendance_assets.py`: `ATTENDANCE_APP_LOGO` → `/assets/dewey_time/images/dewey-time.svg`; add `dewey-time.svg` to `_BRANDING_FILES`.
  - `hooks.py` `add_to_apps_screen[].logo` already references `ATTENDANCE_APP_LOGO`, so it follows automatically.
  - TS `src/lib/brand.ts`: `HR_APP_LOGO` / `APP_LOGO` → the dial path (kept for any remaining consumers; the header no longer uses it).
- **SPA tab favicon** — the `<link rel="icon">` lives in the Vite root `frontend/hr_attendance/index.html`. Changing the href there propagates through `npm run build` → `public/hr_attendance/index.html` → the generated `www/hr-attendance.html` + `www/hr-schedule.html` (via `scripts/copy-html-entry.mjs`, which only rewrites asset-version query strings + the page title — it does **not** touch the favicon). `www/hr-personal.html` is **not** generated by that script, so edit its `<link rel="icon">` directly. **Do not** change `www/adms.html`.
- **Keep DI-logo** for company surfaces: `app_logo_url` (Desk navbar), `website_context.favicon`/`splash_image`, and adms — unchanged.
- **Retire `attendance-svgrepo-com.svg`** — orphaned once the header uses the wordmark and the tile uses the dial. Remove the file and its entry in `_BRANDING_FILES`.

> Implementation note: `www/hr-attendance.html` + `www/hr-schedule.html` are **build-generated** from the Vite root `index.html` — edit that source and rebuild, never hand-edit those two (they'd be overwritten with a stale favicon). `public/hr_attendance/index.html` is likewise generated. `www/hr-personal.html` is hand-maintained and edited directly.

### Testing (TDD on the integration; assets are adopted verbatim)

- `src/brand/Wordmark.test.tsx` — accessible name = "Dewey Time"; both initials render collapsed; the custom `tint` puts `--brand-primary` on index 0 and `--brand-accent` on index 1.
- `HrAppShell` test — header exposes the "Dewey Time" accessible name and no longer renders the old `<img>` / "Dewey Time".
- `index.css` guard test — asserts `./brand/tokens.css` is imported **after** `@lolbikb/dewey-ui/theme.css` (regression guard for the exact cascade-order bug class).
- Branding guard — asserts the app-tile + SPA-favicon references resolve to `dewey-time.svg`, that the SVG exists, and that `attendance-svgrepo-com.svg` is no longer referenced.

### Verification workflow

Locally (on `main` per the default git workflow — push straight to main, no PR unless asked):

1. `npm run build` (typecheck) + `vitest` → green.
2. `npm run dev:hr` → eyeball the green / wordmark / motion / favicon live with HMR.
3. Retune `--brand-primary` together until the green is right.
4. **Only then commit.** Not pushed or deployed in Phase 1.

### Risks / watch-items

- **Tailwind v4 cascade** actually winning — verify the green renders live (structure says yes; confirm visually).
- **AppShell logo slot** not clipping/restyling the wider wordmark — visual check.
- **`font-mono`** resolving to Geist Mono vs a generic stack — acceptable either way; confirm.
- **SVG favicon `prefers-color-scheme`** support — modern evergreen browsers honor it; older ones fall back to the light colors (still legible on light chrome).
- **Retiring `attendance-svgrepo-com.svg`** — confirm no lingering reference (patches history touched it: `resync_*_v6/v7`); those are one-time, already-run patches and won't re-execute, but grep before deleting.

## Out of scope (future phases)

- **Phase 2 — conformance sweep:** screen-by-screen Dewey guardrail audit + fixes (tinted surfaces, color-as-decoration, destructive-as-green, missing `aria-label`s, ad-hoc motion), and applying the orange urgent signal to the right attendance flags.
- **Phase 3 — new surfaces:** anything net-new built in the Dewey language.
