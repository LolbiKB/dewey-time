import imageCompression from 'browser-image-compression'

export interface ImageProcessingOptions {
  /** Background color in hex (default: #F5F5F5) */
  backgroundColor?: string
  /** Target size in pixels (default: 240) */
  targetSize?: number
  /** Max file size in MB (default: 0.5 = 500KB) */
  maxFileSizeMB?: number
  /** JPEG quality 0-1 (default: 0.9) */
  quality?: number
}

export interface ProcessedImage {
  /** Processed image as Blob */
  blob: Blob
  /** Base64 string without data URL prefix */
  base64: string
  /** Data URL for display */
  dataUrl: string
  /** Final dimensions */
  width: number
  height: number
  /** File size in bytes */
  size: number
}

/**
 * Fetch image from URL with proper CORS handling
 * Uses the backend API as a proxy to avoid CORS issues
 */
export async function fetchImageAsBlob(
  imageUrl: string,
  userId?: string
): Promise<Blob> {
  // If it's a data URL, convert directly
  if (imageUrl.startsWith('data:')) {
    return dataUrlToBlob(imageUrl)
  }

  // For registered users, try to fetch through our backend to avoid CORS
  if (userId) {
    try {
      console.log(`[image-processor] Fetching via backend for user ${userId}`)
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-users/${userId}/photo`,
        {
          headers: {
            'Authorization': `Bearer ${(await getSessionToken())}`,
          },
        }
      )

      if (response.ok) {
        const data = await response.json()
        console.log(`[image-processor] Backend response:`, data.contentType || 'no content type', data.base64 ? 'has base64' : 'no base64', 'error:', data.error || 'none')
        if (data.error) {
          console.warn(`[image-processor] Backend returned error:`, data.error)
          // Continue to direct fetch fallback
        } else if (data.base64) {
          // Validate base64 looks reasonable (should be reasonably long for an image)
          if (data.base64.length < 100) {
            console.warn(`[image-processor] Backend base64 too short (${data.base64.length} chars), likely invalid`)
          } else {
            return base64ToBlob(data.base64, data.contentType || 'image/jpeg')
          }
        }
      } else {
        const errorText = await response.text().catch(() => 'unknown error')
        console.warn(`[image-processor] Backend fetch failed: ${response.status} ${response.statusText}`, errorText.slice(0, 200))
      }
    } catch (error) {
      console.warn('[image-processor] Backend fetch failed, trying direct:', error)
    }
  }

  // Fallback: try direct fetch (may fail due to CORS)
  try {
    console.log(`[image-processor] Fetching from URL: ${imageUrl.slice(0, 100)}...`)
    const response = await fetch(imageUrl, {
      mode: 'cors',
      credentials: 'omit',
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const blob = await response.blob()
    console.log(`[image-processor] Fetched blob: type=${blob.type}, size=${blob.size}`)
    return blob
  } catch (error) {
    throw new Error(
      `Failed to fetch image. This is likely a CORS issue. ` +
      `Try refreshing the photo from Frappe first. Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Process image for ZKTeco device requirements:
 * - JPEG format
 * - Exact 240x240 pixels
 * - Light gray background
 * - Under 500KB
 */
export async function processImageForDevice(
  imageBlob: Blob,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage> {
  const {
    backgroundColor = '#F5F5F5',
    targetSize = 240,
    maxFileSizeMB = 0.5,
    quality = 0.9,
  } = options

  // Validate blob is actually an image
  if (!imageBlob.type || !imageBlob.type.startsWith('image/')) {
    // Try to peek at the blob content for debugging
    const textPreview = await imageBlob.slice(0, 100).text().catch(() => 'binary data')
    console.error(`[image-processor] Invalid blob type: "${imageBlob.type}", size: ${imageBlob.size}, preview:`, textPreview.slice(0, 50))
    throw new Error(`Invalid content type: expected image/*, got "${imageBlob.type || 'empty'}"`)
  }

  console.log(`[image-processor] Processing blob: type=${imageBlob.type}, size=${imageBlob.size} bytes`)

  // Step 1: Compress and resize using browser-image-compression
  const compressionOptions = {
    maxWidthOrHeight: targetSize,
    maxSizeMB: maxFileSizeMB,
    useWebWorker: true,
    fileType: 'image/jpeg' as const,
    initialQuality: quality,
    alwaysKeepResolution: false,
  }

  let processedBlob: Blob | File = await imageCompression(imageBlob as File, compressionOptions)

  // Step 2: Apply exact dimensions and background using Canvas
  processedBlob = await applyCanvasProcessing(processedBlob as Blob, {
    targetSize,
    backgroundColor,
    quality,
  })

  // Step 3: Convert to base64
  const base64 = await blobToBase64(processedBlob)
  const dataUrl = `data:image/jpeg;base64,${base64}`

  // Step 4: Verify dimensions and size
  const dimensions = await getImageDimensions(dataUrl)

  return {
    blob: processedBlob,
    base64,
    dataUrl,
    width: dimensions.width,
    height: dimensions.height,
    size: processedBlob.size,
  }
}

/**
 * Process image from URL (convenience method)
 */
export async function processImageFromUrl(
  imageUrl: string,
  userId?: string,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage> {
  console.log(`[image-processor] Starting processing for URL: ${imageUrl.slice(0, 100)}${imageUrl.length > 100 ? '...' : ''}`)
  const blob = await fetchImageAsBlob(imageUrl, userId)
  return processImageForDevice(blob, options)
}

/**
 * Apply Canvas processing to ensure exact dimensions and background
 */
async function applyCanvasProcessing(
  imageBlob: Blob | File,
  options: {
    targetSize: number
    backgroundColor: string
    quality: number
  }
): Promise<Blob> {
  const { targetSize, backgroundColor, quality } = options

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(imageBlob)

    img.onload = () => {
      try {
        // Create canvas with exact target dimensions
        const canvas = document.createElement('canvas')
        canvas.width = targetSize
        canvas.height = targetSize
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          URL.revokeObjectURL(url)
          reject(new Error('Failed to get canvas context'))
          return
        }

        // Fill background
        ctx.fillStyle = backgroundColor
        ctx.fillRect(0, 0, targetSize, targetSize)

        // Calculate centered crop to maintain aspect ratio
        const aspectRatio = img.width / img.height
        let drawWidth = targetSize
        let drawHeight = targetSize
        let offsetX = 0
        let offsetY = 0

        if (aspectRatio > 1) {
          // Image is wider than tall
          drawHeight = targetSize / aspectRatio
          offsetY = (targetSize - drawHeight) / 2
        } else if (aspectRatio < 1) {
          // Image is taller than wide
          drawWidth = targetSize * aspectRatio
          offsetX = (targetSize - drawWidth) / 2
        }

        // Draw image centered on background
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight)

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url)
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error('Canvas toBlob returned null'))
            }
          },
          'image/jpeg',
          quality
        )
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for canvas processing'))
    }

    img.src = url
  })
}

