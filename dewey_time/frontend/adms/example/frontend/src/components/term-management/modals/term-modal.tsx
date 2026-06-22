import { useState, useCallback, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { TermForm } from "../forms/term-form"
import { transformAPIDataForForm, type CreateTermInput } from "@/schemas/term-validation"
import { useTermForModal, useCreateTerm, useUpdateTerm } from "@/hooks/use-terms"
import { DataLoadErrorState } from "@/components/ui/error-state-variants"
import { toast } from "sonner"

interface TermModalProps {
  /** Modal mode - determines behavior and UI */
  mode: "create" | "edit"
  /** Term ID for edit mode (required when mode is "edit") */
  termId?: number
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for modal open state changes */
  onOpenChange: (open: boolean) => void
  /** Success callback - called after successful create/update */
  onSuccess?: () => void
}

export function TermModal({
  mode,
  termId,
  isOpen,
  onOpenChange,
  onSuccess
}: TermModalProps) {
  const isEdit = mode === "edit"
  const [hasChanges, setHasChanges] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<CreateTermInput | null>(null)

  // Always fetch fresh data for edit mode to ensure data accuracy
  const {
    data: term,
    isLoading: isFetchingTerm,
    error: fetchError,
    refetch: refetchTerm
  } = useTermForModal(
    termId || 0,
    isEdit && !!termId && isOpen // Only fetch when editing, have termId, and modal is open
  )

  // Mutations
  const createTerm = useCreateTerm()
  const updateTerm = useUpdateTerm()

  const isMutating = createTerm.isPending || updateTerm.isPending

  // Ensure we have the correct term data loaded (prevent stale data from showing)
  const isCorrectTermLoaded = !isEdit || !termId || (term && term.id === termId)

  // Prepare form default values for edit mode
  const defaultValues = isEdit && term && isCorrectTermLoaded
    ? transformAPIDataForForm(term)
    : undefined

  // Handle loading states
  const isLoading = isFetchingTerm || isMutating || (isEdit && !isCorrectTermLoaded)

  // Reset hasChanges when modal opens/closes or term changes
  useEffect(() => {
    if (!isOpen || !isEdit) {
      setHasChanges(false)
    }
  }, [isOpen, isEdit, term?.id])

  // Callback to receive change status from TermForm
  const handleChangesDetected = useCallback((changes: boolean) => {
    setHasChanges(changes)
  }, [])

  // Handle error state for edit mode
  if (isEdit && fetchError) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Error Loading Term"
        description="Failed to load term data for editing."
      >
        <DataLoadErrorState
          onRetry={refetchTerm}
          customMessage="Unable to load term data. Please try again."
        />
      </BaseModal>
    )
  }

  // Show loading state while fetching term data OR if we have stale data from a different term
  if (isEdit && (isFetchingTerm || !isCorrectTermLoaded)) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Loading..."
        description="Please wait while we load the term data."
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading term data...</p>
        </div>
      </BaseModal>
    )
  }

  const handleSubmit = async (termData: CreateTermInput) => {
    // If we have a pending save confirmation, hide it first
    setShowSaveConfirmation(false)

    try {
      if (isEdit && term) {
        // Update existing term
        await updateTerm.mutateAsync({ id: term.id, term: termData })
        onOpenChange(false)
        toast.success('Term updated successfully', {
          description: `${termData.name} has been updated.`
        })
      } else {
        // Create new term
        await createTerm.mutateAsync(termData)
        onOpenChange(false)
        toast.success('Term created successfully', {
          description: `${termData.name} has been added to the system.`
        })
      }

      onSuccess?.()
    } catch (error) {
      toast.error(isEdit ? 'Failed to update term' : 'Failed to add term', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error("Term operation failed:", error)
    }
  }

  const handleCloseModal = () => {
    if (hasChanges) {
      setShowDiscardConfirmation(true)
    } else {
      onOpenChange(false)
    }
  }

  const handleFormSubmit = async (termData: CreateTermInput) => {
    // Store data and show confirmation
    setPendingSubmissionData(termData)
    setShowSaveConfirmation(true)
  }

  const handleConfirmSave = async () => {
    setShowSaveConfirmation(false)
    if (pendingSubmissionData) {
      await handleSubmit(pendingSubmissionData)
      setPendingSubmissionData(null)
    }
  }

  const handleDiscardChanges = () => {
    setShowDiscardConfirmation(false)
    onOpenChange(false)
  }

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onOpenChange={handleCloseModal}
        title={isEdit ? "Edit Term" : "Add New Term"}
        description={
          isEdit
            ? "Update the term's information below. Required fields are marked with an asterisk (*)."
            : "Add a new term to the system. Required fields are marked with an asterisk (*)."
        }
        footer={
          <Button
            type="submit"
            form={`${isEdit ? 'edit' : 'create'}-term-form`}
            disabled={isLoading || (isEdit && !hasChanges)}
            title={isEdit && !hasChanges ? "Make changes to enable saving" : undefined}
          >
            {isLoading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {isLoading
              ? "Please wait"
              : isEdit
                ? (hasChanges ? "Save Changes" : "No Changes")
                : "Add Term"
            }
          </Button>
        }
      >
        <TermForm
          key={isEdit ? termId : 'create'}
          formId={`${isEdit ? 'edit' : 'create'}-term-form`}
          defaultValues={defaultValues}
          onSubmit={handleFormSubmit}
          isLoading={isLoading}
          onChangesDetected={isEdit ? handleChangesDetected : undefined}
        />
      </BaseModal>

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title={isEdit ? "Save Changes?" : "Add Term?"}
        message={isEdit
          ? "This will update the term's information in the system."
          : "This will add a new term to the system."
        }
        confirmLabel={isEdit ? "Save" : "Add"}
        onConfirm={handleConfirmSave}
        onCancel={() => setShowSaveConfirmation(false)}
        isProcessing={isLoading}
      />

      {/* Discard Changes Confirmation */}
      <ConfirmationDialog
        isOpen={showDiscardConfirmation}
        title="Discard Changes?"
        message="You have unsaved changes. Are you sure you want to close without saving?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onConfirm={handleDiscardChanges}
        onCancel={() => setShowDiscardConfirmation(false)}
      />
    </>
  )
}
