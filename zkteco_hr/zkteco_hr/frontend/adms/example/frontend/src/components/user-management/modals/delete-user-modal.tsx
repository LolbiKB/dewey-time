import { DeleteConfirmationModal } from '../../ui/delete-confirmation-modal'
import type { User } from '../columns'

interface DeleteUserModalProps {
  user: User | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onConfirmDelete: (userId: string) => Promise<void>
  isDeleting?: boolean
}

export function DeleteUserModal({
  user,
  isOpen,
  onOpenChange,
  onConfirmDelete,
  isDeleting = false
}: DeleteUserModalProps) {
  if (!user) return null

  const item = {
    id: user.id,
    displayName: `${user.firstName} ${user.lastName}`,
    subtitle: user.email,
    avatarUrl: user.avatarUrl,
    avatarFallback: `${user.firstName[0]}${user.lastName[0]}`
  }

  const config = {
    title: "Delete User Account",
    description: "This action will permanently remove the user record.",
    entityName: "User",
    successMessage: "User deleted successfully",
    errorMessage: "Failed to delete user",
    confirmationText: `${user.firstName} ${user.lastName}`,
    confirmationInstruction: "Type the user's full name exactly as shown above."
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