import { supabase } from '@/lib/supabase'
import type { ProcessedImage } from '@/lib/image-processor'
import { processImageFromUrl, validateImageForDevice } from '@/lib/image-processor'

const API_BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

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
  processedImage?: ProcessedImage
  errors?: string[]
}

export class PhotoService {
  /**
   * Get auth headers for API requests
   */
  private static async getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session } } = await supabase.auth.getSession()
    
    return {
      'Content-Type': 'application/json',
      ...(session?.access_token && { 'Authorization': `Bearer ${session.access_token}` }),
    }
  }

  /**
   * Fetch and process photo from Frappe URL
   * This is the main method for processing photos for device sync
   */
  static async processAndStorePhoto(
    userId: string,
    imageUrl: string
  ): Promise<ProcessPhotoResult> {
    try {
      console.log(`[PhotoService] Processing photo for user ${userId}`)

      // Step 1: Process the image client-side
      const processedImage = await processImageFromUrl(imageUrl, userId, {
        backgroundColor: '#F5F5F5',
        targetSize: 240,
        maxFileSizeMB: 0.5,
        quality: 0.9,
      })

      console.log(`[PhotoService] Processed: ${processedImage.width}x${processedImage.height}, ${processedImage.size} bytes`)

      // Step 2: Validate the processed image
      const validation = validateImageForDevice(processedImage)
      if (!validation.valid) {
        return {
          success: false,
          message: 'Image validation failed',
          processedImage,
          errors: validation.errors,
        }
      }

      // Step 3: Upload to Supabase Storage via backend
      const uploadResult = await this.uploadProcessedPhoto(userId, processedImage.base64)

      if (!uploadResult.success) {
        return {
          success: false,
          message: uploadResult.message,
          processedImage,
        }
      }

      return {
        success: true,
        message: 'Photo processed and stored successfully',
        processedImage,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('[PhotoService] Photo processing failed:', errorMessage)
      
      // Provide more helpful error messages
      let userMessage = `Photo processing failed: ${errorMessage}`
      if (errorMessage.includes('text/html') || errorMessage.includes('content type')) {
        userMessage = 'The photo URL is no longer valid or the image was removed from Frappe. Please refresh the user data from Frappe to get a new photo URL.'
      } else if (errorMessage.includes('base64') || errorMessage.includes('InvalidCharacterError')) {
        userMessage = 'Could not fetch the photo from Frappe. The photo may have been deleted or the URL has expired. Please refresh the user data from Frappe.'
      } else if (errorMessage.includes('CORS')) {
        userMessage = 'Cannot access the photo due to security restrictions. Please refresh the user data from Frappe to update the photo.'
      }
      
      return {
        success: false,
        message: userMessage,
        errors: [errorMessage],
      }
    }
  }

  /**
   * Upload processed photo to Supabase Storage
   */
  private static async uploadProcessedPhoto(
    userId: string,
    base64Image: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const headers = await this.getAuthHeaders()
      const response = await fetch(
        `${API_BASE_URL}/api-users/${userId}/upload-processed-photo`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ photo_base64: base64Image }),
        }
      )

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        return {
          success: false,
          message: error.error || `Upload failed: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        message: data.message || 'Upload successful',
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Upload failed',
      }
    }
  }

  /**
   * Get public URL for a cached photo
   */
  static async getPhotoUrl(userId: string): Promise<string | null> {
    try {
      // Check if photo is cached
      const { data: user, error } = await supabase
        .from('users')
        .select('photo_storage_path, photo_synced_at')
        .eq('id', userId)
        .single()

      if (error || !user?.photo_storage_path) {
        return null
      }

      // Get public URL (bucket is public)
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
   * This fetches from storage and returns base64
   */
  static async getPhotoBase64ForDeviceSync(userId: string): Promise<string | null> {
    try {
      // Get the storage path
      const { data: user, error } = await supabase
        .from('users')
        .select('photo_storage_path')
        .eq('id', userId)
        .single()

      if (error || !user?.photo_storage_path) {
        return null
      }

      // Download from storage
      const { data: blob, error: downloadError } = await supabase
        .storage
        .from('user-photos')
        .download(user.photo_storage_path)

      if (downloadError || !blob) {
        console.error('[PhotoService] Failed to download photo:', downloadError)
        return null
      }

      // Convert to base64
      const { blobToBase64 } = await import('@/lib/image-processor')
      return await blobToBase64(blob)
    } catch (error) {
      console.error('[PhotoService] Failed to get photo base64:', error)
      return null
    }
  }
}
