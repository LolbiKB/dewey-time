import type { ReactNode } from "react";

import { useT } from "@/miniapp/MiniLocale";
import { isPermanentRejection } from "@/miniapp/useMiniAppSession";
import type { StringKey } from "@/miniapp/miniStrings";

/** The one place loading, error and empty copy is rendered, so the three
 *  pages cannot drift into three different voices for the same situation.
 *
 *  `role="status"` because every one of these replaces the page's whole
 *  contents without a navigation: a screen-reader user tapping between tabs or
 *  paging the roster otherwise gets silence where the answer arrived. Polite,
 *  never assertive — none of this interrupts anything. */
export function MiniState(props: { children: ReactNode }) {
  return (
    <div role="status" className="p-8 text-center text-sm text-muted-foreground">
      {props.children}
    </div>
  );
}

/**
 * A failed request, told apart from a link that no longer works.
 *
 * THE THREE CASES THAT LOOKED LIKE A BLIP. A revoked link, an account that was
 * never linked, and a launch older than the 24-hour window all arrive as 403 —
 * and all three rendered "Couldn't load your day. Try again in a moment.",
 * which is false on every count. Nothing is loading, trying again cannot work,
 * and it WAS tried again: three requests, then a re-poll every sixty seconds
 * for as long as the app stayed open, on the employee's own mobile data.
 *
 * The recovery is not something the app can do, so the copy names who can: open
 * it again from the Dewey Time chat, or ask HR for a new link.
 */
export function MiniErrorState(props: { error: unknown; fallback: StringKey }) {
  const t = useT();
  if (!isPermanentRejection(props.error)) {
    return <MiniState>{t(props.fallback)}</MiniState>;
  }
  return (
    <div role="status" className="flex flex-col gap-2 p-8 text-center">
      <p className="text-sm font-medium text-foreground">{t("sessionEndedTitle")}</p>
      {/* leading-normal, not leading-tight: this is the longest sentence the
          app renders, and in Khmer its below-base stacks clip at tighter
          leading. */}
      <p className="text-sm leading-normal text-muted-foreground">{t("sessionEndedBody")}</p>
    </div>
  );
}
