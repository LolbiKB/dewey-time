import { useQuery } from '@tanstack/react-query'
import { PhotoService } from '@/services/photo-service'

interface UseUserPhotoOptions {
  photoUrl?: string | null
  hasCachedPhoto?: boolean
  enabled?: boolean
}

interface UseUserPhotoResult {
  photoUrl: string | null
  isLoading: boolean
  error: Error | null
  isCached: boolean
}

/**
 * Hook to get photo URL for a user
 * - If hasCachedPhoto is true, the photo_url is from bucket (processed)
 * - Otherwise, photo_url is from Frappe (not processed)
 */
export function useUserPhoto({ photoUrl, hasCachedPhoto, enabled = true }: UseUserPhotoOptions): UseUserPhotoResult {
  // Just return the URL directly - no async fetch needed
  if (!photoUrl || !enabled) {
    return {
      photoUrl: null,
      isLoading: false,
      error: null,
      isCached: false,
    }
  }

  return {
    photoUrl: photoUrl,
    isLoading: false,
    error: null,
    isCached: hasCachedPhoto ?? false,
  }
}

/**
 * Hook to get photo cache status for multiple users
 * Useful for tables/lists to batch check cache status
 */
export function usePhotoCacheStatus(userIds: string[]) {
  return useQuery({
    queryKey: ['photo-cache-status', userIds],
    queryFn: () => PhotoService.getPhotoCacheStatus(userIds),
    enabled: userIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}
