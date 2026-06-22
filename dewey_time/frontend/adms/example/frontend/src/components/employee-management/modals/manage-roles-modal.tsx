import { useState, useEffect } from "react"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Shield, Loader2 } from "lucide-react"
import { RolesSelector } from "../shared/roles-selector"
import { toast } from "sonner"
import { UserInfoCard } from "@/components/shared/user-info-card"
import { useEmployeeForModal, useUpdateEmployeeRoles } from "@/hooks/use-employees"

// Types
interface ManageRolesModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  employeeId?: number
  onSuccess?: () => void
}

export function ManageRolesModal({
  isOpen,
  onOpenChange,
  employeeId,
  onSuccess
}: ManageRolesModalProps) {
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)

  // Hook for fetching employee data (self-fetching)
  const {
    data: employee,
    isLoading: isFetchingEmployee
  } = useEmployeeForModal(employeeId || 0, isOpen)

  // Hook for updating employee roles
  const updateRolesMutation = useUpdateEmployeeRoles()

  // Ensure we have the correct employee data loaded (prevent stale data from showing)
  const isCorrectEmployeeLoaded = !employeeId || (employee?.data && employee.data.id === employeeId)

  // Initialize selected roles from employee data
  useEffect(() => {
    if (employee?.data?.users?.user_roles && isCorrectEmployeeLoaded) {
      const roleIds = employee.data.users.user_roles.map((ur: any) => ur.role_id)
      setSelectedRoleIds(roleIds)
      setHasChanges(false)
    }
  }, [employee?.data?.users?.user_roles, isCorrectEmployeeLoaded])



  // Handle role changes from the shared component
  const handleRoleIdsChange = (newRoleIds: number[]) => {
    setSelectedRoleIds(newRoleIds)
    setHasChanges(true)
  }

  const handleSave = async () => {
    if (!employee?.data || !hasChanges) return

    try {
      await updateRolesMutation.mutateAsync({
        employeeId: employee.data.id,
        roles: { roleIds: selectedRoleIds }
      })

      toast.success('Roles updated successfully', {
        description: `Access roles for ${employeeData.users.first_name} ${employeeData.users.last_name} have been updated.`
      })
      setHasChanges(false)
      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      toast.error('Failed to update roles', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error('Failed to save roles:', error)
    }
  }

  const handleSaveClick = () => {
    setShowSaveConfirmation(true)
  }

  const handleConfirmSave = async () => {
    setShowSaveConfirmation(false)
    await handleSave()
  }

  const handleClose = () => {
    if (hasChanges) {
      setShowDiscardConfirmation(true)
      return
    }
    // Reset to original state when closing without changes
    if (employee?.data?.users?.user_roles) {
      const originalRoleIds = employee.data.users.user_roles.map((ur: any) => ur.role_id)
      setSelectedRoleIds(originalRoleIds)
    }
    setHasChanges(false)
    onOpenChange(false)
  }

  const handleDiscardChanges = () => {
    // Reset to original employee roles
    if (employee?.data?.users?.user_roles) {
      const originalRoleIds = employee.data.users.user_roles.map((ur: any) => ur.role_id)
      setSelectedRoleIds(originalRoleIds)
    }
    setHasChanges(false)
    setShowDiscardConfirmation(false)
    onOpenChange(false)
  }

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
        title="Manage Access Roles"
        description={`Update access permissions for ${employeeData.users.first_name} ${employeeData.users.last_name}`}
        footer={
          <Button
            onClick={handleSaveClick}
            disabled={updateRolesMutation.isPending || !hasChanges}
          >
            {updateRolesMutation.isPending ? (
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
        <div className="space-y-6">
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Access Roles
              </CardTitle>
              <CardDescription>
                Assign roles to define what the employee can access and do in the system.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RolesSelector
                key={`roles-selector-${employeeId}`}
                selectedRoleIds={selectedRoleIds}
                onRoleIdsChange={handleRoleIdsChange}
                modalOpen={isOpen}
                disabled={updateRolesMutation.isPending}
              />

            </CardContent>
          </Card>
        </div>
      </BaseModal>

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title="Save Changes?"
        message="This will update the employee's access roles."
        confirmLabel="Save"
        onConfirm={handleConfirmSave}
        onCancel={() => setShowSaveConfirmation(false)}
        isProcessing={updateRolesMutation.isPending}
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