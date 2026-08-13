import { Fragment, useState } from "react";
import { Button } from "@lolbikb/dewey-ui";
import { AlertTriangleIcon, DownloadIcon } from "lucide-react";

import { ResponsiveModal } from "@/components/ResponsiveModal";
import { AttentionStrip } from "@/components/ui/notice";
import {
  describeRegisterFilters,
  registerCsvColumns,
  type FeedHealth,
  type RegisterFilters,
  type RegisterRow,
} from "@/lib/coverageRegister";
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

/** "1 employee" / "14 employees" — the file's contents, counted aloud. */
export function employeeCount(count: number): string {
  return `${count} ${count === 1 ? "employee" : "employees"}`;
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
  /** The UNFILTERED roster's size — the denominator the confirmation reads out. */
  rosterSize: number;
  feeds: FeedHealth;
  /** What produced `rows` out of the roster. Shown, not applied. */
  filters: RegisterFilters;
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
 * Export what the reader asked for — after showing them what that is.
 *
 * The file holds the FILTERED rows, and that is the right answer: a reader who
 * narrowed to 80 findings asked about 80 findings. It is also the whole risk.
 * A spreadsheet carries no filter bar; once mailed, a file built under "Branch:
 * BRANCH-A, Status: Left" is indistinguishable from one built over the whole
 * roster, and the reader who forgot the filter was on has no way back to that
 * fact. So the narrowing is read out — in the controls' own words — before the
 * file exists rather than being reconstructed from it afterwards.
 *
 * Confirmed on EVERY export, not only a filtered one. "No filters are on" is
 * the answer the reader needs most often and the one they can least afford to
 * assume, and a dialog that appears only sometimes teaches them to dismiss it
 * without reading.
 *
 * The only piece here holding state, on purpose — see the three exports below.
 */
export function RegisterExportButton(props: RegisterExportButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <RegisterExportTrigger
        count={props.rows.length}
        truncated={props.truncated}
        expanded={open}
        onOpen={() => setOpen(true)}
      />

      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        size="md"
        title="Export this register as CSV"
        description="Check what the file will hold before it leaves the page."
        headerClassName="space-y-1.5 border-b border-border/60 px-5 py-4 text-left"
        bodyClassName="space-y-4 px-5 py-4"
        footerClassName="mx-0 mb-0 shrink-0 gap-2 border-t border-border/60 bg-muted/50 px-5 py-4 sm:justify-end"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <RegisterExportConfirm
              rows={props.rows}
              feeds={props.feeds}
              download={props.download}
              onDone={() => setOpen(false)}
            />
          </>
        }
      >
        <RegisterExportSummary
          rows={props.rows}
          rosterSize={props.rosterSize}
          feeds={props.feeds}
          filters={props.filters}
        />
      </ResponsiveModal>
    </>
  );
}

/**
 * The toolbar control that opens the confirmation.
 *
 * Its own component, and hook-free, so a suite with no DOM can reach it: the
 * dialog above it lives in a Radix portal whose container is resolved after
 * mount, so under `renderToStaticMarkup` NOTHING inside the modal reaches the
 * markup — the same escape hatch `FacetOptions` uses.
 *
 * The count in the accessible name is the FILTERED count, so a wiring change
 * that pointed the export at the whole roster or at the visible page moves the
 * label with it.
 *
 * Disabled on a truncated roster, WITH the reason in the accessible name: a
 * file that omits part of the workforce looks complete, and there is no banner
 * inside a spreadsheet to say otherwise. A control that is merely dead, with no
 * explanation, is its own defect.
 *
 * `aria-haspopup="dialog"` because it no longer downloads on press. A control
 * announced as a plain button that instead opens a surface is a small lie, and
 * this one is pressed by someone who expects a file.
 */
