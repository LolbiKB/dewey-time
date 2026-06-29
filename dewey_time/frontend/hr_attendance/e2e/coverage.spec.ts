import { test, expect } from "@playwright/test";
import { stubFrappe } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

test("coverage page defaults to the unassigned view and lists who needs a schedule", async ({
  page,
}, testInfo) => {
  await page.goto("/hr-schedule/coverage");

  await expect(page.getByRole("heading", { name: "Schedule coverage" })).toBeVisible();
  await expect(page.getByText(/13 active/)).toBeVisible();

  // Defaults to "Needs a schedule" because there are unassigned employees.
  await expect(page.getByText("Marco Diaz")).toBeVisible();
  await expect(page.getByRole("button", { name: /Add schedule/ }).first()).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("coverage-needs.png"), fullPage: true });
});

test("weekly-hours view groups assigned employees into nearest-30-min buckets", async ({
  page,
}, testInfo) => {
  await page.goto("/hr-schedule/coverage");

  const toggle = page.getByRole("group", { name: "Coverage views" });
  await toggle.getByRole("button", { name: /Weekly hours/ }).click();

  // Buckets, highest first; the unresolvable row collects in a trailing bucket.
  await expect(page.getByText("40h", { exact: true })).toBeVisible();
  await expect(page.getByText("37h 30m", { exact: true })).toBeVisible();
  await expect(page.getByText("20h", { exact: true })).toBeVisible();
  await expect(page.getByText("No resolved hours")).toBeVisible();

  // The largest bucket is expanded by default → its roster is visible.
  await expect(page.getByText("4 people")).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("coverage-hours.png"), fullPage: true });
});
