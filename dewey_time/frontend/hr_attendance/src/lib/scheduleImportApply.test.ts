import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApplyRows,
  groupRowsByPattern,
  resolveEffectiveDate,
  runScheduleImportApply,
  type ApplyRowInput,
} from "@/lib/scheduleImportApply";
import { WEEKDAYS, type WeekPattern } from "@/types/schedule";

function mkPattern(start: string, end: string): WeekPattern {
  return {
    frequency: "Every Week",
    days: WEEKDAYS.map((weekday, i) =>
      i < 5
        ? {
            weekday,
            works: true,
            start_time: start,
            end_time: end,
            lunch_start: null,
            lunch_end: null,
            grace_minutes: 10,
          }
        : { weekday, works: false }
    ),
  };
}

/**
 * Named on purpose. `ReturnType<typeof deferred>` ignores the `T = void`
 * default and instantiates `T` as `unknown`, which makes `resolve()` demand an
 * argument the callers below have no value for. `Deferred` (defaulting to
 * `void`) is what the `Map`s want.
 */
type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function row(index: number, patternKey: string): ApplyRowInput {
  return { index, employee: `E${index}`, patternKey, weekPatternJson: patternKey };
}

// ---------------------------------------------------------------------------
// buildApplyRows
// ---------------------------------------------------------------------------

test("buildApplyRows keeps only selected, importable, matched rows with a pattern", () => {
  const full = mkPattern("07:00", "17:00");
  const rows = [
    { employee: "E1", week_pattern: full, importable: true }, // 0 selected ✓
    { employee: "E2", week_pattern: full, importable: true }, // 1 not selected
    { employee: "E3", week_pattern: full, importable: false }, // 2 not importable
    { employee: null, week_pattern: full, importable: true }, // 3 no employee
    { employee: "E5", week_pattern: null, importable: true }, // 4 no pattern
  ];
  const out = buildApplyRows(rows, new Set([0, 2, 3, 4]));
  assert.deepEqual(
    out.map((r) => r.employee),
    ["E1"]
  );
  assert.equal(out[0]!.index, 0);
});

test("buildApplyRows gives identical patternKey to identical patterns and differs otherwise", () => {
  const a = mkPattern("07:00", "17:00");
  const b = mkPattern("07:00", "17:00");
  const c = mkPattern("09:00", "18:00");
  const rows = [
    { employee: "E1", week_pattern: a, importable: true },
    { employee: "E2", week_pattern: b, importable: true },
    { employee: "E3", week_pattern: c, importable: true },
  ];
  const out = buildApplyRows(rows, new Set([0, 1, 2]));
  assert.equal(out[0]!.patternKey, out[1]!.patternKey);
  assert.notEqual(out[0]!.patternKey, out[2]!.patternKey);
  assert.equal(out[0]!.weekPatternJson, out[0]!.patternKey);
});

// ---------------------------------------------------------------------------
// groupRowsByPattern
// ---------------------------------------------------------------------------

test("groupRowsByPattern buckets by patternKey preserving order", () => {
  const groups = groupRowsByPattern([
    row(1, "A"),
    row(2, "B"),
    row(3, "A"),
    row(4, "B"),
    row(5, "C"),
  ]);
  assert.deepEqual(
    groups.map((g) => g.map((r) => r.index)),
    [
      [1, 3],
      [2, 4],
      [5],
    ]
  );
});

// ---------------------------------------------------------------------------
// resolveEffectiveDate
// ---------------------------------------------------------------------------

test("resolveEffectiveDate prefers a non-blank override, else the batch date", () => {
  assert.equal(resolveEffectiveDate("A", "2026-01-01", { A: "2026-02-01" }), "2026-02-01");
  assert.equal(resolveEffectiveDate("A", "2026-01-01", { A: "  " }), "2026-01-01");
  assert.equal(resolveEffectiveDate("A", "2026-01-01", {}), "2026-01-01");
  assert.equal(resolveEffectiveDate("A", "2026-01-01"), "2026-01-01");
});

// ---------------------------------------------------------------------------
// runScheduleImportApply
// ---------------------------------------------------------------------------

