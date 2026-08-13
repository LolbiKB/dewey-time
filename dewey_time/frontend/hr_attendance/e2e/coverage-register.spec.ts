import { expect, test, type Page } from "@playwright/test";

import {
  readyCoveragePayload,
  readyEnrollmentPayload,
  staleEnrollmentPayload,
  stubFrappe,
} from "./fixtures";

/**
 * The coverage readiness register, in a browser.
 *
 * Everything derived — the join, the filters, the sort, the alert, column
 * suppression, the CSV — is pure and covered by `src/lib/coverageRegister`'s
 * node:test suite. What that suite cannot see is any of it WIRED: it has no
 * jsdom, so a filter that never reaches the table, a popover that never opens,
 * a dot whose three tones all render the same circle, and an export button
 * whose default `download` nothing ever calls all stay green there. Those are
 * the claims this file measures.
 *
 * The roster under the default fixtures is 14 employees: coverage returns 3
 * unassigned and 10 assigned (13 active), and the enrollment feed adds one
 * leaver — EMP-900, Nora Vance — who coverage cannot return because it filters
 * to status:Active. That extra row IS the security finding the register was
 * built for, so the count is asserted rather than read off the page.
 */

const ROSTER = 14;

/** Rows with a problem, worst first: still-enrolled leaver, then no fingerprint, then no schedule. */
const NOT_READY = ["Nora Vance", "Marco Diaz", "Priya Nair", "Tom O'Brien"];

/**
 * The search box's accessible name at a given roster size.
 *
 * Kept in step with `registerSearchPlaceholder` by hand rather than imported:
 * this file is the outside view, and a locator built from the same function the
 * page builds the name with could not notice the two disagreeing.
 */
function rosterSearchBox(size: number): string {
  return `Search ${size} employees by name or ID…`;
}

function bodyRows(page: Page) {
  return page.locator("tbody tr");
}

/**
 * The name from each row's employee cell, in the order the table shows them.
 *
 * Read off `data-slot="employee-name"` rather than by splitting the cell's
 * text: the cell now stacks a name over an employee id BESIDE an avatar, and
 * the avatar's initials are text too, so the first line of the cell is "NV",
 * not "Nora Vance". The hook survives the cell gaining another layer.
 */
async function employeeNames(page: Page): Promise<string[]> {
  const names = await page.locator('tbody tr [data-slot="employee-name"]').allInnerTexts();
  return names.map((text) => text.trim());
}

/** The alert dot, whichever of its three things it is currently saying. */
function alertDot(page: Page) {
  return page.getByRole("button", { name: /needs? attention|All \d+ ready/ });
}

/**
 * dewey-ui's "Rows per page" control — a raw `<select>`, and the only native
 * one on the page. Located by tag rather than by role or name because it has
 * neither a label element nor an aria-label: the "Rows per page" beside it is a
 * plain `<p>`, so the control announces as an unnamed combobox. That is a gap
 * in the shared primitive, noted here rather than papered over from this side.
 */
function pageSizeControl(page: Page) {
  return page.locator("select");
}

/**
 * Above the 768 breakpoint, where the whole toolbar and footer are on screen.
 *
 * Set explicitly by the tests that need the page-size control: it is hidden
 * below 768 for the same measured reason the search box moves and the column
 * toggle goes — dewey-ui's footer row does not wrap either.
 */
const LAPTOP = { width: 1280, height: 900 };

/**
 * The register's heading, which is `sr-only` since the page header was dropped.
 *
 * Still a real heading in the accessibility tree — `getByRole` finds it, and so
 * does a screen reader's heading list — but zero pixels tall, so `toBeVisible`
 * would fail on it. Attached-ness is the strongest claim available here, and it
 * is the one that matters: a route with no heading has no answer to "where am
 * I", whatever it looks like.
 */
function registerHeading(page: Page) {
  return page.getByRole("heading", { name: "Coverage", level: 1 });
}

async function openRegister(page: Page): Promise<void> {
  await page.goto("/hr-schedule/coverage");
  await expect(registerHeading(page)).toBeAttached();
}

