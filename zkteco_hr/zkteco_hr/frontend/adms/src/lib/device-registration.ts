export interface DeviceRegistrationData {
  pushver?: string
  last_init?: string
}

export function parseDeviceRegistrationData(
  registrationData?: string | null
): DeviceRegistrationData | null {
  if (!registrationData?.trim()) return null
  try {
    const parsed = JSON.parse(registrationData) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) return null
    return {
      pushver: typeof parsed.pushver === 'string' ? parsed.pushver : undefined,
      last_init: typeof parsed.last_init === 'string' ? parsed.last_init : undefined,
    }
  } catch {
    return null
  }
}
