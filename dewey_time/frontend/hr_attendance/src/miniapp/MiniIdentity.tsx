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
import { useT } from "@/miniapp/MiniLocale";

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
  /**
   * The answer has not arrived yet: draw the row, with bars where the values
   * go.
   *
   * NOT the placeholder this file's own note rejects. The objection there is
   * to a false CLAIM — "Your record" printed over an empty name confirms
   * nothing — and a bar makes no claim at all. What it buys is the 54px the
   * whole page used to drop when this query landed, on an app whose first
   * screen is a timeline somebody is already reading.
   */
  pending?: boolean;
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

/**
 * One line of the header while its answer is in flight.
 *
 * THE HEIGHT COMES FROM TEXT, NOT FROM A NUMBER. A bar sized in pixels
 * reserves the wrong row: measured at 320px, this header is 62.9px in Khmer
 * and 57.5px in English with identical content, because the Khmer webfont is
 * applied to the whole app — Latin glyphs included — and its normal
 * line-height is taller. Any constant is wrong in one language.
 *
 * So an invisible non-breaking space sets the line box, in whatever font the
 * reader is actually in, and the bar is laid over it in the same grid cell so
 * it contributes no height of its own. The reserved row is then a real line of
 * text by construction, and the e2e "the header reserves the row it will
 * actually need" measures both states to prove it.
 */
function SkeletonLine(props: { className: string; width: string }) {
  return (
    <p aria-hidden="true" className={`grid grid-cols-1 leading-normal ${props.className}`}>
      <span className="invisible col-start-1 row-start-1">&nbsp;</span>
      <span className={`col-start-1 row-start-1 h-2.5 self-center rounded bg-muted ${props.width}`} />
    </p>
  );
}

export function MiniIdentity(props: MiniIdentityProps) {
  const t = useT();
  const name = (props.employeeName || "").trim() || props.employee || t("yourRecord");
  const subtitle = subtitleOf(props.designation, props.branch);
  const pending = props.pending === true;

  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-2"
      // The landmark's NAME is honest while the row is still loading — it is
      // "your record" either way; only its contents are unknown, which is what
      // aria-busy says.
      aria-label={t("yourRecord")}
      aria-busy={pending || undefined}
    >
      {pending ? (
        // No initials. Two letters guessed from nothing are a claim, and this
        // header exists to make exactly one claim, correctly.
        <span aria-hidden="true" className="size-8 shrink-0 rounded-full bg-muted" />
      ) : props.imageUrl || props.photoUrl ? (
        // alt="" and aria-hidden: the name is right beside it in text, so an
        // announced photo would be the same fact twice.
        <img
          src={props.imageUrl || props.photoUrl || undefined}
          alt=""
          aria-hidden="true"
          // bg-muted UNDER the image, not decoration. Employee photos on this
          // roster are PNGs, and a PNG carries an alpha channel: a cut-out
          // portrait renders its background as whatever is behind it, so on a
          // dark Telegram theme a head floats on black with no edge, and on a
          // white one the crop lines vanish. A filled circle behind it gives
          // every photo the same silhouette as the initials fallback beside
          // it, whether or not it has its own background.
          className="size-8 shrink-0 rounded-full bg-muted object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
        >
          {initialsOf(props.employeeName, props.employee)}
        </span>
      )}

      {/* TWO LINES, AND THE TWO VALUES THAT VERIFY A BINDING ARE LAST TO GIVE.
          Both used to be first: the employee id sat at the END of a single
          truncating line, and the Khmer name was appended INLINE after the
          Latin one — so at 320px, on a Khmer phone, this header dropped
          precisely the two things it exists to let somebody check, and kept
          the transliteration they never use. Now the id is shrink-0 beside
          the name, the Khmer name has its own line ahead of the role, and it
          is the LATIN name that truncates first.

          leading-normal on both, never a tightened line-height: Khmer stacks
          marks below the baseline (ុ, ូ, ្ក) and a Latin-tuned line box clips
          their feet. */}
      <div className="min-w-0 flex-1">
        {pending ? (
          <>
            <SkeletonLine className="text-sm" width="w-28" />
            {/* text-[13px], matching the Khmer name below rather than the
                11px subtitle beside it: the taller of the two sets the line
                box, so that is the one the reservation has to copy. */}
            <SkeletonLine className="text-[13px]" width="w-20" />
          </>
        ) : (
          <>
            <p className="flex items-baseline gap-2 text-sm leading-normal">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{name}</span>
              {/* Latin, never fmt.digits: an employee id is a name, not a
                  quantity. The same rule the Profile section follows. */}
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {props.employee ?? ""}
              </span>
            </p>
            {/* ONE 13px LINE, WHATEVER IS IN IT. Both of this line's children
                are optional — a great many employees have no branch, plenty
                have no Khmer name, and with neither this was a flex container
                with no children, which generates no line box and collapses to
                nothing. The row was then SHORTER than the skeleton that
                reserved it, so the page still moved when the answer landed:
                3px for an ordinary record, 9.9px in Khmer for a sparse one.
                Measured, after the first version of this fix claimed zero.

                The same invisible strut the skeleton uses, so the two are one
                construction rather than two guesses about each other. It costs
                a Khmer-name-less employee 3px of header they did not have
                before, which is the trade: a row that is always the same
                height, on the app's first screen, under a timeline somebody is
                already reading. */}
            <p className="grid grid-cols-1 text-[13px] leading-normal">
              <span aria-hidden="true" className="invisible col-start-1 row-start-1">
                &nbsp;
              </span>
              <span className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-1.5 text-[11px] text-muted-foreground">
                {/* The name many of these employees would actually recognise as
                    their own. Bounded rather than free — the same max-w +
                    shrink-0 pattern the Day header's status chip uses — so it
                    can never take the whole row, but it yields width only after
                    the role and site have. */}
                {props.khmerName ? (
                  <span className="max-w-[60%] shrink-0 truncate text-[13px] text-foreground">
                    {props.khmerName}
                  </span>
                ) : null}
                {subtitle ? <span className="min-w-0 truncate">{subtitle}</span> : null}
              </span>
            </p>
          </>
        )}
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
          // min-h-9 + inline-flex, not py-1: at px-2 py-1 this was a 24px
          // target — the minimum WCAG 2.2 allows — for the one control that
          // rescues somebody stuck in a language they cannot read. It costs
          // the header nothing: the text column beside it is taller, so the
          // button grows entirely into slack that already exists.
          className="inline-flex min-h-9 shrink-0 items-center rounded-md px-3 text-[11px] font-medium text-primary active:bg-muted"
        >
          {props.localeLabel}
        </button>
      ) : null}
    </header>
  );
}