test("the register lists both feeds' employees and the dot filters to problems", async ({
  page,
}) => {
  await stubFrappe(page);
  await openRegister(page);

  // The roster count, not just "some rows": it is the page's own count of the
  // join, and it must include the leaver only the biometric feed knows of. It
  // rides in the search box now that the page header is gone — one line of
  // chrome fewer, and the number still on screen.
  await expect(page.getByRole("textbox", { name: rosterSearchBox(ROSTER) })).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  const dot = alertDot(page);
  await expect(dot).toHaveAttribute("aria-label", "4 need attention — show them");
  await expect(dot).toHaveAttribute("aria-pressed", "false");

  await dot.click();

  await expect(bodyRows(page)).toHaveCount(NOT_READY.length);
  await expect(dot).toHaveAttribute("aria-pressed", "true");
  // Order as well as membership: with the filter on and no column sorted, the
  // register orders by severity, which is the only thing recovering "worst
  // first" once the three old grouped views were collapsed into one flat table.
  expect(await employeeNames(page)).toEqual(NOT_READY);

  // Pressing it again is the way back. A filter with no exit is worse than none.
  await dot.click();
  await expect(bodyRows(page)).toHaveCount(ROSTER);
  await expect(dot).toHaveAttribute("aria-pressed", "false");
});

/**
 * Paging, pressed rather than computed.
 *
 * `paginateRegisterRows` is pure and pinned in node:test, but every way it can
 * be WIRED wrong is invisible there: a `meta` the table never receives leaves
 * the pager reading "Loading...", a `data` that was never sliced renders the
 * whole roster under a correct-looking pager, and buttons that write `page`
 * into a filters object nothing re-reads do nothing at all. That last shape is
 * what shipped — `disabled: !meta?.hasNext` against a hardcoded
 * `hasNext: false` — and it is why this round exists.
 *
 * The default page size (50) is larger than this fixture's roster, so the size
 * control is used to get to two pages. That exercises it too: it is only on
 * screen because `hidePageSize` came off, and it writes `limit` through the
 * same filters everything else does.
 */
test("the pager turns real pages, and the size control sets how big they are", async ({ page }) => {
  await stubFrappe(page);
  // Explicitly wide: the `mobile` project runs this file at 412, where the size
  // control is deliberately absent.
  await page.setViewportSize(LAPTOP);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  // One page to begin with: 14 rows under a default of 50.
  await expect(page.getByText("Page 1 of 1")).toBeVisible();
  await expect(page.getByText(`Showing ${ROSTER} of ${ROSTER} employees`)).toBeVisible();

  // The control agrees with the slice. This is the assertion that rules out
  // REGISTER_PAGE_SIZE drifting outside the five sizes this <select> offers: a
  // size it has no option for leaves `selectedIndex` at -1 and the value empty,
  // so the control would sit there blank above a table showing 25 rows.
  await expect(pageSizeControl(page)).toHaveValue("50");

  await pageSizeControl(page).selectOption("10");

  await expect(bodyRows(page)).toHaveCount(10);
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await expect(page.getByText(`Showing 10 of ${ROSTER} employees`)).toBeVisible();

  const next = page.getByRole("button", { name: "Go to next page" });
  const previous = page.getByRole("button", { name: "Go to previous page" });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();

  // The rows on page 2 must be DIFFERENT rows, not the same ten again — a
  // pager wired to a `data` that is never sliced looks exactly like this
  // otherwise.
  const firstPage = await employeeNames(page);
  await next.click();

  await expect(bodyRows(page)).toHaveCount(ROSTER - 10);
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  const secondPage = await employeeNames(page);
  expect(secondPage.some((name) => firstPage.includes(name))).toBe(false);
  await expect(next).toBeDisabled();

  // And back. A pager with no way home is worse than none.
  await previous.click();
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  expect(await employeeNames(page)).toEqual(firstPage);
});

test("narrowing the roster puts the reader back on page 1", async ({ page }) => {
  // Filter while on page 2 and page 2 may not exist any more. The clamp in
  // paginateRegisterRows stops that rendering an empty table, but landing on
  // the LAST page of your four findings is not what pressing the dot asked
  // for — every control that narrows resets the page, and this presses one.
  await stubFrappe(page);
  await page.setViewportSize(LAPTOP);
  await openRegister(page);
  await pageSizeControl(page).selectOption("10");

  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();

  await alertDot(page).click();

  await expect(bodyRows(page)).toHaveCount(NOT_READY.length);
  await expect(page.getByText("Page 1 of 1")).toBeVisible();
  // Worst first, from the top — the register's headline act, delivered from
  // the right end of the list.
  expect(await employeeNames(page)).toEqual(NOT_READY);
});

