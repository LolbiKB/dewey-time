import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PhotoService, type ProcessPhotoResult } from '@/services/photo-service'
import { toast } from 'sonner'

// Query key factory
export const photoKeys = {
  all: ['photos'] as const,
  user: (userId: string) => [...photoKeys.all, userId] as const,
  url: (userId: string) => [...photoKeys.user(userId), 'url'] as const,
  status: (userId: string) => [...photoKeys.user(userId), 'status'] as const,
}

/**
 * Hook: Process and store photo from Frappe URL
 * Use this to manually process/refresh a user's photo
 */
export function useProcessPhoto() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, imageUrl }: { userId: string; imageUrl: string }): Promise<ProcessPhotoResult> => {
      const result = await PhotoService.processAndStorePhoto(userId, imageUrl)
      return result
    },
    onSuccess: (result, variables) => {
      // Invalidate photo-related queries
      queryClient.invalidateQueries({ queryKey: photoKeys.user(variables.userId) })
      queryClient.invalidateQueries({ queryKey: ['user-photo', variables.userId] })
      
      if (result.success) {
        toast.success('Photo processed successfully', {
          description: `Size: ${result.processedImage?.size ? (result.processedImage.size / 1024).toFixed(1) : '?'}KB, Dimensions: ${result.processedImage?.width}x${result.processedImage?.height}`,
        })
      } else {
        toast.error('Photo processing failed', {
          description: result.message,
        })
      }
    },
    onError: (error: Error) => {
      toast.error(`Photo processing failed: ${error.message}`)
    },
  })
}

/**
 * Hook: Check if user has cached photo
 */
export function useHasCachedPhoto(userId: string) {
  return useMutation({
    mutationFn: async () => {
      return PhotoService.hasCachedPhoto(userId)
    },
  })
}
