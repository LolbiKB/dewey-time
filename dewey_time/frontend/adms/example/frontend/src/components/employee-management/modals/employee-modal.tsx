import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { ConfirmationDialog } from "@/components/ui/base-modal"
import { TabBaseModal } from "@/components/ui/tab-base-modal"
import { useEmployeeForm } from "../forms/employee-form"
import { BasicInfoTab } from "../forms/tabs/basic-info-tab"
import { RolesTab } from "../forms/tabs/roles-tab"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { useCreateEmployee } from "@/hooks/use-employees"
import type { EmployeeFormValues } from "@/schemas/employee-validation"

interface EmployeeModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for modal open state changes */
  onOpenChange: (open: boolean) => void
  /** Success callback - called after successful create */
  onSuccess?: () => void

  // Data props (will be replaced with hooks)
  users?: any[]
  termTypes?: any[]
  positionTypes?: any[]
  departmentTypes?: any[]
  isLoadingData?: boolean
}

export function EmployeeModal({
  isOpen,
  onOpenChange,
  onSuccess,
  users = [],
  termTypes = [],
  positionTypes = [],
  departmentTypes = [],
  isLoadingData = false
}: EmployeeModalProps) {
  const [hasChanges, setHasChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<EmployeeFormValues | null>(null)
  const [activeTab, setActiveTab] = useState<string>('basic')

  // Use the create employee hook
  const createEmployeeMutation = useCreateEmployee()

  const handleSubmit = async (values: EmployeeFormValues) => {
    try {
      // Transform form values to match API format
      const employeeData = {
        user_id: values.user_id || '',
        employee_id: values.employee_id,
        hire_term_id: values.hire_term_id || undefined,
        positions: [{
          position_type_id: values.initial_position.position_type_id || 0,
          department_type_id: values.initial_position.department_type_id || 0,
          start_date: values.initial_position.start_date.toISOString().split('T')[0],
          status: 'active' as const
        }],
        roles: values.role_ids || []
      }

      await createEmployeeMutation.mutateAsync(employeeData)

      toast.success('Employee created successfully', {
        description: `Employee ${values.employee_id} has been added to the system.`
      })
      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      toast.error('Failed to add employee', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error('Failed to add employee:', error)
    }
  }

  const handleFormSubmit = async (values: EmployeeFormValues) => {
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

  // Use the employee form hook
  const { form, handleSubmit: onFormSubmit } = useEmployeeForm({
    onSubmit: handleFormSubmit,
    onChangesDetected: handleChangesDetected,
  })

  // Reset form and state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setHasChanges(false)
      setActiveTab('basic')
      form.reset()
    }
  }, [isOpen, form])

  // Define tabs for TabBaseModal - wrapped in Form context
  const tabs = [
    {
      value: 'basic',
      label: 'Basic Info',
      content: (
        <Form {...form}>
          <BasicInfoTab
            form={form}
            users={users}
            termTypes={termTypes}
            positionTypes={positionTypes}
            departmentTypes={departmentTypes}
            isLoading={createEmployeeMutation.isPending}
            isLoadingData={isLoadingData}
          />
        </Form>
      )
    },
    {
      value: 'roles',
      label: 'Access Roles',
      content: (
        <Form {...form}>
          <RolesTab
            form={form}
            isLoading={createEmployeeMutation.isPending}
            isLoadingData={isLoadingData}
          />
        </Form>
      )
    }
  ]

  return (
    <>
      <TabBaseModal
        isOpen={isOpen}
        onOpenChange={handleClose}
        title="Add New Employee"
        description="Add a new employee to the system with their basic information and initial role."
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        footer={
          <Button
            type="submit"
            onClick={form.handleSubmit(onFormSubmit)}
            disabled={createEmployeeMutation.isPending}
          >
            {createEmployeeMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Employee"
            )}
          </Button>
        }
      />

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title="Add Employee?"
        message="This will add a new employee to the system."
        confirmLabel="Add"
        onConfirm={handleConfirmSave}
        onCancel={() => setShowSaveConfirmation(false)}
        isProcessing={createEmployeeMutation.isPending}
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