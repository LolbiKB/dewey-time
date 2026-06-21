import { useState, useCallback, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { DepartmentForm } from "../forms/department-form"
import { transformAPIDataForForm } from "@/schemas/department-validation"
import { useDepartmentForModal, useCreateDepartment, useUpdateDepartment } from "@/hooks/use-departments"
import { DataLoadErrorState } from "@/components/ui/error-state-variants"
import { toast } from "sonner"
import type { Department } from "@/services/department-service"

type CreateDepartmentInput = Omit<Department, 'id'>

interface DepartmentModalProps {
  /** Modal mode - determines behavior and UI */
  mode: "create" | "edit"
  /** Department ID for edit mode (required when mode is "edit") */
  departmentId?: number
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for modal open state changes */
  onOpenChange: (open: boolean) => void
  /** Success callback - called after successful create/update */
  onSuccess?: () => void
}

export function DepartmentModal({
  mode,
  departmentId,
  isOpen,
  onOpenChange,
  onSuccess
}: DepartmentModalProps) {
  const isEdit = mode === "edit"
  const [hasChanges, setHasChanges] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<CreateDepartmentInput | null>(null)

  // Always fetch fresh data for edit mode to ensure data accuracy
  const {
    data: department,
    isLoading: isFetchingDepartment,
    error: fetchError,
    refetch: refetchDepartment
  } = useDepartmentForModal(
    departmentId || 0,
    isEdit && !!departmentId && isOpen // Only fetch when editing, have departmentId, and modal is open
  )

  // Mutations
  const createDepartment = useCreateDepartment()
  const updateDepartment = useUpdateDepartment()

  const isMutating = createDepartment.isPending || updateDepartment.isPending

  // Ensure we have the correct department data loaded (prevent stale data from showing)
  const isCorrectDepartmentLoaded = !isEdit || !departmentId || (department && department.id === departmentId)

  // Prepare form default values for edit mode
  const defaultValues = isEdit && department && isCorrectDepartmentLoaded
    ? transformAPIDataForForm(department)
    : undefined

  // Handle loading states
  const isLoading = isFetchingDepartment || isMutating || (isEdit && !isCorrectDepartmentLoaded)

  // Reset hasChanges when modal opens/closes or department changes
  useEffect(() => {
    if (!isOpen || !isEdit) {
      setHasChanges(false)
    }
  }, [isOpen, isEdit, department?.id])

  // Callback to receive change status from DepartmentForm
  const handleChangesDetected = useCallback((changes: boolean) => {
    setHasChanges(changes)
  }, [])

  // Handle error state for edit mode
  if (isEdit && fetchError) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Error Loading Department"
        description="Failed to load department data for editing."
      >
        <DataLoadErrorState
          onRetry={refetchDepartment}
          customMessage="Unable to load department data. Please try again."
        />
      </BaseModal>
    )
  }

  // Show loading state while fetching department data OR if we have stale data from a different department
  if (isEdit && (isFetchingDepartment || !isCorrectDepartmentLoaded)) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Loading..."
        description="Please wait while we load the department data."
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading department data...</p>
        </div>
      </BaseModal>
    )
  }

  const handleSubmit = async (departmentData: CreateDepartmentInput) => {
    // If we have a pending save confirmation, hide it first
    setShowSaveConfirmation(false)

    try {
      if (isEdit && department) {
        // Update existing department
        await updateDepartment.mutateAsync({ id: department.id, department: departmentData })
        onOpenChange(false)
        toast.success('Department updated successfully', {
          description: `${departmentData.name} has been updated.`
        })
      } else {
        // Create new department
        await createDepartment.mutateAsync(departmentData)
        onOpenChange(false)
        toast.success('Department created successfully', {
          description: `${departmentData.name} has been added to the system.`
        })
      }

      onSuccess?.()
    } catch (error) {
      toast.error(isEdit ? 'Failed to update department' : 'Failed to add department', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error("Department operation failed:", error)
    }
  }

  const handleCloseModal = () => {
    if (hasChanges) {
      setShowDiscardConfirmation(true)
    } else {
      onOpenChange(false)
    }
  }

  const handleFormSubmit = async (departmentData: CreateDepartmentInput) => {
    // Store data and show confirmation
    setPendingSubmissionData(departmentData)
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
        title={isEdit ? "Edit Department" : "Add New Department"}
        description={
          isEdit
            ? "Update the department's information below. Required fields are marked with an asterisk (*)."
            : "Add a new department to the system. Required fields are marked with an asterisk (*)."
        }
        footer={
          <Button
            type="submit"
            form={`${isEdit ? 'edit' : 'create'}-department-form`}
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
                : "Add Department"
            }
          </Button>
        }
      >
        <DepartmentForm
          key={isEdit ? departmentId : 'create'}
          formId={`${isEdit ? 'edit' : 'create'}-department-form`}
          defaultValues={defaultValues}
          onSubmit={handleFormSubmit}
          isLoading={isLoading}
          onChangesDetected={isEdit ? handleChangesDetected : undefined}
        />
      </BaseModal>

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title={isEdit ? "Save Changes?" : "Add Department?"}
        message={isEdit
          ? "This will update the department's information in the system."
          : "This will add a new department to the system."
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