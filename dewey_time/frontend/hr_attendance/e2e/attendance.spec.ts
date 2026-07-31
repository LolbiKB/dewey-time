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

// Regression guard for the duplicate this app used to render: a top Alert
// banner *and* a Card replacing the week grid for the same failure. App.tsx
// now renders a single FailureBlock (role="alert") in the grid slot, keyed on
// loadError = employeesError ?? calendarError. These two cases pin both
// halves of that union — the calendar failing, and the *employees* list
// failing, which the grid slot used to miss entirely when it was keyed on
// calendarError alone.
test("calendar failure renders exactly one failure surface", async ({ page }) => {
  // Registered after stubFrappe's beforeEach route, so it wins for
  // get_employee_calendar and falls through to the happy path for everything
  // else (Playwright dispatches handlers last-registered-first).
  await page.route("**/api/method/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("get_employee_calendar")) return route.fallback();

    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        exc_type: "ValidationError",
        exception: "frappe.exceptions.ValidationError: staged failure",
        _server_messages: JSON.stringify([JSON.stringify({ message: "Something went wrong." })]),
      }),
    });
  });

  await page.goto("/hr-attendance");

  // react-query retries a 500 before surfacing it, so wait on the failure
  // text itself (with a generous timeout) rather than on network idle.
  await expect(page.getByText("Attendance data didn't load")).toBeVisible({ timeout: 15_000 });
  // The regression this guards: if a top banner is ever reintroduced
  // alongside the grid-slot FailureBlock, this count goes to 2.
  await expect(page.getByRole("alert")).toHaveCount(1);
});

test("employees-only failure is still reported", async ({ page }) => {
  // Only list_calendar_employees fails; get_employee_calendar stays healthy.
  // With the grid slot keyed on calendarError alone (the pre-fix behaviour),
  // this failure would have shown the old top banner and nothing else — the
  // grid slot would have rendered the (empty) week grid instead of a failure.
  await page.route("**/api/method/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes("list_calendar_employees")) return route.fallback();

    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        exc_type: "ValidationError",
        exception: "frappe.exceptions.ValidationError: staged failure",
        _server_messages: JSON.stringify([JSON.stringify({ message: "Something went wrong." })]),
      }),
    });
  });

  await page.goto("/hr-attendance");

  await expect(page.getByText("Attendance data didn't load")).toBeVisible({ timeout: 15_000 });
});
