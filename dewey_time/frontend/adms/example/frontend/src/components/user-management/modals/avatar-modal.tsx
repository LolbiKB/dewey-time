import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import type { User } from "../columns"

interface AvatarModalProps {
  user: User | null
  isOpen: boolean
  onClose: () => void
}

export function AvatarModal({ user, isOpen, onClose }: AvatarModalProps) {
  if (!user) return null

  const fullName = `${user.firstName} ${user.lastName}`
  const initials = `${user.firstName[0]}${user.lastName[0]}`

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">Profile</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center space-y-4 py-4">
          <Avatar className="h-64 w-64 ring-4 ring-primary/10">
            <AvatarImage
              src={user.avatarUrl}
              alt={fullName}
              className="object-cover"
            />
            <AvatarFallback className="text-4xl font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="text-center space-y-1">
            <p className="font-medium text-lg">{fullName}</p>
            {user.khmerFirstName && user.khmerLastName && (
              <p className="text-muted-foreground">
                {user.khmerLastName} {user.khmerFirstName}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}