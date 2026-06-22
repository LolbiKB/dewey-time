import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { ProgramForm } from "../forms/program-form"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  useCreateProgram,
  useUpdateProgram,
  useProgramForModal,
  useProgramDegreeTypesForModal,
  useProgramDepartmentTypesForModal
} from "@/hooks/use-programs"
import type { ProgramFormValues } from "@/schemas/program-validation"
import type { Program } from "../columns"

interface ProgramModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for modal open state changes */
  onOpenChange: (open: boolean) => void
  /** Success callback - called after successful create/update */
  onSuccess?: () => void
  /** Program to edit (if provided, switches to edit mode) */
  program?: Program | null
  /** Modal mode */
  mode?: 'create' | 'edit'
}

export function ProgramModal({
  isOpen,
  onOpenChange,
  onSuccess,
  program = null,
  mode = program ? 'edit' : 'create'
}: ProgramModalProps) {
  const [hasChanges, setHasChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<ProgramFormValues | null>(null)

  // Fetch fresh program data for edit mode
  const { data: fetchedProgram, isLoading: isFetchingProgram } = useProgramForModal(
    program?.id,
    mode === 'edit' && !!program?.id && isOpen
  )

  // Fetch dropdown data - always fresh when modal opens
  const { data: degreeTypesData, isLoading: isLoadingDegrees } = useProgramDegreeTypesForModal(isOpen)
  const { data: departmentTypesData, isLoading: isLoadingDepartments } = useProgramDepartmentTypesForModal(isOpen)

  // Use the create/update program hooks
  const createProgramMutation = useCreateProgram()
  const updateProgramMutation = useUpdateProgram()

  // Use fetched program data in edit mode, fallback to prop
  const programData = mode === 'edit' && fetchedProgram ? fetchedProgram : program

  // Ensure we have the correct program data loaded (prevent stale data from showing)
  const isCorrectProgramLoaded = mode !== 'edit' || !program?.id || (programData && programData.id === program.id)

  const isLoadingData = isLoadingDegrees || isLoadingDepartments || isFetchingProgram
  const isMutating = createProgramMutation.isPending || updateProgramMutation.isPending

  const handleSubmit = async (values: ProgramFormValues) => {
    try {
      if (mode === 'edit' && programData) {
        // Update existing program
        await updateProgramMutation.mutateAsync({
          id: programData.id,
          data: {
            major: values.major,
            description: values.description,
            degree_id: values.degree_id,
            department_type_id: values.department_type_id,
          }
        })

        toast.success('Program updated successfully', {
          description: `${values.major} has been updated.`
        })
      } else {
        // Create new program
        await createProgramMutation.mutateAsync({
          major: values.major,
          description: values.description,
          degree_id: values.degree_id,
          department_type_id: values.department_type_id,
        })

        toast.success('Program created successfully', {
          description: `${values.major} has been added to the system.`
        })
      }

      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      const action = mode === 'edit' ? 'update' : 'add'
      toast.error(`Failed to ${action} program`, {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error(`Failed to ${action} program:`, error)
    }
  }

  const handleFormSubmit = async (values: ProgramFormValues) => {
    // Store data and show confirmation
    setPendingSubmissionData(values)
    setShowSaveConfirmation(true)
  }

  const handleConfirmSave = async () => {
    setShowSaveConfirmation(false)
    if (pendingSubmissionData) {
      await handleSubmit(pendingSubmissionData)
      setPendingSubmissionData(null)
    }
  }

  const handleClose = () => {
    if (hasChanges) {
      setShowConfirmClose(true)
      return
    }
    onOpenChange(false)
  }

  const handleConfirmClose = () => {
    setShowConfirmClose(false)
    onOpenChange(false)
  }

  const handleCancelClose = () => {
    setShowConfirmClose(false)
  }

  const handleChangesDetected = (changes: boolean) => {
    setHasChanges(changes)
  }

  // Reset changes state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setHasChanges(false)
    }
  }, [isOpen])

  // Prepare default values for edit mode
  const defaultValues: Partial<ProgramFormValues> | undefined = programData ? {
    major: programData.major,
    description: programData.description || "",
    degree_id: programData.degree_id || undefined,
    department_type_id: programData.department_type_id || undefined,
  } : undefined

  // Show loading state while fetching program data OR if we have stale data from a different program
  if (mode === 'edit' && (isFetchingProgram || !isCorrectProgramLoaded)) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Loading..."
        description="Please wait while we load the program data."
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading program data...</p>
        </div>
      </BaseModal>
    )
  }

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onOpenChange={handleClose}
        title={mode === 'edit' ? 'Edit Program' : 'Add New Program'}
        description={
          mode === 'edit'
            ? 'Update the program information.'
            : 'Add a new academic program to the system.'
        }
        footer={
          <Button
            type="submit"
            form="program-form"
            disabled={isMutating || (mode === 'edit' && !hasChanges)}
            title={mode === 'edit' && !hasChanges ? "Make changes to enable saving" : undefined}
          >
            {isMutating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {mode === 'edit' ? 'Updating...' : 'Adding...'}
              </>
            ) : (
              mode === 'edit'
                ? (hasChanges ? 'Save Changes' : 'No Changes')
                : 'Add Program'
            )}
          </Button>
        }
      >
        <ProgramForm
          key={programData?.id ?? 'create'}
          defaultValues={defaultValues}
          onSubmit={handleFormSubmit}
          isLoading={isMutating}
          formId="program-form"
          onChangesDetected={handleChangesDetected}
          degreeTypes={degreeTypesData || []}
          departmentTypes={departmentTypesData || []}
          isLoadingData={isLoadingData}
        />
      </BaseModal>

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title={mode === 'edit' ? 'Update Program?' : 'Add Program?'}
        message={
          mode === 'edit'
            ? 'This will update the program information.'
            : 'This will add a new program to the system.'
        }
        confirmLabel={mode === 'edit' ? 'Update' : 'Add'}
        onConfirm={handleConfirmSave}
        onCancel={() => setShowSaveConfirmation(false)}
        isProcessing={isMutating}
      />

      {/* Discard Changes Confirmation */}
      <ConfirmationDialog
        isOpen={showConfirmClose}
        title="Discard Changes?"
        message="You have unsaved changes. Are you sure you want to close without saving?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onConfirm={handleConfirmClose}
        onCancel={handleCancelClose}
      />
    </>
  )
}
