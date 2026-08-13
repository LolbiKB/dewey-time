import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** One fact the calling surface wants beside the ID, in the order it wants them. */
export type TailFact = {
  label: string;
  tone?: "normal" | "warning";
  /**
   * Draw this fact BEFORE the employee ID rather than after it.
   *
   * Line two truncates from its END, so whatever sits last is what gives way.
   * The default order — ID first — assumes the caller's facts are secondary to
   * the person, which is true of a picker's department and employment type. On
   * the flag queue it is not: the finding IS why the row exists and the ID is
   * the incidental part, so the queue asks for the opposite and the ID pays.
   *
   * Measured, at the 139px stack a queue row has on a 375px phone: with the ID
   * leading, line two drew "EMP-002·Missing 3h 1". That does not read as a cut
   * "3h 12m", it reads as a smaller number — on the screen HR uses to decide
   * attendance. With the finding leading it draws "Missing 3h 12m · EMP-0…",
   * and a cut ID is legible AS cut.
   *
   * Crossing the ID changes where a fact is drawn, never whether it is: a lead
   * fact keeps its own rung on the ladder below, and the caller's relative
   * order survives inside each side.
   */
  lead?: boolean;
};

export type EmployeeIdentityProps = {
  /** `employee_name` as ERPNext records it. Never shortened here. */
  englishName: string;
  /**
   * The employee ID, rendered `tabular-nums`.
   *
   * It is the only slot on line two that is always rendered — `tail` facts
   * hide below their width threshold, this does not — so a caller with
   * nothing selected may pass placeholder text (e.g. "Choose an employee")
   * here instead of an id. That is intentional, not a misuse of the prop.
   *
   * Always rendered is not the same as always first: a `TailFact` may ask to
   * lead it, and one that does pushes this to the end of the line where the
   * truncation lands.
   */
  employeeId: string;
  /**
   * Composed by `khmerName()`, never the two raw fields.
   *
   * REQUIRED, deliberately. Seven surfaces render a person and they drifted
   * apart once already; a required prop is the only thing that makes every one
   * of them decide rather than quietly omit.
   */
  khmerName: string | null;
  /**
   * A slot, not a shape.
   *
   * The surfaces wrap their avatars differently for accessibility — the
   * register in an `aria-hidden` `display:contents` span, the flag queue in
   * `DecorativeAvatars` — and a shape-typed prop would have to reproduce all of
   * it. It sits OUTSIDE the query container: the avatar's footprint differs by
   * surface (36+10 in the register, 32+8 in a picker row, 40+12 in the
   * trigger), so one threshold measured across the whole box would mean three
   * different text budgets.
   *
   * Never space-driven. A surface decides once whether it has an avatar and the
   * ladder never takes it away — a decoration that vanishes and returns as you
   * resize reads as a rendering fault.
   */
  avatar?: ReactNode;
  tail?: TailFact[];
  className?: string;
  nameClassName?: string;
  /**
   * Stamped as `data-slot` on the line-one name span.
   *
   * The register's e2e suite reads `data-slot="employee-name"` to find the cell,
   * and that hook has to survive the move into this component.
   */
  nameSlot?: string;
};

/**
 * One person, two lines, on every surface that draws one.
 *
 * Line one is the English name, then `·` and the Khmer name when the box can
 * fit both whole. Line two is the employee ID, then the caller's facts — or,
 * where a caller marks a fact `lead`, that fact and then the ID. Never a third
 * line, and the order never changes with width — the only thing space decides
 * is how far along each line it gets.
 *
 * Adapts by CONTAINER query on its own text stack, not by viewport. The
 * register's Employee cell is 139px at a 1280 viewport and 90px at 375, while a
 * picker row at that same 375 is 168px; a media query cannot tell those apart.
 *
 * Every threshold below is a measured worst case, not a guess: `Sovannary Heng
 * · ហេង សុវណ្ណារី` needs 194px at 14px semibold, so the Khmer name turns on at
 * 200. When it will not fit it is NOT RENDERED rather than shrunk or truncated
 * — shrinking would need 3px for that name, and Khmer has no inter-word spaces
 * so an ellipsis lands mid-cluster. That threshold is one global worst case
 * rather than a per-name calculation, so it narrows the mid-cluster ellipsis to
 * a residual rather than ruling it out: a pair longer than the widest one
 * measured, in a container barely past 200, still meets line one's `truncate`.
 *
 * Hook-free on purpose, so `renderToStaticMarkup` can reach it — the same
 * constraint AlertDot and FacetOptions are built to.
 */