/**
 * Sorting starts again at page 1 — and that rule is dewey-ui's, not ours.
 *
 * `CoverageRegisterPage` deliberately does NOT wrap `handleTableFiltersChange`
 * in `applyFilterChange`, because GenericDataTable already stamps `page: 1` on
 * its own sort write and wrapping it would stop the pager ever leaving page 1.
 * That makes this the one reset rule the repo does not own, and it was pinned
 * by nothing: no unit test asserts it, because the write happens inside the
 * primitive, and no e2e pressed a sort header at all. A dewey-ui bump that
 * dropped it would have shipped green.
 *
 * Pressing the header is also the only end-to-end exercise of the FUSED
 * column's sort — header -> onSortingChange -> columnIdForSort -> filters ->
 * sortRegisterRows -> reordered rows — so the order is asserted too, not just
 * the page number.
 */
test("sorting starts again at page 1, and the fused column sorts by print count", async ({
  page,
}) => {
  await stubFrappe(page);
  await page.setViewportSize(LAPTOP);
  await openRegister(page);
  await pageSizeControl(page).selectOption("10");

  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(ROSTER - 10);

  await page.getByRole("button", { name: /^Biometric, not sorted/ }).click();

  // Back to the top of the newly ordered list. Left on page 2, the reader
  // would press a column header and land in the middle of their own sort.
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(10);

  // The header now says which way it went, in the wording the fused column
  // needs: a column labelled "Biometric" ordering by print count is a surprise
  // worth stating.
  await expect(
    page.getByRole("button", { name: "Biometric, sorted by fingerprint count ascending — press to sort descending" }),
  ).toBeVisible();

  // And it really is the print count doing the ordering, not the name. The
  // biometric feed knows four of these fourteen — 0, 1, 2 and 2 prints — and
  // the ten it has never heard of carry a null count, which sorts LAST in both
  // directions because an absent value is not a small one. The two on 2 tie and
  // fall back to name order, so Jane precedes Nora. Alphabetical order would
  // put Aaron Wells first; print order puts Marco Diaz there.
  expect((await employeeNames(page)).slice(0, 4)).toEqual([
    "Marco Diaz",
    "Aaron Wells",
    "Jane Doe",
    "Nora Vance",
  ]);
});

test("the biometrics URL redirects to the register", async ({ page }) => {
  await stubFrappe(page);
  await page.goto("/hr-schedule/coverage/biometrics");

  await expect(page).toHaveURL(/\/hr-schedule\/coverage$/);
  await expect(registerHeading(page)).toBeAttached();
});

/**
 * The dot's three tones must be three SHAPES, not three colours.
 *
 * Measured, not read off the class string: `cn`/twMerge, Tailwind's emit order
 * and any app-level override all sit between the JSX and the painted box, and
 * this project already has one regression (see page-insets.spec.ts) that a
 * class assertion would have called healthy. The signatures are disjoint on
 * shape alone — a hollow ring with no shadow, a filled disc with one halo, and
 * a filled disc with a halo plus a detached concentric ring — so a reader who
 * cannot tell destructive red from brand accent can still tell all three apart.
 */
type DotShape = {
  tone: string | null;
  label: string | null;
  width: number;
  filled: boolean;
  borderWidth: string;
  /**
   * The GEOMETRY of each box-shadow layer that actually paints — "0px 0px 0px
   * 3px" and so on — with the colour dropped and the transparent placeholders
   * Tailwind emits for unset slots discarded.
   *
   * The set, not a count. `ring-2 ring-offset-2` paints two layers by itself,
   * so a `> 1` count stays green with the halo deleted — and the halo is the
   * whole reason `degraded` reads as loud as `problem`.
   */
  shadows: string[];
};

/** The halo both `problem` and `degraded` carry: `shadow-[0_0_0_3px]`. */
const HALO = "0px 0px 0px 3px";

