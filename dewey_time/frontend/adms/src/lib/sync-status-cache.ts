/**
 * Shape-tolerant mapping over a cached sync-status collection.
 *
 * Two query keys hold sync-status rows in DIFFERENT shapes:
 *   queryKeys.users.syncStatus(userId) — the bridge's SyncStatusResponse
 *                                        object, `{ success, data: [...] }`
 *   ['sync-status', 'all']             — a bare array from the direct
 *                                        Supabase read in use-core-data
 *
 * The optimistic updates in use-mutations guarded with `Array.isArray(old)` and
 * so silently did nothing for the object-shaped key: the "syncing" state never
 * appeared, and the UI kept showing the previous state until the server
 * answered — the same class of defect as the biometrics cache-shape bug.
 */

type Row = Record<string, unknown>

function isWrapped(value: unknown): value is { data: Row[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { data?: unknown }).data)
  )
}

/**
 * Apply `mapRow` to every sync-status row in `cached`, preserving whichever
 * shape the cache holds. Anything unrecognised is returned untouched, so an
 * unexpected shape can never throw inside onMutate and abort the mutation.
 */
export function mapSyncStatusCache<T>(cached: T, mapRow: (row: Row) => Row): T {
  if (Array.isArray(cached)) {
    return cached.map((row) => mapRow(row as Row)) as unknown as T
  }
  if (isWrapped(cached)) {
    return { ...cached, data: cached.data.map(mapRow) } as unknown as T
  }
  return cached
}
