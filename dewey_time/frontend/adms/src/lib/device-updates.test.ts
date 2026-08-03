import { describe, test, expect } from 'vitest'
import { buildDeviceUpdates, type EditableDeviceFields } from './device-updates'
import type { DeviceEntry } from '@/services/device-service'

/**
 * `is_registrar` is guarded at the DATABASE by guard_device_security_columns
 * (supabase/migrations/20260730120000_audit_hardening.sql, applied to prod
 * 2026-08-03): a non-super-admin UPDATE that changes it raises 42501.
 *
 * `DeviceService.updateDevice` writes straight to PostgREST under the user's
 * JWT, so before this the dialog offered an IT Admin a toggle whose only
 * possible outcome was a raw Postgres error toast.
 *
 * `registrar_capabilities` is deliberately NOT guarded here — the DB trigger
 * covers connection_status, comm_key and is_registrar only, so restricting
 * capabilities in the UI would be inventing a policy the database does not have.
 */

const DEVICE = {
  serial_number: 'PYA8254100003',
  name: 'Main Entrance',
  location: 'HQ',
  is_registrar: false,
  registrar_capabilities: [],
} as unknown as DeviceEntry

const UNCHANGED: EditableDeviceFields = {
  name: 'Main Entrance',
  location: 'HQ',
  isRegistrar: false,
  capabilities: [],
}

describe('buildDeviceUpdates', () => {
  test('sends nothing when nothing changed', () => {
    expect(buildDeviceUpdates(DEVICE, UNCHANGED, { canEditRegistrar: true })).toEqual({})
  })

  test('sends a changed name', () => {
    const updates = buildDeviceUpdates(
      DEVICE,
      { ...UNCHANGED, name: 'Side Door' },
      { canEditRegistrar: true }
    )
    expect(updates).toEqual({ name: 'Side Door' })
  })

  test('sends undefined for a cleared name rather than an empty string', () => {
    const updates = buildDeviceUpdates(DEVICE, { ...UNCHANGED, name: '' }, { canEditRegistrar: true })
    expect(updates).toHaveProperty('name', undefined)
  })

  test('sends a changed location', () => {
    const updates = buildDeviceUpdates(
      DEVICE,
      { ...UNCHANGED, location: 'Branch 2' },
      { canEditRegistrar: true }
    )
    expect(updates).toEqual({ location: 'Branch 2' })
  })

  test('sends is_registrar when the caller may edit it', () => {
    const updates = buildDeviceUpdates(
      DEVICE,
      { ...UNCHANGED, isRegistrar: true },
      { canEditRegistrar: true }
    )
    expect(updates).toEqual({ is_registrar: true })
  })

  test('OMITS is_registrar when the caller may not edit it', () => {
    // The security case: the DB would raise 42501, so never send the write.
    const updates = buildDeviceUpdates(
      DEVICE,
      { ...UNCHANGED, isRegistrar: true },
      { canEditRegistrar: false }
    )
    expect(updates).not.toHaveProperty('is_registrar')
    expect(updates).toEqual({})
  })

  test('still sends other fields when is_registrar is suppressed', () => {
    const updates = buildDeviceUpdates(
      DEVICE,
      { ...UNCHANGED, name: 'Side Door', isRegistrar: true },
      { canEditRegistrar: false }
    )
    expect(updates).toEqual({ name: 'Side Door' })
  })

  test('sends registrar_capabilities even when is_registrar is suppressed', () => {
    // The DB trigger guards connection_status/comm_key/is_registrar only.
    const registrarDevice = { ...DEVICE, is_registrar: true } as DeviceEntry
    const updates = buildDeviceUpdates(
      registrarDevice,
      { ...UNCHANGED, isRegistrar: true, capabilities: ['fingerprint'] },
      { canEditRegistrar: false }
    )
    expect(updates).toEqual({ registrar_capabilities: ['fingerprint'] })
  })

  test('treats a null device as nothing to send', () => {
    expect(buildDeviceUpdates(null, UNCHANGED, { canEditRegistrar: true })).toEqual({})
  })
})
