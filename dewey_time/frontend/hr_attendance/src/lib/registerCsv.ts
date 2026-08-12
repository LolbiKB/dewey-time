import { registerCsvRows, type FeedHealth, type RegisterRow } from "@/lib/coverageRegister";

/**
 * Stop a spreadsheet from running the value as code.
 *
 * Excel and Sheets evaluate any cell whose text begins `=`, `+`, `-` or `@` as
 * a FORMULA. Every field in this file is text that arrived from Frappe — a
 * name, a branch, a department — so one typed with a leading `=` becomes code
 * the moment the file is opened: `=HYPERLINK(…)` posting the row somewhere, or
 * a DDE call. The reader who opens it is HR, on the machine that has the whole
 * roster on it.
 *
 * A leading apostrophe is the spreadsheet's own "treat this as text" marker and
 * is not shown as part of the value. No number this export writes is ever
 * negative, so nothing legitimate is caught by the `-` case.
 */
function asText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/**
 * One CSV field.
 *
 * `\r` as well as `\n`: a lone carriage return is a record separator to any
 * parser that still honours classic Mac line endings, Excel among them. A name
 * with a comma in it is ordinary in this data, and an unquoted one shifts every
 * later field on that row into the wrong column — silently, and in a file that
 * looks fine until someone reads a branch as a department.
 *
 * The text marker goes on FIRST, so that it lands inside the quotes on a field
 * that needs both. Outside them it would leave the field unquoted and split the
 * row on the comma it was meant to protect.
 */
function field(value: string): string {
  const text = asText(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The register as a CSV file.
 *
 * Takes the rows it is to write rather than the whole roster: the caller passes
 * what the reader is looking at — filtered and sorted — so the file and the
 * screen agree. `feeds` decides which columns exist at all, by the same rule
 * the table uses; see registerCsvRows.
 */
export function toRegisterCsv(rows: RegisterRow[], feeds: FeedHealth): string {
  return registerCsvRows(rows, feeds)
    .map((row) => row.map(field).join(","))
    .join("\n");
}
