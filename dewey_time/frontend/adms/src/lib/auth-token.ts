/**
 * Single source for the API auth token, regardless of auth mode.
 *
 * Every bridge-API call and ?token= image URL must get its token from here —
 * never from supabase.auth.getSession() directly: in frappe mode supabase.auth
 * is a throwing Proxy (supabase-js accessToken option), so any direct access
 * crashes. ESLint enforces this (no-restricted-syntax on supabase.auth).
 */
import { supabase } from './supabase'
import { AUTH_MODE } from './auth-mode'
import { getFrappeToken } from './frappe-token'

/** The bearer token for bridge /admin calls and Supabase-equivalent auth. */
export async function getAuthToken(): Promise<string | null> {
  if (AUTH_MODE === 'frappe') {
    return getFrappeToken()
  }
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

/** Standard JSON headers with Authorization when a token is available. */
export async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAuthToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}
