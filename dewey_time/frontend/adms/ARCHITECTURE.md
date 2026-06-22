# Centralized Data Architecture - Migration Guide

## Overview

We've implemented a centralized TanStack Query architecture that provides:
- **Single Source of Truth** - All data comes from central hooks
- **Automatic Synchronization** - Real-time updates across components
- **Optimistic Updates** - Instant UI feedback
- **Efficient Caching** - Shared cache, no duplicate fetches

## Architecture Layers

```
┌─────────────────────────────────────────┐
│           UI COMPONENTS                 │
│  (DeviceDetailDialog, UserDetailModal)   │
└─────────────┬───────────────────────────┘
              │ uses
┌─────────────▼───────────────────────────┐
│         DERIVED VIEW HOOKS              │
│  (useDeviceWithUsers, useUserWithDevices)│
└─────────────┬───────────────────────────┘
              │ consumes
┌─────────────▼───────────────────────────┐
│          CORE DATA HOOKS                │
│  (useDevices, useSyncStatus, useCommandQueue)
└─────────────┬───────────────────────────┘
              │ fetches from
┌─────────────▼───────────────────────────┐
│            SUPABASE                     │
└─────────────────────────────────────────┘
```

## Quick Start

### 1. For Device-Centric Views

```typescript
import { useDeviceWithUsers, useForceSync } from '@/hooks'

function MyComponent({ deviceSn }: { deviceSn: string }) {
  // Get device with all its users - automatically updates
  const { device, users, stats, isLoading } = useDeviceWithUsers(deviceSn)
  
  // Use mutations with optimistic updates
  const forceSync = useForceSync()
  
  const handleSync = async (userId: string) => {
    await forceSync.mutateAsync({
      userId,
      deviceSns: [deviceSn]
    })
  }
  
  if (isLoading) return <Loading />
  
  return (
    <div>
      <h1>{device.name}</h1>
      <p>{stats.synced} / {stats.total} users synced</p>
      {users.map(user => (
        <div key={user.userId}>
          {user.userName} - {user.actualState}
        </div>
      ))}
    </div>
  )
}
```

### 2. For User-Centric Views

```typescript
import { useUserWithDevices, useForceSync } from '@/hooks'

function MyComponent({ userId }: { userId: string }) {
  // Get user with all their devices - automatically updates
  const { user, devices, isLoading } = useUserWithDevices(userId)
  
  const forceSync = useForceSync()
  
  const handleSync = async (deviceSn: string) => {
    await forceSync.mutateAsync({
      userId,
      deviceSns: [deviceSn]
    })
  }
  
  if (isLoading) return <Loading />
  
  return (
    <div>
      <h1>{user.name}</h1>
      {devices.map(device => (
        <div key={device.deviceSn}>
          {device.deviceName} - {device.actualState}
        </div>
      ))}
    </div>
  )
}
```

### 3. For Global Views (Dashboard)

```typescript
import { useDashboardStats, useDevicesNeedingAttention } from '@/hooks'

function Dashboard() {
  const stats = useDashboardStats()
  const attention = useDevicesNeedingAttention()
  
  return (
    <div>
      <p>Online Devices: {stats.devices.online} / {stats.devices.total}</p>
      <p>Sync Health: {stats.sync.healthPercentage}%</p>
      {attention.totalAttentionNeeded > 0 && (
        <Alert>{attention.totalAttentionNeeded} devices need attention</Alert>
      )}
    </div>
  )
}
```

## Key Features

### 1. Optimistic Updates

When you call a mutation, the UI updates immediately:

```typescript
const forceSync = useForceSync()

// This will immediately show "syncing" state
// Then update to "synced" or roll back on error
await forceSync.mutateAsync({ userId, deviceSns })
```

### 2. Real-time Subscriptions

Commands update in real-time without polling:

```typescript
import { useRealtimeCommands } from '@/hooks'

function MyComponent({ deviceSn }: { deviceSn: string }) {
  // This sets up a Supabase realtime subscription
  useRealtimeCommands(deviceSn)
  
  // Commands will update automatically when server changes
  const { commands } = useDeviceWithUsers(deviceSn)
}
```

### 3. Automatic Cache Invalidation

When you modify data, related queries automatically refresh:

```typescript
// After forceSync succeeds, these automatically refresh:
// - useSyncStatus
// - useCommandQueue
// - useDeviceWithUsers
// - useUserWithDevices
// - useDashboardStats
```

