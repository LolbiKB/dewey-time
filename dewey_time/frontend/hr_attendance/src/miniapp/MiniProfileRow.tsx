/**
 * The Profile tab's rows, and the omit-when-empty rule they all share.
 *
 * A thin HR record renders four rows, not nine rows of "—". A dash reads as
 * data the app failed to load; an absent row reads as a field nobody filled in,
 * which is what it is. The rule lives HERE rather than at each call site
 * because it is exactly the kind of thing one of fifteen call sites forgets —
 * and the forgotten one is the row reading "Reports to —" to somebody who has
 * no manager.
 *
 * Rows are DATA, not children, for the same reason: a section can only decide
 * whether it is empty if it can see its rows' values, and a `<ProfileRow>`
 * element that will render null is still a truthy child.
 */
import type { ReactNode } from "react";

export type ProfileRowData = { label: string; value: ReactNode };

/** Present unless it is genuinely nothing. `0` is a value — a fingerprint
 *  count and a flag count are both legitimately zero. */
function hasValue(value: ReactNode): boolean {
  return value !== null && value !== undefined && value !== "";
}

export function ProfileHeading(props: { children: ReactNode }) {
  return (
    <h2 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {props.children}
    </h2>
  );
}

export function ProfileSection(props: {
  title: string;
  rows?: ProfileRowData[];
  children?: ReactNode;
}) {
  const rows = (props.rows ?? []).filter((row) => hasValue(row.value));
  if (!rows.length && !props.children) return null;

  return (
    <section>
      <ProfileHeading>{props.title}</ProfileHeading>
      <div className="overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline gap-3 border-b border-border px-3 py-2 last:border-b-0"
          >
            <span className="shrink-0 text-xs text-muted-foreground">{row.label}</span>
            <span className="min-w-0 flex-1 break-words text-right text-[13px] text-foreground">
              {row.value}
            </span>
          </div>
        ))}
        {props.children}
      </div>
    </section>
  );
}
