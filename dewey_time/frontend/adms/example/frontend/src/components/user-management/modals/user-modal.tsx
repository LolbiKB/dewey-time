import { useState, useCallback, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { UserForm } from "../forms/user-form"
import { transformAPIDataForForm } from "@/schemas/user-validation"
import { useUserForModal, useCreateUser, useUpdateUser } from "@/hooks/use-users"
import { DataLoadErrorState } from "@/components/ui/error-state-variants"
import { toast } from "sonner"
import type { CreateUserData, UpdateUserData } from "@/services/user-service"

interface UserModalProps {
  /** Modal mode - determines behavior and UI */
  mode: "create" | "edit"
  /** User ID for edit mode (required when mode is "edit") */
  userId?: string
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for modal open state changes */
  onOpenChange: (open: boolean) => void
  /** Success callback - called after successful create/update */
  onSuccess?: () => void
}

export function UserModal({
  mode,
  userId,
  isOpen,
  onOpenChange,
  onSuccess
}: UserModalProps) {
  const isEdit = mode === "edit"
  const [hasChanges, setHasChanges] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<CreateUserData | null>(null)

  // Always fetch fresh data for edit mode to ensure data accuracy
  const {
    data: userResponse,
    isLoading: isFetchingUser,
    error: fetchError,
    refetch: refetchUser
  } = useUserForModal(
    userId || '',
    isEdit && !!userId && isOpen // Only fetch when editing, have userId, and modal is open
  )

  // Mutations
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()

  const isMutating = createUser.isPending || updateUser.isPending

  // Extract user data from API response
  const user = userResponse?.data

  // Ensure we have the correct user data loaded (prevent stale data from showing)
  const isCorrectUserLoaded = !isEdit || !userId || (user && user.id === userId)

  // Prepare form default values for edit mode
  const defaultValues = isEdit && user && isCorrectUserLoaded
    ? transformAPIDataForForm(user)
    : undefined

  // Handle loading states
  const isLoading = isFetchingUser || isMutating || (isEdit && !isCorrectUserLoaded)

  // Reset hasChanges when modal opens/closes or user changes
  useEffect(() => {
    if (!isOpen || !isEdit) {
      setHasChanges(false)
    }
  }, [isOpen, isEdit, user?.id])

  // Callback to receive change status from UserForm
  const handleChangesDetected = useCallback((changes: boolean) => {
    setHasChanges(changes)
  }, [])

  // Handle error state for edit mode
  if (isEdit && fetchError) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Error Loading User"
        description="Failed to load user data for editing."
      >
        <DataLoadErrorState
          onRetry={refetchUser}
          customMessage="Unable to load user data. Please try again."
        />
      </BaseModal>
    )
  }

  // Show loading state while fetching user data OR if we have stale data from a different user
  if (isEdit && (isFetchingUser || !isCorrectUserLoaded)) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Loading..."
        description="Please wait while we load the user data."
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading user data...</p>
        </div>
      </BaseModal>
    )
  }

  const handleSubmit = async (userData: CreateUserData) => {
    // If we have a pending save confirmation, hide it first
    setShowSaveConfirmation(false)

    try {
      if (isEdit && user) {
        // Update existing user
        const updateData: UpdateUserData = { ...userData, id: user.id }
        await updateUser.mutateAsync(updateData)
        onOpenChange(false)
        toast.success('User updated successfully', {
          description: `${userData.firstName} ${userData.lastName} has been updated.`
        })
      } else {
        // Create new user
        await createUser.mutateAsync(userData)
        onOpenChange(false)
        toast.success('User created successfully', {
          description: `${userData.firstName} ${userData.lastName} has been added to the system.`
        })
      }

      onSuccess?.()
    } catch (error) {
      toast.error(isEdit ? 'Failed to update user' : 'Failed to add user', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error("User operation failed:", error)
    }
  }

  const handleCloseModal = () => {
    if (hasChanges) {
      setShowDiscardConfirmation(true)
    } else {
      onOpenChange(false)
    }
  }

  const handleFormSubmit = async (userData: CreateUserData) => {
    // Store data and show confirmation
    setPendingSubmissionData(userData)
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
        title={isEdit ? "Edit User" : "Add New User"}
        description={
          isEdit
            ? "Update the user's information below. Required fields are marked with an asterisk (*)."
            : "Add a new user to the system. Required fields are marked with an asterisk (*)."
        }
        footer={
          <Button
            type="submit"
            form={`${isEdit ? 'edit' : 'create'}-user-form`}
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
                : "Add User"
            }
          </Button>
        }
      >
        <UserForm
          key={isEdit ? userId : 'create'}
          formId={`${isEdit ? 'edit' : 'create'}-user-form`}
          defaultValues={defaultValues}
          onSubmit={handleFormSubmit}
          isLoading={isLoading}
          onChangesDetected={isEdit ? handleChangesDetected : undefined}
        />
      </BaseModal>

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title={isEdit ? "Save Changes?" : "Add User?"}
        message={isEdit
          ? "This will update the user's information in the system."
          : "This will add a new user to the system."
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