import { test, expect } from '@playwright/test'

// Smoke E2E for the auth-gated SPA. The dashboard has no mock mode, so these
// target the UNAUTHENTICATED surface (the login screen), which renders offline
// with empty localStorage (no session => no network). They verify the app
// boots, mounts, and shows the expected sign-in affordance — catching
// build/bundle/runtime regressions that unit tests can't.

test.describe('login surface', () => {
  test('app boots and mounts the React root without a fatal error', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/')

    // Root element exists and has rendered content.
    const root = page.locator('#root')
    await expect(root).toBeAttached()
    await expect(root).not.toBeEmpty()

    // No uncaught runtime error during boot.
    expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0)
  })

  test('shows the login card with the sign-in affordance', async ({ page }) => {
    await page.goto('/')

    // Product title on the login card.
    await expect(page.getByText('ZKTeco ADMS Bridge')).toBeVisible()

    // The Google sign-in button (role + accessible name).
    await expect(
      page.getByRole('button', { name: /continue with google/i })
    ).toBeVisible()
  })
})
