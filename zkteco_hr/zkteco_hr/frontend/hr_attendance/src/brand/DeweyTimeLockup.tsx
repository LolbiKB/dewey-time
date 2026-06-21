import { DeweyTimeMark } from "./DeweyTimeMark";
import { DeweyTimeWordmark } from "./DeweyTimeWordmark";

/**
 * Header logo lockup: the clock dial mark next to the Dewey Time wordmark.
 * The dial anchors the brand visually; the wordmark carries the name (and the
 * hover-expand). Single source of truth for the header logo.
 */
export function DeweyTimeLockup() {
  return (
    <span className="inline-flex items-center gap-2">
      <DeweyTimeMark />
      <DeweyTimeWordmark />
    </span>
  );
}
