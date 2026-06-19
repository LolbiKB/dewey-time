import { test, expect } from "@playwright/test";
import { stubFrappe } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

test("attendance view loads past the auth gate with stubbed data", async ({ page }) => {
  await page.goto("/hr-attendance");
  // Assert on content (viewport-independent), not chrome — the brand is hidden on phones.
  await expect(page.getByText("Jane Doe").first()).toBeVisible();
  await expect(page.getByText("Sign in required")).toHaveCount(0);
});

test("day inspector opens and shows the day's flag", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop-only interaction");
  await page.goto("/hr-attendance");

  // Each day column is a button labelled with its segment summary (8h 54m gross).
  await page.getByRole("button", { name: /8h 54m/ }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Day inspector")).toBeVisible();

  await dialog.getByRole("tab", { name: /Flags/ }).click();
  await expect(dialog.getByText("Late start")).toBeVisible();
});

test("week navigation moves to a different week", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop-only interaction");
  await page.goto("/hr-attendance");

  // The week-label button is the only control whose name ends in a 4-digit year.
  const weekLabel = page.getByRole("button", { name: /,\s*\d{4}$/ });
  await expect(weekLabel).toBeVisible();
  const before = (await weekLabel.textContent())?.trim() ?? "";

  await page.getByRole("button", { name: "Next week" }).click();
  await expect(weekLabel).not.toHaveText(before);
});
