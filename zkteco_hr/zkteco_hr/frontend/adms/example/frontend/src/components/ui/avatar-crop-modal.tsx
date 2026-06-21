import { useState, useRef, useCallback } from "react"
import ReactCrop, {
  centerCrop,
  makeAspectCrop
} from 'react-image-crop'
import type { Crop, PixelCrop } from 'react-image-crop'
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { processAvatar, createImagePreview } from "@/utils/imageProcessor"
import type { CropArea } from "@/utils/imageProcessor"
import 'react-image-crop/dist/ReactCrop.css'

interface AvatarCropModalProps {
  isOpen: boolean
  onClose: () => void
  imageSrc: string
  onCropComplete: (processedFile: File, previewUrl: string) => void
  originalFile: File
}

function centerAspectCrop(
  mediaWidth: number,
  mediaHeight: number,
  aspect: number,
) {
  return centerCrop(
    makeAspectCrop(
      {
        unit: '%',
        width: 90,
      },
      aspect,
      mediaWidth,
      mediaHeight,
    ),
    mediaWidth,
    mediaHeight,
  )
}

export function AvatarCropModal({
  isOpen,
  onClose,
  imageSrc,
  onCropComplete,
  originalFile,
}: AvatarCropModalProps) {
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [isProcessing, setIsProcessing] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    setCrop(centerAspectCrop(width, height, 1))
  }, [])

  const handleCropComplete = async () => {
    if (!completedCrop || !imgRef.current || !originalFile) return

    setIsProcessing(true)

    try {
      // Convert crop coordinates to pixel values for the original image
      const scaleX = imgRef.current.naturalWidth / imgRef.current.width
      const scaleY = imgRef.current.naturalHeight / imgRef.current.height

      const cropArea: CropArea = {
        x: completedCrop.x * scaleX,
        y: completedCrop.y * scaleY,
        width: completedCrop.width * scaleX,
        height: completedCrop.height * scaleY,
      }

      // Process the image: crop → resize → convert → compress
      const processedFile = await processAvatar(originalFile, cropArea)

      // Create preview URL for the processed image
      const previewUrl = await createImagePreview(processedFile)

      onCropComplete(processedFile, previewUrl)
      // Don't call onClose() here - let the parent component handle closing
    } catch (error) {
      console.error('Crop processing failed:', error)
      // Handle error - maybe show toast notification
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Crop Your Profile Picture</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-center">
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              onComplete={(c) => setCompletedCrop(c)}
              aspect={1}
              circularCrop
              keepSelection
              style={{ maxWidth: '100%', maxHeight: '60vh' }}
            >
              <img
                ref={imgRef}
                alt="Crop preview"
                src={imageSrc}
                style={{ maxWidth: '100%', height: 'auto' }}
                onLoad={onImageLoad}
              />
            </ReactCrop>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleCropComplete}
            disabled={!completedCrop || isProcessing}
          >
            {isProcessing ? "Processing..." : "Use This Crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}