// Derived View Hooks
// Transform core data for specific UI needs without re-fetching

import { useMemo } from 'react'
import { useDevices, useSyncStatus, useCommandQueue, useUser, useUserBiometrics } from './use-core-data'

// =====================================================
// DEVICE-CENTRIC DERIVED VIEWS
// =====================================================

/**
 * Device with all its users and sync status
 * Used by: DeviceDetailDialog
 */
export function useDeviceWithUsers(deviceSn: string) {
  const hasDeviceSn = !!deviceSn
  
  const { data: devices, isLoading: devicesLoading } = useDevices({ enabled: hasDeviceSn })
  const { data: syncData, isLoading: syncLoading } = useSyncStatus({ enabled: hasDeviceSn })
  const { data: commands, isLoading: commandsLoading } = useCommandQueue({ enabled: hasDeviceSn })
  
  return useMemo(() => {
    // If no deviceSn provided, don't show loading - just empty state
    if (!deviceSn) {
      return {
        device: null,
        users: [],
        commands: [],
        stats: { total: 0, synced: 0, syncing: 0, failed: 0 },
        isLoading: false,
      }
    }
    
    const device = devices?.find(d => d.serial_number === deviceSn)
    
    // Only show loading if we're actually fetching
    if (devicesLoading || syncLoading) {
      return {
        device: null,
        users: [],
        commands: [],
        stats: { total: 0, synced: 0, syncing: 0, failed: 0 },
        isLoading: true,
      }
    }
    
    // Data loaded but device not found
    if (!device) {
      return {
        device: null,
        users: [],
        commands: [],
        stats: { total: 0, synced: 0, syncing: 0, failed: 0 },
        isLoading: false,
      }
    }
    
    // Get all users synced to this device
    const deviceSyncs = (syncData || []).filter(s => s.device_sn === deviceSn)
    
    // Get pending commands for this device (only fresh ones < 2 minutes old)
    // This prevents showing "syncing" for old stuck commands
    const TWO_MINUTES = 2 * 60 * 1000
    const now = Date.now()
    const pendingCommands = (commands || []).filter(c => {
      if (c.device_sn !== deviceSn) return false
      if (c.status !== 'pending' && c.status !== 'sent') return false
      // Only consider commands created in last 2 minutes as "actively syncing"
      const commandAge = now - new Date(c.created_at).getTime()
      return commandAge < TWO_MINUTES
    })
    
    const users = deviceSyncs.map(sync => {
      // Check if there are pending commands for this user
      const userPendingCommands = pendingCommands.filter(c => c.related_user_id === sync.user_id)
      
      // Determine which components are actively syncing
      const isUserSyncing = userPendingCommands.some(c => c.command_type === 'sync_user')
      const isFingerprintSyncing = userPendingCommands.some(c => c.command_type === 'enroll_fingerprint')
      const isFaceSyncing = userPendingCommands.some(c => c.command_type === 'enroll_face')
      const isPhotoSyncing = userPendingCommands.some(c => c.command_type === 'upload_photo')
      
      // Get the oldest pending command timestamp for "syncing since" display
      const syncStartTime = userPendingCommands.length > 0 
        ? Math.min(...userPendingCommands.map(c => new Date(c.created_at).getTime()))
        : null
      
      return {
        userId: sync.user_id,
        userName: sync.users?.name || 'Unknown',
        userPin: sync.users?.pin,
        employeeId: sync.users?.frappe_employee_id || '',
        actualState: sync.actual_state,
        expectedState: sync.expected_state,
        userSynced: sync.user_synced,
        fingerprintSynced: sync.fingerprint_synced,
        faceSynced: sync.face_synced,
        photoSynced: sync.photo_synced,
        // Component-level syncing state
        isUserSyncing,
        isFingerprintSyncing,
        isFaceSyncing,
        isPhotoSyncing,
        syncStartTime,
        lastSuccessfulSync: sync.last_successful_sync,
        errorMessage: sync.error_message,
        // Check if user has biometric data available
        hasFingerprint: sync.users?.user_biometrics?.some((b: any) => b.type === 'fingerprint') || false,
        hasFace: sync.users?.user_biometrics?.some((b: any) => b.type === 'face') || false,
        hasPhoto: !!sync.users?.photo_storage_path,
      }
    })
    
    // Get recent commands for this device
    const deviceCommands = (commands || [])
      .filter(c => c.device_sn === deviceSn)
      .slice(0, 50)
    
    // Calculate stats - smarter logic for sync status
    // - synced: actual_state='synced' OR has last_successful_sync (successfully synced before)
    // - failed: actual_state='not_synced' AND has error_message (real failure)
    // - syncing: actual_state='syncing' (actively syncing now)
    const stats = {
      total: users.length,
      synced: users.filter(u => u.actualState === 'synced' || u.lastSuccessfulSync).length,
      syncing: users.filter(u => u.actualState === 'syncing').length,
      failed: users.filter(u => u.actualState === 'not_synced' && u.errorMessage).length,
    }
    
    return {
      device,
      users,
      commands: deviceCommands,
      stats,
      isLoading: devicesLoading || syncLoading || commandsLoading,
    }
  }, [devices, syncData, commands, deviceSn, devicesLoading, syncLoading, commandsLoading])
}

