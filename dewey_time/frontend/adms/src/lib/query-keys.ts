// Centralized Query Key Registry
// All query keys must be defined here to ensure consistency

export const queryKeys = {
  // =====================================================
  // ROOT ENTITIES
  // =====================================================
  
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'lists'] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.users.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.users.all, 'detail', id] as const,
    syncStatus: (id: string) => [...queryKeys.users.detail(id), 'sync-status'] as const,
    biometrics: (id: string) => [...queryKeys.users.detail(id), 'biometrics'] as const,
    commands: (id: string) => [...queryKeys.users.detail(id), 'commands'] as const,
    driftStatus: (id: string) => [...queryKeys.users.detail(id), 'drift-status'] as const,
    syncSummary: (id: string) => [...queryKeys.users.detail(id), 'sync-summary'] as const,
  },
  
  devices: {
    all: ['devices'] as const,
    lists: () => [...queryKeys.devices.all, 'lists'] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.devices.lists(), filters] as const,
    detail: (sn: string) => [...queryKeys.devices.all, 'detail', sn] as const,
    status: () => [...queryKeys.devices.all, 'status'] as const,
    syncStatus: (sn: string) => [...queryKeys.devices.detail(sn), 'sync-status'] as const,
    commands: (sn: string) => [...queryKeys.devices.detail(sn), 'commands'] as const,
    users: (sn: string, search?: string) => [...queryKeys.devices.all, 'users', sn, search || ''] as const,
  },
  
  commands: {
    all: ['commands'] as const,
    byUser: (userId: string) => [...queryKeys.commands.all, 'user', userId] as const,
    byDevice: (deviceSn: string) => [...queryKeys.commands.all, 'device', deviceSn] as const,
    detail: (id: number) => [...queryKeys.commands.all, 'detail', id] as const,
  },
  
  attendance: {
    all: ['attendance'] as const,
    lists: () => [...queryKeys.attendance.all, 'lists'] as const,
    list: (filters: Record<string, unknown>) => [...queryKeys.attendance.lists(), filters] as const,
  },
  
  photos: {
    all: ['photos'] as const,
    detail: (userId: string) => [...queryKeys.photos.all, userId] as const,
    status: (userId: string) => [...queryKeys.photos.detail(userId), 'status'] as const,
    cacheStatus: (userIds: string[]) => [...queryKeys.photos.all, 'cache', userIds.sort().join(',')] as const,
  },
  
  // =====================================================
  // DERIVED / AGGREGATE QUERIES
  // =====================================================
  
  dashboard: {
    stats: ['dashboard', 'stats'] as const,
    health: ['dashboard', 'health'] as const,
  },
  
  system: {
    connection: ['system', 'connection'] as const,
    syncHealth: ['system', 'sync-health'] as const,
  },
  
  // =====================================================
  // REALTIME SUBSCRIPTION KEYS (for cache management)
  // =====================================================
  
  realtime: {
    commands: (deviceSn?: string) => ['realtime', 'commands', deviceSn || 'all'] as const,
    syncStatus: (userId?: string) => ['realtime', 'sync-status', userId || 'all'] as const,
  },
} as const

// Type helper for query key validation
export type QueryKey = ReturnType<
  | typeof queryKeys.users.list
  | typeof queryKeys.users.detail
  | typeof queryKeys.devices.list
  | typeof queryKeys.devices.detail
  | typeof queryKeys.commands.byUser
  | typeof queryKeys.commands.byDevice
>

// Legacy key mappings for migration (TODO: remove after full refactor)
export const legacyKeyMap: Record<string, (params: unknown) => readonly unknown[]> = {
  'user-biometrics': (userId) => queryKeys.users.biometrics(userId as string),
  'user-photo': (userId) => queryKeys.photos.detail(userId as string),
}
