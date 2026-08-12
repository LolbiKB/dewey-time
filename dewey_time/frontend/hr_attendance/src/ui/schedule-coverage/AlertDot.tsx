import { cn } from "@/lib/utils";
import type { RegisterAlert } from "@/lib/coverageRegister";

/**
 * Minimal alert beside the page title. Not a filter control — it sits with the
 * title because it is an alarm, not a facet.
 *
 * Colour never carries meaning alone: `problem` and `degraded` are filled
 * discs, `clear` is a hollow ring, so the states differ in SHAPE. The count and
 * the words live in the accessible name. It never disappears — an absent
 * indicator cannot distinguish "nothing is wrong" from "the page failed".
 */
export function AlertDot({
  alert,
  active,
  onToggle,
}: {
  alert: RegisterAlert;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-tone={alert.tone}
      aria-label={alert.label}
      aria-pressed={active}
      title={alert.label}
      onClick={onToggle}
      className={cn(
        "size-3 shrink-0 rounded-full transition-shadow",
        alert.tone === "problem" && "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20",
        alert.tone === "degraded" && "bg-brand-accent shadow-[0_0_0_3px] shadow-brand-accent/20",
        alert.tone === "clear" && "border-2 border-primary bg-transparent",
        active && "ring-2 ring-offset-1 ring-current",
      )}
    />
  );
}
