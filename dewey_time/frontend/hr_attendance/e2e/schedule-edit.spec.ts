import { test, expect } from "@playwright/test";

import { stubFrappe } from "./fixtures";

test.describe("schedule edit", () => {
  test("editing shows the banner and reconcile review", async ({ page }) => {
    await stubFrappe(page);
    await page.goto("/hr-schedule?employee=EMP-001");

    // The notice moved out of the page header into the Shift blocks card and
    // lost the employee's name — the lg picker above the card now says who.
    await expect(
      page.getByText(/Editing an existing schedule — changes apply from the effective date/),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    const save = page.getByRole("button", { name: /Review changes|Save schedule/ });
    await expect(save).toBeVisible();
    await save.click();

    await expect(page.getByText(/Retiring MON-FRI 09–17/)).toBeVisible();
    await expect(page.getByText(/Adding MON-SAT 09–17 from 2026-07-01/)).toBeVisible();
    await expect(page.getByText(/1 future shift inactivated/)).toBeVisible();
    await expect(page.getByText(/1 shift trimmed to end 2026-06-30/)).toBeVisible();
  });

  test("typed name gates the save when shifts are retired", async ({ page }) => {
    await stubFrappe(page);
    await page.goto("/hr-schedule?employee=EMP-001");
    await page.getByRole("button", { name: /Review changes|Save schedule/ }).click();

    const confirm = page.getByRole("button", { name: "Save changes" });
    await expect(confirm).toBeDisabled();

    const input = page.locator("#schedule-change-confirm");
    await input.fill("wrong name");
    await expect(confirm).toBeDisabled();

    await input.fill("Jane Doe");
    await expect(confirm).toBeEnabled();
  });
});
