/**
 * The signed-out path had NO automated coverage before this file.
 *
 * Task 7 replaced frappe-react-sdk's `useFrappeAuth` with `useSession()` over
 * `frappe.auth.get_logged_user`. That hook feeds the auth gate on all four
 * routes, and the gate's whole job is to render a sign-in card rather than a
 * spinner or a blank page.
 *
 * Signed out, `get_calendar_session` cannot answer `hr_staff: true` — Frappe
 * 403s it — so `useCalendarSession` resolves `hrStaff` to false, and
 * WeeklySchedulePage's `!hrStaff` redirect (WeeklySchedulePage.tsx:281) fires
 * *before* its own sign-in gate below it. A signed-out visitor therefore always
 * lands on App.tsx's card, whichever route they asked for. That is the card
 * asserted here; the redirect gets its own case, and every case checks the
 * login link, not just the heading — a card with a broken /login href is the
 * failure this file exists to catch.
 *
 * Three server shapes, because Frappe produces three:
 *   - 200 carrying the literal "Guest"
 *   - 403, for an unauthenticated whitelisted call
 *   - 200 carrying the login *page*, when a session has expired
 *
 * That last one is what makes useSession's `sessionProbeRetry` predicate
 * load-bearing, and it is the only one of the three that does. queryClient's
 * default already refuses to retry a FrappeCallError with a 4xx status, so the
 * 403 case is never retried either way. But frappeCall turns login HTML into a
 * FrappeCallError with status **200** (frappe.ts:80-85), which is not 4xx, so
 * the default *would* retry it — a backoff spent on a verdict that cannot
 * change.
 *
 * A fourth case covers the other half of that predicate. The probe is a real
 * request now (frappe-react-sdk read a cookie), so it can fail for reasons that
 * are not a verdict, and the gate collapses "signed out" and "the probe failed"
 * to the same `currentUser: null`. One dropped request on first paint must not
 * tell a signed-in user they are signed out, so a 5xx buys exactly one retry.
 *
 * Both are pinned by request count rather than latency, because the backoff
 * still fits inside the timeout below: 1 for the 200, 2 for the 500.
 */
import { test, expect, type Page } from "@playwright/test";
import { stubFrappe } from "./fixtures";

const LOGGED_USER = "**/api/method/frappe.auth.get_logged_user**";
const CALENDAR_SESSION = "**/api/method/**get_calendar_session**";

/** The one destination every signed-out case must reach. */
async function expectSignInCard(page: Page): Promise<void> {
  await expect(page.getByText("Sign in required")).toBeVisible({ timeout: 10_000 });
  const login = page.getByRole("link", { name: /log in/i });
  await expect(login).toBeVisible();
  await expect(login).toHaveAttribute("href", /\/login\?redirect-to=/);
}

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);

  // Both registered after stubFrappe so they take precedence for these methods.
  // The session stub has to be overridden too: the fixture's signed-in
  // `{hr_staff: true}` is a state a signed-out server cannot produce, and
  // leaving it in place would route these tests through a gate real visitors
  // never reach.
  await page.route(CALENDAR_SESSION, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ exc_type: "PermissionError" }),
    }),
  );
  await page.route(LOGGED_USER, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "Guest" }),
    }),
  );
});

test("signed-out: Guest gets the sign-in card, not a spinner", async ({ page }) => {
  await page.goto("/hr-attendance");
  await expectSignInCard(page);
});

test("signed-out: a 403 gets the sign-in card too", async ({ page }) => {
  await page.route(LOGGED_USER, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ exc_type: "PermissionError" }),
    }),
  );
  await page.goto("/hr-attendance");
  await expectSignInCard(page);
});

test("signed-out: /hr-schedule redirects to the attendance card", async ({ page }) => {
  await page.goto("/hr-schedule");
  // Tolerates a query string on purpose: the employee hooks resolve even signed
  // out and sync `?employee=…` into the URL shortly after the redirect lands, so
  // an end-anchored pattern races that write and fails about one run in three.
  // It still has to be a URL assertion — checking only the card would pass even
  // if the redirect never happened, since /hr-schedule renders a card either way.
  await expect(page).toHaveURL(/\/hr-attendance(\?|$)/);
  await expectSignInCard(page);
});

test("signed-out: an expired session's login page is not retried", async ({ page }) => {
  let requests = 0;
  await page.route(LOGGED_USER, (route) => {
    requests += 1;
    // What Frappe actually serves a stale session: the login page, HTTP 200.
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><form id='login'></form></body></html>",
    });
  });

  await page.goto("/hr-attendance");
  await expectSignInCard(page);

  // >1 here means useSession's predicate stopped special-casing the 200, and the
  // user waited out a backoff for a card that could not change.
  expect(requests).toBe(1);
});

test("signed-out: a 500 is retried once before the sign-in card", async ({ page }) => {
  let requests = 0;
  await page.route(LOGGED_USER, (route) => {
    requests += 1;
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ exc_type: "InternalServerError" }),
    });
  });

  await page.goto("/hr-attendance");
  await expectSignInCard(page);

  // The card is the barrier: it only renders once the query has stopped
  // retrying, so the count is settled here. 1 would mean a single blip on first
  // paint tells a signed-in user they are signed out — the failure the
  // predicate exists to prevent. 3 would mean the un-narrowed default leaked
  // back in and the sign-in card is two backoffs behind the truth.
  expect(requests).toBe(2);
});
