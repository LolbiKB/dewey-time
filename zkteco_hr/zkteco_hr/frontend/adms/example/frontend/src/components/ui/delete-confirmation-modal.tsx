import { useState, useEffect } from 'react'
import { BaseModal } from './base-modal'
import { Button } from './button'
import { Input } from './input'
import { Label } from './label'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'
import { Loader2, Trash2, Shield, Type } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'

interface DeleteConfirmationModalProps {
  /** The item to be deleted */
  item: {
    id: string
    displayName: string
    subtitle?: string
    avatarUrl?: string
    avatarFallback?: string
    showAvatar?: boolean
  } | null
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for modal open state changes */
  onOpenChange: (open: boolean) => void
  /** Handler for delete confirmation */
  onConfirmDelete: (itemId: string) => Promise<void>
  /** Whether deletion is in progress */
  isDeleting?: boolean
  /** Configuration for the modal */
  config: {
    /** Modal title */
    title: string
    /** Modal description */
    description: string
    /** Entity name for messages */
    entityName: string
    /** Success message template (item name will be substituted) */
    successMessage: string
    /** Error message template */
    errorMessage: string
    /** Text to type for confirmation */
    confirmationText: string
    /** Instruction text for what to type */
    confirmationInstruction: string
  }
}

export function DeleteConfirmationModal({
  item,
  isOpen,
  onOpenChange,
  onConfirmDelete,
  isDeleting = false,
  config
}: DeleteConfirmationModalProps) {
  const [confirmationText, setConfirmationText] = useState('')
  const [hasStartedTyping, setHasStartedTyping] = useState(false)

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setConfirmationText('')
      setHasStartedTyping(false)
    }
  }, [isOpen])

  if (!item) return null

  const isConfirmationValid = confirmationText.trim() === config.confirmationText
  const canDelete = isConfirmationValid && hasStartedTyping && !isDeleting

  const handleInputChange = (value: string) => {
    setConfirmationText(value)
    if (!hasStartedTyping && value.length > 0) {
      setHasStartedTyping(true)
    }
  }

  const handleConfirmDelete = async () => {
    if (!canDelete || !item) return

    try {
      await onConfirmDelete(item.id)
      onOpenChange(false)
      toast.success(config.successMessage.replace('{name}', item.displayName), {
        description: `${item.displayName} has been permanently removed from the system.`
      })
    } catch (error) {
      toast.error(config.errorMessage, {
        description: error instanceof Error ? error.message : `An unexpected error occurred while deleting the ${config.entityName}.`
      })
      console.error('Delete failed:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Prevent copy/paste shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c' || e.key === 'v' || e.key === 'x' || e.key === 'a') {
        e.preventDefault()
      }
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    // Disable right-click context menu to prevent copy/paste
    e.preventDefault()
  }

  const modalFooter = (
    <Button
      variant="destructive"
      onClick={handleConfirmDelete}
      disabled={!canDelete}
      title={!canDelete ? "Complete the confirmation to enable deletion" : undefined}
    >
      {isDeleting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Deleting...
        </>
      ) : (
        <>
          <Trash2 className="w-4 h-4 mr-2" />
          Delete {config.entityName}
        </>
      )}
    </Button>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={config.title}
      description={config.description}
      footer={modalFooter}
    >
      {/* Item Information Card */}
      <div className="bg-muted/70 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-3">
          {item.showAvatar !== false && (
            <Avatar className="h-10 w-10">
              <AvatarImage
                className="object-cover"
                src={item.avatarUrl}
                alt={item.displayName}
              />
              <AvatarFallback className="text-sm">
                {item.avatarFallback}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-sm">{item.displayName}</h4>
            </div>
            {item.subtitle && (
              <p className="text-sm text-muted-foreground">{item.subtitle}</p>
            )}
          </div>
        </div>
      </div>

      {/* Security Warning */}
      <div className="rounded-lg py-4 space-y-2">
        <div className="flex gap-3">
          <Shield className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-destructive">
              Security Confirmation Required
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {config.confirmationInstruction} Copy and paste is disabled.
        </p>
      </div>

      {/* Confirmation Input */}
      <div className="space-y-1">
        <div className="space-y-2">
          <Label htmlFor="confirmation" className="text-sm font-medium flex items-center gap-2">
            <Type className="w-4 h-4" />
            Type to confirm:
            <code className="bg-muted px-2 py-1 rounded text-sm">
              {config.confirmationText}
            </code>
          </Label>
          <Input
            id="confirmation"
            type="text"
            value={confirmationText}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onContextMenu={handleContextMenu}
            placeholder="Type the confirmation text here..."
            className={cn(
              "font-mono text-sm",
              hasStartedTyping && (
                isConfirmationValid
                  ? "border-success focus-visible:ring-success"
                  : "border-destructive focus-visible:ring-destructive"
              )
            )}
            disabled={isDeleting}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Validation Feedback */}
        {hasStartedTyping && (
          <div className="flex items-center gap-2 text-sm">
            {isConfirmationValid ? (
              <div className="flex items-center gap-2 text-success">
                Confirmation text matches
              </div>
            ) : (
              <div className="flex items-center gap-2 text-destructive">
                Text does not match exactly
              </div>
            )}
          </div>
        )}
      </div>
    </BaseModal>
  )
}