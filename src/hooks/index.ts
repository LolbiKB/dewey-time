// Central Hooks Export
// All data-related hooks should be imported from here

// Core Data (Single Source of Truth)
export {
  useDevices,
  useSyncStatus,
  useCommandQueue,
  useUsersList,
  useAttendanceLogs,
  useUser,
  useDevice,
  useUserBiometrics,
  useRealtimeCommands,
  useRealtimeSyncStatus,
  useSystemConnection,
  useSyncHealth,
} from './use-core-data'

// Derived Views (Transform core data for UI)
export {
  useDeviceWithUsers,
  useDeviceSyncSummary,
  useUserWithDevices,
  useUserSyncProgress,
  useDashboardStats,
  useDevicesNeedingAttention,
  useRecentOperations,
  useCommandsByStatus,
  useRegistrarDevices,
  useUserEnrollmentReadiness,
} from './use-derived-views'

// Mutations (Data modifications with optimistic updates)
export {
  useForceSync,
  useRetrySync,
  useDeleteBiometric,
  useStartEnrollment,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useSendDeviceCommand,
  useUpdateDevice,
  useProcessPhoto,
  useRefreshPhoto,
  useSyncCancel,
  getGlobalCancel,
} from './use-mutations'

// Query Keys (Central registry)
export { queryKeys, legacyKeyMap } from '@/lib/query-keys'

// Legacy hooks (for backward compatibility during migration)
// These will be removed after full refactor
export * from './use-users'
export * from './use-devices'
export * from './use-attendance-logs'
export * from './use-dashboard'
export * from './use-device-status'
export * from './use-connection-status'
export * from './use-photo'
export * from './use-user-photo'
