import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";

import { AlertDot } from "@/ui/schedule-coverage/AlertDot";
import { registerColumns } from "@/ui/schedule-coverage/registerColumns";
import { visibleColumnIds } from "@/lib/coverageRegister";
import type { FeedHealth, RegisterAlert, RegisterRow } from "@/lib/coverageRegister";
import {
  CoverageRegisterView,
  toggleReadiness,
  type CoverageRegisterViewProps,
} from "@/ui/schedule-coverage/CoverageRegisterPage";

const noop = () => {};

const BASE_ROW: RegisterRow = {
  id: "EMP-0001",
  employee_name: "Amara Okafor",
  branch: "Lagos",
  department: "Ops",
  status: "Active",
  schedule: "assigned",
  weekly_minutes: 2400,
  biometric: "enrolled",
  fingerprint_count: 2,
  days_since_relieving: null,
};

/**
 * Renders one row through the REAL @tanstack/react-table runtime (not a hand
 * built CellContext) so every column's `cell` renders exactly as the app
 * will call it — no `as any`/`as unknown as` stand-in for the parts of
 * CellContext the columns don't use.
 *
 * Returns both the per-column rendered HTML (for text/class assertions) and
 * the raw, un-rendered React element each `cell` function returned (for
 * introspecting props like `onClick` — a function prop that `renderToStatic-
 * Markup` drops from its HTML output entirely, so it cannot be checked from
 * `html` alone). The element comes from calling `columnDef.cell` directly
 * with the table's own `cell.getContext()` — the same context flexRender
 * would pass it — not a hand-built stand-in.
 */
function renderRow(
  row: RegisterRow,
  onOpen: (row: RegisterRow) => void = noop,
  onAddSchedule: (row: RegisterRow) => void = noop,
): { html: Record<string, string>; elements: Record<string, ReactNode> } {
  const elements: Record<string, ReactNode> = {};
  function Harness() {
    const table = useReactTable({
      data: [row],
      columns: registerColumns(onOpen, onAddSchedule),
      getCoreRowModel: getCoreRowModel(),
    });
    const tableRow = table.getRowModel().rows[0];
    return (
      <table>
        <tbody>
          <tr>
            {tableRow.getVisibleCells().map((cell) => {
              const def = cell.column.columnDef;
              const rendered = typeof def.cell === "function" ? def.cell(cell.getContext()) : def.cell;
              elements[cell.column.id] = rendered;
              return (
                <td key={cell.id} data-col={cell.column.id}>
                  {rendered}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    );
  }
  const fullHtml = renderToStaticMarkup(<Harness />);
  const html: Record<string, string> = {};
  for (const match of fullHtml.matchAll(/<td data-col="([^"]+)">(.*?)<\/td>/g)) {
    html[match[1]] = match[2];
  }
  return { html, elements };
}

/** Narrows a rendered node to its `onClick`, without an `as any`/`as unknown as` cast. */
function onClickOf(node: ReactNode): (() => void) | undefined {
  if (!isValidElement<{ onClick?: () => void }>(node)) return undefined;
  return node.props.onClick;
}

// ---------------------------------------------------------------------------
// AlertDot
// ---------------------------------------------------------------------------

test("the dot carries its count and words in the accessible name", () => {
  // "Minimal via colour" cannot be colour alone: red/green is the most common
  // colour blindness, and a hue tells a screen reader nothing.
  const html = renderToStaticMarkup(
    <AlertDot
      alert={{ tone: "problem", count: 8, knowable: true, label: "8 need attention — show them" }}
      active={false}
      onToggle={noop}
    />,
  );
  assert.match(html, /aria-label="8 need attention — show them"/);
});

test("dropping the accessible name is not silently OK", () => {
  // Pins that the label MUST be the aria-label, not merely present somewhere —
  // a dot with a `title` but no `aria-label` would pass a looser "contains the
  // count" check while still being invisible to a screen reader.
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 8, knowable: true, label: "8 need attention" }}
              active={false} onToggle={noop} />,
  );
  const button = html.match(/<button[^>]*>/)?.[0] ?? "";
  assert.match(button, /aria-label="[^"]+"/, "the button must carry an aria-label");
});

