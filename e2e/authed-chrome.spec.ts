import { test, expect } from '@playwright/test'
import { seedAdminAuth } from './support/auth'

// Covers the authenticated chrome (the part the login smoke test can't reach):
// the ADMS Bridge mark, the header tab-menu, true-centered tabs, light-only,
// and routing. Auth is seeded hermetically test-side (see support/auth.ts) — no
// app changes, no real OAuth, no live backend.

test.describe('authenticated chrome', () => {
  test.beforeEach(async ({ page }) => {
    await seedAdminAuth(page)
  })

  test('renders the app shell, the ADMS Bridge mark, and the tab nav', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(e.message))

    await page.goto('/')

    // The brand mark — AppShell links it to homeHref, so the link's accessible
    // name is the wordtext "ADMS Bridge".
    await expect(page.getByRole('link', { name: /ADMS Bridge/i })).toBeVisible()

    // The header tab-menu with the three destinations.
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Devices' })).toBeVisible()
    await expect(nav.getByRole('link', { name: /Attendance/ })).toBeVisible()

    // We are past the login gate.
    await expect(page.getByRole('button', { name: /continue with google/i })).toHaveCount(0)

    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0)
  })

  test('is light-only (forced light theme, no dark)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    const cls = await page.evaluate(() => document.documentElement.className)
    expect(cls).toContain('light')
    expect(cls).not.toContain('dark')
  })

  test('navigates between tabs and marks the active one', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('link', { name: 'Devices' }).click()

    await expect(page).toHaveURL(/\/devices$/)
    await expect(nav.getByRole('link', { name: 'Devices' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('tabs are truly centered in the header bar', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'the 1fr/auto/1fr centering grid applies at >=640px')
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    const bar = page.locator('header:has(nav[aria-label="Primary"]) > div').first()
    await expect(nav).toBeVisible()

    const navBox = await nav.boundingBox()
    const barBox = await bar.boundingBox()
    expect(navBox, 'nav box').toBeTruthy()
    expect(barBox, 'bar box').toBeTruthy()

    const navCenter = navBox!.x + navBox!.width / 2
    const barCenter = barBox!.x + barBox!.width / 2
    // True-centered against the whole bar (not the leftover flex space).
    expect(Math.abs(navCenter - barCenter)).toBeLessThan(8)
  })
})
