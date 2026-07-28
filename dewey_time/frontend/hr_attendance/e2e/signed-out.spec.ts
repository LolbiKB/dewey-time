/**
 * The signed-out path had NO automated coverage before this file.
 *
 * Task 7 replaced frappe-react-sdk's `useFrappeAuth` with `useSession()` over
 * `frappe.auth.get_logged_user`. That hook feeds the auth gate on all four
 * routes, and the gate's whole job is to render a sign-in card rather than a
 * spinner or a blank page. Both shapes Frappe actually returns are pinned here:
 * a 200 carrying the literal "Guest", and a 403.
 *
 * The 403 case is also what makes `retry: false` load-bearing in useSession —
 * without it the QueryClient's default would back off twice before the card
 * could appear, turning an instant login prompt into seconds of spinner.
 */
import { test, expect } from "@playwright/test";
import { stubFrappe } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
  // Registered after stubFrappe so it takes precedence for this one method.
  await page.route("**/api/method/frappe.auth.get_logged_user**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "Guest" }),
    }),
  );
});

test("signed-out: Guest gets the sign-in card, not a spinner", async ({ page }) => {
  await page.goto("/hr-schedule");
  await expect(page.getByText("Sign in required")).toBeVisible({ timeout: 10_000 });
  const login = page.getByRole("link", { name: /log in/i });
  await expect(login).toBeVisible();
  await expect(login).toHaveAttribute("href", /\/login\?redirect-to=/);
});

test("signed-out: a 403 gets the sign-in card too", async ({ page }) => {
  await page.route("**/api/method/frappe.auth.get_logged_user**", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ exc_type: "PermissionError" }),
    }),
  );
  await page.goto("/hr-schedule");
  await expect(page.getByText("Sign in required")).toBeVisible({ timeout: 10_000 });
});