export function RegisterExportTrigger(props: {
  count: number;
  truncated: boolean;
  expanded: boolean;
  onOpen: () => void;
}) {
  const label = props.truncated
    ? "Export CSV — unavailable while the roster is partial, because the file would look complete"
    : `Export ${employeeCount(props.count)} as CSV`;

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={props.truncated}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={props.expanded}
      onClick={props.onOpen}
    >
      <DownloadIcon className="size-4" aria-hidden="true" />
      Export CSV
    </Button>
  );
}

/**
 * The button that actually writes the file.
 *
 * Separate, and hook-free, for the same reason the trigger is: it carries the
 * one line that decides WHAT the file contains — these rows, under these
 * feeds — and inside the modal that line is unreachable from a suite with no
 * DOM. An export rewired to the whole roster would keep every count on screen
 * and change only the file.
 */
export function RegisterExportConfirm(props: {
  rows: RegisterRow[];
  feeds: FeedHealth;
  download?: (csv: string) => void;
  onDone: () => void;
}) {
  const download = props.download ?? downloadCsv;

  return (
    <Button
      type="button"
      onClick={() => {
        download(toRegisterCsv(props.rows, props.feeds));
        props.onDone();
      }}
    >
      <DownloadIcon className="size-4" aria-hidden="true" />
      Export {employeeCount(props.rows.length)}
    </Button>
  );
}

/**
 * What the file will hold: how many, narrowed by what, and minus which columns.
 *
 * Hook-free and exported so it can be rendered directly — see the trigger's
 * note on the portal.
 */
export function RegisterExportSummary(props: {
  rows: RegisterRow[];
  rosterSize: number;
  feeds: FeedHealth;
  filters: RegisterFilters;
}) {
  const narrowings = describeRegisterFilters(props.filters);
  const { omitted } = registerCsvColumns(props.feeds);
  const count = props.rows.length;

  return (
    <>
      <p className="text-sm leading-relaxed">
        <span className="font-semibold tabular-nums">{employeeCount(count)}</span>
        {/* The denominator, always — "80 employees" reads as a fact about the
            workforce until the roster it was cut from is beside it. */}
        <span className="text-muted-foreground">
          {" "}
          of {props.rosterSize} on the register
          {count === props.rosterSize ? " — everyone" : ""}.
        </span>
      </p>

      {/* Zero is a real answer and the file is still offered, because a header
          row is a usable template. It is said plainly, though: an empty
          spreadsheet is the one result that looks the same as "nobody has a
          problem". */}
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody matches these filters, so the file will hold its header row and nothing else.
        </p>
      ) : null}

      {narrowings.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Narrowed by
          </p>
          {/* A two-column grid rather than a row per pair, so the values line
              up under each other however wide the labels are. `dt`/`dd` are the
              grid items directly — a wrapping <div> per pair would make each
              pair its own row and lose the alignment that is the point. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-border/60 px-3 py-2.5 text-sm">
            {narrowings.map((narrowing) => (
              <Fragment key={narrowing.label}>
                <dt className="text-muted-foreground">{narrowing.label}</dt>
                <dd className="min-w-0 break-words font-medium">{narrowing.value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No filters are on — this is the whole register.
        </p>
      )}

      {/* The suppression rule is right and it is silent. A spreadsheet with no
          Biometric column looks exactly like one from a build that never had
          it, so the outage has to travel as far as the file does. */}
      {omitted.length > 0 ? (
        <AttentionStrip
          tone="amber"
          icon={<AlertTriangleIcon className="size-4 text-amber-600" aria-hidden="true" />}
        >
          {omitted.join(", ")} {omitted.length === 1 ? "is" : "are"} missing from this file — the{" "}
          {!props.feeds.schedule && !props.feeds.biometric
            ? "schedule and biometric feeds are"
            : props.feeds.biometric
              ? "schedule feed is"
              : "biometric feed is"}{" "}
          unavailable, and a fact the page is hiding must not travel in a document that outlives
          the outage.
        </AttentionStrip>
      ) : null}
    </>
  );
}
