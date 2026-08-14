import { test } from "node:test";
import assert from "node:assert/strict";

import {
  summarizeReconcile,
  reconcileRetiresShifts,
  confirmNameMatches,
  scheduleFormStateFromContext,
  openingScheduleMode,
  scheduleFormFingerprint,
} from "@/lib/scheduleEdit";
import { createShiftBlock, emptyWeekPattern } from "@/types/schedule";
import type { ReconcilePreview, ScheduleContext } from "@/types/schedule";

const EMPTY: ReconcilePreview = {
  effective_from: "2026-07-01",
  disable_ssas: [],
  add_identities: [],
  unchanged_identities: [],
  add_labels: [],
  leaving_labels: [],
  affected_assignments: [],
};

test("empty reconcile reports no changes", () => {
  const s = summarizeReconcile(EMPTY);
  assert.equal(s.hasChanges, false);
  assert.deepEqual(s.lines, []);
});

test("null reconcile is safe", () => {
  const s = summarizeReconcile(null);
  assert.equal(s.hasChanges, false);
});

test("counts inactivated and trimmed with pluralization", () => {
  const r: ReconcilePreview = {
    ...EMPTY,
    disable_ssas: [{ name: "SSA-B", shift_schedule: "PAT_B" }],
    leaving_labels: ["FRI 09–17"],
    add_labels: ["SAT 08–12"],
    affected_assignments: [
      { name: "A1", start_date: "2026-07-05", action: "inactivate" },
      { name: "A2", start_date: "2026-07-12", action: "inactivate" },
      { name: "A3", start_date: "2026-06-20", action: "end_before", proposed_end_date: "2026-06-30" },
    ],
  };
  const s = summarizeReconcile(r);
  assert.equal(s.hasChanges, true);
  assert.equal(s.inactivatedCount, 2);
  assert.equal(s.trimmedCount, 1);
  assert.deepEqual(s.leavingLabels, ["FRI 09–17"]);
  assert.deepEqual(s.addingLabels, ["SAT 08–12"]);
  assert.ok(s.lines.some((l) => l.includes("2 future shifts inactivated")));
  assert.ok(s.lines.some((l) => l.includes("1 shift trimmed")));
});

test("reconcileRetiresShifts: true when SSAs are disabled", () => {
  assert.equal(
    reconcileRetiresShifts({ ...EMPTY, disable_ssas: [{ name: "S", shift_schedule: "P" }] }),
    true,
  );
});

test("reconcileRetiresShifts: true when assignments are affected", () => {
  assert.equal(
    reconcileRetiresShifts({
      ...EMPTY,
      affected_assignments: [{ name: "A", start_date: "2026-07-05", action: "inactivate" }],
    }),
    true,
  );
});

test("reconcileRetiresShifts: false for add-only / empty / null", () => {
  assert.equal(reconcileRetiresShifts({ ...EMPTY, add_identities: ["k"], add_labels: ["X"] }), false);
  assert.equal(reconcileRetiresShifts(EMPTY), false);
  assert.equal(reconcileRetiresShifts(null), false);
});

test("confirmNameMatches: exact, case-insensitive, trimmed", () => {
  assert.equal(confirmNameMatches("Jane Doe", "Jane Doe"), true);
  assert.equal(confirmNameMatches("  jane doe ", "Jane Doe"), true);
  assert.equal(confirmNameMatches("JANE DOE", "Jane Doe"), true);
});

test("confirmNameMatches: empty and mismatch are false", () => {
  assert.equal(confirmNameMatches("", "Jane Doe"), false);
  assert.equal(confirmNameMatches("Jane", "Jane Doe"), false);
  assert.equal(confirmNameMatches("Jane Doe", null), false);
});

function contextWith(overrides: Partial<ScheduleContext> = {}): ScheduleContext {
  const week_pattern = emptyWeekPattern();
  week_pattern.days[0] = {
    ...week_pattern.days[0]!,
    works: true,
    start_time: "08:00",
    end_time: "17:00",
  };
  return {
    employee: "EMP-1",
    employee_name: "Jane Doe",
    ssas: [],
    enabled_ssa_count: 0,
    can_apply: true,
    assignment_summary: {},
    week_pattern,
    default_effective_from: "2026-08-01",
    default_generate_through: "2026-10-30",
    ...overrides,
  };
}