test("runScheduleImportApply applies every row with the resolved effective date", async () => {
  const calls: Array<{ index: number; effective: string }> = [];
  const outcomes = await runScheduleImportApply({
    rows: [row(1, "A"), row(2, "A"), row(3, "B")],
    batchEffectiveFrom: "2026-01-01",
    groupOverrides: { B: "2026-02-01" },
    applyRow: async (r, effective) => {
      calls.push({ index: r.index, effective });
    },
  });

  assert.equal(outcomes.length, 3);
  assert.ok(outcomes.every((o) => o.ok));
  assert.deepEqual(
    calls.sort((x, y) => x.index - y.index),
    [
      { index: 1, effective: "2026-01-01" },
      { index: 2, effective: "2026-01-01" },
      { index: 3, effective: "2026-02-01" },
    ]
  );
});

test("runScheduleImportApply isolates a failing row and keeps applying the rest", async () => {
  const seen: ApplyRowInput["index"][] = [];
  const outcomes = await runScheduleImportApply({
    rows: [row(1, "A"), row(2, "A"), row(3, "B")],
    batchEffectiveFrom: "2026-01-01",
    applyRow: async (r) => {
      seen.push(r.index);
      if (r.index === 1) throw new Error("boom");
    },
    onOutcome: () => {},
  });

  assert.deepEqual([...seen].sort(), [1, 2, 3]);
  const byIndex = new Map(outcomes.map((o) => [o.index, o]));
  assert.equal(byIndex.get(1)!.ok, false);
  assert.equal((byIndex.get(1) as { error: string }).error, "boom");
  assert.equal(byIndex.get(2)!.ok, true);
  assert.equal(byIndex.get(3)!.ok, true);
});

test("runScheduleImportApply runs groups in parallel but rows within a group serially, bounded by laneLimit", async () => {
  const started: number[] = [];
  const defs = new Map<number, Deferred>();
  const rows = [row(1, "A"), row(2, "A"), row(3, "B"), row(4, "B"), row(5, "C")];

  const runPromise = runScheduleImportApply({
    rows,
    batchEffectiveFrom: "2026-01-01",
    laneLimit: 2,
    applyRow: (r) => {
      started.push(r.index);
      const d = deferred();
      defs.set(r.index, d);
      return d.promise;
    },
  });

  await flush();
  // Two lanes: group A row1, group B row3. C is queued (limit 2); row2/row4 wait (serial).
  assert.deepEqual(started, [1, 3]);

  defs.get(1)!.resolve();
  await flush();
  assert.deepEqual(started, [1, 3, 2]); // lane A advances to its second row

  defs.get(3)!.resolve();
  await flush();
  assert.deepEqual(started, [1, 3, 2, 4]); // lane B advances to its second row

  defs.get(2)!.resolve();
  await flush();
  assert.deepEqual(started, [1, 3, 2, 4, 5]); // lane A frees, picks group C

  defs.get(4)!.resolve();
  defs.get(5)!.resolve();
  const outcomes = await runPromise;
  assert.equal(outcomes.length, 5);
  assert.ok(outcomes.every((o) => o.ok));
});

test("runScheduleImportApply stops launching new rows once cancelled, finishing in-flight", async () => {
  const started: number[] = [];
  const defs = new Map<number, Deferred>();
  let cancelled = false;
  const rows = [row(1, "A"), row(2, "A"), row(3, "B")];

  const runPromise = runScheduleImportApply({
    rows,
    batchEffectiveFrom: "2026-01-01",
    laneLimit: 2,
    shouldCancel: () => cancelled,
    applyRow: (r) => {
      started.push(r.index);
      const d = deferred();
      defs.set(r.index, d);
      return d.promise;
    },
  });

  await flush();
  assert.deepEqual(started, [1, 3]);

  cancelled = true;
  defs.get(1)!.resolve();
  defs.get(3)!.resolve();
  const outcomes = await runPromise;

  // row2 is never started (cancel stops new launches); 1 and 3 still recorded.
  assert.ok(!started.includes(2));
  assert.deepEqual(outcomes.map((o) => o.index).sort(), [1, 3]);
  assert.ok(outcomes.every((o) => o.ok));
});
