/**
 * App notification helpers (Sonner / shadcn).
 * Import `toast` from here or from 'sonner' for advanced APIs (actions, promises).
 * Mount `<Toaster />` once in App — see `@/components/ui/sonner`.
 */
import { toast, type ExternalToast } from 'sonner'
import { UserOperationLockedError } from '@/services/user-service'

export type ToastOptions = ExternalToast

export { toast }

export function notifySuccess(title: string, description?: string, options?: ToastOptions) {
  if (description) {
    return toast.success(title, { description, ...options })
  }
  return toast.success(title, options)
}

export function notifyError(title: string, description?: string, options?: ToastOptions) {
  if (description) {
    return toast.error(title, { description, ...options })
  }
  return toast.error(title, options)
}

export function notifyInfo(title: string, description?: string, options?: ToastOptions) {
  if (description) {
    return toast.info(title, { description, ...options })
  }
  return toast.info(title, options)
}

export function notifyWarning(title: string, description?: string, options?: ToastOptions) {
  if (description) {
    return toast.warning(title, { description, ...options })
  }
  return toast.warning(title, options)
}

export function notifyOperationFailed(action: string, error: unknown, options?: ToastOptions) {
  const description = error instanceof Error ? error.message : String(error)
  return notifyError(`Failed to ${action}`, description, options)
}

export function notifyUserOperationLocked(error: UserOperationLockedError, context: 'sync' | 'enroll') {
  const startedTime = error.startedAt ? new Date(error.startedAt).toLocaleTimeString() : null
  const operationName = error.existingOperation
    ? error.existingOperation.replace(/_/g, ' ').toLowerCase()
    : null

  if (context === 'sync') {
    const title = 'Cannot force sync'
    const description =
      operationName && startedTime
        ? `${operationName} is running (since ${startedTime}). Wait ${error.retryAfter}s.`
        : `Another operation is running. Wait ${error.retryAfter}s.`
    return notifyError(title, description, { duration: 5000 })
  }

  const detail =
    operationName && startedTime
      ? `${operationName} (since ${startedTime})`
      : operationName
        ? operationName
        : error.message.includes('Cannot start')
          ? error.message
          : 'another operation'

  return notifyError(
    `Cannot enroll: ${detail}. Wait ${error.retryAfter}s or cancel sync, then try again.`,
    undefined,
    { duration: 6000 }
  )
}
