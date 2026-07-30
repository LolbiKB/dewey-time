import { getAuthHeaders } from '@/lib/auth-token'

export interface ProcessPhotoResult {
  success: boolean
  message: string
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

      // The bridge returns photo_storage_path (plus processedImage dimensions);
      // there is no photo_url in the response.
      const result = await response.json()
      console.log(`[PhotoService] Success: ${result.photo_storage_path}`)

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