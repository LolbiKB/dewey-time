/**
 * What an employee sees when the Mini App throws.
 *
 * The shared `ErrorBoundary` draws a card that is right for the HR console and
 * wrong here on four counts at once: it is English-only on a surface with a
 * Khmer mode, it prints `error.message` into the visible tree, it is sized
 * `h-screen` — 100vh, which inside a Telegram sheet is taller than the sheet,
 * so the one control that matters sits below the fold — and its wording
 * ("Dewey Time hit an unexpected error") is a sentence about our software
 * addressed to somebody who is worried about being marked absent.
 *
 * DEPENDENCY-FREE ON PURPOSE. It imports React types and the string table —
 * a plain object with pure functions — and nothing else. Not the design
 * system's Button, not `cn`, not the locale context: a bad `@lolbikb/dewey-ui`
 * release or a theme-token change is exactly the class of crash this screen
 * exists for, and re-importing the suspect inside the fallback means the
 * fallback throws too. React then walks to the next boundary, finds none, and
 * the employee gets a blank sheet with no message at all.
 *
 * The error text goes to `console.error` and nowhere else — `componentDidCatch`
 * already logs it. A stack trace is for us; on this screen it is noise sitting
 * where the reassurance should be.
 */
import { inBothLanguages } from "@/miniapp/miniStrings";

export function MiniCrashScreen(props: { onRetry: () => void }) {
  const title = inBothLanguages("crashTitle");
  const body = inBothLanguages("crashBody");
  const retry = inBothLanguages("actionRetry");

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 p-8 text-center"
      // Telegram's own stable height, matching the shell — `h-screen` is 100vh,
      // which overshoots the sheet and pushes the retry button off it.
      style={{ height: "var(--tg-viewport-stable-height, 100dvh)" }}
    >
      {/* BOTH LANGUAGES, because there is no provider left to ask and the SDK
          may never have loaded. See inBothLanguages for why that is a decision
          rather than a shortcut. */}
      <p className="text-sm font-medium text-foreground">{title.km}</p>
      <p className="text-sm font-medium text-foreground">{title.en}</p>
      <p className="text-xs leading-normal text-muted-foreground">{body.km}</p>
      <p className="text-xs leading-normal text-muted-foreground">{body.en}</p>
      <button
        type="button"
        onClick={props.onRetry}
        // A plain button with plain utilities: see the note above about not
        // importing the thing that may have just broken. min-h-11 because this
        // is the only control on the screen and it is pressed by a thumb.
        className="mt-2 inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground active:bg-muted"
      >
        {retry.km} · {retry.en}
      </button>
    </div>
  );
}
