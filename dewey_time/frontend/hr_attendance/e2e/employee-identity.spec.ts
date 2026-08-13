import { expect, test, type Page } from "@playwright/test";

import { longKhmerCoveragePayload, stubFrappe } from "./fixtures";

/**
 * The identity block, in a browser.
 *
 * Everything about the composition is pure and covered by node:test. What that
 * suite cannot see is a CONTAINER QUERY: a threshold that never matches, one
 * that drifted, or a Tailwind class string that emitted no CSS at all are all
 * invisible to renderToStaticMarkup, which reports the markup and not the box.
 *
 * Three of the numbers this file pins contradict what the design recorded, and
 * every one of them was only reachable by measuring:
 *
 *   - the register's stack is 190px at 1280, not 185, and crosses the 200px
 *     threshold at a 1330 viewport rather than the ~1536 the plan assumed;
 *   - a Khmer name is NOT free of row height — it costs 4px of line box;
 *   - the flag queue's finding overflows line two on a phone.
 *
 * They are pinned rather than papered over. A test that records the wrong
 * number is worse than no test, because the number then gets quoted.
 */

/**
 * The Khmer half of the measured worst case. The whole of it — "Sovannary Heng
 * · ហេង សុវណ្ណារី" — needs 194px on one line at 14px semibold, which is where
 * the 200px threshold came from.
 */
const LONGEST_KHMER = "ហេង សុវណ្ណារី";

/** Jane Doe's Khmer family name. Appears in none of her Latin fields. */
const JANE_KHMER_FAMILY = "ចាន់";

/** Every surface that draws a person and has a route of its own. */
const ROUTES = ["/hr-attendance", "/hr-schedule/coverage", "/hr-flags"];

/**
 * Laptop, tablet, large phone, phone — led by 1440, which is past the width at
 * which the register turns its Khmer name on. Without that first one the whole
 * grid would walk the app with the threshold never once satisfied in a table.
 */
const WIDTHS = [1440, 1280, 768, 412, 375];

/**
 * Kantumruy Pro's Khmer subset, confirmed loaded.
 *
 * Two measurement passes during design were wrong because it had not loaded and
 * every number came from a fallback font. A geometric test that measures the
 * wrong font is a test that cannot fail correctly, so this is a precondition
 * rather than a convenience.
 */
async function khmerFontLoaded(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 14px "Kantumruy Pro"', "ចាន់");
  });
}

/**
 * Every identity stack on the page, with its width and what it is showing.
 *
 * `clipped` names the LINE that overflowed rather than quoting its text, because
 * the two lines carry different promises: line one must never be clipped while a
 * Khmer name is on it (an ellipsis with no inter-word space to land in is the
 * failure the whole threshold exists to prevent), whereas line two is the id
 * followed by facts that are supposed to hide before they overflow. Collapsing
 * both into one string list, as the first draft of this file did, made a
 * genuine line-two overflow read as the same event as a mid-cluster ellipsis.
 */
type Stack = {
  width: number;
  height: number;
  showsKhmer: boolean;
  name: string;
  facts: string;
  clipped: ("name" | "facts")[];
};

async function stacks(page: Page): Promise<Stack[]> {
  // Settle the webfonts BEFORE reading any box. The register's Employee column
  // is auto-layout and takes whatever the other columns leave, so those columns
  // measured in a fallback face hand it a different width — 204px instead of
  // 198px at a 1320 viewport, which is enough to cross the threshold this file
  // exists to pin. It made the crossing test pass alone and fail under load.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".\\@container")].map((el) => {
      const lines = [...el.children] as HTMLElement[];
      const box = el.getBoundingClientRect();
      // innerText, not textContent: it reports RENDERED text, so a Khmer name
      // switched off by the container query reads as absent rather than as
      // present-but-invisible. That is the whole measurement.
      const text = (index: number) => lines[index]?.innerText ?? "";
      const overflows = (index: number) => {
        const line = lines[index];
        return !!line && line.scrollWidth > line.clientWidth + 1;
      };
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        showsKhmer: /[ក-៿]/.test(text(0)),
        name: text(0).trim(),
        facts: text(1).trim(),
        clipped: ([] as ("name" | "facts")[]).concat(
          overflows(0) ? ["name"] : [],
          overflows(1) ? ["facts"] : [],
        ),
      };
    }),
  );
}

