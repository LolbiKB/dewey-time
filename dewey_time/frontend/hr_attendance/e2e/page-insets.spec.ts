import { expect, test } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/**
 * The shell's header and the page under it are stacked siblings, so their left
 * and right content edges are read as one line down the screen. Nothing had
 * ever enforced that: dewey-ui's header spelled its gutters `px-4 sm:px-6` and
 * its Page `px-5 sm:px-8`, so the logo and tabs sat 8px inside every page title
 * on every route — and once /hr-flags dropped the shared max-w-7xl cap to win
 * its width back, while the header kept it, that 8px became 108px at 1512 and
 * 312px at 1920.
 *
 * dewey-ui 2.0.0 has both surfaces read one PAGE_INSET_X and neither carry a
 * cap. That is a claim about geometry, and a class-string assertion cannot
 * check geometry — twMerge, Tailwind's own emit order, and any app-level CSS
 * override all sit between the JSX and the rendered box. So it is measured
 * here, in a browser, on every route the shell wraps.
 */

const ROUTES = [
  "/hr-attendance",
  "/hr-schedule",
  "/hr-schedule/import",
  "/hr-schedule/coverage",
  "/hr-flags",
];

/** Widths either side of the `sm` gutter step, and past the old 1280 cap. */
const WIDTHS = [1024, 1280, 1512, 1920];

type Edges = {
  headerLeft: number;
  headerRight: number;
  pageLeft: number;
  pageRight: number;
  viewport: number;
};

async function contentEdges(page: import("@playwright/test").Page): Promise<Edges> {
  return page.evaluate(() => {
    // The bar inside <header> that carries the gutters, and the page wrapper.
    const bar = document.querySelector("header > div");
    const pageEl = document.querySelector('[data-slot="page"]');
    if (!bar || !pageEl) throw new Error("expected an AppShell header and a Page on this route");

    const edges = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        left: rect.left + parseFloat(style.paddingLeft),
        right: rect.right - parseFloat(style.paddingRight),
      };
    };
    const b = edges(bar);
    const p = edges(pageEl);
    return {
      headerLeft: b.left,
      headerRight: b.right,
      pageLeft: p.left,
      pageRight: p.right,
      viewport: window.innerWidth,
    };
  });
}

test("the chrome and the page content share one pair of edges, on every route", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await stubFrappe(page);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('[data-slot="page"]')).toBeVisible();
      const e = await contentEdges(page);
      const where = `${route} @${width}`;

      // Preconditions. Without these the equality below would still hold for a
      // header and a page that had both collapsed to zero width, or for a run
      // whose viewport never reached the width being named.
      expect(e.viewport, `${where}: viewport did not take`).toBe(width);
      expect(e.headerRight - e.headerLeft, `${where}: header bar has no width`).toBeGreaterThan(
        width / 2,
      );

      expect(e.pageLeft, `${where}: page content starts left of the chrome`).toBeCloseTo(
        e.headerLeft,
        1,
      );
      expect(e.pageRight, `${where}: page content ends right of the chrome`).toBeCloseTo(
        e.headerRight,
        1,
      );
    }
  }
});

test("the pages are full-bleed — no cap re-centres them on a wide monitor", async ({ page }) => {
  await stubFrappe(page);
  await page.setViewportSize({ width: 1920, height: 900 });

  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('[data-slot="page"]')).toBeVisible();
    const e = await contentEdges(page);

    // 32px of gutter each side at >= sm, and nothing else taken off. Under the
    // old max-w-7xl this was 352 and 1568 — a third of the monitor unused.
    expect(e.pageLeft, `${route}: left gutter`).toBeCloseTo(32, 1);
    expect(e.pageRight, `${route}: right gutter`).toBeCloseTo(1920 - 32, 1);
  }
});
