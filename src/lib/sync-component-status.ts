import type { CommandActivityInput, SyncComponentKey } from './command-types'
import {
  getActiveComponentsFromCommands,
  hasActiveDeleteFingerprint,
} from './command-types'

export type SyncComponent = SyncComponentKey

export type SyncComponentState =
  | 'not_enrolled'
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'failed'

export interface SyncStatusRow {
  user_synced?: boolean
  fingerprint_synced?: boolean
  fingerprint_mask?: number
  face_synced?: boolean
  photo_synced?: boolean
  has_fingerprint?: boolean
  has_face?: boolean
  has_photo_in_db?: boolean
  has_fingerprint_in_db?: boolean
  actual_state?: string
  error_message?: string | null
}

export interface FingerprintBio {
  finger_id?: number | null
  type?: string
}

export interface GetComponentSyncOptions {
  /** @deprecated Prefer activeComponents — global flag bleeds FP work into other tiles */
  hasActiveCommands?: boolean
  /** Per-component fresh pending/sent commands (from getActiveComponentsFromCommands). */
  activeComponents?: Set<SyncComponent>
  /** True when delete_fingerprint is actively running (shows "Removing…" on FP tile). */
  activeDeleteFingerprint?: boolean
  fingerprints?: FingerprintBio[]
  hasFaceInDb?: boolean
  hasPhotoInDb?: boolean
}

export const SYNC_COMPONENT_LABELS: Record<SyncComponentState, string> = {
  not_enrolled: 'Not enrolled',
  pending: 'Pending',
  syncing: 'Syncing',
  synced: 'Synced',
  failed: 'Failed',
}

export const SYNC_COMPONENT_REMOVING_LABEL = 'Removing…'

function fingerprintExpectedMask(fingerprints: FingerprintBio[]): number {
  return fingerprints
    .filter((b) => b.type === 'fingerprint' || b.type === undefined)
    .reduce((mask, fp) => mask | (1 << (fp.finger_id || 0)), 0)
}

function hasFingerprintInCloud(
  status: SyncStatusRow,
  fingerprints: FingerprintBio[]
): boolean {
  const fpCount = fingerprints.filter(
    (b) => b.type === 'fingerprint' || b.type === undefined
  ).length
  return !!(status.has_fingerprint_in_db || status.has_fingerprint || fpCount > 0)
}

function hasFingerprintOnDeviceMask(status: SyncStatusRow): boolean {
  return (status.fingerprint_mask ?? 0) > 0
}

/** Cloud is source of truth; device mask alone is transient cleanup, not enrollment. */
function hasFingerprintInCloudOnly(
  status: SyncStatusRow,
  fingerprints: FingerprintBio[]
): boolean {
  return hasFingerprintInCloud(status, fingerprints)
}

function isComponentCommandActive(
  component: SyncComponent,
  options: GetComponentSyncOptions
): boolean {
  if (options.activeComponents?.has(component)) return true
  if (options.hasActiveCommands) {
    return component === 'fingerprint'
  }
  return false
}

/** Fingerprint may use global actual_state when FP is applicable and mask work is implied. */
function isFingerprintGlobalCleanupInProgress(
  status: SyncStatusRow,
  fingerprints: FingerprintBio[]
): boolean {
  if (status.actual_state !== 'syncing' && status.actual_state !== 'cleaning') {
    return false
  }
  if (!isFingerprintComponentApplicable(status, fingerprints)) return false
  const fpList = fingerprints.filter(
    (b) => b.type === 'fingerprint' || b.type === undefined
  )
  const deviceMask = status.fingerprint_mask ?? 0
  if (fpList.length === 0 && deviceMask > 0) return true
  if (fpList.length === 0) return false
  const expectedMask = fingerprintExpectedMask(fpList)
  return deviceMask !== expectedMask
}

function isComponentInProgress(
  component: SyncComponent,
  status: SyncStatusRow,
  options: GetComponentSyncOptions
): boolean {
  if (isComponentCommandActive(component, options)) return true
  if (component === 'fingerprint') {
    return isFingerprintGlobalCleanupInProgress(
      status,
      options.fingerprints ?? []
    )
  }
  return false
}

function componentIdleState(
  component: SyncComponent,
  status: SyncStatusRow,
  options: GetComponentSyncOptions
): SyncComponentState {
  return isComponentInProgress(component, status, options) ? 'syncing' : 'pending'
}

function fingerprintComponentLabel(
  state: SyncComponentState,
  options: GetComponentSyncOptions
): string {
  if (state === 'syncing' && options.activeDeleteFingerprint) {
    return SYNC_COMPONENT_REMOVING_LABEL
  }
  return SYNC_COMPONENT_LABELS[state]
}

function isFingerprintComponentApplicable(
  status: SyncStatusRow,
  fingerprints: FingerprintBio[]
): boolean {
  return (
    hasFingerprintInCloudOnly(status, fingerprints) ||
    hasFingerprintOnDeviceMask(status)
  )
}

function hasFaceInCloud(
  status: SyncStatusRow,
  hasFaceInDb?: boolean
): boolean {
  return !!(hasFaceInDb ?? status.has_face)
}

function hasPhotoInCloud(
  status: SyncStatusRow,
  hasPhotoInDb?: boolean
): boolean {
  return !!(hasPhotoInDb ?? status.has_photo_in_db)
}