/** The register, at a viewport chosen for what it does to the Employee column. */
async function registerAt(page: Page, width: number): Promise<Stack[]> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/hr-schedule/coverage");
  await expect(page.locator("tbody tr")).toHaveCount(14);
  return stacks(page);
}

test("the Khmer subset font is loaded, or nothing below means anything", async ({ page }) => {
  await stubFrappe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-attendance");
  await expect(page.locator(".\\@container").first()).toBeVisible();
  expect(await khmerFontLoaded(page)).toBe(true);
});

test("a name line is never clipped, and line two only where measured", async ({ page }) => {
  // The name assertion is the one that would have caught both rejected
  // alternatives: a Khmer name shrunk to 3px, and an ellipsis landing
  // mid-cluster. It is absolute — there is no width or surface at which a name
  // on this fixture's roster may overflow.
  //
  // Line two is pinned as a SET rather than asserted empty, because it is not
  // empty: the flag queue's finding overflows on a phone, measured below. A set
  // fails both ways — on a new overflow anywhere, and on this one being fixed
  // without the pin being updated to say so.
  //
  // Fifteen navigations, so the default 30s is not the budget this needs — the
  // same reason page-insets.spec.ts raises it for its own route-by-width walk.
  test.setTimeout(120_000);
  await stubFrappe(page);
  const factOverflows: string[] = [];

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator(".\\@container").first()).toBeVisible();
      const found = await stacks(page);
      expect(found.length, `${route} @${width}: no identity blocks found`).toBeGreaterThan(0);
      for (const s of found) {
        expect(
          s.clipped,
          `${route} @${width}: name clipped at stack ${s.width}px — "${s.name}"`,
        ).not.toContain("name");
        if (s.clipped.includes("facts")) factOverflows.push(`${route} @${width}`);
      }
    }
  }

  // 210px of "EMP-002 · Missing 3h 12m · Thu 6 Aug" into a 139px stack at 375
  // and a 176px one at 412. The tail ladder's first rung is 120px — "the id
  // plus one fact" — and it was measured against a picker's department name,
  // not against a 26-character finding. See the dedicated test below.
  expect([...new Set(factOverflows)].sort()).toEqual(["/hr-flags @375", "/hr-flags @412"]);
});

test("the Khmer name appears above 200px of stack and not below it", async ({ page }) => {
  // The threshold, measured rather than read off a class string. Tailwind can
  // emit no CSS for a malformed arbitrary variant and the markup looks correct.
  await stubFrappe(page);
  const register = await registerAt(page, 1280);
  expect(register.length, "the register drew no identity blocks").toBeGreaterThan(0);
  for (const s of register) {
    expect(s.showsKhmer, `register stack ${s.width}px must hide the Khmer name`).toBe(false);
    expect(s.width, "the register stack is below the threshold by design").toBeLessThan(200);
  }

  await page.goto("/hr-attendance");
  await expect(page.locator("[role=combobox]").first()).toBeVisible();
  await page.locator("[role=combobox]").first().click();
  const options = await stacks(page);
  const wide = options.filter((s) => s.width >= 200);
  expect(wide.length, "the open picker should have wide stacks").toBeGreaterThan(0);
  expect(wide.some((s) => s.showsKhmer), "a wide stack must show the Khmer name").toBe(true);
});