async function dotShape(page: Page): Promise<DotShape> {
  return page.evaluate(() => {
    const button = document.querySelector("button[data-tone]");
    const dot = button?.querySelector("span");
    if (!button || !dot) throw new Error("expected the alert dot and the shape inside it");

    const style = getComputedStyle(dot);

    // Split box-shadow on top-level commas only — every layer carries an
    // rgb()/rgba() colour with commas of its own.
    const layers: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of style.boxShadow) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        layers.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    layers.push(current);

    const paints = (layer: string) => {
      const text = layer.trim();
      if (text === "" || text === "none") return false;
      return !/rgba\([^)]*,\s*0\s*\)/.test(text);
    };

    // Colour dropped: this is a claim about shape. The lengths are the only
    // part of a layer that says where it sits and how thick it is, and every
    // colour notation Chrome may hand back — rgb(), oklab(), a bare keyword —
    // is free of `px`.
    const geometry = (layer: string) => (layer.match(/-?[\d.]+px/g) ?? []).join(" ");

    return {
      tone: button.getAttribute("data-tone"),
      label: button.getAttribute("aria-label"),
      width: dot.getBoundingClientRect().width,
      filled: !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor),
      borderWidth: style.borderTopWidth,
      shadows: layers.filter(paints).map(geometry),
    };
  });
}

test("the dot's `problem` tone is a filled disc with a halo", async ({ page }) => {
  await stubFrappe(page);
  await openRegister(page);
  await expect(alertDot(page)).toBeVisible();

  const shape = await dotShape(page);
  expect(shape.tone).toBe("problem");
  expect(shape.label).toBe("4 need attention — show them");
  expect(shape.width).toBeCloseTo(12, 0);
  expect(shape.filled).toBe(true);
  expect(shape.borderWidth).toBe("0px");
  expect(shape.shadows, "the halo, and nothing else").toEqual([HALO]);
});

test("the dot's `clear` tone is a hollow ring", async ({ page }) => {
  await stubFrappe(page, {
    coverage: readyCoveragePayload(),
    enrollment: readyEnrollmentPayload(),
  });
  await openRegister(page);
  await expect(alertDot(page)).toBeVisible();

  const shape = await dotShape(page);
  expect(shape.tone).toBe("clear");
  expect(shape.label).toBe("All 10 ready");
  expect(shape.width).toBeCloseTo(12, 0);
  // Hollow: the border IS the shape. The dot never disappears when nothing is
  // wrong — an absent indicator cannot be told from a page that failed to draw.
  expect(shape.filled).toBe(false);
  expect(shape.borderWidth).toBe("2px");
  expect(shape.shadows).toEqual([]);
});

test("the dot's `degraded` tone adds a concentric ring to the disc", async ({ page }) => {
  await stubFrappe(page, { enrollment: staleEnrollmentPayload() });
  await openRegister(page);
  await expect(alertDot(page)).toBeVisible();

  const shape = await dotShape(page);
  expect(shape.tone).toBe("degraded");
  // Says what it cannot see. Three of the fourteen are unschedulable; whether
  // any of them is also unenrolled is exactly what a stale bridge cannot say.
  expect(shape.label).toBe("3 need attention · biometrics unavailable");
  expect(shape.width).toBeCloseTo(12, 0);
  expect(shape.filled).toBe(true);
  expect(shape.borderWidth).toBe("0px");

  // The two halves pinned separately, because either alone is satisfiable
  // without the other. `ring-2 ring-offset-2` paints two layers on its own, so
  // any count-based check stays green with the halo deleted — and the halo is
  // what keeps this tone as LOUD as `problem`, which is the point: this is the
  // state where the count covers only part of the roster.
  expect(shape.shadows, "the same halo `problem` carries").toContain(HALO);
  // And a ring outside it — the SHAPE that separates the two filled-disc
  // tones, so they are not told apart by hue alone. Not pinned to an exact
  // radius: ring-2 could become ring-[3px] without touching the claim.
  expect(
    shape.shadows.filter((layer) => layer !== HALO),
    "a concentric ring, detached from the halo",
  ).not.toEqual([]);

  // And the columns the stale feed cannot vouch for are gone, not blanked.
  await expect(page.getByRole("columnheader", { name: "Biometric" })).toHaveCount(0);
  await expect(page.getByText("Biometric feed unavailable")).toBeVisible();

  // The leaver goes with them. Coverage returns Active employees only, so Nora
  // Vance exists in the stale feed ALONE — she used to survive as a row of em
  // dashes still carrying the name, branch and department that only that feed
  // supplied, counted in the roster size and exported to the CSV, under this
  // very banner saying leaver detection was hidden.
  await expect(page.getByText("Nora Vance")).toHaveCount(0);
  await expect(bodyRows(page)).toHaveCount(ROSTER - 1);
  await expect(page.getByRole("textbox", { name: rosterSearchBox(ROSTER - 1) })).toBeVisible();
});

