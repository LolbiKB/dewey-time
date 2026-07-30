/**
 * Optimistic-update helper for the user-biometrics query cache.
 *
 * The biometrics query key holds a bare BiometricEntry-like array. This
 * helper tolerates anything else (legacy wrapper objects, undefined) by
 * returning the input unchanged — defense-in-depth for the
 * "i.filter is not a function" crash that aborted fingerprint deletes
 * before the request was ever sent.
 */

interface BiometricLike {
  type: string
  finger_id: number | null
}

export function removeBiometricFromCache<T>(
  cached: T,
  type: 'fingerprint' | 'face',
  fingerId: number | undefined
): T {
  if (!Array.isArray(cached)) return cached
  return cached.filter(
    (bio: BiometricLike) =>
      !(bio.type === type && (fingerId === undefined || bio.finger_id === fingerId))
  ) as T
}