// Regression coverage for the WeeklySchedulePage post-save re-seed: the form
// only self-updates on employee change ([context?.employee] as its effect
// dependency), so both that seed effect and the post-save refetch call this
// same function to reset the form from the server's fresh defaults.
test("scheduleFormStateFromContext seeds the form from the context's defaults", () => {
  const state = scheduleFormStateFromContext(contextWith());
  assert.equal(state.effectiveFrom, "2026-08-01");
  assert.equal(state.generateThrough, "2026-10-30");
  assert.equal(state.limitGenerateThrough, false);
  assert.equal(state.shiftBlocks.length, 1);
  assert.deepEqual(state.shiftBlocks[0]!.days, ["Monday"]);
  assert.equal(state.shiftBlocks[0]!.profile.start_time, "08:00");
  assert.equal(state.shiftBlocks[0]!.profile.end_time, "17:00");
});

// The regression this guards against: after a save with "limit end date" on
// and a chosen generateThrough, the server's post-save context reports an
// open-ended default (no generate_through). A stale re-seed would leave the
// old limited values in the form; the fresh state must reflect the server.
test("scheduleFormStateFromContext resets an open-ended generate-through and the limit toggle", () => {
  const state = scheduleFormStateFromContext(contextWith({ default_generate_through: "" }));
  assert.equal(state.generateThrough, "");
  assert.equal(state.limitGenerateThrough, false);
});

test("scheduleFormStateFromContext does not alias the context's week_pattern", () => {
  const context = contextWith();
  const state = scheduleFormStateFromContext(context);
  state.shiftBlocks[0]!.profile.start_time = "09:00";
  assert.equal(context.week_pattern.days[0]!.start_time, "08:00");
});

test("an employee with a live schedule opens in preview, one without opens in edit", () => {
  // Preview-first guards the dangerous case only. Someone with no schedule has
  // nothing to preview, and editing is the only thing they can do — an Edit
  // button in front of that is a click for nothing.
  assert.equal(openingScheduleMode(true), "preview");
  assert.equal(openingScheduleMode(false), "edit");
});

test("the form fingerprint covers every editable field, not just the blocks", () => {
  // Cancel discards all four. A fingerprint over blocks alone would call a
  // changed effective date "clean" and bin it without asking.
  const base = {
    shiftBlocks: [],
    effectiveFrom: "2026-09-01",
    generateThrough: "",
    limitGenerateThrough: false,
  };
  const baseline = scheduleFormFingerprint(base);

  assert.equal(scheduleFormFingerprint({ ...base }), baseline, "same state, same key");
  assert.notEqual(
    scheduleFormFingerprint({ ...base, effectiveFrom: "2026-09-02" }),
    baseline,
    "a changed effective date is dirty",
  );
  assert.notEqual(
    scheduleFormFingerprint({ ...base, limitGenerateThrough: true }),
    baseline,
    "toggling the limit switch is dirty",
  );

  const limited = { ...base, limitGenerateThrough: true, generateThrough: "2026-12-31" };
  assert.notEqual(
    scheduleFormFingerprint({ ...limited, generateThrough: "2027-01-31" }),
    scheduleFormFingerprint(limited),
    "a changed end date is dirty while the limit is on",
  );
});

test("the end date is ignored while the limit switch is off", () => {
  // The server ALWAYS seeds a non-empty default_generate_through
  // (schedule_api.py:295), and the switch's own handler clears the date when
  // it is turned off. So a user who toggles the limit on and straight back off
  // lands on generateThrough "" against a seeded date — with the switch off,
  // the field is neither rendered nor submitted, so counting it would leave
  // the form permanently dirty against a value nobody can see, and Cancel
  // would raise a confirm about invisible edits.
  const off = (generateThrough: string) => ({
    shiftBlocks: [],
    effectiveFrom: "2026-09-01",
    generateThrough,
    limitGenerateThrough: false,
  });
  assert.equal(scheduleFormFingerprint(off("")), scheduleFormFingerprint(off("2026-09-29")));
});

test("the fingerprint ignores block ids, as blocksFingerprint does", () => {
  // Reseeding from the server mints new block ids for identical content. If ids
  // counted, every freshly loaded form would report itself dirty and every
  // employee switch would raise a confirm nobody caused.
  //
  // `createShiftBlock` is the exported builder — ShiftBlock.profile has five
  // required fields and there is no exported `defaultShiftProfile`.
  const state = (id: string) => ({
    shiftBlocks: [createShiftBlock({ id, days: ["Monday" as const] })],
    effectiveFrom: "2026-09-01",
    generateThrough: "",
    limitGenerateThrough: false,
  });
  assert.notEqual(state("a").shiftBlocks[0]!.id, state("b").shiftBlocks[0]!.id);
  assert.equal(scheduleFormFingerprint(state("a")), scheduleFormFingerprint(state("b")));
});
