/**
 * Auth mode for the dashboard build.
 *
 * - 'supabase' (default): standalone deployment — Supabase Auth Google login,
 *   session managed by supabase-js. Local dev uses this.
 * - 'frappe': served from the Frappe site (/adms) — the Frappe session is the
 *   credential; a bridge-minted token (via zkteco_hr get_dashboard_token)
 *   authenticates both the bridge API and direct Supabase reads. In this mode
 *   `supabase.auth.*` is unusable by design (supabase-js accessToken option) —
 *   always go through lib/auth-token.ts instead.
 */
export type AuthMode = 'frappe' | 'supabase'

export const AUTH_MODE: AuthMode =
  import.meta.env.VITE_AUTH_MODE === 'frappe' ? 'frappe' : 'supabase'

export const isFrappeMode = AUTH_MODE === 'frappe'