test("the clear state is a hollow ring — not a filled disc of any kind", () => {
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "clear", count: 0, knowable: true, label: "All 241 ready" }}
              active={false} onToggle={noop} />,
  );
  // Direction, not difference: a swap that gives `clear` the filled look
  // must fail this, not merely "differ from problem" (which a swap also
  // satisfies).
  assert.match(html, /border-2/, "clear must be a ring");
  assert.doesNotMatch(html, /bg-destructive/, "clear must not carry the problem fill");
  assert.doesNotMatch(html, /bg-brand-accent/, "clear must not carry the degraded fill");
  assert.doesNotMatch(html, /ring-offset-2/, "clear must not carry degraded's concentric ring");
});

test("the problem state is a filled disc with a halo — no ring, no border", () => {
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 3, knowable: true, label: "3 need attention" }}
              active={false} onToggle={noop} />,
  );
  assert.match(html, /bg-destructive/, "problem must be filled");
  assert.doesNotMatch(html, /border-2/, "problem must not carry clear's ring");
  assert.doesNotMatch(html, /ring-offset-2/, "problem must not carry degraded's concentric ring");
});

test("the degraded state is a filled disc PLUS its own concentric ring — a third, distinct shape", () => {
  // Colour never carries meaning alone: with only two shapes (filled disc /
  // hollow ring) for three states, `problem` and `degraded` would be
  // distinguished by hue alone — exactly what the rule forbids, and the one
  // case (a feed down, count only partial) where under-noticing costs most.
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "degraded", count: 5, knowable: false, label: "5 need attention · biometrics unavailable" }}
              active={false} onToggle={noop} />,
  );
  assert.match(html, /bg-brand-accent/, "degraded must be filled");
  assert.match(html, /ring-offset-2/, "degraded must carry its own concentric ring, separate from problem's plain disc");
  assert.doesNotMatch(html, /border-2/, "degraded must not carry clear's hollow-ring look");
  // The ring is what makes degraded a distinct SHAPE; the halo is what keeps
  // it as loud as problem. Dropping the halo would leave the state that says
  // "this count is partial" quieter than the one that says "here are the
  // problems" — under-noticing, in the case where it costs most. Tailwind
  // composes shadow-* and ring-* into one box-shadow via separate custom
  // properties, so both survive; this pins that they are both emitted.
  assert.match(html, /shadow-\[0_0_0_3px\]/, "degraded must keep problem's halo, not just the ring");
});

test("the clear state still renders — absence is not a signal", () => {
  const clear = renderToStaticMarkup(
    <AlertDot alert={{ tone: "clear", count: 0, knowable: true, label: "All 241 ready" }}
              active={false} onToggle={noop} />,
  );
  assert.match(clear, /<button/);
  assert.match(clear, /data-tone="clear"/);
  assert.match(clear, /aria-label="All 241 ready"/);
});

test("aria-pressed follows the active prop in both directions", () => {
  const pressed = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active onToggle={noop} />,
  );
  const unpressed = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active={false} onToggle={noop} />,
  );
  assert.match(pressed, /aria-pressed="true"/);
  assert.match(unpressed, /aria-pressed="false"/);
});

test("active adds its own visible ring, not just the aria-pressed attribute", () => {
  // aria-pressed alone is enough for assistive tech, but a sighted mouse/
  // touch user toggling the dot needs a visual confirmation too.
  const active = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active onToggle={noop} />,
  );
  const inactive = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active={false} onToggle={noop} />,
  );
  assert.match(active, /ring-offset-1/, "the active state must carry its own ring");
  assert.doesNotMatch(inactive, /ring-offset-1/, "an inactive dot must not carry the active ring");
});

test("the dot's onClick is wired directly to onToggle, not dropped or copied", () => {
  let calls = 0;
  const onToggle = () => {
    calls += 1;
  };
  // AlertDot uses no hooks, so it can be called directly as a plain
  // function to get back the exact element it constructs.
  const element = AlertDot({
    alert: { tone: "problem", count: 1, knowable: true, label: "1 needs attention" },
    active: false,
    onToggle,
  });
  assert.equal(onClickOf(element), onToggle, "the button's onClick must be the exact onToggle reference");
  onClickOf(element)?.();
  assert.equal(calls, 1);
});