test("a facet popover opens, narrows the table, and clears back", async ({ page }) => {
  await stubFrappe(page);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  // Radix renders the three single-value facets as `role="combobox"`, which is
  // nameFrom:author — the "Status: Any" a sighted reader sees contributes
  // NOTHING to the accessible name, and until one was given all three
  // announced as bare unnamed comboboxes. Located BY NAME here so the name
  // stays load-bearing: the unit suite can only assert the attribute is in the
  // markup, not that a browser computes it into the name.
  for (const name of ["Status filter, Any", "Schedule filter, Any", "Biometric filter, Any"]) {
    await expect(page.getByRole("combobox", { name, exact: true })).toBeVisible();
  }

  // Branch is a fact only the biometric feed carries, so the roster has exactly
  // the two branches its rows mention.
  const trigger = page.getByRole("button", { name: "Branch filter, 2 options" });
  await trigger.click();

  // The popover is uncontrolled — Radix owns `open`. Nothing below the trigger
  // exists until it is really mounted, which is what this asserts.
  const branchA = page.getByRole("option", { name: "BRANCH-A", exact: true });
  await expect(branchA).toBeVisible();

  await branchA.click();
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Branch filter, 2 options, 1 selected: BRANCH-A" }),
  ).toBeVisible();
  // The tick is a shape, and it is what says "selected" aloud too.
  await expect(page.getByRole("option", { name: "BRANCH-A, selected" })).toBeVisible();

  await page.getByRole("option", { name: "Clear branch filter" }).click();
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  // ...and it closes again. An uncontrolled popover that opens but never closes
  // would pass every assertion above.
  await page.keyboard.press("Escape");
  await expect(branchA).toBeHidden();
});

/**
 * The export's confirmation, and the reader's way past it.
 *
 * Radix mounts it in a portal, so nothing in here exists until the trigger has
 * really been pressed — which is the half `renderToStaticMarkup` cannot see.
 */
function exportDialog(page: Page) {
  return page.getByRole("dialog", { name: "Export this register as CSV" });
}

