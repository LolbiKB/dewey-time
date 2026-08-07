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

  // Keyed on `src`: the same rendered avatar can be handed a different employee
  // as a list refetches, and a stale "loaded" would show the previous person's
  // photo under the new person's initials.
  useEffect(() => {
    setPhase(initialAvatarPhase(image));
    setDelayElapsed(false);
    if (!image) return;
    const timer = setTimeout(() => setDelayElapsed(true), AVATAR_RING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [image]);

  return (
    <span className={cn("relative shrink-0", props.className)}>
      <span
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
            className={cn(
              "absolute inset-0 size-full rounded-full object-cover transition-opacity duration-150 motion-reduce:transition-none",
              showsPhoto(phase) ? "opacity-100" : "opacity-0"
            )}
          />
        ) : null}
      </span>
      {showsRing(phase, delayElapsed) ? <AvatarLoadingRing /> : null}
    </span>
  );
}
