/**
 * Who the server thinks you are, at the top of every tab.
 *
 * This is a CONFIRMATION, not decoration, and the distinction decides where
 * the data comes from. Telegram hands the page `initDataUnsafe.user` — the
 * viewer's own Telegram name — and showing that would prove nothing: of course
 * it matches, it is their account. What an employee cannot otherwise check is
 * which Employee RECORD their account was bound to.
 *
 * That became worth showing when binding stopped always going through a link
 * HR sent. The recorded-id path trusts an id somebody put on an Employee
 * record; a wrong one binds a stranger, and every screen after it looks
 * completely normal. A name at the top is the one place that surfaces.
 *
 * So the name here is the SERVER's answer, carried on the same authenticated
 * payload as the attendance it labels — never the client's idea of who is
 * looking.
 */
import { cn } from "@/lib/utils";

export type MiniIdentityProps = {
  employee: string | null | undefined;
  employeeName: string | null | undefined;
  khmerName: string | null | undefined;
  designation: string | null | undefined;
  branch: string | null | undefined;
  /**
   * The EMPLOYEE RECORD's photo — the one HR put on the record, and the one
   * that appears beside this person everywhere else in Dewey Time.
   */
  imageUrl?: string | null;
  /**
   * Telegram's avatar, used ONLY when the record has no photo.
   *
   * It is whatever the person chose for Telegram — frequently not a face —
   * and it confirms nothing about the binding, since it is the viewer's own
   * picture by definition. A record with no photo is still better served by
   * something recognisable than by two grey letters, so it is kept as the
   * middle rung: record photo, then Telegram's, then initials.
   */
  photoUrl?: string | null;
  /** The OTHER language's own name, e.g. "ភាសាខ្មែរ" while reading English. */
  localeLabel?: string;
  onToggleLocale?: () => void;
};

/** Initials from the English name, falling back to the employee id. */
export function initialsOf(name: string | null | undefined, employee: string | null | undefined): string {
  const source = (name || "").trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const letters = parts.length > 1
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`
      : parts[0]!.slice(0, 2);
    return letters.toUpperCase();
  }
  // An employee id like HR-EMP-00042 has no initials worth taking; its last
  // two digits at least differ between people.
  //
  // Stripped FIRST, then defaulted. The other order runs the "??" placeholder
  // through the same strip that removes punctuation and leaves an empty
  // circle — which is what a missing name and a missing id both looked like.
  const digits = (employee || "").replace(/[^0-9A-Za-z]/g, "").slice(-2);
  return digits ? digits.toUpperCase() : "??";
}

/**
 * The secondary line: role and site, whichever exist.
 *
 * Both are optional on a real roster — a great many employees have no branch —
 * so this composes what is there rather than rendering separators around
 * nothing.
 */
export function subtitleOf(designation: string | null | undefined, branch: string | null | undefined): string | null {
  const parts = [designation, branch].map((p) => (p || "").trim()).filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function MiniIdentity(props: MiniIdentityProps) {
  const name = (props.employeeName || "").trim() || props.employee || "Your record";
  const subtitle = subtitleOf(props.designation, props.branch);

  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-2"
      aria-label="Your record"
    >
      {props.imageUrl || props.photoUrl ? (
        // alt="" and aria-hidden: the name is right beside it in text, so an
        // announced photo would be the same fact twice.
        <img
          src={props.imageUrl || props.photoUrl || undefined}
          alt=""
          aria-hidden="true"
          className="size-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
        >
          {initialsOf(props.employeeName, props.employee)}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight text-foreground">
          {name}
          {/* The Khmer name inline, because for many of these employees it is
              the name they would actually recognise as their own — and an
              English transliteration they never use is a poor thing to verify
              an identity against. */}
          {props.khmerName ? (
            <span className="ml-1.5 font-normal text-muted-foreground">{props.khmerName}</span>
          ) : null}
        </p>
        <p className={cn("truncate text-[11px] leading-tight text-muted-foreground")}>
          {subtitle ? `${subtitle} · ${props.employee ?? ""}` : (props.employee ?? "")}
        </p>
      </div>

      {/* In the header rather than behind a settings screen: this app has no
          settings screen, and a language switch nobody can find is a language
          switch nobody has. Its own name in its own script is also the one
          label that needs no translation to be understood. */}
      {props.onToggleLocale && props.localeLabel ? (
        <button
          type="button"
          onClick={props.onToggleLocale}
          aria-label={props.localeLabel}
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-primary active:bg-muted"
        >
          {props.localeLabel}
        </button>
      ) : null}
    </header>
  );
}
