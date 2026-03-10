// Command type constants for the ADMS Bridge

// Sync-related command types (user-specific, for syncing to devices)
export const SYNC_COMMAND_TYPES = [
  'sync_user',
  'enroll_fingerprint', 
  'enroll_face',
  'upload_photo',
  'delete_user',
] as const

export type SyncCommandType = typeof SYNC_COMMAND_TYPES[number]

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
  enroll_face: 'Face',
  upload_photo: 'Photo',
  delete_user: 'Delete User',
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
