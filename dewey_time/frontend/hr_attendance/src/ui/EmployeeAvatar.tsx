import { useEffect, useState } from "react";

import { employeeInitials } from "@/lib/employeeCard";
import {
  AVATAR_RING_DELAY_MS,
  initialAvatarPhase,
  nextAvatarPhase,
  showsPhoto,
  showsRing,
} from "@/lib/avatarLoading";
import { cn } from "@/lib/utils";
import type { CalendarEmployee } from "@/types/calendar";

export type EmployeeAvatarProps = {
  employee: CalendarEmployee | null;
  fallbackId?: string | null;
  className?: string;
  imageClassName?: string;
};

/**
 * A 2px arc travelling the circle's perimeter.
 *
 * Deliberately NOT the shared `Spinner` component. `Spinner` is a centred
 * `Loader2Icon`, and at 40px there is no room for a centred spinner and readable
 * initials at the same time — it would cover the very thing the base layer
 * exists to show. This takes `Spinner`'s accessibility contract even though it
 * cannot take its shape.
 *
 * Under reduced motion it stops rotating but STAYS on screen, dimmed. The signal
 * is what matters; spinning is only how it is usually delivered. Removing it
 * would hand those users back exactly the loading-versus-no-photo ambiguity the
 * ring exists to remove.
 */
export function AvatarLoadingRing() {
  return (
    <svg
      role="status"
      aria-label="Loading"
      viewBox="0 0 40 40"
      fill="none"
      className="pointer-events-none absolute inset-0 size-full animate-spin text-primary/70 motion-reduce:animate-none motion-reduce:text-muted-foreground/60"
    >
      {/* r=19 leaves the 2px stroke inside the 40px box. A 30-unit dash against
          the ~119-unit circumference is a quarter-turn arc — enough to read as
          motion without ringing the whole circle and competing with the photo
          that is about to land. */}
      <circle
        cx="20"
        cy="20"
        r="19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="30 90"
      />
    </svg>
  );
}

/**
 * The only `<img>` in the SPA.
 *
 * It used to render the photo OR the initials, and three defects followed from
 * that `or`: the photo painted in half-drawn as bytes arrived; a 404 left an
 * empty circle, because `alt=""` shows nothing; and nothing marked the image as
 * non-urgent, so decode could block.
 *
 * The fix is layering. The initials are the base layer, always rendered; the
 * photo sits on top at zero opacity and fades in on `load`. On `error` it stays
 * hidden and the initials simply remain. The avatar is then never empty, never
 * half-painted, and never a broken-image icon — every state is a real avatar.
 *
 * No skeleton or shimmer: a pulsing grey circle would replace meaningful content
 * (whose initials these are) with a meaningless placeholder. The initials are a
 * BETTER loading state than a skeleton because they already carry the answer to
 * "who is this row about".
 */
export function EmployeeAvatar(props: EmployeeAvatarProps) {
  const image = props.employee?.image ?? null;
  const [phase, setPhase] = useState(() => initialAvatarPhase(image));
  const [delayElapsed, setDelayElapsed] = useState(false);
  const [renderedImage, setRenderedImage] = useState(image);

  // A new `src` starts over, and the reset happens DURING render rather than in an
  // effect. The same avatar is handed a different employee without remounting — a
  // picker trigger changes on every selection — and an effect only runs after the
  // commit that already installed the new `src`. That commit would take its opacity
  // from the stale "loaded" phase, and an <img> keeps painting its previous image
  // until the new one decodes, so the previous employee's photo would flash at full
  // opacity before the fade: exactly the defect this reset exists to prevent.
  // Effect ordering is racy besides — a memory-cached `load` firing before the
  // passive flush would be undone by the reset, stranding the photo at opacity-0
  // under a ring that never clears, because no second `load` is coming. Adjusting
  // state in render (React's documented pattern for props-derived state) re-renders
  // before anything is committed, so a `src` is only ever painted from its own phase.
  if (renderedImage !== image) {
    setRenderedImage(image);
    setPhase(initialAvatarPhase(image));
    setDelayElapsed(false);
  }

  // Only the delay is left in an effect, because a timer genuinely is one.
  useEffect(() => {
    if (!image) return;
    const timer = setTimeout(() => setDelayElapsed(true), AVATAR_RING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [image]);

  return (
    // `rounded-full` on the ROOT, not only on the inner layers: AvatarGroup
    // styles its children with a `ring`, which is a box-shadow, and a
    // box-shadow follows the border-radius of the element it sits on. Without
    // this the ring drew a SQUARE around a circular avatar — and where the
    // faces overlap that reads as each circle being sliced flat.
    //
    // `data-slot="avatar"` is what shadcn's AvatarGroup targets
    // (`*:data-[slot=avatar]:ring-2`), so the group styles its children itself
    // instead of every callsite hand-applying a ring and getting it wrong.
    <span
      data-slot="avatar"
      className={cn("relative shrink-0 rounded-full", props.className)}
    >
      {/* Decoration, not content: every caller renders the employee's name as
          adjacent text, so initials in the accessibility tree only pad the
          computed name of whatever contains them — `EmployeePicker`'s trigger is
          a combobox that names itself from its contents. The photo is already
          `alt=""`, and the ring is a SIBLING of this span, so its `role="status"`
          stays exposed. */}
      <span
        aria-hidden="true"
        className={cn(
          "flex size-full items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground",
          props.imageClassName
        )}
      >
        {employeeInitials(props.employee, props.fallbackId ?? null)}
        {image ? (
          <img
            src={image}
            alt=""
            decoding="async"
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setPhase((current) => nextAvatarPhase(current, "load"))}
            onError={() => setPhase((current) => nextAvatarPhase(current, "error"))}
            // `bg-muted` because `object-cover` promises the photo covers the box
            // geometrically, not that it is opaque: a PNG with an alpha channel
            // would leave the initials legible through it forever. Same colour as
            // the empty circle, so the photo self-occludes without a seam.
            className={cn(
              "absolute inset-0 size-full rounded-full bg-muted object-cover transition-opacity duration-150 motion-reduce:transition-none",
              showsPhoto(phase) ? "opacity-100" : "opacity-0"
            )}
          />
        ) : null}
      </span>
      {showsRing(phase, delayElapsed) ? <AvatarLoadingRing /> : null}
    </span>
  );
}
