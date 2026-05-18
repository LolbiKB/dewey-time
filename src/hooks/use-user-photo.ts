import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PhotoService } from '@/services/photo-service'

const API_URL = import.meta.env.VITE_API_URL || ''

interface UseUserPhotoOptions {
  photoUrl?: string | null
  hasCachedPhoto?: boolean
  frappeEmployeeId?: string
  userId?: string
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
 * - If hasCachedPhoto is true and userId is provided, resolves the Supabase Storage public URL
 * - If not cached but frappeEmployeeId is provided, uses the backend proxy URL
 * - Private Frappe URLs are never returned directly (browser can't access them)
 */
export function useUserPhoto({ photoUrl, hasCachedPhoto, frappeEmployeeId, userId, enabled = true }: UseUserPhotoOptions): UseUserPhotoResult {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !hasCachedPhoto || !userId) {
      setResolvedUrl(null)
      return
    }

    let cancelled = false
    setLoading(true)

    PhotoService.getPhotoUrl(userId).then(url => {
      if (!cancelled) {
        setResolvedUrl(url)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [userId, hasCachedPhoto, enabled])

  if (!enabled) {
    return { photoUrl: null, isLoading: false, error: null, isCached: false }
  }

  // Prefer Supabase Storage URL (public, always accessible)
  if (hasCachedPhoto && resolvedUrl) {
    return { photoUrl: resolvedUrl, isLoading: false, error: null, isCached: true }
  }

  if (loading) {
    return { photoUrl: null, isLoading: true, error: null, isCached: false }
  }

  // Fall back to Frappe proxy URL for uncached private photos
  if (frappeEmployeeId && !hasCachedPhoto) {
    return {
      photoUrl: `${API_URL}/admin/frappe-employees/${frappeEmployeeId}/photo/image`,
      isLoading: false,
      error: null,
      isCached: false,
    }
  }

  // Don't return raw Frappe URL — browser can't access private files
  return { photoUrl: null, isLoading: false, error: null, isCached: false }
}

/**
 * Hook to get photo cache status for multiple users
 */
export function usePhotoCacheStatus(userIds: string[]) {
  return useQuery({
    queryKey: ['photo-cache-status', userIds],
    queryFn: () => PhotoService.getPhotoCacheStatus(userIds),
    enabled: userIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}