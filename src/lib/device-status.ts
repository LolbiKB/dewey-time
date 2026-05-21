// Simple utility to calculate if a device is online based on last_seen
const ONLINE_THRESHOLD_MS = 65000 // 65 seconds (device pings every ~60s)

export function isDeviceOnline(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false
  const now = Date.now()
  const lastSeenTime = new Date(lastSeen).getTime()
  return (now - lastSeenTime) < ONLINE_THRESHOLD_MS
}

// Type for device with computed online status
export interface DeviceWithStatus {
  isOnline: boolean
  [key: string]: unknown
}
