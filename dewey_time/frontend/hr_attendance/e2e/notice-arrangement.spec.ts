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