export function EmployeeIdentity(props: EmployeeIdentityProps) {
  // Partitioned around the ID, carrying each fact's ORIGINAL index so its rung
  // on the ladder does not move when it crosses. Two stable filters rather than
  // a sort, so the caller's order survives inside each side.
  const tail = (props.tail ?? []).map((fact, index) => ({ fact, index }));
  const lead = tail.filter((entry) => entry.fact.lead);
  const behind = tail.filter((entry) => !entry.fact.lead);

  return (
    // `<span>`, not `<div>`: both pickers place this inside a `<button>`, whose
    // content model is phrasing content only. The Tailwind utilities carry the
    // display (`flex` below, `block` on the lines inside), so layout is
    // unaffected — `container-type` blockifies the query container the same
    // way a flex item already blockifies this root.
    <span className={cn("flex min-w-0 items-center gap-2.5", props.className)}>
      {props.avatar}

      {/* The query container. `min-w-0` so flex can shrink it below its content,
          and `flex-1` so it takes the width the row has left — which is exactly
          the width the thresholds were measured against. */}
      <span className="@container block min-w-0 flex-1">
        <span
          data-slot={props.nameSlot}
          className={cn(
            "block truncate text-sm font-semibold leading-tight",
            props.nameClassName,
          )}
        >
          {props.englishName}
          {props.khmerName ? (
            // One span for separator and name together, so hiding it cannot
            // leave a bare middot behind. Same font-size and weight as the
            // English name — at 11px Khmer's stacked subscripts start
            // compressing into each other.
            //
            // This is NOT free of row height, as this comment claimed until it
            // was measured in a browser (e2e/employee-identity.spec.ts, which
            // pins the numbers). Kantumruy Pro's ascent and descent exceed the
            // Latin face's, so line one's line box is the union of two
            // differently proportioned inline boxes and grows 4px even though
            // both spans carry the same font-size and the same `leading-tight`:
            // 33px to 37px for this stack, 53px to 54px for a register row.
            // The extra is what draws the coeng subscripts, so flattening it
            // with a fixed height on line one — whose `truncate` already sets
            // `overflow: hidden` — would clip them.
            <span className="hidden @min-[200px]:inline">
              <span aria-hidden="true" className="mx-1.5 font-normal opacity-40">
                ·
              </span>
              <span className="font-khmer">{props.khmerName}</span>
            </span>
          ) : null}
        </span>

        <span className="block truncate text-xs leading-tight text-muted-foreground">
          {lead.map((entry) => (
            <Fact key={`${entry.fact.label}-${entry.index}`} {...entry} separator="after" />
          ))}
          <span className="tabular-nums">{props.employeeId}</span>
          {behind.map((entry) => (
            <Fact key={`${entry.fact.label}-${entry.index}`} {...entry} separator="before" />
          ))}
        </span>
      </span>
    </span>
  );
}

/**
 * One caller fact and the separator that joins it to the employee ID.
 *
 * The separator lives INSIDE the fact's span, on the side facing the ID, so a
 * fact the ladder hides cannot leave a bare middot behind at either end of the
 * line. (Only a fact the LADDER hides — a lead fact beside an empty
 * `employeeId` would still draw its trailing middot, which no caller does
 * today and the prop's own contract steers away from.)
 * `index` is the fact's position in the caller's array, not its position
 * on the line: a fact keeps its rung when it crosses the ID.
 */
function Fact(props: { fact: TailFact; index: number; separator: "before" | "after" }) {
  const separator = (
    <span aria-hidden="true" className="mx-1 opacity-40">
      ·
    </span>
  );
  return (
    <span
      className={cn(
        "hidden",
        // A fourth fact and beyond share the last rung: the threshold is read
        // out of the ladder so the number lives in one place.
        TAIL_VISIBILITY[props.index] ?? TAIL_VISIBILITY[TAIL_VISIBILITY.length - 1],
        props.fact.tone === "warning" && "text-brand-accent",
      )}
    >
      {props.separator === "before" ? separator : null}
      {props.fact.label}
      {props.separator === "after" ? separator : null}
    </span>
  );
}

/**
 * When each caller fact earns its place, by measured worst case.
 *
 * 110px for the ID plus one fact, 158px for two, 206px for three — rounded up
 * to 120 / 170 / 230. A fourth and beyond share the third's threshold: by then
 * the surface is wide enough that one more short fact is not what breaks it,
 * and no caller currently declares more than three.
 *
 * Written as whole class strings rather than composed, because Tailwind scans
 * source text: `@min-[${n}px]:inline` produces no CSS at all.
 */
const TAIL_VISIBILITY = [
  "@min-[120px]:inline",
  "@min-[170px]:inline",
  "@min-[230px]:inline",
];
