import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

interface BaseModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for open state changes */
  onOpenChange: (open: boolean) => void
  /** Modal title */
  title: string
  /** Optional modal description */
  description?: string
  /** Modal content */
  children: React.ReactNode
  /** Optional footer content (buttons, actions) */
  footer?: React.ReactNode
}

export function BaseModal({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  footer
}: BaseModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0">
        <DialogHeader className="contents space-y-0 text-left">
          {/* Sticky Header with Title and Description */}
          <div className="border-b">
            <DialogTitle className="px-6 pt-6">{title}</DialogTitle>
            {description && (
              <DialogDescription className="px-6 pt-2 pb-3">
                {description}
              </DialogDescription>
            )}
          </div>

          {/* Scrollable Content Only */}
          <ScrollArea className="flex max-h-full flex-col overflow-hidden">
            <div className="px-6 pt-4 pb-6">
              {children}
            </div>
          </ScrollArea>
        </DialogHeader>

        {/* Sticky Footer */}
        {footer && (
          <DialogFooter className="flex-row items-center justify-end border-t px-6 py-4">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Reusable Confirmation Dialog Component
interface ConfirmationDialogProps {
  /** Whether the confirmation dialog is open */
  isOpen: boolean
  /** Confirmation title */
  title: string
  /** Confirmation message */
  message: string
  /** Confirm button label */
  confirmLabel?: string
  /** Cancel button label */
  cancelLabel?: string
  /** Button variant for confirm button */
  variant?: 'default' | 'destructive' | 'ghost' | 'secondary' | "outline"
  /** Whether the action is processing */
  isProcessing?: boolean
  /** Handler for confirm action */
  onConfirm: () => void | Promise<void>
  /** Handler for cancel action */
  onCancel: () => void
}

export function ConfirmationDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  isProcessing = false,
  onConfirm,
  onCancel
}: ConfirmationDialogProps) {
  const handleConfirm = async () => {
    await onConfirm()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={isProcessing}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={handleConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}