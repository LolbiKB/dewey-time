import { test } from "@playwright/test";

import { AUDIT_SCENARIOS, stubAuditScenario } from "./audit-fixtures";

/**
 * Pre-rollout screenshot walk. NOT a CI test: it asserts nothing and exists to
 * produce e2e/.audit-shots/ for human review. Run with:
 *   AUDIT=1 npx playwright test e2e/audit-walk.spec.ts --project=desktop
 */
test.skip(!process.env.AUDIT, "audit walk runs only with AUDIT=1");

const SHOTS = "e2e/.audit-shots";
const VIEWPORTS = [
  { tag: "laptop", width: 1440, height: 900 },
  { tag: "phone", width: 375, height: 812 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(vp.tag, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const scenario of AUDIT_SCENARIOS) {
      test(`attendance ${scenario}`, async ({ page }) => {
        await stubAuditScenario(page, scenario);
        await page.goto("/hr-attendance");
        if (scenario === "slow-load") {
          // capture the in-flight loading state, then the settled state
          await page.waitForTimeout(1500);
          await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-slow-load-loading.png`, fullPage: true });
          await page.waitForTimeout(6000);
        } else {
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.waitForTimeout(500);
        }
        await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-${scenario}.png`, fullPage: true });
      });
    }

    test("attendance interactions (baseline + crowded-list)", async ({ page }) => {
      // employee picker open + no-match search, on the crowded list
      await stubAuditScenario(page, "crowded-list");
      await page.goto("/hr-attendance");
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.getByRole("combobox").first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-picker-open.png`, fullPage: true });
      await page.getByPlaceholder(/Search by name/).fill("zzzz");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-picker-no-match.png`, fullPage: true });
      await page.keyboard.press("Escape");

      // weekly schedule sheet
      await page.getByRole("button", { name: "View weekly schedule" }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-schedule-sheet.png`, fullPage: true });
      await page.keyboard.press("Escape");
    });

    test("attendance flag detail (all-flags)", async ({ page }) => {
      await stubAuditScenario(page, "all-flags");
      await page.goto("/hr-attendance");
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(500);
      // open the first visible flag badge; LATE_START is encoded as a colored
      // border only, but OFF_SHIFT renders as a text chip above the column header
      // — click that instead to open the flag detail panel
      const flagChip = page.getByText("OFF_SHIFT", { exact: false }).first();
      if (await flagChip.isVisible().catch(() => false)) {
        await flagChip.click();
        await page.waitForTimeout(400);
      }
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-attendance-flag-detail.png`, fullPage: true });
    });

    // ── Schedule walk ──────────────────────────────────────────────────────────

    for (const scenario of ["baseline", "no-schedule", "api-error", "crowded-list"] as const) {
      test(`schedule ${scenario}`, async ({ page }) => {
        await stubAuditScenario(page, scenario);
        await page.goto("/hr-schedule");
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/${vp.tag}-schedule-${scenario}.png`, fullPage: true });
      });
    }

    test("schedule wizard flow (baseline)", async ({ page }) => {
      await stubAuditScenario(page, "baseline");
      await page.goto("/hr-schedule");
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(500);

      // open the employee picker (ScheduleEmployeePicker renders a Button with role="combobox")
      await page.getByRole("combobox").first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-schedule-picker-open.png`, fullPage: true });

      // brief uses getByText("Jane Doe").first() but when the picker is open the trigger
      // also shows "Jane Doe" — clicking it would close the popover rather than select the
      // option.  Use getByRole("option") to target the cmdk CommandItem specifically.
      await page.getByRole("option", { name: /Jane Doe/ }).first().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/${vp.tag}-schedule-wizard-loaded.png`, fullPage: true });

      // walk to the apply/confirm step; locators may need adjusting at execution
      // time — the goal shots are: day editor, review step, confirm modal.
      // With isEditing=true (fixture has enabled_ssa_count=1) the button reads "Review changes".
      const applyButton = page.getByRole("button", { name: /apply|review|continue/i }).first();
      if (await applyButton.isVisible().catch(() => false)) {
        await applyButton.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS}/${vp.tag}-schedule-review-step.png`, fullPage: true });
      }
    });
  });
}
