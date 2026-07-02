import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import { extractFrappeError } from "@/lib/frappeError";
import {
  buildApplyRows,
  runScheduleImportApply,
  type ApplyOutcome,
} from "@/lib/scheduleImportApply";
import {
  clearImportState,
  loadImportState,
  saveImportState,
} from "@/lib/scheduleImportPersist";
import type {
  FeedbackRow,
  ParsedRow,
  ParseResult,
  ParseSummary,
  RowApplyStatus,
  RowFilter,
} from "@/types/scheduleImport";
import { APPLY_METHOD, PARSE_METHOD } from "@/ui/schedule-import/constants";
import { fileToBase64 } from "@/ui/schedule-import/format";

export type ImportStep = "idle" | "parsing" | "preview" | "applying" | "done";

/**
 * Pattern groups applied concurrently. Set to 1 (serial) so the import never runs
 * two apply transactions at once: concurrent lanes were the root of the InnoDB
 * deadlocks and the "Could not find Shift Type / Shift Schedule" snapshot races when
 * lanes create the same shared Shift Type / PAT. The backend recovers from those
 * races (find-or-create + retry), but serial import removes the contention entirely —
 * the right trade for a one-time bulk import. Raise to 2–3 only if speed demands it.
 */
const LANE_LIMIT = 1;

function getSessionStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function useScheduleImport(options?: {
  defaultEffectiveFrom?: string;
  onApplied?: () => void;
}) {
  const defaultEffectiveFrom = options?.defaultEffectiveFrom ?? "";

  const [step, setStep] = useState<ImportStep>("idle");
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [feedbackRows, setFeedbackRows] = useState<FeedbackRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom);
  const [groupOverrides, setGroupOverrides] = useState<Record<string, string>>({});
  const [applyStatuses, setApplyStatuses] = useState<Record<number, RowApplyStatus>>({});
  // ISO timestamp of when THIS tab's apply run finished — stamped into the problems
  // export so a stale tab's re-download is recognizable. Null until an apply runs.
  const [appliedAt, setAppliedAt] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  // Frozen at apply() start so the progress denominator can't shift if anything
  // touches the selection mid-run.
  const [applyTotal, setApplyTotal] = useState(0);

  const cancelRef = useRef(false);
  const hydratedRef = useRef(false);

  const { call: callParse } = useFrappePostCall<{ message: ParseResult }>(PARSE_METHOD);
  const { call: callApply } = useFrappePostCall<{ message: unknown }>(APPLY_METHOD);

  // Restore an in-progress review from a previous visit (refresh / back-nav).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const storage = getSessionStorage();
    if (!storage) return;
    const saved = loadImportState(storage);
    if (!saved || !saved.rows.length) return;
    setRows(saved.rows);
    setSummary(saved.summary);
    setFeedbackRows(saved.feedbackRows ?? []);
    setSelected(new Set(saved.selected));
    setRowFilter(saved.rowFilter ?? "all");
    if (saved.effectiveFrom) setEffectiveFrom(saved.effectiveFrom);
    setGroupOverrides(saved.groupOverrides ?? {});
    setStep("preview");
  }, []);

  // Persist the review state (only while reviewing) so a refresh restores it.
  // Debounced: a large import re-serializes the whole row set on every checkbox
  // toggle otherwise. The cleanup also cancels a pending write when the step
  // leaves "preview" (e.g. apply starts), so no stale snapshot is re-saved.
  useEffect(() => {
    if (step !== "preview" || !summary || !rows.length) return;
    const storage = getSessionStorage();
    if (!storage) return;
    const handle = setTimeout(() => {
      saveImportState(storage, {
        rows,
        summary,
        feedbackRows,
        selected: [...selected],
        rowFilter,
        effectiveFrom,
        groupOverrides,
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [step, rows, summary, feedbackRows, selected, rowFilter, effectiveFrom, groupOverrides]);

  const reset = useCallback(() => {
    const storage = getSessionStorage();
    if (storage) clearImportState(storage);
    setStep("idle");
    setParseError(null);
    setRows([]);
    setSummary(null);
    setFeedbackRows([]);
    setSelected(new Set());
    setRowFilter("all");
    setGroupOverrides({});
    setApplyStatuses({});
    setAppliedAt(null);
    setApplyTotal(0);
    setCurrentFileName(null);
    cancelRef.current = false;
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setCurrentFileName(file.name);
      setParseError(null);
      setApplyStatuses({});
      setAppliedAt(null);
      setStep("parsing");
      try {
        const b64 = await fileToBase64(file);
        const result = await callParse({ file_b64: b64, filename: file.name });
        const parsed: ParseResult = result?.message ?? (result as unknown as ParseResult);
        setRows(parsed.rows);
        setSummary(parsed.summary);
        setFeedbackRows(parsed.feedback_rows ?? []);
        setSelected(
          new Set(parsed.rows.map((r, i) => (r.importable ? i : -1)).filter((i) => i >= 0))
        );
        const s = parsed.summary;
        // Don't open Review on an empty list: if nothing is importable but rows
        // exist (a common first-attempt outcome), show the problems instead.
        setRowFilter(
          s.importable === 0 && s.total_rows > 0
            ? "errors"
            : s.importable < s.total_rows
              ? "importable"
              : "all"
        );
        setStep("preview");
      } catch (err) {
        setParseError(extractFrappeError(err));
        setStep("idle");
      }
    },
    [callParse]
  );

  const toggleRow = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const setRowsSelected = useCallback((indexes: number[], value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const i of indexes) {
        if (value) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  }, []);

  const setGroupOverride = useCallback((patternKey: string, date: string) => {
    setGroupOverrides((prev) => {
      const next = { ...prev };
      if (date) next[patternKey] = date;
      else delete next[patternKey];
      return next;
    });
  }, []);

  const apply = useCallback(async () => {
    if (!effectiveFrom) return;
    const applyRows = buildApplyRows(rows, selected);
    if (!applyRows.length) return;

    cancelRef.current = false;
    setApplyStatuses({});
    setApplyTotal(applyRows.length);
    // Drop the persisted preview snapshot now: a refresh mid-apply must restart
    // from upload, never re-apply already-saved employees from a stale snapshot.
    const storage = getSessionStorage();
    if (storage) clearImportState(storage);
    setStep("applying");

    let anyOk = false;
    await runScheduleImportApply({
      rows: applyRows,
      batchEffectiveFrom: effectiveFrom,
      groupOverrides,
      laneLimit: LANE_LIMIT,
      shouldCancel: () => cancelRef.current,
      applyRow: async (row, effective) => {
        setApplyStatuses((prev) => ({ ...prev, [row.index]: { type: "applying" } }));
        try {
          await callApply({
            employee: row.employee,
            week_pattern: row.weekPatternJson,
            create_shifts_after: effective,
            generate_through: "",
            confirm_create: 1,
            derive_employment_type: 1,
          });
        } catch (err) {
          throw new Error(extractFrappeError(err, "Failed"));
        }
      },
      onOutcome: (outcome: ApplyOutcome) => {
        if (outcome.ok) anyOk = true;
        setApplyStatuses((prev) => ({
          ...prev,
          [outcome.index]: outcome.ok
            ? { type: "ok" }
            : { type: "error", message: outcome.error },
        }));
      },
    });

    setAppliedAt(new Date().toISOString());
    setStep("done");
    if (anyOk) options?.onApplied?.();
  }, [rows, selected, effectiveFrom, groupOverrides, callApply, options]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const eligibleCount = useMemo(
    () => rows.filter((r, i) => r.importable && selected.has(i)).length,
    [rows, selected]
  );
  const doneCount = useMemo(
    () => Object.values(applyStatuses).filter((s) => s.type === "ok").length,
    [applyStatuses]
  );
  const failCount = useMemo(
    () => Object.values(applyStatuses).filter((s) => s.type === "error").length,
    [applyStatuses]
  );
  const settledCount = doneCount + failCount;

  return {
    step,
    parseError,
    rows,
    summary,
    feedbackRows,
    selected,
    rowFilter,
    effectiveFrom,
    groupOverrides,
    applyStatuses,
    appliedAt,
    currentFileName,
    eligibleCount,
    applyTotal,
    doneCount,
    failCount,
    settledCount,
    setRowFilter,
    setEffectiveFrom,
    setGroupOverride,
    toggleRow,
    setRowsSelected,
    handleFile,
    apply,
    cancel,
    reset,
  };
}

export type ScheduleImportController = ReturnType<typeof useScheduleImport>;