test("the register turns its Khmer name on at a 1330 viewport, not at 1536", async ({ page }) => {
  // Task 9 floored the Employee column at min-w-[185px] and deliberately did
  // NOT cap it, so that the column can widen the names as the register grows.
  // The consequence was recorded as arriving "above ~1536"; it arrives at 1330,
  // where the stack is exactly 200px. 1330 is an ordinary laptop, so this is
  // the common case and not an edge, and it is pinned here so that a change to
  // the column's floor, the avatar or the threshold shows up as a moved
  // crossing rather than as a surprise.
  //
  // Bracketed at 1320/1340 rather than probed at 1330 itself: the crossing lands
  // ON the boundary there, and a test standing on a knife edge reports rounding
  // as a regression. 198px and 202px leave two pixels of daylight either side.
  await stubFrappe(page);

  const below = await registerAt(page, 1320);
  for (const s of below) {
    expect(s.width, "1320 must leave the column just short of the threshold").toBeLessThan(200);
    expect(s.showsKhmer, `stack ${s.width}px is below 200 and must show no Khmer`).toBe(false);
  }

  const above = await registerAt(page, 1340);
  for (const s of above) {
    expect(s.width, "1340 must carry the column over the threshold").toBeGreaterThanOrEqual(200);
  }
  // The four people in the fixture who have a Khmer name, and not the ten who
  // do not: the query turned on for the column, and each row still decided for
  // itself on the strength of its own data.
  expect(above.filter((s) => s.showsKhmer).map((s) => s.name).sort()).toEqual([
    "Aaron Wells·ហេង សុវណ្ណារី",
    "Jane Doe·ចាន់ សុភា",
    "Marco Diaz·លី",
    "Nora Vance·សុខ ដារា",
  ]);
});

test("a Khmer name costs 4px of line box, and one pixel of register row", async ({ page }) => {
  // The design recorded this as free — "Khmer at 14px sits inside the same line
  // box as Latin at 14px, so this costs no row height". It is not free, and the
  // number was almost certainly taken from a fallback face. Kantumruy Pro's
  // ascent and descent exceed the Latin face's, so line one's line box is the
  // union of two differently proportioned inline boxes and grows even though
  // both carry the same font-size and the same `leading-tight`.
  //
  // 4px, and the extra is what draws Khmer's stacked coeng subscripts, so
  // flattening it by fixing line one's height would clip them: this is a cost
  // to know about, not a bug to close. Measured on the register just past the
  // threshold, the one place that shows both kinds of row side by side.
  await stubFrappe(page);
  const register = await registerAt(page, 1340);

  const withKhmer = [...new Set(register.filter((s) => s.showsKhmer).map((s) => s.height))];
  const without = [...new Set(register.filter((s) => !s.showsKhmer).map((s) => s.height))];
  expect(withKhmer, "no row showed a Khmer name — the measurement is vacuous").toEqual([37]);
  expect(without, "no row lacked a Khmer name — the measurement is vacuous").toEqual([33]);

  // What it costs the table, which is the number that actually matters: the
  // other cells absorb most of it, so 503 register rows come out 1px apart.
  const rowHeights = await page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll("tbody tr")].map((el) =>
        Math.round(el.getBoundingClientRect().height),
      ),
    ),
  ]);
  expect(rowHeights.sort((a, b) => a - b)).toEqual([53, 54]);
});

test("typing a Khmer name narrows the register to that one person", async ({ page }) => {
  // Asserting a row COUNT of 1 would pass on an empty result: with nothing
  // matched the register renders a single "No employees found" row, so the
  // count is 1 either way. This drove a green test on a roster that had no
  // Khmer names in it at all.
  await stubFrappe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-schedule/coverage");
  await expect(page.locator("tbody tr")).toHaveCount(14);

  await page.getByRole("textbox", { name: /^Search 14 employees/ }).fill(LONGEST_KHMER);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator('tbody tr [data-slot="employee-name"]')).toHaveText(
    `Aaron Wells·${LONGEST_KHMER}`,
  );
});

test("a Khmer query narrows an open picker, non-Latin data-value and all", async ({ page }) => {
  // The wiring — `filter={employeeCommandFilter}` over a
  // `value={employeeSearchHaystack(employee)}` that includes the Khmer name —
  // was only ever checked by reading the source. What no unit test reaches is
  // cmdk itself, which lowercases and normalises the `data-value` it stores and
  // the query it is given before either reaches our filter.
  await stubFrappe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-attendance");
  await page.locator("[role=combobox]").first().click();
  await expect(page.getByRole("option")).toHaveCount(1);

  const search = page.getByPlaceholder(/Search by name/);
  // Jane's Khmer family name is in none of her Latin fields, so the row can
  // only have survived on the Khmer half of the haystack.
  await search.fill(JANE_KHMER_FAMILY);
  await expect(page.getByRole("option")).toHaveCount(1);

  // …and the filter really is filtering. A scorer that kept every row would
  // pass the assertion above and fail this one.
  await search.fill(LONGEST_KHMER);
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("No employees match your search.")).toBeVisible();
});