/**
 * Device sync summary for header/quick views
 * Used by: Header, DeviceCards
 */
export function useDeviceSyncSummary(deviceSn: string) {
  const { data: syncData } = useSyncStatus()
  
  return useMemo(() => {
    if (!syncData) return { total: 0, synced: 0, failed: 0, pending: 0, percentage: 0 }
    
    const deviceSyncs = syncData.filter(s => s.device_sn === deviceSn)
    const total = deviceSyncs.length
    const synced = deviceSyncs.filter(s => s.actual_state === 'synced' || s.last_successful_sync).length
    const failed = deviceSyncs.filter(s => s.actual_state === 'not_synced' && s.error_message).length
    const pending = deviceSyncs.filter(s => s.actual_state === 'not_synced' && !s.last_successful_sync && !s.error_message).length
    
    return {
      total,
      synced,
      failed,
      pending,
      percentage: total > 0 ? Math.round((synced / total) * 100) : 0,
    }
  }, [syncData, deviceSn])
}

// =====================================================
// USER-CENTRIC DERIVED VIEWS
// =====================================================

/**
 * User with all their devices and sync status
 * Used by: SyncStatusDialog
 */
export function useUserWithDevices(userId: string) {
  const { data: devices, isLoading: devicesLoading } = useDevices()
  const { data: syncData, isLoading: syncLoading } = useSyncStatus()
  const { data: commands, isLoading: commandsLoading } = useCommandQueue()
  const { data: user, isLoading: userLoading } = useUser(userId)
  
  return useMemo(() => {
    if (!devices || !syncData) {
      return {
        user: null,
        devices: [],
        commands: [],
        isLoading: devicesLoading || syncLoading || userLoading,
      }
    }
    
    // Get sync status for this user across all devices
    const userSyncs = syncData.filter(s => s.user_id === userId)
    
    // Map devices with sync status
    const devicesWithSync = devices.map(device => {
      const sync = userSyncs.find(s => s.device_sn === device.serial_number)
      return {
        deviceSn: device.serial_number,
        deviceName: device.name,
        deviceLocation: device.location,
        isOnline: device.isOnline,
        isRegistrar: device.is_registrar,
        actualState: sync?.actual_state || 'not_synced',
        expectedState: sync?.expected_state || 'not_synced',
        userSynced: sync?.user_synced || false,
        fingerprintSynced: sync?.fingerprint_synced || false,
        faceSynced: sync?.face_synced || false,
        photoSynced: sync?.photo_synced || false,
        lastSuccessfulSync: sync?.last_successful_sync,
        errorMessage: sync?.error_message,
      }
    })
    
    // Get commands for this user
    const userCommands = (commands || [])
      .filter(c => c.related_user_id === userId)
      .slice(0, 50)
    
    return {
      user,
      devices: devicesWithSync,
      commands: userCommands,
      isLoading: devicesLoading || syncLoading || commandsLoading || userLoading,
    }
  }, [devices, syncData, commands, user, userId, devicesLoading, syncLoading, commandsLoading, userLoading])
}

/**
 * User sync progress across all devices
 * Used by: User list badges, inline status
 */
export function useUserSyncProgress(userId: string) {
  const { data: syncData } = useSyncStatus()
  
  return useMemo(() => {
    if (!syncData) {
      return {
        totalDevices: 0,
        syncedDevices: 0,
        hasFingerprint: false,
        hasFace: false,
        hasPhoto: false,
        percentage: 0,
      }
    }
    
    const userSyncs = syncData.filter(s => s.user_id === userId)
    const totalDevices = userSyncs.length
    const syncedDevices = userSyncs.filter(s => s.actual_state === 'synced').length
    
    // Check if user has any biometrics/photos synced anywhere
    const hasFingerprint = userSyncs.some(s => s.fingerprint_synced)
    const hasFace = userSyncs.some(s => s.face_synced)
    const hasPhoto = userSyncs.some(s => s.photo_synced)
    
    return {
      totalDevices,
      syncedDevices,
      hasFingerprint,
      hasFace,
      hasPhoto,
      percentage: totalDevices > 0 ? Math.round((syncedDevices / totalDevices) * 100) : 0,
    }
  }, [syncData, userId])
}

// =====================================================
// DASHBOARD / GLOBAL VIEWS
// =====================================================

/**
 * Dashboard statistics derived from core data
 * Used by: Dashboard page, Header stats
 */
