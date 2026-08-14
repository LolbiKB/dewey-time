import { expect, test, type Page } from "@playwright/test";

import { stubFrappe } from "./fixtures";

/**
 * Height of the growing content region — the band the schedule itself gets.
 *
 * `/hr-schedule` is a fixed-viewport layout: `Page` is `h-full flex-col` and
 * `Section grow` is `min-h-0 flex-1 overflow-hidden`, so the document never
 * gets shorter no matter how much chrome is removed. The reclaimed pixels are
 * handed to this section instead. Measuring the body would report zero and
 * call it a no-op.
 */
async function sectionHeight(page: Page): Promise<number> {
  return page
    .locator('[data-slot="page"] > [data-slot="section"]')
    .evaluate((el) => el.getBoundingClientRect().height);
}

/** Total laid-out height of the page's content, in CSS pixels. */
async function contentHeight(page: Page): Promise<number> {
  return page.evaluate(() => document.body.getBoundingClientRect().height);
}

/** SpreadsheetImportTrigger's accessible name. */
const IMPORT_BUTTON = "Import";

test.beforeEach(async ({ page }) => {
  await stubFrappe(page);
});

test("an employee with a live schedule lands on preview, not the editor", async ({ page }) => {
  await page.goto("/hr-schedule?employee=EMP-001");
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review changes|Save schedule/ })).toHaveCount(0);
  await expect(page.getByText("Effective from")).toHaveCount(0);
});

test("Edit opens the editor, and Cancel with no changes returns silently", async ({ page }) => {
  await page.goto("/hr-schedule?employee=EMP-001");
  await page.getByRole("button", { name: "Edit schedule" }).click();

  await expect(page.getByRole("button", { name: /Review changes|Save schedule/ })).toBeVisible();
  await expect(page.getByText("Effective from")).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  // Clean form: no confirm, straight back to preview.
  await expect(page.getByText("Discard unsaved changes?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();
});

test("preview hands the schedule the height the editing chrome was using", async ({ page }) => {
  // The spec derived ~134px at desktop from class strings. This records what it
  // actually is. Note what is being compared: the page height is FIXED (see
  // sectionHeight's comment), so the saving shows up as a taller schedule
  // region, not a shorter document.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-schedule?employee=EMP-001");
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();
  const previewSection = await sectionHeight(page);
  const previewBody = await contentHeight(page);

  await page.getByRole("button", { name: "Edit schedule" }).click();
  await expect(page.getByText("Effective from")).toBeVisible();
  const editSection = await sectionHeight(page);
  const editBody = await contentHeight(page);

  console.log(
    `[measured] desktop section: preview ${previewSection}px · edit ${editSection}px · ` +
      `reclaimed ${previewSection - editSection}px ` +
      `(body ${previewBody}px vs ${editBody}px — fixed-viewport layout)`,
  );
  expect(previewSection).toBeGreaterThan(editSection);
});

test("the same saving holds at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/hr-schedule?employee=EMP-001");
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();
  const previewSection = await sectionHeight(page);

  await page.getByRole("button", { name: "Edit schedule" }).click();
  await expect(page.getByText("Effective from")).toBeVisible();
  const editSection = await sectionHeight(page);

  console.log(
    `[measured] phone section: preview ${previewSection}px · edit ${editSection}px · ` +
      `reclaimed ${previewSection - editSection}px`,
  );
  expect(previewSection).toBeGreaterThan(editSection);
});

test("the import trigger rides beside the picker at desktop, and stacks on a phone", async ({
  page,
}) => {
  // The other half of the reclaimed height, and the half that is easy to
  // over-claim: moving Import beside the picker only saves a row where the two
  // actually sit side by side. The wrapper is `flex-col … sm:flex-row`, and
  // Tailwind's `sm` is 640px, so at 375px they still stack and the move buys
  // nothing there. Measured rather than argued.
  const box = async (name: string) => {
    const b = await page.getByRole("button", { name }).first().boundingBox();
    if (!b) throw new Error(`no box for ${name}`);
    return b;
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hr-schedule?employee=EMP-001");
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();
  const deskPicker = await page.getByRole("combobox").first().boundingBox();
  const deskImport = await box(IMPORT_BUTTON);
  console.log(
    `[measured] desktop picker y=${deskPicker?.y} h=${deskPicker?.height} · ` +
      `import y=${deskImport.y} h=${deskImport.height}`,
  );
  expect(deskImport.y).toBeLessThan((deskPicker?.y ?? 0) + (deskPicker?.height ?? 0));

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/hr-schedule?employee=EMP-001");
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();
  const phonePicker = await page.getByRole("combobox").first().boundingBox();
  const phoneImport = await box(IMPORT_BUTTON);
  console.log(
    `[measured] phone picker y=${phonePicker?.y} h=${phonePicker?.height} · ` +
      `import y=${phoneImport.y} h=${phoneImport.height}`,
  );
  expect(phoneImport.y).toBeGreaterThanOrEqual((phonePicker?.y ?? 0) + (phonePicker?.height ?? 0));
});

test("/hr-schedule still does not scroll sideways at 375px in either mode", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/hr-schedule?employee=EMP-001");
  await expect(page.getByRole("button", { name: "Edit schedule" })).toBeVisible();

  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Edit schedule" }).click();
  await expect(page.getByText("Effective from")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});
