/**
 * Device presence (online/offline) — single source of truth for the dashboard.
 *
 * Derived from `devices.last_seen` (updated by device pings via gcr-fastify/iclock).
 * Freshness is pushed via Supabase Realtime on `devices` UPDATE → useDevices refetch.
 *
 * Do not add a separate "connected" flag in UI; tune DEVICE_ONLINE_THRESHOLD_MS if needed.
 */
export const DEVICE_ONLINE_THRESHOLD_MS = 65_000 // ~60s device ping interval + buffer

/** @deprecated Use DEVICE_ONLINE_THRESHOLD_MS */
const ONLINE_THRESHOLD_MS = DEVICE_ONLINE_THRESHOLD_MS

export type DevicePresenceStatus = 'online' | 'offline'

export interface DevicePresence {
  isOnline: boolean
  status: DevicePresenceStatus
  lastSeen: string | null
  lastSeenMs: number | null
  /** Whole minutes since last_seen (null if never seen) */
  lastSeenMinutes: number | null
}

export function isDeviceOnline(lastSeen: string | null | undefined): boolean {
  return getDevicePresence(lastSeen).isOnline
}

export function getDevicePresence(lastSeen: string | null | undefined): DevicePresence {
  if (!lastSeen) {
    return {
      isOnline: false,
      status: 'offline',
      lastSeen: null,
      lastSeenMs: null,
      lastSeenMinutes: null,
    }
  }

  const now = Date.now()
  const lastSeenMs = new Date(lastSeen).getTime()
  const ageMs = now - lastSeenMs
  const isOnline = ageMs < ONLINE_THRESHOLD_MS
  const lastSeenMinutes = Math.floor(ageMs / 60_000)

  return {
    isOnline,
    status: isOnline ? 'online' : 'offline',
    lastSeen,
    lastSeenMs,
    lastSeenMinutes,
  }
}

export interface DeviceWithStatus {
  isOnline: boolean
  [key: string]: unknown
}
