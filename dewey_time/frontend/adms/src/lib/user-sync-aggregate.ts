/**
 * Single source of truth for user-level sync aggregates (list badge + modal chips).
 * Aligns "synced" and "syncing" with command queue activity, not only actual_state.
 */
import {
  COMMAND_FRESHNESS_MS,
  isFreshActiveCommand,
  type CommandActivityInput,
} from '@/lib/command-types'
import {
  buildComponentSyncOptions,
  getComponentSyncStatus,
  isComponentSatisfiedForAggregate,
  type FingerprintBio,
  type SyncComponent,
  type SyncStatusRow,
} from '@/lib/sync-component-status'

export interface CommandForAggregate extends CommandActivityInput {
  device_sn: string
  id?: number
  command?: string
}

export interface EnrollmentSessionHint {
  phase?: string
  recovery_command_id?: number | null
  device_sn?: string
}

export interface UserSyncAggregateResult {
  total: number
  synced: number
  not_synced: number
  syncing: number
  cleaning: number
  stale_count: number
  has_active_commands: boolean
  is_fully_synced: boolean
  syncing_device_sns: string[]
  has_failed_commands: boolean
  has_failed_devices: boolean
}

function isStaleCommand(c: CommandActivityInput): boolean {
  const age = Date.now() - new Date(c.created_at).getTime()
  return age >= COMMAND_FRESHNESS_MS && (c.status === 'pending' || c.status === 'sent')
}

function isFingerprintTemplatePush(cmd: string | undefined): boolean {
  if (!cmd) return false
  const body = cmd.replace(/^C:\d+:/, '')
  return body.includes('DATA UPDATE') && (body.includes('FINGERTMP') || body.includes('FACE'))
}

function isStaleCommandForDisplay(
  c: CommandForAggregate,
  deviceCommands: CommandForAggregate[],
  enrollmentSession?: EnrollmentSessionHint | null
): boolean {
  if (!isStaleCommand(c)) return false

  if (
    (c.command_type === 'enroll_fingerprint' ||
      c.command_type === 'enroll_fingerprint_confirm' ||
      c.command_type === 'enroll_face') &&
    isFingerprintTemplatePush(c.command)
  ) {
    return false
  }

  const isRecoveryQuery =
    c.command_type === 'query_fingerprint' || c.command_type === 'query_face'

  if (isRecoveryQuery) {
    const newerSuccess = deviceCommands.some(
      (other) =>
        other.id != null &&
        c.id != null &&
        other.id > c.id &&
        other.command_type === c.command_type &&
        other.device_sn === c.device_sn &&
        other.status === 'success'
    )
    if (newerSuccess) return false

    const recoveryId = enrollmentSession?.recovery_command_id
    if (recoveryId != null && c.id != null && c.id < recoveryId) return false
  }

  const terminalPhases = ['timed_out', 'completed', 'cancelled', 'failed']
  if (
    enrollmentSession?.phase &&
    terminalPhases.includes(enrollmentSession.phase) &&
    isRecoveryQuery
  ) {
    return false
  }

  return true
}

const SYNC_COMPONENTS: SyncComponent[] = ['user', 'fingerprint', 'face', 'photo']

export function computeUserSyncAggregate(params: {
  syncStatus: SyncStatusRow[]
  commands: CommandForAggregate[]
  fingerprints: FingerprintBio[]
  hasActiveEnrollment?: boolean
  enrollmentSession?: EnrollmentSessionHint | null
}): UserSyncAggregateResult {
  const { syncStatus, commands, fingerprints, hasActiveEnrollment = false, enrollmentSession } =
    params

  const hasFace = fingerprints.some((b) => b.type === 'face')

  const syncingDevices = new Set(
    commands.filter(isFreshActiveCommand).map((c) => c.device_sn)
  )

  const staleCount = commands.filter((c) => {
    const deviceCommands = commands.filter((d) => d.device_sn === c.device_sn)
    const sessionForDevice =
      enrollmentSession?.device_sn === c.device_sn ? enrollmentSession : null
    return isStaleCommandForDisplay(c, deviceCommands, sessionForDevice)
  }).length

  const componentSatisfied = (s: SyncStatusRow, component: SyncComponent) => {
    const deviceCommands = commands.filter((c) => c.device_sn === s.device_sn)
    const syncOptions = buildComponentSyncOptions(deviceCommands, {
      fingerprints,
      hasFaceInDb: hasFace,
      hasPhotoInDb: s.has_photo_in_db,
    })
    const { state } = getComponentSyncStatus(component, s, syncOptions)
    return isComponentSatisfiedForAggregate(state)
  }

  const deviceFullySynced = (s: SyncStatusRow) =>
    SYNC_COMPONENTS.every((c) => componentSatisfied(s, c))

  const synced = syncStatus.filter((s) => {
    const sn = s.device_sn
    if (!sn || syncingDevices.has(sn)) return false
    return deviceFullySynced(s)
  }).length

  let notSynced = syncStatus.filter((s) => {
    const sn = s.device_sn
    if (!sn || syncingDevices.has(sn)) return false
    return !deviceFullySynced(s)
  }).length

  const total = syncStatus.length
  if (hasActiveEnrollment && notSynced === 0 && total > 0 && syncingDevices.size === 0) {
    notSynced = 1
  }

  const cleaning = syncStatus.filter((s) => s.actual_state === 'cleaning').length
  const hasActiveCommands = commands.some(isFreshActiveCommand)
  const hasFailedCommands = commands.some((c) => c.status === 'failed')
  const hasFailedDevices = syncStatus.some(
    (s) => s.actual_state === 'failed' || (s.error_message != null && s.error_message !== '')
  )

  const isFullySynced =
    synced === total &&
    total > 0 &&
    syncingDevices.size === 0 &&
    !hasActiveCommands &&
    !hasActiveEnrollment

  return {
    total,
    synced,
    not_synced: notSynced,
    syncing: syncingDevices.size,
    cleaning,
    stale_count: staleCount,
    has_active_commands: hasActiveCommands,
    is_fully_synced: isFullySynced,
    syncing_device_sns: [...syncingDevices],
    has_failed_commands: hasFailedCommands,
    has_failed_devices: hasFailedDevices,
  }
}

/** Map API / service summary shape to aggregate result fields used by the list badge. */
export function aggregateToSyncStatusSummary(
  aggregate: UserSyncAggregateResult
): {
  total_devices: number
  synced: number
  not_synced: number
  is_fully_synced: boolean
  syncing_devices: number
  has_active_commands: boolean
  is_syncing: boolean
} {
  return {
    total_devices: aggregate.total,
    synced: aggregate.synced,
    not_synced: aggregate.not_synced,
    is_fully_synced: aggregate.is_fully_synced,
    syncing_devices: aggregate.syncing,
    has_active_commands: aggregate.has_active_commands,
    is_syncing:
      aggregate.has_active_commands || aggregate.syncing > 0 || aggregate.cleaning > 0,
  }
}
