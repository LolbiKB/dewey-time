import { DeleteConfirmationModal } from '../../ui/delete-confirmation-modal'
import type { Student } from '../columns'

interface DeleteStudentModalProps {
  student: Student | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConfirmDelete: (studentId: string) => Promise<void>
  isDeleting?: boolean
}

export function DeleteStudentModal({
  student,
  isOpen,
  onOpenChange,
  onConfirmDelete,
  isDeleting = false
}: DeleteStudentModalProps) {
  if (!student) return null

  const item = {
    id: student.id.toString(),
    displayName: `${student.users.first_name} ${student.users.last_name}`,
    subtitle: `Student ID: ${student.student_id}`,
    avatarUrl: student.users.avatar_url,
    avatarFallback: `${student.users.first_name[0]}${student.users.last_name[0]}`
  }

  const config = {
    title: "Delete Student Record",
    description: "This action will permanently remove the student record.",
    entityName: "Student",
    successMessage: "Student record deleted successfully",
    errorMessage: "Failed to delete student record",
    confirmationText: `${student.users.first_name} ${student.users.last_name}`,
    confirmationInstruction: "Type the student's full name exactly as shown above."
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
