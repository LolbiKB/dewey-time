// Central Hooks Export
// All data-related hooks should be imported from here

// Core Data (Single Source of Truth)
export {
  useDevicePresence,
  useDevicePresenceMap,
  useRequireDeviceOnline,
  enrichSyncStatusWithPresence,
  DEVICE_ACTION_TIERS,
  type DeviceActionTier,
} from './use-device-presence'

export {
  useDevices,
  useSyncStatus,
  useCommandQueue,
  useUsersList,
  useAttendanceLogs as useAttendanceLogsCore,
  useUser,
  useDevice,
  useDeviceCommands,
  useUserBiometrics,
  useRealtimeCommands,
  useRealtimeSyncStatus,
  useSystemConnection,
  useSyncHealth,
} from './use-core-data'

// Batch Status
export { useLatestBatch, useDeviceBatches } from './use-batch-status'

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
  useDeviceUsersPaginated,
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
  useRetryCommand,
  useClearDeviceCommands,
  useForceUserSync,
  useRetryUserSync,
} from './use-mutations'

export { useSyncCancel } from './use-users'
export { useProcessPhoto } from './use-photo'
export { useUserSyncAggregate, userSyncAggregateKeys } from './use-user-sync-aggregate'
export { getGlobalCancel, setGlobalCancel } from '@/services/user-service'

// Query Keys (Central registry)
export { queryKeys, legacyKeyMap } from '@/lib/query-keys'

// User queries + user-specific mutations (sync pipeline, enrollment cancel, reconcile)
export * from './use-users'
export * from './use-devices'
export * from './use-attendance-logs'
export * from './use-attlog-closure'
export * from './use-device-status'
export * from './use-connection-status'
export * from './use-photo'
export * from './use-user-photo'
