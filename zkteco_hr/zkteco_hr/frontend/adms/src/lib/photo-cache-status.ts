/** HR (Frappe) ↔ bridge cache status — not device sync. */

export type PhotoCacheStatus =
  | 'missing_cache'
  | 'hr_updated'
  | 'cache_current'
  | 'hr_no_photo'
  | 'stale_cache'

export interface PhotoCacheStatusInput {
  frappeImage: string | null | undefined
  frappeModified: string | null | undefined
  photoStoragePath: string | null | undefined
  storedFrappeImagePath: string | null | undefined
  storedFrappeImageModifiedAt: string | null | undefined
}

export function computePhotoCacheStatus(input: PhotoCacheStatusInput): PhotoCacheStatus {
  const hasFrappeImage = !!input.frappeImage
  const hasCache = !!input.photoStoragePath

  if (!hasFrappeImage && !hasCache) return 'hr_no_photo'
  if (!hasFrappeImage && hasCache) return 'stale_cache'
  if (hasFrappeImage && !hasCache) return 'missing_cache'

  if (!input.storedFrappeImagePath) return 'cache_current'

  const pathMatch = input.frappeImage === input.storedFrappeImagePath
  const storedMod = input.storedFrappeImageModifiedAt
    ? new Date(input.storedFrappeImageModifiedAt).getTime()
    : 0
  const empMod = input.frappeModified ? new Date(input.frappeModified).getTime() : 0
  const modifiedOk = !empMod || !storedMod || empMod <= storedMod

  if (pathMatch && modifiedOk) return 'cache_current'
  return 'hr_updated'
}

export const PHOTO_CACHE_STATUS_LABELS: Record<PhotoCacheStatus, string> = {
  missing_cache: 'HR photo not cached',
  hr_updated: 'HR photo newer than cache',
  cache_current: 'Cache matches HR',
  hr_no_photo: 'No HR photo',
  stale_cache: 'HR photo removed; cache remains',
}

export const PHOTO_CACHE_STATUS_VARIANT: Record<
  PhotoCacheStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  missing_cache: 'secondary',
  hr_updated: 'default',
  cache_current: 'outline',
  hr_no_photo: 'outline',
  stale_cache: 'destructive',
}

/** Show avatar corner indicator for statuses that need admin attention. */
export function photoCacheNeedsAttention(status: PhotoCacheStatus | undefined): boolean {
  return status === 'missing_cache' || status === 'hr_updated' || status === 'stale_cache'
}

/** Avatar overlay: missing_cache → fetch from HR; hr_updated → cache older than HR; stale_cache → orphan cache. */
export type PhotoCacheAvatarIndicatorKind = 'missing_cache' | 'hr_updated' | 'stale_cache'

export function getPhotoCacheAvatarIndicator(
  status: PhotoCacheStatus | undefined
): { kind: PhotoCacheAvatarIndicatorKind; title: string } | null {
  if (!status || !photoCacheNeedsAttention(status)) return null
  return {
    kind: status as PhotoCacheAvatarIndicatorKind,
    title: PHOTO_CACHE_STATUS_LABELS[status],
  }
}