test("the flag queue's finding survives a phone, truncated but never dropped", async ({ page }) => {
  // The finding is why the row exists, and it is now the first tail fact —
  // which `TAIL_VISIBILITY[0]` hides below 120px of container. Two implementers
  // called that theoretical at real viewports without being able to measure a
  // container width. Measured: the queue's stack is 139px at 375, so the fact
  // clears the rung and is RENDERED — and then overflows, needing 210px.
  //
  // So it is truncated rather than dropped, the part that survives is the part
  // that matters ("Missing 3h 12m" leads), and the whole of it is in the row's
  // aria-label at every width. Pinned, because the alternative reading — that
  // the fact vanishes — would call for a different fix entirely.
  await stubFrappe(page);
  const label = "Aaron Wells. ហេង សុវណ្ណារី. Missing 3h 12m";

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/hr-flags");
  const row = page.getByRole("button", { name: /Aaron Wells/ });
  await expect(row).toBeVisible();
  const phone = (await stacks(page))[0];
  expect(phone.width, "the queue's stack on a phone").toBe(139);
  expect(phone.facts, "the finding is rendered, not hidden").toContain("Missing 3h 12m");
  expect(phone.clipped, "…and does not fit").toContain("facts");
  expect(await row.getAttribute("aria-label")).toContain(label);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-flags");
  await expect(row).toBeVisible();
  const desktop = (await stacks(page))[0];
  expect(desktop.width, "the queue's stack on a laptop").toBe(284);
  expect(desktop.clipped, "which is room enough for all of it").toEqual([]);
  expect(await row.getAttribute("aria-label")).toContain(label);
});

test("a pair longer than the measured worst case still truncates", async ({ page }) => {
  // The residual the component's docstring admits. The 200px threshold is ONE
  // global worst case rather than a per-name calculation, so a longer pair
  // switches its Khmer name on at 200px and then meets line one's `truncate`.
  //
  // Measured: this pair needs 327px, so it is clipped from 200px — the moment
  // the name appears — until the column reaches 327, which is a 1330-to-1930
  // band of viewport widths, and the ellipsis is inside the Khmer for most of
  // it. Whether that matters is a question about the real roster: nobody
  // measured on site is anywhere near this long, and the longest who was fits
  // in the same box on the same screen, below.
  await stubFrappe(page, { coverage: longKhmerCoveragePayload() });

  const atThreshold = await registerAt(page, 1340);
  const overlong = atThreshold.find((s) => s.name.startsWith("Chandravaddhana"));
  const longestMeasured = atThreshold.find((s) => s.name.startsWith("Aaron Wells"));
  expect(overlong, "the over-long fixture row is missing").toBeDefined();
  expect(longestMeasured, "the control row is missing").toBeDefined();

  // One column, one width, just past the threshold — so the only thing that can
  // differ between these two rows is the length of the name in them.
  expect(overlong!.width, "both rows share one column").toBe(longestMeasured!.width);
  expect(overlong!.width, "…just past the threshold").toBeGreaterThanOrEqual(200);
  expect(overlong!.showsKhmer, "the threshold turned it on regardless of length").toBe(true);
  expect(overlong!.clipped, "…and then it did not fit").toContain("name");
  expect(longestMeasured!.clipped, "the longest MEASURED pair fits the same box").toEqual([]);

  // There is a width at which it resolves, so this is a shortfall against the
  // container and not a name that can never be drawn.
  const wide = await registerAt(page, 2560);
  expect(wide.find((s) => s.name.startsWith("Chandravaddhana"))!.clipped).toEqual([]);
});
