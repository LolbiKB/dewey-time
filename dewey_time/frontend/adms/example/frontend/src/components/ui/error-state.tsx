import * as React from "react"
import { Button } from "./button"

interface ErrorStateProps {
  /** The main error title */
  title?: string
  /** The error message to display */
  message?: string
  /** Custom error object to extract message from */
  error?: Error | unknown
  /** Primary action button text */
  primaryActionText?: string
  /** Primary action handler */
  onPrimaryAction?: () => void
  /** Show secondary action (page refresh) */
  showSecondaryAction?: boolean
  /** Secondary action button text */
  secondaryActionText?: string
  /** Secondary action handler */
  onSecondaryAction?: () => void
  /** Additional CSS classes for container */
  className?: string
}

export function ErrorState({
  title = "Something went wrong",
  message,
  error,
  primaryActionText = "Try Again",
  onPrimaryAction,
  showSecondaryAction = false,
  secondaryActionText = "Refresh Page",
  onSecondaryAction = () => window.location.reload(),
  className = ""
}: ErrorStateProps) {
  // Determine the error message to display
  const errorMessage = React.useMemo(() => {
    if (message) return message
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return 'An unexpected error occurred. Please try again.'
  }, [message, error])

  return (
    <div className={`flex items-center justify-center h-full p-8 ${className}`}>
      <div className="max-w-md w-full text-center space-y-4">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground">
            {errorMessage}
          </p>
        </div>

        {(onPrimaryAction || showSecondaryAction) && (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {onPrimaryAction && (
              <Button onClick={onPrimaryAction}>
                {primaryActionText}
              </Button>
            )}

            {showSecondaryAction && (
              <Button
                variant="outline"
                onClick={onSecondaryAction}
              >
                {secondaryActionText}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}