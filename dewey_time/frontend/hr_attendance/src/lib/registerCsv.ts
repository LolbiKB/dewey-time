import { registerCsvRows, type FeedHealth, type RegisterRow } from "@/lib/coverageRegister";

/**
 * One CSV field.
 *
 * `\r` as well as `\n`: a lone carriage return is a record separator to any
 * parser that still honours classic Mac line endings, Excel among them. A name
 * with a comma in it is ordinary in this data, and an unquoted one shifts every
 * later field on that row into the wrong column — silently, and in a file that
 * looks fine until someone reads a branch as a department.
 */
function field(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
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
