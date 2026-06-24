/**
 * Build and serialise the "Problems" export for the schedule-import dialog.
 *
 * Two kinds of problem feed one export:
 *  1. Parse-time issues — every validation issue Frappe attached to a row
 *     (EMPLOYEE_NOT_FOUND, bad times, warnings, …), already flattened into
 *     `feedback_rows` by the backend.
 *  2. Apply-time failures — rows the backend rejected when the user clicked
 *     Apply. These live in the dialog's per-row `applyStatuses` and were never
 *     exportable before, so a red row meant eyeballing the whole list.
 *
 * Both are merged, sorted by row number, and serialised to the same CSV shape
 * the AI-normaliser feedback already used.
 */

export type ProblemRow = {
  row_number: number;
  employee_id: string;
  email: string;
  employee_name: string;
  field: string;
  code: string;
  severity: string;
  message: string;
  suggestion: string;
};

type FeedbackInput = {
  row_number: number;
  employee_id: string;
  email: string;
  employee_name?: string;
  field: string;
  code: string;
  severity: string;
  message: string;
  suggestion: string;
};

type RowRef = {
  row_number: number;
  id_card: string;
  email: string;
  employee_name?: string | null;
};

type ApplyStatusLike = { type: string; message?: string };

const CSV_HEADER =
  "row_number,employee_id,email,employee_name,field,code,severity,message,suggestion";

export function buildProblemRows(
  feedback: FeedbackInput[],
  rows: RowRef[],
  applyStatuses: Record<number, ApplyStatusLike>,
): ProblemRow[] {
  const problems: ProblemRow[] = feedback.map((f) => ({
    row_number: f.row_number,
    employee_id: f.employee_id,
    email: f.email,
    employee_name: f.employee_name ?? "",
    field: f.field,
    code: f.code,
    severity: f.severity,
    message: f.message,
    suggestion: f.suggestion,
  }));

  for (const [key, status] of Object.entries(applyStatuses)) {
    if (status?.type !== "error") continue;
    const row = rows[Number(key)];
    if (!row) continue;
    problems.push({
      row_number: row.row_number,
      employee_id: row.id_card,
      email: row.email,
      employee_name: row.employee_name ?? "",
      field: "apply",
      code: "APPLY_FAILED",
      severity: "error",
      message: status.message?.trim() || "Apply failed.",
      suggestion: "",
    });
  }

  // Stable sort keeps parse issues before an apply failure for the same row.
  return problems.sort((a, b) => a.row_number - b.row_number);
}

export function problemsToCsv(rows: ProblemRow[]): string {
  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.row_number,
      r.employee_id,
      r.email,
      r.employee_name,
      r.field,
      r.code,
      r.severity,
      r.message,
      r.suggestion,
    ]
      .map(escape)
      .join(","),
  );
  return [CSV_HEADER, ...lines].join("\n");
}
