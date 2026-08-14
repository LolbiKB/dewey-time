import { expect, test, type Page } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/** Height of the page's first chrome row, in CSS pixels. */
async function toolbarHeight(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().height);
}

test("an outage puts a chip in the flags toolbar and no band above the queue", async ({ page }) => {
  await stubFrappe(page, { flagQueueOutageBranches: ["Siem Reap Depot"] });
  await page.goto("/hr-flags");

  const chip = page.getByRole("button", { name: /branch(es)? offline/ });
  await expect(chip).toBeVisible();
  // The band's own text must not be on the page until the chip is opened.
  await expect(page.getByText(/had no device data/)).toHaveCount(0);

  await chip.click();
  await expect(page.getByText(/had no device data/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Excuse/ })).toBeVisible();
  await expect(page.getByText(/nobody is being judged here/)).toBeVisible();
});

test("everything behind the chip is reachable by keyboard", async ({ page }) => {
  // The regression this exists for: with onOpenAutoFocus prevented, this
  // popover is non-modal (trapFocus:false), so focus stayed on the trigger and
  // the first Tab BOTH moved to the date picker and dismissed the layer on the
  // way out. Thirteen checkboxes, the Device health link and the page's largest
  // write were pointer-only, and nothing failed.
  await stubFrappe(page, { flagQueueOutageBranches: ["Siem Reap Depot"] });
  await page.goto("/hr-flags");

  await page.getByRole("button", { name: /branch(es)? offline/ }).focus();
  await page.keyboard.press("Enter");

  const panel = page.locator('[aria-label="Device outages"]');
  await expect(panel).toBeVisible();
  await expect(
    page.evaluate(() => !!document.activeElement?.closest('[aria-label="Device outages"]')),
  ).resolves.toBe(true);

  // Tab reaches the write without dismissing the panel on the way.
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    await expect(panel).toBeVisible();
    // aria-label OR text: the checkboxes are labelled, the Excuse button
    // carries its name as content.
    seen.push(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent ??
          "",
      ),
    );
  }
  assertReached(seen, /^Excuse /);
  assertReached(seen, /^Include /);
});

/** Playwright has no "one of these matched" assertion; this reads better than a filter. */
function assertReached(labels: string[], pattern: RegExp) {
  expect(labels.some((label) => pattern.test(label)), `${pattern} in ${labels.join(" | ")}`).toBe(
    true,
  );
}

test("a healthy queue has no chip at all — absent, not present-and-empty", async ({ page }) => {
  await stubFrappe(page);
  await page.goto("/hr-flags");

  await expect(page.getByRole("list", { name: "Flag queue" })).toBeVisible();
  await expect(page.getByRole("button", { name: /branch(es)? offline/ })).toHaveCount(0);
});

/**
 * What the chip actually costs, measured rather than derived.
 *
 * Free at 1280: it takes the horizontal space the page title vacated. NOT free
 * at 375, and the retreat the plan wrote in advance — dropping the chevron and
 * the +N at that width — was tried and changed nothing: the date pickers below
 * `sm` already need the full row, so the chip is a whole wrap line no matter
 * how narrow it is. 44px, pinned exactly, so a regression that adds a SECOND
 * line still fails here.
 *
 * It is still an enormous saving on a phone. What it replaces at 375 was the
 * page header, the outage band (134px by OutageBand's own measurement), the
 * capped strip and up to two orphan lines — well past 200px, none of it
 * actionable.
 */
const EXPECTED_CHIP_COST: Record<number, number> = { 1280: 0, 375: 44 };

for (const width of [1280, 375]) {
  test(`the flags chip costs ${EXPECTED_CHIP_COST[width]}px of vertical space at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    // With an outage — the chip is present.
    await stubFrappe(page, { flagQueueOutageBranches: ["Siem Reap Depot"] });
    await page.goto("/hr-flags");
    await expect(page.getByRole("button", { name: /branch(es)? offline/ })).toBeVisible();
    const withChip = await toolbarHeight(page, '[data-testid="flag-toolbar"]');

    // Without one — the chip is not rendered at all.
    await stubFrappe(page);
    await page.goto("/hr-flags");
    await expect(page.getByRole("button", { name: /branch(es)? offline/ })).toHaveCount(0);
    const withoutChip = await toolbarHeight(page, '[data-testid="flag-toolbar"]');

    console.log(
      `[measured] flags toolbar @${width}: with chip ${withChip}px · without ${withoutChip}px`,
    );
    expect(withChip - withoutChip).toBe(EXPECTED_CHIP_COST[width]);
  });
}

/**
 * The attendance side, which the first version of this spec did not measure at
 * all — the "costs no vertical space" claim there was a comment, and a review
 * found it false: below `sm` the chip was a full-width 335px amber bar on its
 * own line, because AttendanceToolbar's <header> is flex-col with the default
 * align-items:stretch. That is the banner shape this whole change deletes.
 */
const EXPECTED_ATTENDANCE_COST: Record<number, number> = { 1280: 0, 375: 44 };

for (const width of [1280, 375]) {
  test(`the attendance chip costs ${EXPECTED_ATTENDANCE_COST[width]}px and never spans the row at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const toolbar = () => page.locator('header:has([aria-label="Week navigation"])');

    // A healthy day: no chip.
    await stubFrappe(page);
    await page.goto("/hr-attendance");
    await expect(toolbar()).toBeVisible();
    await expect(page.getByRole("button", { name: /Last sync/ })).toHaveCount(0);
    const without = await toolbar().evaluate((el) => el.getBoundingClientRect().height);

    // Five hours since the freshest delivery — past SYNC_STALE_AFTER_MIN.
    await stubFrappe(page, { staleSyncHours: 5 });
    await page.goto("/hr-attendance");
    const chip = page.getByRole("button", { name: /Last sync/ });
    await expect(chip).toBeVisible();
    const withChip = await toolbar().evaluate((el) => el.getBoundingClientRect().height);
    const chipWidth = await chip.evaluate((el) => el.getBoundingClientRect().width);

    console.log(
      `[measured] attendance toolbar @${width}: with chip ${withChip}px · without ${without}px · chip ${chipWidth}px wide`,
    );
    expect(withChip - without).toBe(EXPECTED_ATTENDANCE_COST[width]);
    // self-start. Without it align-items:stretch made this the full row.
    expect(chipWidth).toBeLessThan(width / 2);
  });
}
