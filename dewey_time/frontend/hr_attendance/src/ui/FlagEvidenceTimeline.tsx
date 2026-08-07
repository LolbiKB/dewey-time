import { hourLabel, hourTicks, pctOfWindow } from "@/lib/timelineAxis";
import { cn } from "@/lib/utils";
import type { FlagTimelineSpec } from "@/lib/flagNarrative";

/**
 * Draws a FlagTimelineSpec — the compact strip embedded directly in the flag
 * panel (design doc "Cross-cutting rule 8": embedded, not linked, because
 * requiring navigation to see the finding was the complaint this whole
 * design exists to fix).
 *
 * Deliberately flag-blind: every value drawn here (band, lunch, spans,
 * threshold, marks) already arrives pre-computed on the spec. That is what
 * lets `flagNarrative.test.ts` (tasks 2-5) cover the per-scenario logic with
 * plain objects and no React, and lets this file be tested the same way in
 * reverse — a spec in, HTML out, no Flag or Day fixture ever constructed.
 *
 * Visual language matches DayTimeline.tsx / TimelineAxis.tsx (same band and
 * gap treatments, same hour-tick math) rather than inventing a second style
 * — just laid out horizontally instead of vertically, and roughly 30px tall
 * so it reads as reinforcement of the headline, not a second calendar.
 *
 * `band`/`lunch`/`spans`/`threshold` can all legitimately fall outside
 * `window` (an overnight scenario's clamped-to-midnight window vs. its
 * normalised-past-midnight anchors — see flagNarrative.test.ts's LEFT_EARLY
 * and MISSING_TIME overnight cases). `overflow-hidden` on the strip is what
 * clips that instead of letting the strip grow past its container; the
 * percentage math itself is left alone rather than clamped, so a partially
 * visible span still starts at its true position.
 */
export function FlagEvidenceTimeline(props: { spec: FlagTimelineSpec; ariaLabel: string }) {
  const { spec } = props;
  const ticks = hourTicks(spec.window.startMin, spec.window.endMin);
  const pct = (min: number) => pctOfWindow(min, spec.window);

  return (
    // One label for the whole graphic. The headline already states the
    // finding in words (see flagNarrative.ts) — a screen reader walking a
    // dozen positioned divs on top of that would be pure noise, so every
    // child below is aria-hidden and only this root carries a name.
    <div role="img" aria-label={props.ariaLabel} className="w-full">
      <div
        className="relative h-[30px] w-full overflow-hidden rounded-sm bg-muted/25"
        aria-hidden="true"
      >
        {/* Hour grid first — TimelineAxis.tsx's HourGrid comment states the
            rule this file also follows: nothing here sets a z-index, so
            stacking is DOM order, and this must be the first child or it
            paints over everything inserted after it. */}
        {ticks.map((m) => (
          <div
            key={`tick-${m}`}
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: `${pct(m)}%` }}
          />
        ))}

        {spec.band ? (
          // Same treatment as DayTimeline.tsx:44-45's scheduledBandClass.
          <div
            className="absolute inset-y-0.5 rounded-sm border-2 border-dashed border-muted-foreground/80 bg-muted/50"
            style={{
              left: `${pct(spec.band.startMin)}%`,
              width: `${Math.max(0, pct(spec.band.endMin) - pct(spec.band.startMin))}%`,
            }}
          />
        ) : null}

        {spec.lunch ? (
          // Same treatment as DayTimeline.tsx:474's isScheduledLunch band.
          <div
            className="absolute inset-y-1.5 rounded-sm border border-muted-foreground/45 bg-muted/35"
            style={{
              left: `${pct(spec.lunch.startMin)}%`,
              width: `${Math.max(0, pct(spec.lunch.endMin) - pct(spec.lunch.startMin))}%`,
            }}
          />
        ) : null}

        {spec.spans.map((s, idx) => {
          const left = pct(s.startMin);
          const width = pct(s.endMin) - left;
          if (width <= 0) return null;
          const worked = s.tone === "worked";
          return (
            <div
              key={`span-${idx}`}
              className={cn(
                "absolute inset-y-0 rounded-sm",
                worked
                  ? "bg-primary shadow-sm ring-1 ring-foreground/10"
                  : "border border-dashed border-destructive/75 bg-destructive/5"
              )}
              style={
                worked
                  ? { left: `${left}%`, width: `${width}%` }
                  : {
                      left: `${left}%`,
                      width: `${width}%`,
                      // The fill/border above matches DayTimeline.tsx:444's
                      // "missing expected" gap language — same family. The
                      // hatch layered on top is what marks THIS interval as
                      // the specific gap the flag is about, as opposed to
                      // an ordinary unaccounted-for span; without it a
                      // MISSING_TIME gap and a routine schedule gap would be
                      // visually identical again, just in a smaller box.
                      backgroundImage:
                        "repeating-linear-gradient(135deg, var(--destructive) 0 3px, transparent 3px 8px)",
                    }
              }
            />
          );
        })}

        {spec.threshold != null ? (
          <div
            className="absolute inset-y-0 w-px bg-destructive/70"
            style={{ left: `${pct(spec.threshold)}%` }}
          />
        ) : null}

        {spec.marks.map((mark, idx) => (
          // mark.label is never rendered here — the container's aria-label
          // already states the finding in words, so a visible caption on a
          // 30px strip would just repeat it while spending the only space
          // budget this compact treatment has. It exists on the type for
          // whatever eventually reads FlagTimelineSpec off-panel.
          <div
            key={`mark-${idx}`}
            className={cn(
              "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background shadow-sm",
              mark.tone === "alert" ? "bg-destructive" : "bg-primary"
            )}
            style={{ left: `${pct(mark.atMin)}%` }}
          />
        ))}
      </div>

      {ticks.length > 0 ? (
        // Same label row as TimelineAxis.tsx's HourGutter, laid out under
        // the strip instead of beside it — this timeline is horizontal.
        <div className="relative mt-0.5 h-3 w-full" aria-hidden="true">
          {ticks.map((m) => (
            <div
              key={`label-${m}`}
              className="absolute -translate-x-1/2 text-[10px] font-medium tabular-nums text-muted-foreground/70"
              style={{ left: `${pct(m)}%` }}
            >
              {hourLabel(m)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
