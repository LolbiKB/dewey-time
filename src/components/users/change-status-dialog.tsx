import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2 } from 'lucide-react'
import type { UserEntry } from '@/services/user-service'
import { UserService } from '@/services/user-service'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { notifyError, notifySuccess } from '@/lib/toast'

interface ChangeStatusDialogProps {
  user: UserEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type UserStatus = 'active' | 'inactive' | 'compromised' | 'archived'

const statusDescriptions: Record<UserStatus, string> = {
  active: 'User can access devices and their data is synced normally.',
  inactive: 'User temporarily cannot access devices. Data remains on devices but won\'t sync.',
  compromised: 'Employee deleted from Frappe HR but still exists in ADMS. Should be reviewed.',
  archived: 'User permanently removed. Biometric data can be cleaned up.',
}

export function ChangeStatusDialog({ user, open, onOpenChange }: ChangeStatusDialogProps) {
  const [selectedStatus, setSelectedStatus] = useState<UserStatus>('active')
  const queryClient = useQueryClient()

  useEffect(() => {
    if (user?.status) {
      setSelectedStatus(user.status)
    }
  }, [user])

  const updateStatusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: UserStatus }) => {
      return await UserService.updateUser(userId, { status })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      notifySuccess('Status updated', `User status changed to ${selectedStatus}.`)
      onOpenChange(false)
    },
    onError: (error: Error) => {
      notifyError('Update failed', error.message || 'Failed to update user status')
    },
  })

  const handleSave = () => {
    if (!user?.id) return
    updateStatusMutation.mutate({ userId: user.id, status: selectedStatus })
  }

  if (!user) return null

  const currentStatus = user.status || 'active'
  const hasChanged = selectedStatus !== currentStatus

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>Change User Status</DialogTitle>
          <DialogDescription>
            Update the status for {user.name} (PIN: {user.pin})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="status">New Status</Label>
            <Select value={selectedStatus} onValueChange={(value: UserStatus) => setSelectedStatus(value)}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="compromised">Compromised</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Alert className="bg-muted/50">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              {statusDescriptions[selectedStatus]}
            </AlertDescription>
          </Alert>

          {selectedStatus === 'compromised' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Warning:</strong> This status indicates the employee was deleted from Frappe HR.
                Consider removing the user from all devices or archiving instead.
              </AlertDescription>
            </Alert>
          )}

          {selectedStatus === 'archived' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Warning:</strong> Archived users should be removed from all devices first.
                This is typically the final step before deletion.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleSave}
            disabled={!hasChanged || updateStatusMutation.isPending}
          >
            {updateStatusMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
