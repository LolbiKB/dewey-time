import { supabase } from '@/lib/supabase'
import { getAuthHeaders } from '@/lib/auth-token'

export interface PhotoCacheEntry {
  userId: string
  photoUrl: string | null
  photoHash: string | null
  photoStoragePath: string | null
  photoSyncedAt: string | null
}

export interface ProcessPhotoResult {
  success: boolean
  message: string
  errors?: string[]
  processedImage?: any // Kept for compatibility
}

const API_URL = import.meta.env.VITE_API_URL || '' // Empty uses Vite proxy in dev

export class PhotoService {
  /**
   * Process and store photo via Fastify backend (server-side processing)
   * Fetches from Frappe, resizes, uploads to Supabase Storage
   */
  static async processAndStorePhoto(
    userId: string,
    frappeEmployeeId?: string | null
  ): Promise<ProcessPhotoResult> {
    try {
      console.log(`[PhotoService] Processing photo for user ${userId}`)

      const response = await fetch(`${API_URL}/admin/photo/process`, {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          user_id: userId,
          ...(frappeEmployeeId ? { frappe_employee_id: frappeEmployeeId } : {}),
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('[PhotoService] Fastify error:', error)
        return {
          success: false,
          message: error.error || `Failed: ${response.status}`,
        }
      }

      const result = await response.json()
      console.log(`[PhotoService] Success: ${result.photo_url}`)

      return {
        success: true,
        message: 'Photo processed and stored successfully',
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('[PhotoService] Photo processing failed:', errorMessage)
      
      let userMessage = `Photo processing failed: ${errorMessage}`
      if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
        userMessage = 'Cannot connect to backend. Please try again.'
      }
      
      return {
        success: false,
        message: userMessage,
      }
    }
  }

  /**
   * Get public URL for a cached photo
   */
  static async getPhotoUrl(userId: string): Promise<string | null> {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('photo_storage_path, photo_synced_at')
        .eq('id', userId)
        .single()

      if (error || !user?.photo_storage_path) {
        return null
      }

      const { data } = supabase
        .storage
        .from('user-photos')
        .getPublicUrl(user.photo_storage_path)

      return data?.publicUrl || null
    } catch (error) {
      console.error('[PhotoService] Failed to get photo URL:', error)
      return null
    }
  }

  /**
   * Check if user has a cached photo
   */
  static async hasCachedPhoto(userId: string): Promise<boolean> {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('photo_storage_path')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('[PhotoService] Error checking photo cache:', error)
        return false
      }

      return !!user?.photo_storage_path
    } catch (error) {
      console.error('[PhotoService] Failed to check photo cache:', error)
      return false
    }
  }

  /**
   * Fetch photo cache status for multiple users
   */
  static async getPhotoCacheStatus(userIds: string[]): Promise<Map<string, PhotoCacheEntry>> {
    const { data, error } = await supabase
      .from('users')
      .select('id, photo_url, photo_hash, photo_storage_path, photo_synced_at')
      .in('id', userIds)

    if (error || !data) {
      console.error('[PhotoService] Failed to fetch photo cache status:', error)
      return new Map()
    }

    const result = new Map<string, PhotoCacheEntry>()
    for (const user of data) {
      result.set(user.id, {
        userId: user.id,
        photoUrl: user.photo_url,
        photoHash: user.photo_hash,
        photoStoragePath: user.photo_storage_path,
        photoSyncedAt: user.photo_synced_at,
      })
    }

    return result
  }

  /**
   * Get the raw base64 photo for device sync
   */
  static async getPhotoBase64ForDeviceSync(userId: string): Promise<string | null> {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('photo_storage_path')
        .eq('id', userId)
        .single()

      if (error || !user?.photo_storage_path) {
        return null
      }

      const { data: blob, error: downloadError } = await supabase
        .storage
        .from('user-photos')
        .download(user.photo_storage_path)

      if (downloadError || !blob) {
        console.error('[PhotoService] Failed to download photo:', downloadError)
        return null
      }

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => {
          const result = reader.result as string
          resolve(result.split(',')[1])
        }
        reader.onerror = () => resolve('')
        reader.readAsDataURL(blob)
      })

      return base64
    } catch (error) {
      console.error('[PhotoService] Failed to get photo base64:', error)
      return null
    }
  }

  private static photoQuery(frappeEmployeeId?: string | null): string {
    if (!frappeEmployeeId) return ''
    return `?frappe_employee_id=${encodeURIComponent(frappeEmployeeId)}`
  }

  static async checkPhoto(
    userId: string,
    frappeEmployeeId?: string | null
  ): Promise<{
    exists: boolean
    needsRefresh?: boolean
    photo_cache_status?: string
  }> {
    const response = await fetch(
      `${API_URL}/admin/photo/${userId}/check${PhotoService.photoQuery(frappeEmployeeId)}`,
      { headers: await getAuthHeaders() }
    )
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error || `Check failed: ${response.status}`)
    }
    return response.json()
  }

  static async headCheckPhoto(
    userId: string,
    frappeEmployeeId?: string | null
  ): Promise<{
    exists: boolean
    needsRefresh?: boolean
    photo_cache_status?: string
  }> {
    const response = await fetch(
      `${API_URL}/admin/photo/${userId}/head-check${PhotoService.photoQuery(frappeEmployeeId)}`,
      { headers: await getAuthHeaders() }
    )
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error || `Head check failed: ${response.status}`)
    }
    return response.json()
  }
}