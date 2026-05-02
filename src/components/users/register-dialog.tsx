import { useState, useEffect, useMemo } from 'react'
import { BaseModal, ConfirmationDialog } from '@/components/ui/base-modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'
import { UserService } from '@/services/user-service'
import type { UserEntry } from '@/services/user-service'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

interface RegisterDialogProps {
  employee: UserEntry | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RegisterDialog({ employee, open, onOpenChange }: RegisterDialogProps) {
  const [pin, setPin] = useState('')
  const [suggestedPin, setSuggestedPin] = useState('')
  const [isCheckingPin, setIsCheckingPin] = useState(false)
  const [pinError, setPinError] = useState('')
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)
  const queryClient = useQueryClient()

  // Track if user has made changes
  const hasChanges = useMemo(() => {
    return pin !== '' && pin !== suggestedPin
  }, [pin, suggestedPin])

  // Register mutation
  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!employee) throw new Error('No employee selected')
      if (!employee.frappe_employee_id) throw new Error('No Frappe employee ID')

      const result = await UserService.registerEmployee(
        employee.frappe_employee_id,
        pin,
        employee.name
      )

      return result
    },
    onSuccess: () => {
      // Invalidate queries to refresh the user list
      queryClient.invalidateQueries({ queryKey: ['users'] })

      // Reset form
      setPin('')
      setSuggestedPin('')
      setPinError('')

      // Close modal with success - user can check sync status in user details
      onOpenChange(false)
      
      toast.success('Employee Registered', {
        description: `${employee?.name} registered. Syncing to devices...`,
      })
    },
    onError: (error: Error) => {
      toast.error('Registration Failed', {
        description: error.message || 'Failed to register employee',
      })
    },
  })

  // Auto-suggest next available PIN when dialog opens
  useEffect(() => {
    if (open && employee) {
      suggestNextPin()
    } else {
      // Reset form when dialog closes
      setPin('')
      setSuggestedPin('')
      setPinError('')
    }
  }, [open, employee])

  // Suggest the next available PIN
  const suggestNextPin = async () => {
    try {
      const nextPin = await UserService.getNextAvailablePin()
      setPin(nextPin)
      setSuggestedPin(nextPin)
      setPinError('')
    } catch (error) {
      console.error('Failed to suggest PIN:', error)
      setPin('1')
      setSuggestedPin('1')
    }
  }

  // Validate PIN in real-time
  useEffect(() => {
    if (!pin) {
      setPinError('')
      return
    }

    // Check if PIN is numeric
    if (!/^\d+$/.test(pin)) {
      setPinError('PIN must be numeric')
      return
    }

    // Check if PIN already exists (direct DB check)
    const checkPin = async () => {
      setIsCheckingPin(true)
      try {
        const isAvailable = await UserService.checkPinAvailability(pin)
        if (!isAvailable) {
          setPinError('PIN already in use')
        } else {
          setPinError('')
        }
      } catch (error) {
        console.error('Failed to check PIN:', error)
        setPinError('Failed to check PIN availability')
      } finally {
        setIsCheckingPin(false)
      }
    }

    const debounce = setTimeout(checkPin, 300)
    return () => clearTimeout(debounce)
  }, [pin])

  // Handle close with unsaved changes
  const handleCloseModal = () => {
    if (hasChanges && !registerMutation.isPending) {
      setShowDiscardConfirmation(true)
    } else {
      onOpenChange(false)
    }
  }

  // Handle discard confirmation
  const handleConfirmDiscard = () => {
    setShowDiscardConfirmation(false)
    setPin('')
    setSuggestedPin('')
    setPinError('')
    onOpenChange(false)
  }

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pinError || !pin || registerMutation.isPending) {
      return
    }
    registerMutation.mutate()
  }

  const isLoading = isCheckingPin || registerMutation.isPending

  if (!employee) return null

  return (
    <>
      <BaseModal
        isOpen={open}
        onOpenChange={handleCloseModal}
        title="Register Employee"
        description={`Assign a PIN to ${employee.name} to register them in the attendance system.`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={handleCloseModal}
              disabled={registerMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              form="register-form"
              type="submit"
              disabled={isLoading || !!pinError || !pin}
            >
              {registerMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registering...
                </>
              ) : (
                'Register Employee'
              )}
            </Button>
          </>
        }
      >
        <form id="register-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">Employee Name</label>
            <Input
              id="name"
              value={employee.name}
              disabled
              className="bg-muted"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="frappe_employee_id" className="text-sm font-medium">Frappe ID</label>
            <Input
              id="frappe_employee_id"
              value={employee.frappe_employee_id}
              disabled
              className="bg-muted"
            />
          </div>

          {employee.department && (
            <div className="space-y-2">
              <label htmlFor="department" className="text-sm font-medium">Department</label>
              <Input
                id="department"
                value={employee.department}
                disabled
                className="bg-muted"
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="pin" className="text-sm font-medium">
              PIN <span className="text-destructive">*</span>
            </label>
            <Input
              id="pin"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              autoFocus
              disabled={registerMutation.isPending}
            />
            {isCheckingPin && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking PIN...
              </p>
            )}
            {pinError && !isCheckingPin && (
              <p className="text-sm text-destructive">{pinError}</p>
            )}
            {!pinError && !isCheckingPin && pin && (
              <p className="text-sm text-green-600">PIN is available</p>
            )}
            {pin === suggestedPin && (
              <p className="text-sm text-muted-foreground">
                This is the suggested next available PIN
              </p>
            )}
          </div>
        </form>
      </BaseModal>

      {/* Discard Confirmation */}
      <ConfirmationDialog
        isOpen={showDiscardConfirmation}
        title="Discard Changes?"
        message="You have modified the PIN. Are you sure you want to discard these changes?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        variant="destructive"
        onConfirm={handleConfirmDiscard}
        onCancel={() => setShowDiscardConfirmation(false)}
      />
    </>
  )
}
