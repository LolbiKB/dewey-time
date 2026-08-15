import type { ReactNode } from "react";

/** The one place loading, error and empty copy is rendered, so the three
 *  pages cannot drift into three different voices for the same situation. */
export function MiniState(props: { children: ReactNode }) {
  return (
    <div className="p-8 text-center text-sm text-muted-foreground">{props.children}</div>
  );
}
