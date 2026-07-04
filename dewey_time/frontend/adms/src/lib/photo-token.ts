/**
 * Scoped, short-lived photo-read token for `?token=` image URLs.
 *
 * The admin JWT (super_admin scope) must never appear in `<img src>` URLs — image
 * URLs leak through Referer headers, browser history, and server/CDN access logs.
 * Instead we exchange the admin JWT, via the bridge, for a narrow token
 * (aud:"photo", photo-read only, ~5 min):
 *
 *   GET /admin/photo-token   Authorization: Bearer <admin JWT from getAuthToken()>
 *     -> { token: "<jwt>", expiresIn: 300 }
 *
 * The result is cached in memory and refreshed when under 60s remain, so a burst
 * of photo `<img>`s shares one token and one round-trip.
 */
import { getAuthToken } from './auth-token'

const API_URL = import.meta.env.VITE_API_URL || ''
const REFRESH_MARGIN_MS = 60_000

interface CachedPhotoToken {
  token: string
  expiresAt: number
}

let cached: CachedPhotoToken | null = null
let inflight: Promise<string | null> | null = null

async function fetchPhotoToken(): Promise<string | null> {
  try {
    const authToken = await getAuthToken()
    if (!authToken) return null
    const res = await fetch(`${API_URL}/admin/photo-token`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { token?: string; expiresIn?: number }
    if (!data.token) return null
    const ttlMs = (typeof data.expiresIn === 'number' ? data.expiresIn : 300) * 1000
    cached = { token: data.token, expiresAt: Date.now() + ttlMs }
    return data.token
  } catch {
    return null
  }
}

/**
 * Scoped photo-read JWT for `?token=` image URLs.
 * Cached in memory; refreshed when under 60s remain. Concurrent callers share
 * one in-flight request. Returns null if the exchange fails (photo just won't load).
 */
export async function getPhotoToken(): Promise<string | null> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cached.token
  }
  if (!inflight) {
    inflight = fetchPhotoToken().finally(() => {
      inflight = null
    })
  }
  return inflight
}