export function isComponentApplicable(
  component: SyncComponent,
  status: SyncStatusRow,
  options: GetComponentSyncOptions = {}
): boolean {
  const { fingerprints = [], hasFaceInDb, hasPhotoInDb } = options

  switch (component) {
    case 'user':
      return true
    case 'fingerprint':
      return isFingerprintComponentApplicable(status, fingerprints)
    case 'face':
      return hasFaceInCloud(status, hasFaceInDb) || !!status.face_synced
    case 'photo':
      return hasPhotoInCloud(status, hasPhotoInDb) || !!status.photo_synced
    default:
      return false
  }
}

export function getComponentSyncStatus(
  component: SyncComponent,
  status: SyncStatusRow,
  options: GetComponentSyncOptions = {}
): { state: SyncComponentState; label: string; isApplicable: boolean } {
  const { fingerprints = [] } = options

  const applicable = isComponentApplicable(component, status, options)
  if (!applicable) {
    return {
      state: 'not_enrolled',
      label: SYNC_COMPONENT_LABELS.not_enrolled,
      isApplicable: false,
    }
  }

  if (status.actual_state === 'not_synced' && status.error_message) {
    return {
      state: 'failed',
      label: SYNC_COMPONENT_LABELS.failed,
      isApplicable: true,
    }
  }

  if (component === 'fingerprint') {
    const fpList = fingerprints.filter(
      (b) => b.type === 'fingerprint' || b.type === undefined
    )
    const fpCount = fpList.length
    const inCloud = hasFingerprintInCloudOnly(status, fingerprints)
    const deviceMask = status.fingerprint_mask ?? 0

    if (fpCount === 0 && deviceMask > 0) {
      const state = componentIdleState('fingerprint', status, options)
      return {
        state,
        label: fingerprintComponentLabel(state, options),
        isApplicable: true,
      }
    }

    if (fpCount === 0 && deviceMask === 0) {
      return {
        state: 'not_enrolled',
        label: SYNC_COMPONENT_LABELS.not_enrolled,
        isApplicable: false,
      }
    }

    const expectedMask = fingerprintExpectedMask(fpList)
    const maskMatchesExactly = deviceMask === expectedMask

    if (isComponentInProgress('fingerprint', status, options)) {
      const state = 'syncing' as const
      return {
        state,
        label: fingerprintComponentLabel(state, options),
        isApplicable: true,
      }
    }

    if (maskMatchesExactly && inCloud) {
      return {
        state: 'synced',
        label: SYNC_COMPONENT_LABELS.synced,
        isApplicable: true,
      }
    }

    const state = componentIdleState('fingerprint', status, options)
    return {
      state,
      label: fingerprintComponentLabel(state, options),
      isApplicable: true,
    }
  }

  if (component === 'face') {
    const inCloud = hasFaceInCloud(status, options.hasFaceInDb)
    if (!inCloud && status.face_synced) {
      const state = componentIdleState('face', status, options)
      return { state, label: SYNC_COMPONENT_LABELS[state], isApplicable: true }
    }
  }

  if (component === 'photo') {
    const inCloud = hasPhotoInCloud(status, options.hasPhotoInDb)
    if (!inCloud && status.photo_synced) {
      const state = componentIdleState('photo', status, options)
      return { state, label: SYNC_COMPONENT_LABELS[state], isApplicable: true }
    }
  }

  const fieldMap: Record<Exclude<SyncComponent, 'fingerprint'>, keyof SyncStatusRow> = {
    user: 'user_synced',
    face: 'face_synced',
    photo: 'photo_synced',
  }

  const field = fieldMap[component as Exclude<SyncComponent, 'fingerprint'>]
  if (status[field]) {
    return {
      state: 'synced',
      label: SYNC_COMPONENT_LABELS.synced,
      isApplicable: true,
    }
  }

  const state = componentIdleState(component, status, options)
  return { state, label: SYNC_COMPONENT_LABELS[state], isApplicable: true }
}

/** Counts toward "fully synced" aggregate — only cloud-synced or N/A. */
export function isComponentSatisfiedForAggregate(state: SyncComponentState): boolean {
  return state === 'synced' || state === 'not_enrolled'
}

export function isDeviceAllComponentsSynced(
  status: SyncStatusRow,
  options: GetComponentSyncOptions = {}
): boolean {
  const components: SyncComponent[] = ['user', 'fingerprint', 'face', 'photo']
  return components.every((c) => {
    const { state } = getComponentSyncStatus(c, status, options)
    return isComponentSatisfiedForAggregate(state)
  })
}

export function syncComponentTileClass(state: SyncComponentState): string {
  switch (state) {
    case 'synced':
      return 'bg-green-50 border border-green-200 dark:bg-green-950/30 dark:border-green-800'
    case 'syncing':
      return 'bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-800'
    case 'pending':
      return 'bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
    case 'failed':
      return 'bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-800'
    default:
      return 'bg-gray-50 dark:bg-muted/30'
  }
}

/** Build sync options for one device from its command list. */
export function buildComponentSyncOptions(
  deviceCommands: CommandActivityInput[],
  context: Omit<
    GetComponentSyncOptions,
    'activeComponents' | 'activeDeleteFingerprint' | 'hasActiveCommands'
  >
): GetComponentSyncOptions {
  const activeComponents = getActiveComponentsFromCommands(deviceCommands)
  return {
    ...context,
    activeComponents,
    activeDeleteFingerprint: hasActiveDeleteFingerprint(deviceCommands),
    hasActiveCommands: activeComponents.size > 0,
  }
}
