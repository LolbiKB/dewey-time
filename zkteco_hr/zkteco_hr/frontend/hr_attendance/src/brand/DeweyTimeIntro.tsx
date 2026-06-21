import { useEffect, useState } from "react";
import { DeweyTimeMark } from "./DeweyTimeMark";
import { DeweyTimeWordmark } from "./DeweyTimeWordmark";

const PLAYED_KEY = "dewey-time-intro-played";

function alreadyPlayed(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(PLAYED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * One-time launch intro — a clock-themed take on the GAR brand intro. The dial
 * pops in and winds its hands clockwise into the 10:10 rest position, then the
 * "Dewey Time" wordtext rises beneath it; the overlay then crossfades away to
 * reveal the app. Plays once per browser session, is skippable on click, and is
 * fully disabled under prefers-reduced-motion (the wind keyframes no-op; only a
 * brief crossfade remains). Mounted once at the app root.
 */
export function DeweyTimeIntro() {
  const [phase, setPhase] = useState<"play" | "closing" | "done">(() =>
    alreadyPlayed() ? "done" : "play",
  );

  useEffect(() => {
    if (phase === "play") {
      try {
        window.sessionStorage.setItem(PLAYED_KEY, "1");
      } catch {
        /* sessionStorage unavailable (private mode) — still play, just don't persist */
      }
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const holdMs = reduce ? 900 : 2600;
      const timer = window.setTimeout(() => setPhase("closing"), holdMs);
      return () => window.clearTimeout(timer);
    }
    if (phase === "closing") {
      const timer = window.setTimeout(() => setPhase("done"), 500);
      return () => window.clearTimeout(timer);
    }
  }, [phase]);

  if (phase === "done") return null;

  const skip = () => setPhase("closing");

  return (
    <div
      role="img"
      aria-label="Dewey Time"
      onClick={skip}
      className={
        "fixed inset-0 z-[100] flex items-center justify-center bg-background " +
        "transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] " +
        (phase === "closing" ? "pointer-events-none opacity-0" : "opacity-100")
      }
    >
      <div className="flex flex-col items-center gap-6">
        <DeweyTimeMark className="dw-intro-dial size-24 sm:size-28" />
        <div className="dw-intro-rise">
          <DeweyTimeWordmark className="text-3xl sm:text-4xl" />
        </div>
      </div>
    </div>
  );
}