test("the export confirms what the file holds before writing it", async ({ page }) => {
  await stubFrappe(page);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  // Filter first, so the file can be checked against the screen rather than
  // against the roster — exporting everything would still count as "a download".
  await alertDot(page).click();
  await expect(bodyRows(page)).toHaveCount(NOT_READY.length);

  const button = page.getByRole("button", { name: `Export ${NOT_READY.length} employees as CSV` });
  await expect(button).toBeEnabled();

  // Pressing it writes nothing. That is the whole change: the file is the
  // reader's second decision, taken while looking at what is in it.
  await button.click();
  const dialog = exportDialog(page);
  await expect(dialog).toBeVisible();

  // The wiring the unit suite is structurally blind to. Every assertion it
  // makes about this surface renders it directly with props of its own, so a
  // page that passed an empty `filters` or the wrong roster size would keep
  // every one of them green while telling the reader the file was unfiltered.
  await expect(dialog).toContainText(`${NOT_READY.length} employees`);
  await expect(dialog).toContainText(`of ${ROSTER} on the register`);
  await expect(dialog).toContainText("Narrowed by");
  await expect(dialog).toContainText("Needs attention");
  await expect(dialog).not.toContainText("No filters are on");

  // Cancelling really cancels: no file, and the register untouched behind it.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(bodyRows(page)).toHaveCount(NOT_READY.length);

  await button.click();
  await expect(dialog).toBeVisible();

  const confirm = dialog.getByRole("button", { name: `Export ${NOT_READY.length} employees` });
  const [download] = await Promise.all([page.waitForEvent("download"), confirm.click()]);

  // Answered, and gone. A confirmation still standing over a register the
  // reader can no longer see invites a second file nobody decided on.
  await expect(dialog).toBeHidden();

  expect(download.suggestedFilename()).toMatch(/^coverage-register-\d{4}-\d{2}-\d{2}\.csv$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString("utf8");

  const lines = csv.split("\n");
  expect(lines[0]).toBe(
    "Employee ID,Name,Branch,Department,Employment status,Schedule,Weekly minutes,Biometric,Fingerprints,Days since leaving",
  );
  expect(lines).toHaveLength(NOT_READY.length + 1);
  expect(lines.slice(1).map((line) => line.split(",")[1])).toEqual(NOT_READY);
});

/**
 * Crossing the 768 breakpoint with a search already typed.
 *
 * The register hands its search box between two owners at that width, and each
 * direction of the handoff had its own defect — both invisible to every test
 * above, because every one of them loads fresh at a fixed width and nothing
 * exercised a live resize.
 *
 * Wide -> narrow took the WHOLE SPA down. GenericDataTable seeds its
 * `debouncedSearch` once at mount and never resyncs it from props, so after
 * the boundary blanks `search` the two disagree permanently — its input is
 * hidden by then, so nothing can move its copy — and because `filters` is a
 * fresh object every render its write-back effect re-fired on every render:
 * onFiltersChange -> setFilters -> render -> repeat, "Maximum update depth
 * exceeded", and the top-level ErrorBoundary replacing the entire app until a
 * reload.
 *
 * Narrow -> wide lost the reader's text: the same frozen `""` echoed back
 * through the boundary and overwrote the real search, so the desktop box came
 * up empty over an unfiltered table.
 *
 * Both are closed by remounting the table at the breakpoint — see the `key` in
 * CoverageRegisterPage.
 */
const PHONE = { width: 375, height: 812 };

/** The search box, under the one name both owners give it. */
const SEARCH_BOX = rosterSearchBox(ROSTER);

/**
 * Everything the page logs as an error, for the duration of the test.
 *
 * The crash announced itself here and nowhere else — React logs "Maximum
 * update depth exceeded" to the console and the ErrorBoundary swallows the
 * throw — so an assertion has to be listening or a runaway render loop is a
 * test that passes.
 */
function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test("a search typed on a laptop survives the phone breakpoint", async ({ page }) => {
  const errors = consoleErrors(page);
  await stubFrappe(page);
  await page.setViewportSize(LAPTOP);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  // GenericDataTable's own box, above the breakpoint. Typed and left to settle
  // past its 300ms debounce — an unsettled search never reaches the state the
  // handoff then disagrees about.
  await page.getByRole("textbox", { name: SEARCH_BOX }).fill("Nora");
  await expect(bodyRows(page)).toHaveCount(1);

  await page.setViewportSize(PHONE);

  // The register is still on screen at all. Before the fix the whole SPA was
  // replaced by the ErrorBoundary's "Something went wrong", recoverable only
  // by reloading.
  await expect(registerHeading(page)).toBeAttached();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);

  // And the handoff kept the reader's work: the bar's box holds the text and
  // the table is still narrowed to it.
  await expect(page.getByRole("textbox", { name: SEARCH_BOX })).toHaveValue("Nora");
  await expect(bodyRows(page)).toHaveCount(1);

  expect(errors, "the page logged an error while crossing the breakpoint").toEqual([]);
});

test("a search typed on a phone survives going back to a laptop", async ({ page }) => {
  const errors = consoleErrors(page);
  await stubFrappe(page);
  await page.setViewportSize(PHONE);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  await page.getByRole("textbox", { name: SEARCH_BOX }).fill("Nora");
  await expect(bodyRows(page)).toHaveCount(1);

  await page.setViewportSize(LAPTOP);

  // The desktop box takes the search over, rather than coming up empty over a
  // table that has quietly snapped back to all fourteen.
  await expect(page.getByRole("textbox", { name: SEARCH_BOX })).toHaveValue("Nora");
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);

  expect(errors, "the page logged an error while crossing the breakpoint").toEqual([]);
});

