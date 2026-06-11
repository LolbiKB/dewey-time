/**
 * Frappe-mode token provider.
 *
 * Holds the bridge-minted dashboard token in memory and keeps it fresh by
 * re-calling the whitelisted Frappe method (same-origin, session cookie).
 * The Frappe session is the long-lived credential; this token is a 1h
 * derivative used for the bridge API and direct Supabase reads.
 *
 * No supabase imports here — supabase.ts consumes this module for its
 * accessToken callback, so an import the other way would be a cycle.
 */

declare global {
  interface Window {
    csrf_token?: string
  }
}

const TOKEN_METHOD = '/api/method/zkteco_hr.attendance_engine.dashboard_auth.get_dashboard_token'
/** Refresh when less than this remains (also the proactive-timer margin). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface FrappeTokenState {
  token: string
  email: string
  role: 'admin' | 'super_admin'
  expiresAt: number
}

let state: FrappeTokenState | null = null
let inflight: Promise<FrappeTokenState> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const subscribers = new Set<(s: FrappeTokenState | null) => void>()

function notify() {
  for (const fn of subscribers) fn(state)
}

/** Frappe session is gone — hand over to Frappe login. */
function redirectToFrappeLogin(): never {
  const target = '/login?redirect-to=' + encodeURIComponent('/adms')
  window.location.href = target
  // Halt callers; navigation is already underway.
  throw new Error('Redirecting to Frappe login')
}

/**
 * Logged in to Frappe, but the account is not an ADMS admin. This is terminal:
 * redirecting to /login would just bounce the active session back to /adms and
 * loop forever. Callers render an access-denied screen instead.
 */
export class AdmsForbiddenError extends Error {
  constructor(message = 'Your Frappe account is not registered as an ADMS admin.') {
    super(message)
    this.name = 'AdmsForbiddenError'
  }
}

async function fetchToken(): Promise<FrappeTokenState> {
  const res = await fetch(TOKEN_METHOD, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(window.csrf_token ? { 'X-Frappe-CSRF-Token': window.csrf_token } : {}),
    },
  })

  if (res.status === 401) {
    // No / expired Frappe session — log in.
    redirectToFrappeLogin()
  }
  if (res.status === 403) {
    // Authenticated but not an ADMS admin — terminal, do NOT redirect (loops).
    throw new AdmsForbiddenError()
  }
  if (!res.ok) {
    throw new Error(`Token exchange failed: HTTP ${res.status}`)
  }

  const body = await res.json()
  const msg = body.message ?? body
  if (!msg?.token) {
    throw new Error('Token exchange returned no token')
  }

  state = {
    token: msg.token,
    email: msg.email,
    role: msg.role === 'super_admin' ? 'super_admin' : 'admin',
    expiresAt: Date.now() + (msg.expires_in ?? 3600) * 1000,
  }
  scheduleRefresh()
  notify()
  return state
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  if (!state) return
  const delay = Math.max(30_000, state.expiresAt - Date.now() - REFRESH_MARGIN_MS)
  refreshTimer = setTimeout(() => {
    getFrappeToken(true).catch(() => {
      // fetchToken redirects on auth failure; transient errors retry on next use
    })
  }, delay)
}

/** Current valid token, fetching/refreshing as needed. Single-flight. */
export async function getFrappeToken(force = false): Promise<string> {
  if (!force && state && state.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return state.token
  }
  if (!inflight) {
    inflight = fetchToken().finally(() => {
      inflight = null
    })
  }
  const s = await inflight
  return s.token
}

/** Snapshot without triggering a fetch (e.g. for sync render decisions). */
export function getFrappeTokenState(): FrappeTokenState | null {
  return state
}

export function subscribeFrappeToken(fn: (s: FrappeTokenState | null) => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

// Re-validate when the tab wakes up — the timer doesn't fire while suspended.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state && state.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
      getFrappeToken(true).catch(() => {})
    }
  })
}
