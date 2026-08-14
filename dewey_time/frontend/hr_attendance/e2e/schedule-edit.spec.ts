import { test, expect, type Page } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/**
 * Open the editor and make one real edit.
 *
 * Save is gated on the form being dirty, because saving an untouched schedule
 * is not a no-op on this page — the backend retires the existing SSAs and
 * recreates them. So a test that wants the reconcile review has to actually
 * change something first; before that gate existed these tests were asserting
 * that saving an *identical* schedule offers to retire the employee's shifts.
 */
async function openEditorWithAnEdit(page: Page) {
  await page.goto("/hr-schedule?employee=EMP-001");
  // EMP-001 has a live schedule, so the page lands on the read-only preview.
  // The editor is behind an explicit trigger now.
  await page.getByRole("button", { name: "Edit schedule" }).click();
  await page.locator("#generate-through-limit").click();
  await expect(page.locator("#generate-through-limit")).toBeChecked();
}

test.describe("schedule edit", () => {
  test("the editor shows the shift blocks card and the reconcile review", async ({ page }) => {
    await stubFrappe(page);
    await openEditorWithAnEdit(page);

    // The "Editing an existing schedule" notice is gone: with editing behind an
    // explicit trigger, a line telling you that you are editing is noise. The
    // Shift blocks card's own description is what survives.
    await expect(page.getByText(/One block per shared pattern/)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    const save = page.getByRole("button", { name: /Review changes|Save schedule/ });
    await expect(save).toBeEnabled();
    await save.click();

    await expect(page.getByText(/Retiring MON-FRI 09–17/)).toBeVisible();
    await expect(page.getByText(/Adding MON-SAT 09–17 from 2026-07-01/)).toBeVisible();
    await expect(page.getByText(/1 future shift inactivated/)).toBeVisible();
    await expect(page.getByText(/1 shift trimmed to end 2026-06-30/)).toBeVisible();
  });

  test("an untouched schedule cannot be re-saved", async ({ page }) => {
    // The other half of the gate above: Edit, change nothing, and Save stays
    // disabled rather than walking the user through a typed-name confirmation
    // to replace a schedule with an identical one.
    await stubFrappe(page);
    await page.goto("/hr-schedule?employee=EMP-001");
    await page.getByRole("button", { name: "Edit schedule" }).click();

    await expect(page.getByText(/One block per shared pattern/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Review changes|Save schedule/ })).toBeDisabled();
  });

  test("typed name gates the save when shifts are retired", async ({ page }) => {
    await stubFrappe(page);
    await openEditorWithAnEdit(page);
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