/**
 * Phone widths — 375 (the narrowest this app is expected on) and 412 (the
 * Pixel 7 the `mobile` project runs, and the shape a phone actually gets).
 *
 * page-insets.spec.ts measures gutter geometry, but only from 1024 up, and the
 * only 375px walk in the suite is behind AUDIT=1 and asserts nothing. The
 * register's toolbar is the widest thing this app puts in one row, so it is
 * where a phone runs out of room first.
 *
 * THREE measurements, because none of them can see what the others do:
 *
 * 1. The page must not scroll sideways. On its own this is nearly blind here —
 *    `Section grow` is `overflow-hidden`, so anything the toolbar spills is
 *    CLIPPED, and the document stays exactly 375px wide with a control sitting
 *    outside the viewport.
 * 2. No control may sit outside the viewport. Catches the clipped case.
 * 3. No two controls may overlap. Catches the case where everything is on
 *    screen but drawn on top of each other, which is what a non-wrapping
 *    toolbar row does when its flex items are crushed to nothing — measured at
 *    375 before the handoff: dewey-ui's search input over the Status facet,
 *    the export button over the search input.
 *
 * `test.use({ viewport })` replaces the viewport on BOTH projects, so a single
 * fixed width would leave the Pixel 7's native 412 measured by nobody. Both
 * widths are walked inside the test instead.
 */
const PHONE_WIDTHS = [375, 412];

/** Every control in the toolbar, and what is wrong with where it sits. */
type ToolbarFit = {
  viewport: number;
  documentScroll: number;
  documentClient: number;
  controls: string[];
  offscreen: string[];
  overlapping: string[];
};

async function toolbarFit(page: Page): Promise<ToolbarFit> {
  return page.evaluate(() => {
    const named = (el: Element) => el.getAttribute("aria-label") ?? (el.textContent ?? "").trim();

    const buttons = [...document.querySelectorAll("button")];
    const exportButton = buttons.find((b) => /^Export /.test(b.getAttribute("aria-label") ?? ""));
    const facet = buttons.find((b) => /^Branch filter/.test(b.getAttribute("aria-label") ?? ""));
    if (!exportButton || !facet) throw new Error("expected the register's toolbar controls");

    // The toolbar found structurally — the nearest ancestor of the export
    // button that also holds the facets — rather than by a dewey-ui class
    // string that could change under us without anything going red.
    let toolbar: Element | null = exportButton.parentElement;
    while (toolbar && !toolbar.contains(facet)) toolbar = toolbar.parentElement;
    if (!toolbar) throw new Error("the export button and the facets share no toolbar");

    const boxes = [...toolbar.querySelectorAll("button, input")]
      .map((el) => ({ name: named(el), rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);

    const overlapping: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i].rect;
        const b = boxes[j].rect;
        // 1px of slack, so two controls sharing an edge are not an overlap.
        const hit =
          a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        if (hit) overlapping.push(`${boxes[i].name} × ${boxes[j].name}`);
      }
    }

    return {
      viewport: window.innerWidth,
      documentScroll: document.documentElement.scrollWidth,
      documentClient: document.documentElement.clientWidth,
      controls: boxes.map(({ name }) => name),
      offscreen: boxes
        .filter(({ rect }) => rect.right > window.innerWidth + 1 || rect.left < -1)
        .map(({ name, rect }) => `${name} @${Math.round(rect.left)}..${Math.round(rect.right)}`),
      overlapping,
    };
  });
}

test("on a phone the register's toolbar fits, whole and without overlaps", async ({ page }) => {
  await stubFrappe(page);

  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: 812 });
    await openRegister(page);

    // Preconditions. Without them this passes just as happily on a blank page,
    // or on a run whose viewport never narrowed.
    await expect(bodyRows(page)).toHaveCount(ROSTER);
    const fit = await toolbarFit(page);
    expect(fit.viewport, `viewport did not take at ${width}`).toBe(width);

    // The register hands its search box to the wrapping facet bar below 768,
    // so at these widths the toolbar is entirely its own controls: the alert
    // dot, five facets, the search box and the export button. The dot is the
    // eighth — it moved here from the page header, and it is the one control
    // that does NOT wrap with the bar, so it is also the one this measurement
    // most needed to be re-run for.
    expect(fit.controls, `@${width}: the toolbar is not the one being measured`).toHaveLength(8);
    expect(
      fit.controls,
      `@${width}: the search box must survive the handoff, under the same name`,
    ).toContain(rosterSearchBox(ROSTER));
    expect(
      fit.controls,
      `@${width}: the alert dot must reach the phone toolbar too`,
    ).toContain("4 need attention — show them");

    // 1px of rounding, and no more. The TABLE scrolls horizontally by design —
    // GenericDataTable's fill layout gives it its own scroller — but the page
    // under it must not move.
    expect(
      fit.documentScroll,
      `@${width}: document overflows by ${fit.documentScroll - fit.documentClient}px`,
    ).toBeLessThanOrEqual(fit.documentClient + 1);

    expect(fit.offscreen, `@${width}: a toolbar control is off the screen`).toEqual([]);
    expect(fit.overlapping, `@${width}: toolbar controls are drawn over each other`).toEqual([]);
  }
});

