import { test, expect } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/**
 * Phone-viewport e2e walk — P3-a proof.
 *
 * Assertions:
 *   1. The week screen (single-day mode at <768 px) never overflows horizontally.
 *   2. A migrated ResponsiveModal opens as a bottom Sheet on a phone.
 *
 * Run individually:
 *   npm run test:e2e -- mobile-surfaces
 */

const PHONE = { width: 390, height: 844 };

test.describe("mobile surfaces", () => {
  test.use({ viewport: PHONE });

  test.beforeEach(async ({ page }) => {
    await stubFrappe(page);
  });

  test("the week screen never scrolls horizontally on a phone", async ({ page }) => {
    await page.goto("/hr-attendance");
    await page.waitForLoadState("networkidle");

    // P3-a proof: scrollWidth must not exceed clientWidth (allow 1 px rounding).
    const overflowing = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowing, "no horizontal overflow at 390 px").toBe(false);

    // Sanity-check: the mobile single-day switcher is visible.
    await expect(page.getByLabel("Next day")).toBeVisible();
  });

  test("a quick-decision dialog opens as a bottom sheet on a phone", async ({ page }) => {
    await page.goto("/hr-attendance");
    await page.waitForLoadState("networkidle");

    // The "Run flag engine" button (FlagIcon, aria-label) lives in AttendanceToolbar
    // and renders at all viewport widths. Click it to open the RunEngineDialog, which
    // delegates to ResponsiveModal → SheetContent(side="bottom") on mobile.
    const trigger = page.getByRole("button", { name: "Run flag engine" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    // ResponsiveModal renders a SheetContent with data-slot="sheet-content" and
    // data-side="bottom" (set by @lolbikb/dewey-ui's SheetContent component).
    const sheet = page.locator('[data-slot="sheet-content"][data-side="bottom"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Run flag engine")).toBeVisible();
  });
});
