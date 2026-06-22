/**
 * ADMS Bridge house mark — an inline, token-colored twin of the lucide
 * `Waypoints` glyph (the bridge between the ZKTeco devices and Frappe HR).
 *
 * Unlike the lucide component (separate circles + paths), this is ONE continuous
 * path: the four node rings (twin 180° arcs) and the three bridge connectors,
 * laid out in route order top → left → right → bottom, with `M` jumps over the
 * small node→connector gaps. That single path is what lets a single linear
 * `stroke-dashoffset` sweep (see brand-motion.css) draw the whole logo at
 * constant pen speed — precise, smooth, one animation. The `.adms-pen` twin is
 * the orange leading tip.
 *
 * Decorative by default: aria-hidden, because the "ADMS Bridge" wordtext beside
 * it in the lockup carries the accessible name.
 */

// Single source of geometry. Route: top(12,4) → left(4,12) → right(20,12) → bottom(12,20),
// node rings r=2; connector endpoints match lucide's Waypoints (edge-to-edge gaps).
export const ADMS_BRIDGE_PATH =
  "M10.586 5.414 A2 2 0 1 1 13.414 2.586 A2 2 0 1 1 10.586 5.414" + // top ring
  " L5.414 10.586" + // connector 1 (top → left)
  " A2 2 0 1 1 2.586 13.414 A2 2 0 1 1 5.414 10.586" + // left ring
  " M6 12 L18 12" + // connector 2 (left → right)
  " A2 2 0 1 1 22 12 A2 2 0 1 1 18 12" + // right ring
  " M18.586 13.414 L13.414 18.586" + // connector 3 (right → bottom)
  " A2 2 0 1 1 10.586 21.414 A2 2 0 1 1 13.414 18.586"; // bottom ring

export function AdmsBridgeMark({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden focusable={false}>
      <path className="adms-glyph" d={ADMS_BRIDGE_PATH} />
      <path className="adms-pen" d={ADMS_BRIDGE_PATH} />
    </svg>
  );
}
