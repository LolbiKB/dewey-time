import { test, expect } from "@playwright/test";

import { stubFrappe } from "./fixtures";

test.describe("schedule edit", () => {
  test("the editor shows the shift blocks card and the reconcile review", async ({ page }) => {
    await stubFrappe(page);
    await page.goto("/hr-schedule?employee=EMP-001");

    // The "Editing an existing schedule" notice is gone: with editing behind an
    // explicit trigger, a line telling you that you are editing is noise. The
    // Shift blocks card's own description is what survives.
    await expect(page.getByText(/One block per shared pattern/)).toBeVisible();
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
