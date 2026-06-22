/**
 * The Dewey Time dial — an inline, token-colored twin of the favicon clock mark
 * (public/images/dewey-time.svg). The favicon hardcodes hex for static <img>
 * use; this version rides --brand-primary / --brand-accent so it tracks the
 * green knob right alongside the wordmark. Same geometry, hands at 10:10.
 *
 * The ring is a <path> (a full circle starting at the 10:10 minute-hand rim
 * point, drawn clockwise) rather than a <circle>, so the launch intro and the
 * header-hover redraw can dash-draw it under the sweeping minute hand — the
 * dial draws itself, an echo of the ADMS Bridge self-drawing mark (see base.css
 * dw-draw-ring / dw-sweep-min). At rest it renders as a plain full ring,
 * identical to the favicon. `.dw-pen` is the orange leading pen-tip: invisible
 * until a draw lights it up and races it around the rim.
 *
 * Decorative by default: aria-hidden, because the wordmark beside it in the
 * lockup already carries the accessible name.
 */

// One source of geometry: a full circle (r=32, centre 48,48) as a path that
// STARTS at the 10:10 minute-hand rim point and runs clockwise (two 180° arcs),
// so the draw begins exactly where the resting minute hand points.
const RING_PATH =
  "M75.973 32.459 A32 32 0 0 1 20.027 63.541 A32 32 0 0 1 75.973 32.459";

export function DeweyTimeMark({ className = "size-5 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 96 96" fill="none" aria-hidden focusable={false} shapeRendering="geometricPrecision">
      <path className="dw-ring" pathLength={201.06} d={RING_PATH} stroke="var(--brand-primary)" strokeWidth="8" strokeLinecap="round" />
      <line x1="48" y1="48" x2="35" y2="41" stroke="var(--brand-primary)" strokeWidth="8" strokeLinecap="round" />
      <line x1="48" y1="48" x2="66" y2="38" stroke="var(--brand-accent)" strokeWidth="8" strokeLinecap="round" />
      <circle cx="48" cy="48" r="4.5" fill="var(--brand-primary)" />
      <path className="dw-pen" pathLength={201.06} d={RING_PATH} stroke="var(--brand-accent)" strokeWidth="10.5" strokeLinecap="round" opacity="0" style={{ filter: "drop-shadow(0 0 5px var(--brand-accent))" }} />
    </svg>
  );
}
