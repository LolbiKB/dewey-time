import imageCompression from 'browser-image-compression'

export interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

export const processAvatar = async (
  originalFile: File,
  cropArea?: CropArea
): Promise<File> => {
  try {
    let fileToProcess = originalFile

    // If crop area is provided, crop the image first
    if (cropArea) {
      fileToProcess = await cropImage(originalFile, cropArea)
    }

    // Process: Resize → Convert → Compress
    const options = {
      maxSizeMB: 0.2, // 200KB max
      maxWidthOrHeight: 400,
      useWebWorker: true,
      fileType: 'image/webp' as const,
      initialQuality: 0.85,
    }

    const processedFile = await imageCompression(fileToProcess, options)
    
    // Rename the file to have .webp extension
    const renamedFile = new File(
      [processedFile], 
      `avatar-${Date.now()}.webp`, 
      { type: 'image/webp' }
    )
    
    return renamedFile
  } catch (error) {
    console.error('Avatar processing failed:', error)
    throw new Error('Failed to process avatar image')
  }
}

const cropImage = async (file: File, cropArea: CropArea): Promise<File> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Canvas context not available'))
      return
    }

    const img = new Image()
    img.onload = () => {
      // Set canvas size to crop area
      canvas.width = cropArea.width
      canvas.height = cropArea.height

      // Draw the cropped portion
      ctx.drawImage(
        img,
        cropArea.x, cropArea.y, cropArea.width, cropArea.height, // Source
        0, 0, cropArea.width, cropArea.height // Destination
      )

      // Convert canvas to blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const croppedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            })
            resolve(croppedFile)
          } else {
            reject(new Error('Failed to create cropped image'))
          }
        },
        file.type,
        0.95 // High quality for intermediate step
      )
    }

    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

export const createImagePreview = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}