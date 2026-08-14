import { expect, test, type Page } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/**
 * Every width figure behind `EmployeePicker`'s size tokens is DERIVED
 * arithmetic. Derived layout numbers have been wrong on this component's
 * neighbourhood before — `--font-khmer` named a family that did not exist, so
 * every Khmer name drew in a macOS system face while the intended subset
 * downloaded unused, and the precondition written to catch exactly that could
 * not fail. This file measures instead of reasoning.
 */

/**
 * The trigger's chrome: everything between the trigger's own box and the width
 * `EmployeeIdentity`'s container queries actually see.
 *
 * `[data-slot="picker-employee-name"]` is line one's name span, a `block` child
 * of the query container, which has no padding — so its width IS the container
 * width. Chrome is width-independent, so measuring it once validates the
 * arithmetic behind all three tokens.
 */
async function chromeBudget(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Anchor on the name slot and walk UP, rather than taking the first
    // [role=combobox] on the page: the picker is not reliably the first one at
    // every viewport, and a wrong element yields a plausible wrong number
    // rather than an error.
    const name = document.querySelector('[data-slot="picker-employee-name"]') as HTMLElement;
    const trigger = name.closest('[role="combobox"]') as HTMLElement;
    return trigger.getBoundingClientRect().width - name.getBoundingClientRect().width;
  });
}

/**
 * Open /hr-attendance and wait for the picker to hold a RESOLVED employee.
 *
 * Every measurement here is about a populated trigger. With nothing selected
 * the picker draws "Choose an employee" and no Khmer name, and the numbers
 * describe a state no user reads.
 */
async function openAttendance(page: Page): Promise<void> {
  await page.goto("/hr-attendance");
  await expect(page.getByText("Jane Doe").first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

test("the trigger chrome costs no more than the 102px the size tokens assume", async ({
  page,
}) => {
  // px-3 (24) + the 40px avatar + gap-2.5 (10) + gap-3 (12) + a 16px chevron.
  // If this is larger, every token's text stack is smaller than claimed and
  // the tokens move — the claim does not.
  await openAttendance(page);
  const chrome = await chromeBudget(page);
  console.log(`[measured] trigger chrome budget: ${chrome}px`);
  expect(chrome).toBeLessThanOrEqual(102);
});

test("each size token leaves the text stack clear of the rung it promises", async ({ page }) => {
  // EmployeeIdentity's measured rungs: first tail fact 120, second 170,
  // Khmer 200, third fact 230. sm promises one fact; md and lg promise all
  // three plus the Khmer name.
  await openAttendance(page);
  const chrome = await chromeBudget(page);
  console.log(
    `[measured] sm stack ${240 - chrome}px · md stack ${352 - chrome}px · lg stack ${512 - chrome}px`,
  );
  expect(240 - chrome).toBeGreaterThanOrEqual(120);
  expect(352 - chrome).toBeGreaterThanOrEqual(230);
  expect(512 - chrome).toBeGreaterThanOrEqual(230);
});

test("a Khmer name fits the trigger's minimum height without clipping", async ({ page }) => {
  // Kantumruy's line box is 17.50px at leading-tight and a Khmer row grows
  // about half a pixel. min-h-14 (56px) must still leave real padding around
  // the two-line stack — where a hard height would have clipped the coeng
  // subscripts, which sit below the baseline.
  await openAttendance(page);

  const fits = await page.evaluate(() => {
    const name = document.querySelector('[data-slot="picker-employee-name"]') as HTMLElement;
    const el = name.closest('[role="combobox"]') as HTMLElement;
    return {
      khmer: !!el.querySelector(".font-khmer"),
      trigger: el.getBoundingClientRect().height,
      stack: (name.parentElement as HTMLElement).getBoundingClientRect().height,
    };
  });
  console.log(`[measured] trigger ${fits.trigger}px · two-line stack ${fits.stack}px`);

  // The precondition, not decoration: every assertion below is vacuous without
  // a Khmer name actually on screen, and a check that cannot fail is what hid
  // the --font-khmer bug for a whole branch.
  expect(fits.khmer, "the fixture employee must have a Khmer name on screen").toBe(true);
  expect(fits.trigger).toBeGreaterThanOrEqual(56);
  expect(fits.stack).toBeLessThanOrEqual(fits.trigger - 8);
});

test("/hr-schedule at 375px does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/hr-schedule");
  await expect(page.getByRole("heading", { name: "Weekly Schedule", level: 1 })).toBeAttached();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
