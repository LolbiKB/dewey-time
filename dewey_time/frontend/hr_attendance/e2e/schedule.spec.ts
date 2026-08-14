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
  // The heading is `sr-only` since the page header was dropped: still a real
  // heading in the accessibility tree — getByRole finds it, and so does a
  // screen reader's heading list — but zero pixels tall, so `toBeVisible`
  // would fail on it. Attached-ness is the claim that matters: a route with
  // no heading has no answer to "where am I", whatever it looks like.
  await expect(
    page.getByRole("heading", { name: "Weekly Schedule", level: 1 }),
  ).toBeAttached();
  await expect(page.getByText("Jane Doe").first()).toBeVisible();
  await expect(page.getByText("Sign in required")).toHaveCount(0);
});
