import { BUCKET_LABELS, type EnrollmentRow } from "@/lib/enrollmentReport";

const HEADERS = [
  "Employee ID",
  "Name",
  "Branch",
  "Department",
  "Employment status",
  "Enrollment state",
  "Fingerprints",
  "Days since leaving",
];

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // \r as well as \n: a lone carriage return is a record separator to any
  // parser that still honours classic Mac line endings, Excel among them.
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export type CsvContext = {
  /** Frappe datetime of the snapshot, or null when the feed never reported. */
  snapshotAt: string | null;
  /** Human description of the active filters, e.g. "Branch: ACES". */
  filterLabel: string;
};

/**
 * Rows → CSV.
 *
 * The snapshot time is a ROW in the file, not just the filename: a CSV outlives
 * its context, and without it stale enrollment data reads as current three
 * weeks later. The filter is recorded for the same reason — a narrowed export
 * must not be mistaken for the whole roster.
 */
export function toEnrollmentCsv(rows: EnrollmentRow[], context: CsvContext): string {
  const lines = [
    `Snapshot taken,${cell(context.snapshotAt ?? "never — feed not connected")}`,
    `Filter,${cell(context.filterLabel)}`,
    "",
    HEADERS.join(","),
  ];

  for (const row of rows) {
    lines.push(
      [
        cell(row.id),
        cell(row.employee_name),
        cell(row.branch),
        cell(row.department),
        cell(row.status),
        cell(BUCKET_LABELS[row.bucket]),
        cell(row.fingerprint_count),
        cell(row.days_since_relieving),
      ].join(","),
    );
  }

  return lines.join("\n");
}
