import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PhotoService, type ProcessPhotoResult } from '@/services/photo-service'
import { notifyError, notifyOperationFailed, notifySuccess } from '@/lib/toast'

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
    mutationFn: async ({ userId }: { userId: string }): Promise<ProcessPhotoResult> => {
      const result = await PhotoService.processAndStorePhoto(userId)
      return result
    },
    onSuccess: (result, variables) => {
      // Invalidate photo-related queries
      queryClient.invalidateQueries({ queryKey: photoKeys.user(variables.userId) })
      queryClient.invalidateQueries({ queryKey: ['user-photo', variables.userId] })
      
      if (result.success) {
        notifySuccess(
          'Photo processed successfully',
          `Size: ${result.processedImage?.size ? (result.processedImage.size / 1024).toFixed(1) : '?'}KB, ${result.processedImage?.width}x${result.processedImage?.height}`
        )
      } else {
        notifyError('Photo processing failed', result.message)
      }
    },
    onError: (error: Error) => {
      notifyOperationFailed('process photo', error)
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
