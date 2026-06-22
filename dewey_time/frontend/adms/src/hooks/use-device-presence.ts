import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import {
  getDevicePresence,
  type DevicePresence,
  type DevicePresenceStatus,
} from '@/lib/device-status'
import { useDevice, useDevices } from './use-core-data'

export type DeviceActionTier = 'live' | 'queued' | 'read'

/** Offline behavior per action tier (see plan) */
export const DEVICE_ACTION_TIERS: Record<DeviceActionTier, { allowWhenOffline: boolean }> = {
  live: { allowWhenOffline: false },
  queued: { allowWhenOffline: true },
  read: { allowWhenOffline: true },
}

function findLastSeenInDevicesCache(
  queryClient: ReturnType<typeof useQueryClient>,
  deviceSn: string
): string | null | undefined {
  const queries = queryClient.getQueriesData<{ devices?: { serial_number: string; last_seen?: string }[] }>({
    queryKey: queryKeys.devices.all,
  })

  for (const [, data] of queries) {
    const device = data?.devices?.find((d) => d.serial_number === deviceSn)
    if (device) return device.last_seen
  }
  return undefined
}

/**
 * Presence for one device — prefers React Query devices cache, falls back to useDevice fetch.
 */
export function useDevicePresence(deviceSn: string | undefined): DevicePresence & { isLoading: boolean } {
  const queryClient = useQueryClient()
  const cachedLastSeen = deviceSn ? findLastSeenInDevicesCache(queryClient, deviceSn) : undefined
  const needsFetch = deviceSn && cachedLastSeen === undefined

  const { data: device, isLoading } = useDevice(deviceSn || '', { enabled: !!needsFetch })

  const lastSeen = cachedLastSeen !== undefined ? cachedLastSeen : device?.last_seen

  const presence = useMemo(() => getDevicePresence(lastSeen), [lastSeen])

  return {
    ...presence,
    isLoading: !!needsFetch && isLoading,
  }
}

/**
 * Map of device SN → presence (loads all devices once for sync-status enrichment).
 */
export function useDevicePresenceMap(options?: { enabled?: boolean }) {
  const { data, isLoading } = useDevices({ page: 1, limit: 500 }, { enabled: options?.enabled !== false })

  const map = useMemo(() => {
    const bySn = new Map<string, DevicePresence>()
    for (const d of data?.devices ?? []) {
      bySn.set(d.serial_number, getDevicePresence(d.last_seen))
    }
    return bySn
  }, [data?.devices])

  return { map, isLoading }
}

export function getPresenceForSn(
  map: Map<string, DevicePresence>,
  deviceSn: string,
  fallbackLastSeen?: string | null
): DevicePresence {
  return map.get(deviceSn) ?? getDevicePresence(fallbackLastSeen)
}

export interface SyncRowWithDeviceSn {
  device_sn: string
  is_online?: boolean
  devices?: { last_seen?: string | null; serial_number?: string }
}

/** Override API snapshot `is_online` with canonical presence from devices cache. */
export function enrichSyncStatusWithPresence<T extends SyncRowWithDeviceSn>(
  rows: T[],
  presenceBySn: Map<string, DevicePresence>
): (T & { is_online: boolean; presence_status: DevicePresenceStatus })[] {
  return rows.map((row) => {
    const presence = getPresenceForSn(
      presenceBySn,
      row.device_sn,
      row.devices?.last_seen ?? undefined
    )
    return {
      ...row,
      is_online: presence.isOnline,
      presence_status: presence.status,
    }
  })
}

export function useRequireDeviceOnline(
  deviceSn: string | undefined,
  tier: DeviceActionTier = 'live'
) {
  const { isOnline, status, lastSeen, lastSeenMinutes, isLoading } = useDevicePresence(deviceSn)
  const allowWhenOffline = DEVICE_ACTION_TIERS[tier].allowWhenOffline
  const canRun = allowWhenOffline || isOnline

  return {
    isOnline,
    status,
    lastSeen,
    lastSeenMinutes,
    isLoading,
    canRunDeviceAction: canRun,
    canRunLiveDeviceAction: isOnline,
    blockReason: canRun ? undefined : 'Device is offline',
  }
}