test("the hit area is a padded button around a same-size 12px dot", () => {
  // WCAG 2.5.8's 24x24 CSS px minimum target size: the visual dot alone is
  // 12px, so the interactive <button> needs its own padding rather than
  // being exactly the dot's size.
  const html = renderToStaticMarkup(
    <AlertDot alert={{ tone: "problem", count: 1, knowable: true, label: "1 needs attention" }}
              active={false} onToggle={noop} />,
  );
  const button = html.match(/<button[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(button, /size-3\b/, "the button itself must not be sized down to the dot's 12px box");
  assert.match(button, /class="[^"]*\bp-\d/, "the button needs its own padding beyond the dot");
  const span = html.match(/<span[^>]*>/)?.[0] ?? "";
  assert.match(span, /aria-hidden="true"/, "the visual dot is decorative — the button already carries the label");
  assert.match(span, /size-3\b/, "the visual dot itself stays 12px");
});

// ---------------------------------------------------------------------------
// registerColumns — id contract
// ---------------------------------------------------------------------------

test("every column id is one visibleColumnIds knows about", () => {
  // A typo here silently makes a column permanently invisible.
  const ids = registerColumns(noop, noop).map((c) => c.id);
  const known = visibleColumnIds({ schedule: true, biometric: true });
  for (const id of ids) assert.ok(known.includes(id!), `unknown column id: ${id}`);
  for (const id of known) assert.ok(ids.includes(id), `visibleColumnIds names a column that does not exist: ${id}`);
});

// ---------------------------------------------------------------------------
// registerColumns — cell content
// ---------------------------------------------------------------------------

test("the biometric column shows the right label and variant for each of the four buckets", () => {
  const cases: { biometric: NonNullable<RegisterRow["biometric"]>; label: string; variant: string }[] = [
    { biometric: "enrolled", label: "Enrolled", variant: "secondary" },
    { biometric: "enrolled_not_punching", label: "Enrolled, not punching", variant: "outline" },
    { biometric: "none", label: "No fingerprint", variant: "destructive" },
    { biometric: "still_enrolled", label: "Still enrolled", variant: "destructive" },
  ];
  for (const { biometric, label, variant } of cases) {
    const { html } = renderRow({ ...BASE_ROW, biometric });
    assert.match(html.biometric, new RegExp(`>${label}<`), `${biometric} must show "${label}"`);
    assert.match(html.biometric, new RegExp(`data-variant="${variant}"`), `${biometric} must use the ${variant} variant`);
  }
});

test("a still-enrolled leaver's day count is singular at 1 and plural otherwise", () => {
  const singular = renderRow({ ...BASE_ROW, biometric: "still_enrolled", days_since_relieving: 1 }).html.biometric;
  const plural = renderRow({ ...BASE_ROW, biometric: "still_enrolled", days_since_relieving: 42 }).html.biometric;
  assert.match(singular, />1 day</);
  assert.doesNotMatch(singular, />1 days</);
  assert.match(plural, />42 days</);
});

test("the schedule column shows Assigned/secondary vs Missing/outline", () => {
  const assigned = renderRow({ ...BASE_ROW, schedule: "assigned" }).html.schedule;
  const missing = renderRow({ ...BASE_ROW, schedule: "missing" }).html.schedule;
  assert.match(assigned, />Assigned</);
  assert.match(assigned, /data-variant="secondary"/);
  assert.match(missing, />Missing</);
  assert.match(missing, /data-variant="outline"/);
});

test("the status column shows Active/secondary vs Left/destructive, and blanks when unknown", () => {
  const active = renderRow({ ...BASE_ROW, status: "Active" }).html.status;
  const left = renderRow({ ...BASE_ROW, status: "Left" }).html.status;
  const unknown = renderRow({ ...BASE_ROW, status: null }).html.status;
  assert.match(active, />Active</);
  assert.match(active, /data-variant="secondary"/);
  assert.match(left, />Left</);
  assert.match(left, /data-variant="destructive"/);
  assert.equal(unknown, "—");
});

test("the employee cell shows the name and id, not the branch", () => {
  const { html } = renderRow(BASE_ROW);
  assert.match(html.employee, />Amara Okafor</);
  assert.match(html.employee, />EMP-0001</);
  assert.doesNotMatch(html.employee, />Lagos</, "the employee cell must not render the branch");
});

test("weekly_minutes renders the formatted duration, 0h for a real zero, and an em dash only when unknown", () => {
  const formatted = renderRow({ ...BASE_ROW, weekly_minutes: 130 }).html.weekly_minutes;
  const zero = renderRow({ ...BASE_ROW, weekly_minutes: 0 }).html.weekly_minutes;
  const unknown = renderRow({ ...BASE_ROW, weekly_minutes: null }).html.weekly_minutes;
  // Pins that the column calls formatScheduleDuration rather than rendering
  // the raw minute count.
  assert.equal(formatted, "2h 10m");
  // A real 0-minute assigned schedule is itself a coverage problem and must
  // not read the same as a feed that never reported the fact at all —
  // formatScheduleDuration alone collapses both to "—".
  assert.equal(zero, "0h");
  assert.equal(unknown, "—");
});

test("a null branch, department, and fingerprint_count render as an em dash, never a plausible default", () => {
  const { html } = renderRow({
    ...BASE_ROW,
    branch: null,
    department: null,
    fingerprint_count: null,
  });
  assert.equal(html.branch, "—");
  assert.equal(html.department, "—");
  assert.equal(html.fingerprint_count, "—");
});

test("a null schedule and null biometric render as an em dash, not a badge", () => {
  const { html } = renderRow({ ...BASE_ROW, schedule: null, biometric: null });
  assert.equal(html.schedule, "—");
  assert.equal(html.biometric, "—");
});

// ---------------------------------------------------------------------------
// registerColumns — the action column
// ---------------------------------------------------------------------------

test("a row with both problems gets Open, not Add schedule — the leaver case this page exists for", () => {
  // Coverage filters status:Active live while the enrollment snapshot can lag
  // by up to STALE_AFTER_MINUTES, so schedule:"missing" AND
  // biometric:"still_enrolled" on the same row is the ordinary shape of a
  // recent leaver, not an edge case. severity() in coverageRegister.ts ranks
  // still_enrolled worst (0) and puts this row first when filtered to
  // not-ready — the action column's priority must agree, or the one row the
  // register exists to surface offers to schedule a shift for someone who
  // has left instead of the path to revoke their access.
  const { html } = renderRow({
    ...BASE_ROW,
    schedule: "missing",
    biometric: "still_enrolled",
    days_since_relieving: 42,
  });
  assert.match(html.action, />Open</);
  assert.doesNotMatch(html.action, />Add schedule</);
});

test("Add schedule is wired to onAddSchedule, and never fires onOpen", () => {
  const opened: RegisterRow[] = [];
  const scheduled: RegisterRow[] = [];
  const row = { ...BASE_ROW, schedule: "missing" as const, biometric: "enrolled" as const };
  const { elements } = renderRow(
    row,
    (r) => opened.push(r),
    (r) => scheduled.push(r),
  );
  const onClick = onClickOf(elements.action);
  assert.ok(onClick, "the action cell must render a clickable button");
  onClick();
  assert.deepEqual(scheduled, [row]);
  assert.deepEqual(opened, [], "Add schedule must not also fire onOpen");
});

test("Open is wired to onOpen, and never fires onAddSchedule", () => {
  const opened: RegisterRow[] = [];
  const scheduled: RegisterRow[] = [];
  const row = { ...BASE_ROW, schedule: "assigned" as const, biometric: "still_enrolled" as const };
  const { elements } = renderRow(
    row,
    (r) => opened.push(r),
    (r) => scheduled.push(r),
  );
  const onClick = onClickOf(elements.action);
  assert.ok(onClick, "the action cell must render a clickable button");
  onClick();
  assert.deepEqual(opened, [row]);
  assert.deepEqual(scheduled, [], "Open must not also fire onAddSchedule");
});

test("the action column stays empty for enrolled-not-punching", () => {
  // A button here is what made the old Needs list read as a to-do list for
  // something that is not actually a coverage problem.
  const { html } = renderRow({ ...BASE_ROW, biometric: "enrolled_not_punching", schedule: "assigned" });
  assert.doesNotMatch(html.action, /data-slot="button"/);
});

test("a fully ready row has no action button at all", () => {
  const { html } = renderRow({ ...BASE_ROW, schedule: "assigned", biometric: "enrolled" });
  assert.doesNotMatch(html.action, /data-slot="button"/);
});

// ---------------------------------------------------------------------------
// CoverageRegisterPage — the source contract
//
// These read the file rather than render it. The page half owns the router and
// react-query wiring, and this suite has no jsdom, so what it DELEGATES is the
// only thing checkable from outside. Everything the page actually renders is
// exercised for real against CoverageRegisterView further down.
// ---------------------------------------------------------------------------

const pageSource = readFileSync(
  new URL("./schedule-coverage/CoverageRegisterPage.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

test("the page uses dewey-ui Page chrome like every other routed page", () => {
  // The old biometrics page was the only routed page without it, which is why
  // the shared nav shifted 16px between tabs (Page is px-5 sm:px-8, that page
  // hand-rolled px-4).
  assert.ok(pageSource.includes("<Page>"), "expected <Page> from @lolbikb/dewey-ui");
  assert.ok(pageSource.includes("PageHeader"), "expected PageHeader");
  assert.ok(!/className="[^"]*\bpx-4\b/.test(pageSource), "no hand-rolled page inset");
});

test("the page gates on hrStaff like its siblings", () => {
  assert.ok(pageSource.includes("hrStaff"));
  assert.ok(pageSource.includes("Navigate"));
  // Direction, not just presence. Deleting the guard while leaving the outlet
  // context destructured — which is what removing the gate actually looks like
  // in a diff — keeps both strings above in the file, so on their own they
  // cannot fail for the mutation they exist to catch.
  assert.match(
    pageSource,
    /if \(!hrStaff\)[\s\S]{0,120}<Navigate to="\/hr-attendance" replace \/>/,
    "a non-HR visitor must be redirected, not merely have their role read",
  );
});

test("the page holds no ROW derivation of its own", () => {
  // All logic lives in lib/ as pure tested functions. A second site would drift.
  // Assert delegation rather than banning `.filter(` outright: the page
  // legitimately filters the COLUMN list by visibility. What must never appear
  // is row derivation.
  assert.ok(pageSource.includes("filterRegisterRows"), "rows come from filterRegisterRows");
  assert.ok(pageSource.includes("sortRegisterRows"), "rows come from sortRegisterRows");
  assert.ok(!pageSource.includes("rows.filter("), "row filtering belongs in filterRegisterRows");
  assert.ok(!pageSource.includes(".sort("), "sorting belongs in sortRegisterRows");
  assert.ok(!pageSource.includes("localeCompare"), "name ordering belongs in sortRegisterRows");
  assert.ok(!pageSource.includes("isNotReady"), "readiness belongs in coverageRegister.ts");
});

test("the page renders the hook's rows, never a join of its own", () => {
  // useCoverageRegister hands back rows that are joined AND suppressed, in that
  // order (composeRegister owns it). A page that reached for joinRegisterRows
  // itself would render facts a downed-or-stale feed cannot vouch for, in the
  // very columns suppression exists to blank — and the alert count beside them
  // would then describe a different set of rows than the table does.
  assert.ok(!pageSource.includes("joinRegisterRows"), "the join belongs to the hook");
  assert.ok(!pageSource.includes("suppressUnusableFacts"), "suppression belongs to the hook");
  assert.ok(!pageSource.includes("composeRegister"), "composition belongs to the hook");
  assert.ok(pageSource.includes("useCoverageRegister"), "the page's rows come from the hook");
});

test("the retired biometrics route redirects into the register", () => {
  // The page it pointed at is deleted by this change; a link or bookmark to it
  // must land on the register rather than on the catch-all.
  assert.match(
    mainSource,
    /path="\/hr-schedule\/coverage\/biometrics"[\s\S]{0,120}<Navigate to="\/hr-schedule\/coverage" replace \/>/,
    "/hr-schedule/coverage/biometrics must redirect to /hr-schedule/coverage",
  );
  assert.ok(
    !mainSource.includes("BiometricEnrollmentPage"),
    "the deleted page must not still be routed",
  );
  assert.ok(
    !mainSource.includes("ScheduleCoveragePage"),
    "the deleted page must not still be routed",
  );
});

// ---------------------------------------------------------------------------
// CoverageRegisterView — rendered for real
// ---------------------------------------------------------------------------

const HEALTHY_FEEDS: FeedHealth = { schedule: true, biometric: true };

const CLEAR_ALERT: RegisterAlert = {
  tone: "clear", count: 0, knowable: true, label: "All 1 ready",
};

/** What both queries look like before either has answered — see feedHealth. */
const PENDING_ALERT: RegisterAlert = {
  tone: "degraded", count: 0, knowable: false,
  label: "0 need attention · schedules and biometrics unavailable",
};

/**
 * The text of PageHeader's description line.
 *
 * Anchored on `data-slot="page-header"` — dewey-ui's own stable hook, the same
 * one e2e/page-insets.spec.ts selects on — and on the element structure around
 * it, never on the utility classes PageHeader happens to style that <p> with
 * today. A restyle in the shared package is not a behaviour change here and
 * must not turn into red tests.
 */
function headerDescription(html: string): string {
  const start = html.indexOf('data-slot="page-header"');
  assert.notEqual(start, -1, "expected a PageHeader");
  const region = html.slice(start, html.indexOf('data-slot="section"', start));
  return region.match(/<\/h1>\s*<p[^>]*>(.*?)<\/p>/)?.[1] ?? "";
}

function renderView(over: Partial<CoverageRegisterViewProps> = {}): string {
  return renderToStaticMarkup(
    <CoverageRegisterView
      rows={[BASE_ROW]}
      feeds={HEALTHY_FEEDS}
      alert={CLEAR_ALERT}
      truncated={false}
      isLoading={false}
      bothFailed={false}
      filters={{}}
      onFiltersChange={noop}
      onRetry={noop}
      onOpen={noop}
      onAddSchedule={noop}
      {...over}
    />,
  );
}

test("an ordinary page load does not flash an outage", () => {
  // While either query is pending BOTH payloads are undefined, so feedHealth
  // reads {schedule:false, biometric:false} and the alert is `degraded`
  // — every single load would otherwise open on a red-adjacent dot reading
  // "schedules and biometrics unavailable" plus a feed-down banner, for the
  // second or so before the data lands. Nothing is wrong yet; nothing may say
  // so yet.
  // `rows: []` is not a convenience — it is what a pending load actually
  // holds, since composeRegister joins two undefined payloads into nothing.
  const html = renderView({
    isLoading: true,
    rows: [],
    feeds: { schedule: false, biometric: false },
    alert: PENDING_ALERT,
  });
  assert.doesNotMatch(html, /data-tone=/, "no alert dot until the feeds have answered");
  assert.doesNotMatch(html, /unavailable/, "no outage banner until the feeds have answered");
  assert.doesNotMatch(html, /roster is partial/);
  // Same rule one line up in the header. The roster size is not known yet, so
  // the description must say so rather than report a count of nobody.
  // Asserted against PageHeader's own description element, not the whole
  // document: GenericDataTable's footer legitimately reads "Showing 0 of 0"
  // beside its spinner, and a bare /0 employees/ search would either collide
  // with that or — with a one-row fixture — never be able to fail at all.
  assert.equal(
    headerDescription(html),
    "Loading…",
    "the header must say it is loading, not report a roster size it does not have",
  );
  // Direction: the gate must be on `isLoading`, not on the page as a whole.
  assert.match(html, /Loading data/, "the table still reports that it is loading");
});

test("the header names the roster size, and says employee once at one", () => {
  assert.equal(headerDescription(renderView({ rows: [BASE_ROW] })), "1 employee");
  assert.equal(
    headerDescription(renderView({ rows: [BASE_ROW, { ...BASE_ROW, id: "EMP-0002" }] })),
    "2 employees",
  );
});

test("the alert dot is the header's action once the feeds have answered", () => {
  const html = renderView();
  assert.match(html, /data-tone="clear"/, "the dot must render when not loading");
  assert.match(html, /aria-label="All 1 ready"/);
  assert.match(html, /aria-pressed="false"/, "nothing is filtered yet");

  // The dot doubles as the not-ready filter's control, so it has to show that
  // the filter is on — and `active` is the view's wiring, not AlertDot's.
  const filtered = renderView({ filters: { readiness: "not-ready" } });
  assert.match(filtered, /aria-pressed="true"/, "a filtered register shows a pressed dot");
});

test("pressing the alert dot toggles the not-ready filter, keeping every other filter", () => {
  assert.deepEqual(toggleReadiness({}), { readiness: "not-ready" }, "off -> on");
  assert.deepEqual(
    toggleReadiness({ readiness: "not-ready" }),
    { readiness: undefined },
    "on -> off, so the dot is a toggle rather than a one-way trip",
  );
  // A toggle that reset the reader's search or branch facets would read as the
  // dot clearing their work.
  assert.deepEqual(
    toggleReadiness({ search: "ada", branch: ["DIU"], sort: "hours" }),
    { search: "ada", branch: ["DIU"], sort: "hours", readiness: "not-ready" },
  );
});

test("a downed biometric feed says so, and takes its columns with it", () => {
  const html = renderView({ feeds: { schedule: true, biometric: false } });
  assert.match(html, /Biometric feed unavailable/, "the outage must be named");
  // Columns are REMOVED, never blanked: an empty Biometric column reads as a
  // whole roster who cannot clock in.
  assert.doesNotMatch(html, />Biometric</, "the Biometric column must be gone, not empty");
  assert.doesNotMatch(html, />Prints</, "the Prints column must be gone, not empty");
  assert.doesNotMatch(html, />Status</, "Status is a biometric-feed fact and must go with it");
  // The schedule half is unaffected — that is the claim the banner makes.
  assert.match(html, />Schedule</, "the schedule columns must survive a biometric outage");
  assert.match(html, />Hrs\/wk</);
});

test("a healthy pair of feeds shows every column", () => {
  // Without this the test above passes just as well against a table that never
  // renders any column at all.
  const html = renderView();
  for (const header of ["Employee", "Branch", "Dept", "Status", "Schedule", "Hrs/wk", "Biometric", "Prints"]) {
    assert.ok(html.includes(`>${header}<`), `expected the ${header} column`);
  }
  assert.doesNotMatch(html, /Biometric feed unavailable/, "no outage banner on a healthy load");
});

test("a partial roster says so", () => {
  const html = renderView({ truncated: true });
  assert.match(html, /roster is partial/);
});

test("the truncated notice waits for the feeds, and stands down on a total failure", () => {
  // Both halves of this gate were previously unreachable: the only assertion
  // that a truncation notice was ABSENT ran against the default
  // `truncated: false`, where no gate has to do anything for it to hold. Each
  // case here sets `truncated: true` so the gate itself is what is under test.
  const loading = renderView({ truncated: true, isLoading: true, rows: [] });
  assert.doesNotMatch(
    loading,
    /roster is partial/,
    "nothing is known about the roster's completeness until the feeds answer",
  );

  // Same rule as the biometric strip: notice.tsx forbids reporting one failure
  // as both a banner and a replaced region, and "some employees are not shown"
  // is a strange way to describe a page that loaded nobody at all.
  const failed = renderView({ truncated: true, bothFailed: true, rows: [] });
  assert.doesNotMatch(failed, /roster is partial/, "one failure, reported once");
  assert.match(failed, /Coverage didn’t load/, "the failure itself must still be reported");
});

test("when both feeds fail the table is replaced, not banner-stacked", () => {
  // notice.tsx's own rule: a page that shows both a banner and a replaced
  // region reports one failure twice. The biometric strip also ends with
  // "Schedule coverage is unaffected", which is flatly false here.
  const html = renderView({
    bothFailed: true,
    isLoading: false,
    rows: [],
    feeds: { schedule: false, biometric: false },
  });
  assert.match(html, /Coverage didn’t load/, "the failure must replace the region");
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /Biometric feed unavailable/, "one failure, reported once");
  assert.doesNotMatch(html, /Search by name/, "the table must be gone, not sitting under a banner");
});

test("the footer counts the real roster, never zero", () => {
  // GenericDataTable's footer reads `Showing {data.length} of {meta?.total || 0}`
  // and its pager reads "Loading..." whenever `meta` is absent — so omitting
  // `meta` ships a permanent "Showing 241 of 0 employees" under a full table.
  // Zero is a rendered non-fact, which is the one thing this page may not do.
  const ready = { ...BASE_ROW, id: "READY", employee_name: "Bea Ready" };
  const notReady: RegisterRow = {
    ...BASE_ROW, id: "STUCK", employee_name: "Ada Stuck", schedule: "missing",
  };
  const html = renderView({
    rows: [ready, notReady],
    filters: { readiness: "not-ready" },
  });
  assert.match(html, /Showing 1 of 2 employees/, "filtered count of roster count");
  assert.doesNotMatch(html, /of 0 employees/);
  assert.doesNotMatch(html, /Loading\.\.\./, "the pager must not be stuck reporting a load");
});

/** Which of two names the rendered table puts first. */
function orderOf(html: string, first: string, second: string): [number, number] {
  const a = html.indexOf(first);
  const b = html.indexOf(second);
  assert.ok(a !== -1, `expected ${first} in the table`);
  assert.ok(b !== -1, `expected ${second} in the table`);
  return [a, b];
}

test("the view filters and sorts through lib, so the not-ready filter reaches the table", () => {
  // The rows the table receives must be filterRegisterRows + sortRegisterRows
  // of what came in, not the raw list — otherwise clicking the alert dot
  // changes the header and leaves the table showing everybody.
  const ready = { ...BASE_ROW, id: "READY", employee_name: "Bea Ready" };
  const notReady: RegisterRow = {
    ...BASE_ROW, id: "STUCK", employee_name: "Ada Stuck", schedule: "missing",
  };
  const unfiltered = renderView({ rows: [ready, notReady] });
  assert.match(unfiltered, /Bea Ready/);
  assert.match(unfiltered, /Ada Stuck/);

  const filtered = renderView({ rows: [ready, notReady], filters: { readiness: "not-ready" } });
  assert.match(filtered, /Ada Stuck/, "the not-ready row stays");
  assert.doesNotMatch(filtered, /Bea Ready/, "the ready row must be filtered out");
});

test("the view SORTS as well as filters — default order is by name, not input order", () => {
  // Membership alone cannot tell sortRegisterRows from a bare
  // filterRegisterRows: with both rows passing the filter, dropping the sort
  // leaves exactly the same two rows in the HTML and only their ORDER moves.
  // Input order is deliberately the reverse of name order, so the assertion
  // fails the moment the sort call goes.
  const zoe = { ...BASE_ROW, id: "Z", employee_name: "Zoe Last" };
  const ana = { ...BASE_ROW, id: "A", employee_name: "Ana First" };
  const [zoeAt, anaAt] = orderOf(renderView({ rows: [zoe, ana] }), "Zoe Last", "Ana First");
  assert.ok(anaAt < zoeAt, "the default order is alphabetical by name, not the order the feed sent");
});

test("severity order reaches the table, not just the alert count", () => {
  // While filtered to not-ready and with no explicit sort, sortRegisterRows
  // ranks worst first: a leaver still holding a template outranks a merely
  // missing schedule. Input order is again reversed, and name order would ALSO
  // put "Ana" first — so the fixture is chosen so that severity and
  // alphabetical disagree, and only severity produces this result.
  const missingSchedule: RegisterRow = {
    ...BASE_ROW, id: "SCHED", employee_name: "Ana Schedule", schedule: "missing",
  };
  const leaver: RegisterRow = {
    ...BASE_ROW, id: "LEAVER", employee_name: "Zoe Leaver",
    biometric: "still_enrolled", status: "Left", days_since_relieving: 42,
  };
  const html = renderView({
    rows: [missingSchedule, leaver],
    filters: { readiness: "not-ready" },
  });
  const [leaverAt, schedAt] = orderOf(html, "Zoe Leaver", "Ana Schedule");
  assert.ok(
    leaverAt < schedAt,
    "the leaver still holding a template must sort above a missing schedule, and alphabetically would not",
  );
});
