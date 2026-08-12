import { Button } from "@lolbikb/dewey-ui";
import { DownloadIcon } from "lucide-react";

import type { FeedHealth, RegisterRow } from "@/lib/coverageRegister";
import { toRegisterCsv } from "@/lib/registerCsv";

/**
 * Hand the reader the file.
 *
 * The only browser-side-effect code on this page, which is why it lives here
 * rather than in CoverageRegisterPage: it needs a DOM, and the suite that
 * covers the register has none.
 */
export function downloadCsv(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `coverage-register-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type RegisterExportButtonProps = {
  /**
   * Every row the reader's filters admit — filtered and sorted, but NOT paged.
   *
   * Narrower than the roster and wider than the screen. The table shows one
   * page of these; the file holds all of them, because a reader who narrowed to
   * 80 findings asked about 80 findings, not about the 50 that happened to fit.
   */
  rows: RegisterRow[];
  feeds: FeedHealth;
  truncated: boolean;
  /**
   * Where the file goes. Defaulted, so no caller passes it.
   *
   * Parameterised because `downloadCsv` needs a DOM and this suite has none:
   * without the seam, the one line that decides WHAT the file contains — these
   * rows, under these feeds — could not be reached by any test, and an export
   * rewired to the whole roster or to the wrong feed health would stay green.
   * The row count in the accessible name is a proxy for the props, not for that
   * call.
   */
  download?: (csv: string) => void;
};

/**
 * Export what the reader asked for.
 *
 * `rows` is the filtered, sorted set BEHIND the table — every row the filters
 * admit, not the page of them on screen — and the accessible name counts that
 * same array, so a wiring change that exported the whole roster or only the
 * visible page moves the label with it. A file that silently disagreed with
 * the question it came from is indistinguishable from one that agrees, once it
 * has been mailed to somebody.
 *
 * Disabled on a truncated roster, WITH the reason in the accessible name: a
 * file that omits part of the workforce looks complete, and there is no banner
 * inside a spreadsheet to say otherwise. A control that is merely dead, with no
 * explanation, is its own defect.
 */
export function RegisterExportButton(props: RegisterExportButtonProps) {
  const download = props.download ?? downloadCsv;
  const label = props.truncated
    ? "Export CSV — unavailable while the roster is partial, because the file would look complete"
    : `Export ${props.rows.length} ${props.rows.length === 1 ? "employee" : "employees"} as CSV`;

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={props.truncated}
      aria-label={label}
      title={label}
      onClick={() => download(toRegisterCsv(props.rows, props.feeds))}
    >
      <DownloadIcon className="size-4" aria-hidden="true" />
      Export CSV
    </Button>
  );
}
