import { test, expect } from "@playwright/test";
import { stubFrappe } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

test("weekly schedule page renders for HR staff (no auth gate)", async ({ page }) => {
  await page.goto("/hr-schedule");
  await expect(page.getByText("Configure shared shift patterns for an employee.")).toBeVisible();
  await expect(page.getByText("Jane Doe").first()).toBeVisible();
  await expect(page.getByText("Sign in required")).toHaveCount(0);
});
