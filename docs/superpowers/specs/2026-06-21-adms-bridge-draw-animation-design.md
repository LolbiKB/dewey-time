# ADMS Bridge — self-drawing logo animation

**Date:** 2026-06-21
**Status:** Approved (concept + execution validated via interactive preview)
**App:** `dewey_time/frontend/adms` (the `/adms` device-admin SPA)

## Goal

Give the ADMS Bridge dashboard the same calibre of branded motion DeweyTime has:
a launch **intro** animation and a **header-hover** replay, themed to the ADMS
Bridge house mark (the green lucide `Waypoints` glyph — a path bridging
device → Frappe).

## Decision (what the animation is)

**The logo draws itself onto a blank canvas** — a single continuous pen stroke
traces the whole Waypoints glyph (the four node rings + the three bridge
connectors) in route order **top → left → right → bottom**, as one
constant-speed line, with a small orange (`--signal-attention`) pen-tip leading
the draw. It settles into the finished green logo; then the "ADMS Bridge"
wordtext rises.

Rejected along the way (recorded so we don't relitigate):
- A pulse skimming a *pre-drawn* logo — not a "draw".
- A fat mask **wipe** revealing pre-existing art — reads as a wipe, not a precise pen.
- Per-stroke draw split across **8 staggered animations** — uneven velocity ⇒ janky.

**Why the chosen technique is smooth:** the entire glyph is ONE `<path>` (node
circles as twin 180° arcs, connectors as line segments, `M` jumps the small
node→connector gaps), animated by ONE linear `stroke-dashoffset` sweep. One
uniform-velocity animation = precise dash-draw with no stutter.

**Duration:** `--adms-draw-dur: 1.6s` (single knob).

## Components (all under `src/brand/`)

| File | Role |
|---|---|
| `AdmsBridgeMark.tsx` | **new** — the animated glyph: an inline SVG twin of `Waypoints` as ONE continuous path (`.adms-glyph`, green) + a leading `.adms-pen` (orange). `aria-hidden`. The shared path `d` is the single source of geometry. Motion is driven entirely by CSS classes — no JS animation lib. |
| `Brandmark.tsx` | **edit** — swap the static `<Waypoints/>` for `<AdmsBridgeMark/>`, wrap in a `group` so `.group:hover/:focus-visible` replays the draw. Already the header `logo`, so `App.tsx`'s shell wiring is unchanged. |
| `AdmsBridgeIntro.tsx` | **new** — full-screen overlay; phase machine `play → closing → done` (copied from `DeweyTimeIntro`); `sessionStorage` once-per-session; skippable on click; reduced-motion → no draw + brief crossfade. The inner container carries `.adms-draw` to trigger the mark's draw; wordtext rises via `.adms-intro-rise`. |
| `brand-motion.css` | **new** — `@keyframes adms-draw / adms-pen / adms-rise`, the `.adms-glyph/.adms-pen` base + triggers (`.adms-draw …`, `.group:hover …`), the `--adms-draw-dur` knob, and the `prefers-reduced-motion` guard. Imported by `index.css` right after `brand/tokens.css`. |

## Behavior

- **Intro timing:** mounts inside `AppContent`'s authenticated return (the
  `<div className="h-full">` wrapping `<AppShell>`), so it plays the first time
  the signed-in admin dashboard paints — never over the login / access-denied
  screens. Once per browser session, click-to-skip, reduced-motion safe.
- **Header hover:** hovering the brand lockup replays one draw (the analog of
  DeweyTime winding its dial). Idle = the finished logo.
- **Colors:** green identity = `--primary`; orange pen = `--signal-attention`.
  No hardcoded hex — the brand knob in `tokens.css` cascades.

## Tests (vitest, node env — `renderToStaticMarkup` + source-text, mirroring the 6 DeweyTime brand tests)

- `AdmsBridgeMark`: renders the single glyph path + pen, token-colored (no hex), `aria-hidden`.
- `Brandmark`: carries the `group` hover hook, the mark, and the "ADMS"/"Bridge" wordtext.
- `AdmsBridgeIntro`: renders the overlay (`fixed inset-0`, `aria-label="ADMS Bridge"`) with the mark + wordtext + `.adms-draw` hook; source-text asserts `sessionStorage`, `prefers-reduced-motion`, skip; `brand-motion.css` defines `@keyframes adms-draw` and the reduced-motion guard; `App.tsx` mounts the intro.

## Out of scope / notes

- No new dependencies (CSS-only motion; the app's `motion` lib stays unused here).
- Light-only app → no dark variants.
- `tokens.css` stays color-only; motion lives in `brand-motion.css`.
- Deploy: `npm run build:frappe` republishes `public/adms` into the Frappe app (unchanged process).
