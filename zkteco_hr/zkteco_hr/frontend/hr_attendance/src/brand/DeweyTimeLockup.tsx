import { DeweyTimeMark } from "./DeweyTimeMark";
import { DeweyTimeWordmark } from "./DeweyTimeWordmark";

/**
 * Header logo lockup: the clock dial mark next to the Dewey Time wordtext.
 * The dial anchors the brand visually; the wordtext carries the name. Hovering
 * the lockup re-runs the launch intro's clock-wind on the dial (the `group` +
 * `dw-hover-dial` hook drives the CSS in base.css). Single source of truth for
 * the header logo.
 */
export function DeweyTimeLockup() {
  return (
    <span className="group inline-flex items-center gap-2">
      <DeweyTimeMark className="dw-hover-dial size-5 shrink-0" />
      <DeweyTimeWordmark />
    </span>
  );
}
