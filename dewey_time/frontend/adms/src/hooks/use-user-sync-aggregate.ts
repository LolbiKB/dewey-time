import { useEffect, useMemo, useState } from 'react'
import {
  computeUserSyncAggregate,
  type UserSyncAggregateResult,
} from '@/lib/user-sync-aggregate'
import { useSyncStatus, useCommandQueue, useUserBiometrics, useEnrollmentStatus } from '@/hooks/use-users'
import { getSyncState, subscribeSyncState } from '@/services/user-service'

export const userSyncAggregateKeys = {
  all: ['user-sync-aggregate'] as const,
  detail: (userId: string) => [...userSyncAggregateKeys.all, userId] as const,
}

export interface UseUserSyncAggregateOptions {
  enabled?: boolean
  refetchInterval?: number
  /** Poll enrollment session for stale-command heuristics (modal). List badge can omit. */
  includeEnrollmentHints?: boolean
}

/**
 * Shared sync aggregate for list badge and user detail modal — same rules as modal stats.
 */
export function useUserSyncAggregate(
  userId: string,
  options: UseUserSyncAggregateOptions = {}
) {
  const {
    enabled = !!userId,
    refetchInterval = 10000,
    includeEnrollmentHints = false,
  } = options

  const { data: syncData, isLoading: syncLoading } = useSyncStatus(userId, {
    refetchInterval: enabled ? refetchInterval : undefined,
  })
  const { data: commandData, isLoading: commandsLoading } = useCommandQueue(userId, 50, {
    refetchInterval: enabled ? refetchInterval : undefined,
  })
  const { data: bioData, isLoading: bioLoading } = useUserBiometrics(userId)

  const { data: enrollmentData } = useEnrollmentStatus(userId, {
    enabled: enabled && includeEnrollmentHints,
    refetchInterval: enabled && includeEnrollmentHints ? refetchInterval : undefined,
  })

  const aggregate = useMemo((): UserSyncAggregateResult | null => {
    if (!userId || !syncData?.data) return null

    const session = enrollmentData?.data?.session
    const activePhases = ['queued', 'awaiting_upload']
    const hasActiveEnrollment =
      enrollmentData?.data?.isActive === true ||
      (session?.phase != null && activePhases.includes(session.phase))

    return computeUserSyncAggregate({
      syncStatus: syncData.data,
      commands: commandData?.data ?? [],
      fingerprints: bioData?.data ?? [],
      hasActiveEnrollment,
      enrollmentSession: session
        ? {
            phase: session.phase,
            recovery_command_id: session.recovery_command_id,
            device_sn: session.device_sn,
          }
        : null,
    })
  }, [userId, syncData?.data, commandData?.data, bioData?.data, enrollmentData?.data])

  const [globalSyncActive, setGlobalSyncActive] = useState(
    () => getSyncState().active && getSyncState().userId === userId
  )

  useEffect(() => {
    const sync = () => {
      const state = getSyncState()
      setGlobalSyncActive(state.active && state.userId === userId)
    }
    sync()
    return subscribeSyncState(sync)
  }, [userId])

  const isSyncing =
    globalSyncActive ||
    (aggregate?.has_active_commands ?? false) ||
    (aggregate?.syncing ?? 0) > 0 ||
    (aggregate?.cleaning ?? 0) > 0

  return {
    aggregate,
    isLoading: syncLoading || commandsLoading || bioLoading,
    isSyncing,
    globalSyncActive,
  }
}