/**
 * Convert Blob to base64 string (without data URL prefix)
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read blob as base64'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Convert base64 string to Blob
 */
export function base64ToBlob(base64: string, contentType: string = 'image/jpeg'): Blob {
  try {
    // Remove any data URL prefix if present
    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '')
    
    const byteCharacters = atob(cleanBase64)
    const byteNumbers = new Array(byteCharacters.length)
    
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    
    const byteArray = new Uint8Array(byteNumbers)
    return new Blob([byteArray], { type: contentType })
  } catch (error) {
    throw new Error(`Invalid base64 data: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}

/**
 * Convert data URL to Blob
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',')
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg'
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  
  return new Blob([u8arr], { type: mime })
}

/**
 * Get image dimensions from data URL
 */
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.width, height: img.height })
    }
    img.onerror = () => reject(new Error('Failed to get image dimensions'))
    img.src = dataUrl
  })
}

/**
 * Get Supabase session token
 */
async function getSessionToken(): Promise<string> {
  // Import dynamically to avoid circular dependencies
  const { supabase } = await import('./supabase')
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || ''
}

/**
 * Validate if image meets device requirements
 */
export function validateImageForDevice(processedImage: ProcessedImage): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (processedImage.width !== 240 || processedImage.height !== 240) {
    errors.push(`Dimensions must be exactly 240x240px, got ${processedImage.width}x${processedImage.height}`)
  }

  if (processedImage.size > 500 * 1024) {
    errors.push(`File size must be under 500KB, got ${(processedImage.size / 1024).toFixed(1)}KB`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
