import { test, expect } from "@playwright/test";
import { stubFrappe } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

test("weekly schedule page renders for HR staff (no auth gate)", async ({ page }) => {
  await page.goto("/hr-schedule");
  // Assert the heading, not the subtitle. The subtitle is a slot: it reads
  // "Configure shared shift patterns for an employee." only until the schedule
  // context loads, then swaps to the editing line for an employee who already
  // has a live schedule — which the auto-selected Jane Doe does. Asserting the
  // subtitle raced that load and failed intermittently.
  await expect(page.getByRole("heading", { name: "Weekly Schedule" })).toBeVisible();
  await expect(page.getByText("Jane Doe").first()).toBeVisible();
  await expect(page.getByText("Sign in required")).toHaveCount(0);
});
