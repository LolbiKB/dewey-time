import { ErrorState } from "./error-state"

interface ErrorStateVariantProps {
  onRetry?: () => void
  customMessage?: string
}

// Network/Connection Error
export function NetworkErrorState({ onRetry, customMessage }: ErrorStateVariantProps) {
  return (
    <ErrorState
      title="Connection Failed"
      message={customMessage || "Unable to connect to the server."}
      onPrimaryAction={onRetry}
      primaryActionText="Try Again"
    />
  )
}

// Authentication/Permission Error
export function AuthErrorState({ onRetry, customMessage }: ErrorStateVariantProps) {
  return (
    <ErrorState
      title="Access Denied"
      message={customMessage || "You don't have permission to view this."}
      onPrimaryAction={onRetry}
      primaryActionText="Try Again"
      showSecondaryAction={false}
    />
  )
}

// Server Error
export function ServerErrorState({ onRetry, customMessage }: ErrorStateVariantProps) {
  return (
    <ErrorState
      title="Server Error"
      message={customMessage || "Something went wrong on our end. Please try again."}
      onPrimaryAction={onRetry}
      primaryActionText="Retry"
      showSecondaryAction={false}
    />
  )
}

// Timeout Error
export function TimeoutErrorState({ onRetry, customMessage }: ErrorStateVariantProps) {
  return (
    <ErrorState
      title="Request Timeout"
      message={customMessage || "The request took too long to complete."}
      onPrimaryAction={onRetry}
      primaryActionText="Try Again"
      showSecondaryAction={false}
    />
  )
}

// Generic Data Loading Error (most common for admin pages)
export function DataLoadErrorState({
  onRetry,
  customMessage,
  dataType = "data"
}: ErrorStateVariantProps & { dataType?: string }) {
  return (
    <ErrorState
      title={`Unable to Load ${dataType.charAt(0).toUpperCase() + dataType.slice(1)}`}
      message={customMessage || `We encountered an error while fetching ${dataType}. Please try again.`}
      onPrimaryAction={onRetry}
      primaryActionText="Reload Data"
    />
  )
}