export function useDashboardStats() {
  const { data: devices } = useDevices()
  const { data: syncData } = useSyncStatus()
  const { data: commands } = useCommandQueue()
  
  return useMemo(() => {
    const totalDevices = devices?.length || 0
    const onlineDevices = devices?.filter(d => d.isOnline).length || 0
    const offlineDevices = totalDevices - onlineDevices
    
    const totalUsers = new Set(syncData?.map(s => s.user_id)).size
    const syncedPairs = syncData?.filter(s => s.actual_state === 'synced').length || 0
    const syncingPairs = syncData?.filter(s => s.actual_state === 'syncing').length || 0
    const failedPairs = syncData?.filter(s => s.actual_state === 'not_synced').length || 0
    
    const pendingCommands = commands?.filter(c => c.status === 'pending').length || 0
    const failedCommands = commands?.filter(c => c.status === 'failed').length || 0
    
    return {
      devices: {
        total: totalDevices,
        online: onlineDevices,
        offline: offlineDevices,
      },
      users: {
        total: totalUsers,
      },
      sync: {
        total: syncData?.length || 0,
        synced: syncedPairs,
        syncing: syncingPairs,
        failed: failedPairs,
        healthPercentage: syncData?.length 
          ? Math.round((syncedPairs / syncData.length) * 100) 
          : 100,
      },
      commands: {
        pending: pendingCommands,
        failed: failedCommands,
      },
    }
  }, [devices, syncData, commands])
}

/**
 * Devices that need attention (offline or failed syncs)
 * Used by: Dashboard alerts, notification badges
 */
export function useDevicesNeedingAttention() {
  const { data: devices } = useDevices()
  const { data: syncData } = useSyncStatus()
  
  return useMemo(() => {
    const offlineDevices = devices?.filter(d => !d.isOnline) || []
    
    const devicesWithFailedSyncs = devices?.filter(device => {
      const deviceSyncs = syncData?.filter(s => s.device_sn === device.serial_number)
      return deviceSyncs?.some(s => s.actual_state === 'not_synced')
    }) || []
    
    return {
      offlineCount: offlineDevices.length,
      offlineDevices,
      failedSyncCount: devicesWithFailedSyncs.length,
      devicesWithFailedSyncs,
      totalAttentionNeeded: offlineDevices.length + devicesWithFailedSyncs.length,
    }
  }, [devices, syncData])
}

// =====================================================
// COMMAND / OPERATION VIEWS
// =====================================================

/**
 * Recent operations with full context
 * Used by: Activity feeds, operation logs
 */
export function useRecentOperations(limit: number = 20) {
  const { data: commands } = useCommandQueue()
  const { data: devices } = useDevices()
  
  return useMemo(() => {
    if (!commands) return []
    
    return commands.slice(0, limit).map(cmd => {
      const device = devices?.find(d => d.serial_number === cmd.device_sn)
      return {
        id: cmd.id,
        type: cmd.command_type,
        status: cmd.status,
        deviceSn: cmd.device_sn,
        deviceName: device?.name || cmd.device_sn,
        deviceLocation: device?.location,
        userId: cmd.related_user_id,
        userName: cmd.users?.name,
        userPin: cmd.users?.pin,
        createdAt: cmd.created_at,
        completedAt: cmd.completed_at,
        errorMessage: cmd.error_message,
      }
    })
  }, [commands, devices, limit])
}

/**
 * Commands grouped by status for monitoring
 */
export function useCommandsByStatus() {
  const { data: commands } = useCommandQueue()
  
  return useMemo(() => {
    if (!commands) {
      return {
        pending: [],
        sent: [],
        success: [],
        failed: [],
      }
    }
    
    return {
      pending: commands.filter(c => c.status === 'pending'),
      sent: commands.filter(c => c.status === 'sent'),
      success: commands.filter(c => c.status === 'success'),
      failed: commands.filter(c => c.status === 'failed'),
    }
  }, [commands])
}

// =====================================================
// ENROLLMENT / BIOMETRIC VIEWS
// =====================================================

/**
 * Available registrar devices for enrollment
 */
export function useRegistrarDevices() {
  const { data: devices } = useDevices()
  
  return useMemo(() => {
    return devices?.filter(d => d.is_registrar && d.isOnline) || []
  }, [devices])
}

/**
 * User enrollment readiness check
 */
export function useUserEnrollmentReadiness(userId: string) {
  const { data: devices } = useDevices()
  const { data: biometrics } = useUserBiometrics(userId)
  
  return useMemo(() => {
    const registrarDevices = devices?.filter(d => d.is_registrar && d.isOnline) || []
    const hasFingerprint = biometrics?.some(b => b.type === 'fingerprint')
    const hasFace = biometrics?.some(b => b.type === 'face')
    
    return {
      canEnroll: registrarDevices.length > 0,
      availableDevices: registrarDevices,
      hasFingerprint,
      hasFace,
      missingBiometrics: !hasFingerprint || !hasFace,
    }
  }, [devices, biometrics, userId])
}
