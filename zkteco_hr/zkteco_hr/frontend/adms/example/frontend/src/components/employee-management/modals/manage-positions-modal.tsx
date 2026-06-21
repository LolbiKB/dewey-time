import { useState, useEffect, useMemo } from "react"
import { formatISO } from "date-fns"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { UserInfoCard } from "@/components/shared/user-info-card"
import { useUpdateEmployeePositions, useEmployeePositionTypesForModal, useEmployeeDepartmentTypesForModal, useEmployeeForModal } from "@/hooks/use-employees"
import { PositionForm } from "../forms/position-form"
import type { PositionManagementFormValues } from "@/schemas/employee-validation"

interface ManagePositionsModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  employeeId?: number
  onSuccess?: () => void
}

export function ManagePositionsModal({
  isOpen,
  onOpenChange,
  employeeId,
  onSuccess
}: ManagePositionsModalProps) {
  const [hasChanges, setHasChanges] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<PositionManagementFormValues | null>(null)

  // Hook for updating positions
  const updatePositionsMutation = useUpdateEmployeePositions()

  // Hook for fetching employee data (self-fetching)
  const {
    data: employee,
    isLoading: isFetchingEmployee
  } = useEmployeeForModal(employeeId || 0, isOpen)

  // Hook for fetching position types (self-fetching)
  const { data: positionTypes = [], isLoading: isLoadingPositionTypes } = useEmployeePositionTypesForModal(isOpen)

  // Hook for fetching department types (self-fetching)
  const { data: departmentTypes = [], isLoading: isLoadingDepartmentTypes } = useEmployeeDepartmentTypesForModal(isOpen)

  // Ensure we have the correct employee data loaded (prevent stale data from showing)
  const isCorrectEmployeeLoaded = !employeeId || (employee?.data && employee.data.id === employeeId)

  // Default values for the form - memoized to prevent unnecessary resets
  const defaultValues: Partial<PositionManagementFormValues> = useMemo(() => ({
    positions: employee?.data?.employee_positions && isCorrectEmployeeLoaded ?
      employee.data.employee_positions.map((pos: any) => ({
        id: pos.id,
        position_type_id: pos.position_type_id,
        department_type_id: pos.department_type_id || undefined,
        start_date: pos.start_date ? new Date(pos.start_date + 'T00:00:00') : new Date(),
        end_date: pos.end_date ? new Date(pos.end_date + 'T00:00:00') : undefined,
        status: pos.status
      })) : []
  }), [employee?.data?.employee_positions, isCorrectEmployeeLoaded])

  const handleSubmit = async (values: PositionManagementFormValues) => {
    if (!employee?.data) return

    setIsLoading(true)
    try {
      // Convert positions to API format
      const positionsToSave = values.positions.map(pos => ({
        id: pos.id,
        position_type_id: pos.position_type_id,
        department_type_id: pos.department_type_id,
        start_date: pos.start_date ? formatISO(pos.start_date).split('T')[0] : '',
        end_date: pos.end_date ? formatISO(pos.end_date).split('T')[0] : undefined,
        status: pos.status
      }))

      await updatePositionsMutation.mutateAsync({
        employeeId: employee.data.id,
        positions: { positions: positionsToSave }
      })

      toast.success('Positions updated successfully', {
        description: `Position history for ${employeeData.users.first_name} ${employeeData.users.last_name} has been updated.`
      })
      setHasChanges(false)
      onSuccess?.()
      onOpenChange(false)
    } catch (error: any) {
      toast.error('Failed to update positions', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error('Failed to save positions:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFormSubmit = async (values: PositionManagementFormValues) => {
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
      setShowDiscardConfirmation(true)
      return
    }
    onOpenChange(false)
  }

  const handleDiscardChanges = () => {
    setShowDiscardConfirmation(false)
    onOpenChange(false)
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

  // Show loading state while fetching employee data OR if we have stale data from a different employee
  if (isFetchingEmployee || !isCorrectEmployeeLoaded) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Loading..."
        description="Please wait while we load the employee data."
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading employee data...</p>
        </div>
      </BaseModal>
    )
  }

  if (!employee?.data) return null

  const employeeData = employee.data

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onOpenChange={handleClose}
        title="Manage Positions"
        description={`Update position history for ${employeeData.users.first_name} ${employeeData.users.last_name}`}
        footer={
          <Button
            type="submit"
            form="position-form"
            disabled={isLoading || !hasChanges}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        }
      >
        <div className="space-y-4">
          {/* Employee Info Header */}
          <UserInfoCard
            firstName={employeeData.users.first_name}
            lastName={employeeData.users.last_name}
            khmerFirstName={employeeData.users.khmer_first_name}
            khmerLastName={employeeData.users.khmer_last_name}
            email={employeeData.users.email}
            avatarUrl={employeeData.users.avatar_url}
            idLabel="ID:"
            idValue={employeeData.employee_id}
          />

          {/* Position Form */}
          {employee?.data?.employee_positions && (
            <PositionForm
              key={`position-form-${employee.data.id}-${employee.data.employee_positions.length}`}
              defaultValues={defaultValues}
              onSubmit={handleFormSubmit}
              isLoading={isLoading}
              formId="position-form"
              onChangesDetected={handleChangesDetected}
              positionTypes={positionTypes}
              departmentTypes={departmentTypes}
              isLoadingPositionTypes={isLoadingPositionTypes}
              isLoadingDepartmentTypes={isLoadingDepartmentTypes}
            />
          )}
        </div>
      </BaseModal>

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title="Save Changes?"
        message="This will update the employee's position history."
        confirmLabel="Save"
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