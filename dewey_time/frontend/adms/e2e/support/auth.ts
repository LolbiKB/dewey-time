import type { Page } from '@playwright/test'

// Hermetic, TEST-SIDE-ONLY admin auth for the dashboard E2E. Nothing here exists
// in app code, so there is zero risk of an auth bypass shipping to prod (the app
// has no mock mode by design — see the security audit). We make the SPA believe
// it is signed in as an admin by:
//   1. injecting a Supabase session into localStorage before the app boots, so
//      supabase.auth.getSession() returns a user (we do NOT automate Google OAuth
//      — Google blocks headless automation; you inject a session instead);
//   2. stubbing the admin_users RLS check to return an admin row (=> isAdmin);
//   3. stubbing the rest of Supabase REST + the bridge /admin API with benign
//      empties so the data queries don't error the chrome we're asserting.
// Project ref is derived from the committed default VITE_SUPABASE_URL; CI uses the
// same default, so the storage key is deterministic in both places.

const PROJECT_REF = 'jihzfxcdbdpzrrefecys'
export const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`
export const E2E_ADMIN_EMAIL = 'e2e-admin@test.local'

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

// A structurally-valid (unsigned) JWT. The access token is never verified
// client-side, and every request that would carry it is stubbed below.
function fakeJwt(): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({
    sub: 'e2e-user',
    email: E2E_ADMIN_EMAIL,
    role: 'authenticated',
    aud: 'authenticated',
    iat: 1_700_000_000,
    exp: 4_102_444_800, // year 2100 — far future, so supabase-js never refreshes
  })
  return `${header}.${payload}.e2e-signature`
}

function fakeSession() {
  return {
    access_token: fakeJwt(),
    refresh_token: 'e2e-refresh-token',
    token_type: 'bearer',
    expires_in: 999_999_999,
    expires_at: 4_102_444_800,
    user: {
      id: 'e2e-user',
      aud: 'authenticated',
      role: 'authenticated',
      email: E2E_ADMIN_EMAIL,
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { email: E2E_ADMIN_EMAIL, full_name: 'E2E Admin' },
      identities: [],
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    },
  }
}

export async function seedAdminAuth(page: Page): Promise<void> {
  const session = fakeSession()

  // Seed the session BEFORE any app script runs, on every navigation.
  await page.addInitScript(
    (arg: { key: string; value: string }) => {
      window.localStorage.setItem(arg.key, arg.value)
    },
    { key: STORAGE_KEY, value: JSON.stringify(session) }
  )

  // Playwright matches the LAST-registered route first, so register broad
  // catch-alls before the specific admin_users override.

  // Supabase auth endpoints — never let it refresh or bounce to a provider.
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) })
  )
  // Bridge admin API (same-origin via the Vite proxy) — benign list shape.
  await page.route('**/admin/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      }),
    })
  )
  await page.route('**/health', (r) => r.fulfill({ status: 200, body: 'ok' }))
  // Supabase REST catch-all → empty array (tables render empty, not errored).
  await page.route('**/rest/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  // admin_users RLS check → a single admin row. Registered last so it wins for
  // this path; .maybeSingle() expects a single object, not an array.
  await page.route('**/rest/v1/admin_users*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: E2E_ADMIN_EMAIL, role: 'super_admin', is_admin: true }),
    })
  )
}
