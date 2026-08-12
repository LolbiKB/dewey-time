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

function bodyRows(page: Page) {
  return page.locator("tbody tr");
}

/** The name line of each row's employee cell, in the order the table shows them. */
async function employeeNames(page: Page): Promise<string[]> {
  const cells = await page.locator("tbody tr td:first-child").allInnerTexts();
  // The cell stacks the name over the employee id; the first line is the name.
  return cells.map((text) => text.split("\n")[0].trim());
}

/** The alert dot, whichever of its three things it is currently saying. */
function alertDot(page: Page) {
  return page.getByRole("button", { name: /needs? attention|All \d+ ready/ });
}

async function openRegister(page: Page): Promise<void> {
  await page.goto("/hr-schedule/coverage");
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
}

test("the register lists both feeds' employees and the dot filters to problems", async ({
  page,
}) => {
  await stubFrappe(page);
  await openRegister(page);

  // The roster description, not just "some rows": it is the page's own count of
  // the join, and it must include the leaver only the biometric feed knows of.
  // `exact`, or this also matches the table footer's "Showing 14 of 14 employees".
  await expect(page.getByText(`${ROSTER} employees`, { exact: true })).toBeVisible();
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

test("the biometrics URL redirects to the register", async ({ page }) => {
  await stubFrappe(page);
  await page.goto("/hr-schedule/coverage/biometrics");

  await expect(page).toHaveURL(/\/hr-schedule\/coverage$/);
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
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
  /** Box-shadow layers that actually paint. Tailwind emits transparent placeholders for the unset ones. */
  shadows: number;
};

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

    return {
      tone: button.getAttribute("data-tone"),
      label: button.getAttribute("aria-label"),
      width: dot.getBoundingClientRect().width,
      filled: !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor),
      borderWidth: style.borderTopWidth,
      shadows: layers.filter(paints).length,
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
  expect(shape.shadows, "the halo, and nothing else").toBe(1);
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
  expect(shape.shadows).toBe(0);
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
  // Strictly louder than `problem`'s single halo — this is the state where the
  // count covers only part of the roster, so it may not read as the quieter one.
  expect(shape.shadows, "halo plus the detached ring").toBeGreaterThan(1);

  // And the columns the stale feed cannot vouch for are gone, not blanked.
  await expect(page.getByRole("columnheader", { name: "Biometric" })).toHaveCount(0);
  await expect(page.getByText("Biometric feed unavailable")).toBeVisible();
});

test("a facet popover opens, narrows the table, and clears back", async ({ page }) => {
  await stubFrappe(page);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

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

test("the export button hands over the rows on screen as a file", async ({ page }) => {
  await stubFrappe(page);
  await openRegister(page);
  await expect(bodyRows(page)).toHaveCount(ROSTER);

  // Filter first, so the file can be checked against the screen rather than
  // against the roster — exporting everything would still count as "a download".
  await alertDot(page).click();
  await expect(bodyRows(page)).toHaveCount(NOT_READY.length);

  const button = page.getByRole("button", { name: `Export ${NOT_READY.length} employees as CSV` });
  await expect(button).toBeEnabled();

  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);

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
 * 375px — the narrowest phone this app is expected on.
 *
 * page-insets.spec.ts measures gutter geometry, but only from 1024 up, and the
 * only 375px walk in the suite is behind AUDIT=1 and asserts nothing. The
 * register's toolbar is the widest thing this app puts in one row — five facet
 * controls, a fixed-width search box and an export button — so it is where a
 * phone runs out of room first.
 *
 * TWO measurements, because the first alone cannot see the second. `Section
 * grow` is `overflow-hidden`, so anything the toolbar spills is CLIPPED rather
 * than scrolled: the document stays 375px wide while a control sits outside
 * the viewport, perfectly invisible to a scrollWidth check. So the register's
 * own controls are measured against the viewport directly as well.
 *
 * KNOWN, MEASURED, AND NOT YET FIXED — deliberately not asserted here, so this
 * file does not quietly claim the toolbar is sound: dewey-ui's toolbar row does
 * not wrap, so below 768px its own search input overlaps the Status facet, and
 * below ~480px its "Columns" dropdown is off-screen entirely (right edge 432 at
 * both 375 and 412). Neither control is one this page renders or can place; the
 * fix is in the primitive's toolbar, not here. What IS asserted is everything
 * the register itself puts in that row.
 */
test.describe("at 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  /**
   * The controls the register itself contributes to the toolbar.
   *
   * The three single-value facets are located by their TEXT, not by an
   * accessible name, because they have none: Radix's SelectTrigger is a
   * `role="combobox"`, and ARIA does not allow a combobox to take its name
   * from its contents, so the "Status: Any" a sighted reader sees is not a
   * name any assistive technology is given. Reported, not fixed here — see
   * SingleFacet's own comment in RegisterFilterBar.tsx, which assumes the
   * opposite.
   */
  function registerControls(page: Page) {
    const single = (text: string) =>
      page.locator('button[role="combobox"]').filter({ hasText: text });
    return [
      page.getByRole("button", { name: "Branch filter, 2 options" }),
      page.getByRole("button", { name: "Department filter, 2 options" }),
      single("Status: Any"),
      single("Schedule: Any"),
      single("Biometric: Any"),
      page.getByRole("button", { name: `Export ${ROSTER} employees as CSV` }),
    ];
  }

  test("the register does not scroll sideways, and its own controls stay on screen", async ({
    page,
  }) => {
    await stubFrappe(page);
    await openRegister(page);

    // A precondition, not a claim: this passes just as happily on a blank page.
    await expect(bodyRows(page)).toHaveCount(ROSTER);

    const measured = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentScroll: document.documentElement.scrollWidth,
      documentClient: document.documentElement.clientWidth,
      bodyScroll: document.body.scrollWidth,
    }));

    expect(measured.viewport, "viewport did not take").toBe(375);
    // 1px of rounding, and no more. The TABLE scrolls horizontally by design —
    // GenericDataTable's fill layout gives it its own scroller — but the page
    // under it must not move.
    expect(
      measured.documentScroll,
      `document overflows by ${measured.documentScroll - measured.documentClient}px`,
    ).toBeLessThanOrEqual(measured.documentClient + 1);
    expect(measured.bodyScroll).toBeLessThanOrEqual(measured.documentClient + 1);

    for (const control of registerControls(page)) {
      const name = (await control.getAttribute("aria-label")) ?? (await control.innerText());
      const box = await control.boundingBox();
      expect(box, `${name} is not laid out at all`).not.toBeNull();
      expect(box!.x, `${name} starts left of the viewport`).toBeGreaterThanOrEqual(-1);
      expect(
        box!.x + box!.width,
        `${name} runs ${Math.round(box!.x + box!.width - measured.viewport)}px past the right edge`,
      ).toBeLessThanOrEqual(measured.viewport + 1);
    }
  });
});
