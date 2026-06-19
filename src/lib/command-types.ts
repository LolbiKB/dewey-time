// Command type constants for the ADMS Bridge

export type SyncComponentKey = 'user' | 'fingerprint' | 'face' | 'photo'

// Sync-related command types (user-specific, for syncing to devices)
export const SYNC_COMMAND_TYPES = [
  'sync_user',
  'enroll_fingerprint',
  'enroll_fingerprint_confirm',
  'enroll_face',
  'enroll_face_confirm',
  'upload_photo',
  'delete_user',
  'delete_fingerprint',
] as const

export type SyncCommandType = typeof SYNC_COMMAND_TYPES[number]

/** Fresh active command window (matches user-detail-modal). */
export const COMMAND_FRESHNESS_MS = 2 * 60 * 1000

/** Command types that drive per-component "in progress" UI. */
export const COMPONENT_COMMAND_TYPES: Record<SyncComponentKey, readonly string[]> = {
  user: ['sync_user'],
  fingerprint: [
    'delete_fingerprint',
    'enroll_fingerprint',
    'enroll_fingerprint_confirm',
    'query_fingerprint',
  ],
  face: ['enroll_face', 'enroll_face_confirm', 'query_face'],
  photo: ['upload_photo'],
}

export interface CommandActivityInput {
  command_type?: string
  status: string
  created_at: string
}

export function isFreshActiveCommand(
  c: CommandActivityInput,
  freshnessMs = COMMAND_FRESHNESS_MS
): boolean {
  const age = Date.now() - new Date(c.created_at).getTime()
  return (
    age < freshnessMs && (c.status === 'pending' || c.status === 'sent')
  )
}

/** Which sync components have fresh pending/sent commands. */
export function getActiveComponentsFromCommands(
  commands: CommandActivityInput[],
  freshnessMs = COMMAND_FRESHNESS_MS
): Set<SyncComponentKey> {
  const active = new Set<SyncComponentKey>()
  for (const c of commands) {
    if (!isFreshActiveCommand(c, freshnessMs) || !c.command_type) continue
    for (const [component, types] of Object.entries(COMPONENT_COMMAND_TYPES) as [
      SyncComponentKey,
      readonly string[],
    ][]) {
      if (types.includes(c.command_type)) {
        active.add(component)
      }
    }
  }
  return active
}

export function hasActiveDeleteFingerprint(
  commands: CommandActivityInput[],
  freshnessMs = COMMAND_FRESHNESS_MS
): boolean {
  return commands.some(
    (c) =>
      isFreshActiveCommand(c, freshnessMs) &&
      c.command_type === 'delete_fingerprint'
  )
}

// Device-level command types (not user-specific)
export const DEVICE_COMMAND_TYPES = [
  'reboot',
  'info',
  'check',
  'log',
  'clear_data',
] as const

export type DeviceCommandType = typeof DEVICE_COMMAND_TYPES[number]

// All known command types
export const ALL_COMMAND_TYPES = [...SYNC_COMMAND_TYPES, ...DEVICE_COMMAND_TYPES] as const

// Check if a command type is a sync command
export function isSyncCommand(commandType: string): boolean {
  return SYNC_COMMAND_TYPES.includes(commandType as SyncCommandType)
}

// Check if a command type is a device command
export function isDeviceCommand(commandType: string): boolean {
  return DEVICE_COMMAND_TYPES.includes(commandType as DeviceCommandType)
}

// Human-readable labels for command types
export const COMMAND_LABELS: Record<string, string> = {
  // Sync commands
  sync_user: 'User Info',
  enroll_fingerprint: 'Fingerprint',
  enroll_fingerprint_confirm: 'Fingerprint (push)',
  enroll_face: 'Face',
  enroll_face_confirm: 'Face (push)',
  upload_photo: 'Photo',
  delete_user: 'Delete User',
  delete_fingerprint: 'Remove fingerprint',
  query_fingerprint: 'Query fingerprint',
  query_face: 'Query face',
  // Device commands
  reboot: 'Reboot',
  info: 'Info Request',
  check: 'Force Sync',
  log: 'Push Logs',
  clear_data: 'Clear Data',
}

// Get label for a command type
export function getCommandLabel(commandType: string): string {
  return COMMAND_LABELS[commandType] || commandType.replace(/_/g, ' ')
}
