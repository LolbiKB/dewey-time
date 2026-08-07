import { earlierMarkerLabel, stripAriaLabel } from "@/lib/flagQueueLabels";
import type { Strip, StripCell } from "@/lib/flagStrip";
import { cn } from "@/lib/utils";

/**
 * Height AND colour, never colour alone: the strip has to be readable to
 * someone who cannot separate the hues, and height is the one channel that
 * survives every kind of colour vision.
 *
 * Green means "no flag on this day" and nothing more. It deliberately does not
 * claim the person worked — the queue does not load shift assignments and cannot
 * know, so a day someone was rostered off and a day they worked cleanly both
 * render green. That is honest: the strip asserts only what was measured.
 */
const CELL_CLASS: Record<StripCell["state"], string> = {
  clean: "h-1 bg-emerald-500/70",
  "no-data": "h-1 bg-muted-foreground/30",
  flagged: "",
};

const TIER_CLASS = {
  act: "h-3.5 bg-destructive",
  review: "h-2.5 bg-amber-500",
  routine: "h-1.5 bg-sky-500",
} as const;

export function FlagStrip(props: { strip: Strip; className?: string }) {
  const { strip } = props;
  const marker = earlierMarkerLabel(strip.earlierCount);

  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", props.className)}>
      {strip.cells.length > 0 ? (
        <span
          role="img"
          aria-label={stripAriaLabel(strip)}
          data-strip-cells={strip.cells.length}
          className="flex h-3.5 items-end gap-[2.5px]"
        >
          {strip.cells.map((cell) => (
            <span
              key={cell.date}
              aria-hidden="true"
              className={cn(
                "w-1.5 rounded-[1px]",
                cell.tier ? TIER_CLASS[cell.tier] : CELL_CLASS[cell.state],
              )}
            />
          ))}
        </span>
      ) : null}
      {marker ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{marker}</span>
      ) : null}
    </span>
  );
}