/**
 * Keyboard focus, and the clip that was eating it.
 *
 * `Section grow` is `overflow-hidden` — load-bearing, it is what makes the
 * table scroll inside the page rather than the page scroll under it. This route
 * is the only one that puts focusable controls flush against all four of its
 * edges: with no PageHeader the toolbar starts at the section's exact top, and
 * the table fills the rest, so the pager sits on its exact bottom. Every one of
 * those controls carries dewey-ui's `focus-visible:ring-3`, a box-shadow drawn
 * OUTSIDE the border box, and every pixel of it that fell outside the section
 * was being cut off — the search box's whole top edge on a laptop, and the alert
 * dot's top and left, and Export's right, and all four pager buttons' bottoms.
 *
 * Measured rather than asserted as a class string, for the reason page-insets
 * gives: twMerge, Tailwind's emit order and the negative margins that buy the
 * room all sit between the JSX and the rendered box. The clip is the padding
 * box, so `-m-1 p-1` moves the clip edge out without moving anything in it.
 *
 * The budget is read from the ring the browser actually computes, not
 * hardcoded: a dewey-ui release that widened the ring would otherwise leave
 * this passing against a headroom that had stopped being enough.
 */
type FocusRoom = {
  ring: number;
  controls: number;
  tight: string[];
};

async function focusRoom(page: Page): Promise<FocusRoom> {
  return page.evaluate(() => {
    const section = document.querySelector('[data-slot="section"]');
    if (!section) throw new Error("expected a Section on the register");
    const clip = section.getBoundingClientRect();

    // The ring's spread, off the control that has one: Chromium serialises it
    // as "<color> 0px 0px 0px Npx".
    const focusable = [...section.querySelectorAll<HTMLElement>("button, input, select")].filter(
      (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      },
    );
    const probe = focusable.find((el) => el.tagName === "INPUT") ?? focusable[0];
    if (!probe) throw new Error("expected a focusable control in the register's Section");
    probe.focus();
    const spreads = [...getComputedStyle(probe).boxShadow.matchAll(/0px 0px 0px (\d+(?:\.\d+)?)px/g)]
      .map((match) => Number(match[1]));
    const ring = Math.max(0, ...spreads);
    probe.blur();

    const tight: string[] = [];
    for (const el of focusable) {
      // A control inside a scroller of its own is clipped by that scroller;
      // a different problem, and not one padding on the Section can fix.
      let inScroller = false;
      let node: Element | null = el.parentElement;
      while (node && node !== section) {
        const s = getComputedStyle(node);
        if (s.overflowX === "auto" || s.overflowY === "auto") inScroller = true;
        node = node.parentElement;
      }
      if (inScroller) continue;

      const r = el.getBoundingClientRect();
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? "?").trim().slice(0, 40);
      for (const [side, gap] of [
        ["top", r.top - clip.top],
        ["left", r.left - clip.left],
        ["right", clip.right - r.right],
        ["bottom", clip.bottom - r.bottom],
      ] as const) {
        if (gap < ring) tight.push(`${name} — ${side} by ${(ring - gap).toFixed(1)}px`);
      }
    }

    return { ring, controls: focusable.length, tight };
  });
}

test("a focused control's ring is never clipped by the section that holds it", async ({ page }) => {
  await stubFrappe(page);

  for (const size of [LAPTOP, PHONE]) {
    await page.setViewportSize(size);
    await openRegister(page);
    await expect(bodyRows(page)).toHaveCount(ROSTER);

    const room = await focusRoom(page);

    // Preconditions. Without them this passes on a page with no focus ring to
    // clip, and on one whose controls the walk never found.
    expect(room.ring, `@${size.width}: no focus ring to make room for`).toBeGreaterThan(0);
    expect(room.controls, `@${size.width}: found no controls to measure`).toBeGreaterThan(5);

    expect(room.tight, `@${size.width}: a focus ring is cut off`).toEqual([]);
  }
});
