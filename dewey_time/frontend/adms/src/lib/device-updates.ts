import type { DeviceEntry } from '@/services/device-service'

export interface EditableDeviceFields {
  name: string
  location: string
  isRegistrar: boolean
  capabilities: string[]
}

export interface DeviceUpdatePermissions {
  /**
   * True when the signed-in admin is a Super Admin.
   *
   * `is_registrar` is guarded at the DATABASE by
   * `guard_device_security_columns` (audit-hardening migration, applied to prod
   * 2026-08-03): an UPDATE from a non-super-admin that changes it raises 42501.
   * `DeviceService.updateDevice` writes straight to PostgREST under the user's
   * JWT, so sending the field anyway produces a raw Postgres error toast.
   */
  canEditRegistrar: boolean
}

export interface DeviceUpdatePayload {
  name?: string
  location?: string
  is_registrar?: boolean
  registrar_capabilities?: string[]
}

/**
 * Build the PATCH payload for a device edit — only the fields that actually
 * changed, and only the ones this admin is allowed to change.
 *
 * `registrar_capabilities` is intentionally NOT gated: the DB trigger covers
 * `connection_status`, `comm_key` and `is_registrar` only, so restricting
 * capabilities here would invent a policy the database does not have.
 */
export function buildDeviceUpdates(
  device: DeviceEntry | null,
  fields: EditableDeviceFields,
  permissions: DeviceUpdatePermissions
): DeviceUpdatePayload {
  if (!device) return {}

  const updates: DeviceUpdatePayload = {}

  if (fields.name !== (device.name || '')) {
    updates.name = fields.name || undefined
  }
  if (fields.location !== (device.location || '')) {
    updates.location = fields.location || undefined
  }
  if (
    permissions.canEditRegistrar &&
    fields.isRegistrar !== (device.is_registrar || false)
  ) {
    updates.is_registrar = fields.isRegistrar
  }
  if (
    JSON.stringify(fields.capabilities) !==
    JSON.stringify(device.registrar_capabilities || [])
  ) {
    updates.registrar_capabilities = fields.capabilities
  }

  return updates
}
