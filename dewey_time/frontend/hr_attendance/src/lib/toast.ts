/**
 * App notification helpers (Sonner). Mirrors frontend/adms/src/lib/toast.ts so
 * both apps report outcomes identically. `<Toaster />` is already mounted once
 * in main.tsx.
 *
 * Use these for mutation OUTCOMES (events). Persistent conditions — an
 * ineligible employee, "editing X's schedule" — stay inline as <Alert>, because
 * they remain true while the user reads them.
 */
import { toast, type ExternalToast } from "sonner";

export type ToastOptions = ExternalToast;

export { toast };

export function notifySuccess(title: string, description?: string, options?: ToastOptions) {
  if (description) return toast.success(title, { description, ...options });
  return toast.success(title, options);
}

export function notifyError(title: string, description?: string, options?: ToastOptions) {
  if (description) return toast.error(title, { description, ...options });
  return toast.error(title, options);
}

export function notifyInfo(title: string, description?: string, options?: ToastOptions) {
  if (description) return toast.info(title, { description, ...options });
  return toast.info(title, options);
}

export function notifyWarning(title: string, description?: string, options?: ToastOptions) {
  if (description) return toast.warning(title, { description, ...options });
  return toast.warning(title, options);
}

export function notifyOperationFailed(action: string, error: unknown, options?: ToastOptions) {
  const description = error instanceof Error ? error.message : String(error);
  return notifyError(`Failed to ${action}`, description, options);
}
