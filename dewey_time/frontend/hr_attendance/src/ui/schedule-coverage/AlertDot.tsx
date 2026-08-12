import { cn } from "@/lib/utils";
import type { RegisterAlert } from "@/lib/coverageRegister";

/**
 * Minimal alert beside the page title. Not a filter control — it sits with the
 * title because it is an alarm, not a facet.
 *
 * Colour never carries meaning alone, and three states need three DISTINCT
 * shapes, not two: `problem` is a filled disc with a halo, `clear` is a
 * hollow ring, and `degraded` is a filled disc with its own concentric outer
 * ring, separated from the disc by a gap. `degraded` is the state where a
 * feed is down and the count only covers part of the roster — the one that
 * costs the most if it goes unnoticed, so it gets its own shape rather than
 * sharing "filled disc" with `problem` and leaning on hue alone to tell the
 * two apart. The count and the words live in the accessible name. The dot
 * never disappears — an absent indicator cannot distinguish "nothing is
 * wrong" from "the page failed".
 *
 * The visual dot is 12px, well under the WCAG 24x24 CSS px minimum target
 * size — `title` gives a mouse user a hover hint, but touch has no hover, so
 * the <button> carries its own padding around the dot rather than being
 * exactly the dot's size.
 */
export function AlertDot({
  alert,
  active,
  onToggle,
}: {
  alert: RegisterAlert;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-tone={alert.tone}
      aria-label={alert.label}
      aria-pressed={active}
      title={alert.label}
      onClick={onToggle}
      className="inline-flex shrink-0 items-center justify-center rounded-full p-2.5"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-3 rounded-full transition-shadow",
          alert.tone === "problem" && "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20",
          // The halo shadow above and `ring-*` both resolve to the CSS
          // `box-shadow` property; layering them on the same state would
          // have one silently overwrite the other. `degraded` uses the ring
          // family exclusively — offset creates the "gap", ring-current
          // (with the accent text colour) draws the outer ring — the same
          // mechanism `active` below already relies on.
          alert.tone === "degraded" &&
            "bg-brand-accent text-brand-accent ring-2 ring-offset-2 ring-current",
          alert.tone === "clear" && "border-2 border-primary bg-transparent",
          active && "ring-2 ring-offset-1 ring-current",
        )}
      />
    </button>
  );
}
