import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogSize,
} from "@/components/ui/dialog"
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
  /** Width preset — defaults to md (512px). */
  size?: DialogSize
}

export function BaseModal({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md"
}: BaseModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {/* Clean canonical layout: header / scrollable body / footer share the
          dialog's p-6 + gap-5; body scrolls only when content is tall. */}
      <DialogContent size={size} className="flex max-h-[85vh] flex-col text-left">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{children}</div>

        {footer && <DialogFooter variant="bar">{footer}</DialogFooter>}
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
  /** Confirmation message (string or custom React content) */
  message: React.ReactNode
  /** Confirm button label */
  confirmLabel?: string
  /** Cancel button label — only renders a cancel button if provided */
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
  cancelLabel,
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
          {typeof message === 'string' ? (
            <DialogDescription>{message}</DialogDescription>
          ) : (
            <div className="text-sm text-muted-foreground pt-1">{message}</div>
          )}
        </DialogHeader>
        <DialogFooter>
          {cancelLabel && (
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={isProcessing}
            >
              {cancelLabel}
            </Button>
          )}
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
