import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PhotoService } from '@/services/photo-service'
import { supabase } from '@/lib/supabase'

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
 * - All photos served through backend proxies (private bucket + private Frappe)
 * - Token is appended as ?token= for <img src> auth
 */
export function useUserPhoto({ hasCachedPhoto, frappeEmployeeId, userId, enabled = true }: UseUserPhotoOptions): UseUserPhotoResult {
  const [token, setToken] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token || '')
    })
  }, [])

  if (!enabled) {
    return { photoUrl: null, isLoading: false, error: null, isCached: false }
  }

  const qs = token ? `?token=${encodeURIComponent(token)}` : ''

  if (hasCachedPhoto && userId) {
    return {
      photoUrl: `${API_URL}/admin/photo/${userId}/image${qs}`,
      isLoading: false,
      error: null,
      isCached: true,
    }
  }

  if (frappeEmployeeId && !hasCachedPhoto) {
    return {
      photoUrl: `${API_URL}/admin/frappe-employees/${frappeEmployeeId}/photo/image${qs}`,
      isLoading: false,
      error: null,
      isCached: false,
    }
  }

  return { photoUrl: null, isLoading: false, error: null, isCached: false }
}

export function usePhotoCacheStatus(userIds: string[]) {
  return useQuery({
    queryKey: ['photo-cache-status', userIds],
    queryFn: () => PhotoService.getPhotoCacheStatus(userIds),
    enabled: userIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}