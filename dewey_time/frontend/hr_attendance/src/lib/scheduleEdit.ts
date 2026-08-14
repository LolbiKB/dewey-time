import { blocksFingerprint, cloneWeekPattern, weekPatternToBlocks } from "@/types/schedule";
import type { ReconcilePreview, ScheduleContext, ShiftBlock } from "@/types/schedule";

export type ScheduleChangeSummary = {
  hasChanges: boolean;
  leavingLabels: string[];
  addingLabels: string[];
  inactivatedCount: number;
  trimmedCount: number;
  lines: string[];
};

export function summarizeReconcile(
  reconcile: ReconcilePreview | null | undefined,
): ScheduleChangeSummary {
  const disable = reconcile?.disable_ssas ?? [];
  const affected = reconcile?.affected_assignments ?? [];
  const addingLabels = reconcile?.add_labels ?? [];
  const leavingLabels = reconcile?.leaving_labels ?? [];

  const inactivatedCount = affected.filter((a) => a.action === "inactivate").length;
  const trimmedCount = affected.filter((a) => a.action === "end_before").length;

  const lines: string[] = [];
  for (const label of leavingLabels) lines.push(`Retiring ${label}`);
  for (const label of addingLabels) {
    lines.push(`Adding ${label} from ${reconcile?.effective_from ?? "the effective date"}`);
  }
  if (inactivatedCount) {
    lines.push(`${inactivatedCount} future shift${inactivatedCount === 1 ? "" : "s"} inactivated`);
  }
  if (trimmedCount) {
    const end = reconcile?.affected_assignments.find((a) => a.action === "end_before")
      ?.proposed_end_date;
    lines.push(
      `${trimmedCount} shift${trimmedCount === 1 ? "" : "s"} trimmed${end ? ` to end ${end}` : ""}`,
    );
  }

  const hasChanges =
    disable.length > 0 ||
    affected.length > 0 ||
    addingLabels.length > 0 ||
    (reconcile?.add_identities?.length ?? 0) > 0;

  return { hasChanges, leavingLabels, addingLabels, inactivatedCount, trimmedCount, lines };
}

/** True when the edit will retire existing future shifts (disable an SSA or trim/inactivate
 * an assignment) — the case that warrants a typed confirmation. */
export function reconcileRetiresShifts(
  reconcile: ReconcilePreview | null | undefined,
): boolean {
  return Boolean(
    (reconcile?.disable_ssas?.length ?? 0) > 0 ||
      (reconcile?.affected_assignments?.length ?? 0) > 0,
  );
}

/** Trimmed, case-insensitive equality of the typed text against the employee's name.
 * Empty input never matches. */
export function confirmNameMatches(
  typed: string,
  employeeName: string | null | undefined,
): boolean {
  const a = (typed ?? "").trim().toLowerCase();
  const b = (employeeName ?? "").trim().toLowerCase();
  return a.length > 0 && a === b;
}

export type ScheduleFormState = {
  shiftBlocks: ShiftBlock[];
  effectiveFrom: string;
  generateThrough: string;
  limitGenerateThrough: boolean;
};

/** Derives the editable form fields from a schedule context — the server's week
 * pattern and defaults become the form's starting point. Shared by the
 * "employee changed" seed effect and the post-save re-seed: a refetched
 * context doesn't update the form on its own (the form holds its own local
 * state), so both call sites reset from it explicitly. */
export function scheduleFormStateFromContext(context: ScheduleContext): ScheduleFormState {
  return {
    shiftBlocks: weekPatternToBlocks(cloneWeekPattern(context.week_pattern)),
    effectiveFrom: context.default_effective_from,
    generateThrough: context.default_generate_through ?? "",
    limitGenerateThrough: false,
  };
}

/** Which mode the page opens in for a given employee. */
export type ScheduleMode = "preview" | "edit";

/**
 * The opening mode.
 *
 * Preview-first guards the case that can go wrong: someone with a live
 * schedule cannot nudge a block by accident. Someone with no schedule has
 * nothing to preview and editing is the only thing they can do, so an Edit
 * button in front of it would be a click that buys nothing.
 */
export function openingScheduleMode(hasLiveSchedule: boolean): ScheduleMode {
  return hasLiveSchedule ? "preview" : "edit";
}

/**
 * A stable compare key for the whole editable form.
 *
 * Cancel discards all four fields, so all four decide whether the form is
 * dirty — a key over `shiftBlocks` alone would call a changed effective date
 * clean and bin it silently. Block ids are excluded via `blocksFingerprint`:
 * reseeding from the server mints new ids for identical content, and counting
 * them would make every freshly loaded form report itself dirty.
 *
 * `generateThrough` is collapsed to "" when the limit switch is off, exactly
 * as the save path collapses it before sending. With the switch off the end
 * date is neither rendered nor submitted, so it is not part of the schedule —
 * and the server always seeds a non-empty `default_generate_through`, so
 * counting it regardless would make toggling the switch on and straight back
 * off (which clears the date) leave the form permanently dirty against a value
 * the user cannot see.
 */
export function scheduleFormFingerprint(state: ScheduleFormState): string {
  return JSON.stringify({
    blocks: blocksFingerprint(state.shiftBlocks),
    effectiveFrom: state.effectiveFrom,
    generateThrough: state.limitGenerateThrough ? state.generateThrough : "",
    limitGenerateThrough: state.limitGenerateThrough,
  });
}