## Available Hooks

### Core Data Hooks
- `useDevices()` - All devices with online status
- `useSyncStatus()` - All user-device sync relationships
- `useCommandQueue()` - Recent commands
- `useUsersList(filters)` - Paginated user list
- `useUser(userId)` - Single user details
- `useDevice(deviceSn)` - Single device details

### Derived View Hooks
- `useDeviceWithUsers(deviceSn)` - Device + its users
- `useUserWithDevices(userId)` - User + their devices
- `useDashboardStats()` - Global statistics
- `useDeviceSyncSummary(deviceSn)` - Quick sync stats
- `useUserSyncProgress(userId)` - User sync percentage
- `useDevicesNeedingAttention()` - Alerts

### Mutation Hooks
- `useForceSync()` - Force sync with optimistic updates
- `useRetrySync()` - Retry failed syncs
- `useDeleteBiometric()` - Delete fingerprints/face
- `useStartEnrollment()` - Start biometric enrollment
- `useCreateUser()` - Create new user
- `useUpdateUser()` - Update user
- `useDeleteUser()` - Delete user
- `useSendDeviceCommand()` - Send device commands

## Query Keys

All query keys are centralized in `lib/query-keys.ts`:

```typescript
import { queryKeys } from '@/hooks'

// Use in components
queryClient.invalidateQueries({ 
  queryKey: queryKeys.users.syncStatus(userId) 
})
```

## Migration from Old Code

### Before (Direct Supabase):
```typescript
const [data, setData] = useState([])

useEffect(() => {
  const fetchData = async () => {
    const { data } = await supabase
      .from('devices')
      .select('*')
    setData(data)
  }
  fetchData()
}, [])
```

### After (Centralized Hook):
```typescript
const { data: devices, isLoading } = useDevices()
// Data updates automatically, no manual fetching needed
```

## Performance Benefits

1. **No Duplicate Requests** - Same data is cached and reused
2. **Automatic Background Updates** - Data stays fresh without manual polling
3. **Optimistic UI** - Feels instant to users
4. **Selective Refetching** - Only changed data is refetched

## Debugging

Use React Query DevTools (already enabled in App.tsx):
- Press `Shift + F` to open
- See cache state, query status, and timing
- Manually invalidate or refetch queries

## Notifications (Sonner)

This dashboard uses **[Sonner](https://sonner.emilkowal.ski/)** via shadcn’s `sonner` component — not the deprecated Radix `toast` + `useToast` stack.

| Rule | Detail |
|------|--------|
| Mount once | `<Toaster />` from [`src/components/ui/sonner.tsx`](src/components/ui/sonner.tsx) in [`App.tsx`](src/App.tsx) |
| Sync aggregate | [`useUserSyncAggregate`](dashboard/src/hooks/use-user-sync-aggregate.ts) + [`computeUserSyncAggregate`](dashboard/src/lib/user-sync-aggregate.ts) — list badge and modal share rules; API `GET /admin/users/:id/sync-aggregate` |
| Mutations toast | Success/error feedback lives in **`use-mutations.ts`** `onSuccess` / `onError` (one toast per operation) |
| Helpers | [`src/lib/toast.ts`](src/lib/toast.ts) — `notifySuccess(title, description?)`, `notifyError`, `notifyOperationFailed`, lock errors |
| Components | Toast only for non-mutation UX (e.g. “PIN copied”, background job completion) — avoid duplicating hook toasts |
| Style | **Title** = outcome; **description** = detail or error message |

```typescript
import { notifySuccess, notifyError } from '@/lib/toast'

notifySuccess('Employee registered', 'Syncing to devices…')
notifyError('Registration failed', error.message)
```

## Best Practices

1. **Always use derived hooks** - Don't fetch raw data when a derived hook exists
2. **Let mutations handle cache** - Don't manually invalidate after mutations
3. **Use optimistic updates** - They provide better UX
4. **Check `isLoading`** - Always handle loading states
5. **Handle errors** - Mutations return error states
6. **One toast per mutation** - Do not toast again in the caller after `mutateAsync` from centralized hooks

## Questions?

Check the hook implementations in:
- `src/hooks/use-core-data.ts` - Core data fetching
- `src/hooks/use-derived-views.ts` - Data transformation
- `src/hooks/use-mutations.ts` - Data modifications
