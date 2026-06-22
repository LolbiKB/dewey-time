import { DeleteConfirmationModal } from '../../ui/delete-confirmation-modal'
import type { Employee } from '../columns'

interface DeleteEmployeeModalProps {
  employee: Employee | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConfirmDelete: (employeeId: string) => Promise<void>
  isDeleting?: boolean
}

export function DeleteEmployeeModal({
  employee,
  isOpen,
  onOpenChange,
  onConfirmDelete,
  isDeleting = false
}: DeleteEmployeeModalProps) {
  if (!employee) return null

  const item = {
    id: employee.id.toString(),
    displayName: `${employee.users.first_name} ${employee.users.last_name}`,
    subtitle: `Employee ID: ${employee.employee_id}`,
    avatarUrl: employee.users.avatar_url,
    avatarFallback: `${employee.users.first_name[0]}${employee.users.last_name[0]}`
  }

  const config = {
    title: "Delete Employee Record",
    description: "This action will permanently remove the employee record.",
    entityName: "Employee",
    successMessage: "Employee record deleted successfully",
    errorMessage: "Failed to delete employee record",
    confirmationText: `${employee.users.first_name} ${employee.users.last_name}`,
    confirmationInstruction: "Type the employee's full name exactly as shown above."
  }

  return (
    <DeleteConfirmationModal
      item={item}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onConfirmDelete={onConfirmDelete}
      isDeleting={isDeleting}
      config={config}
    />
  )
}