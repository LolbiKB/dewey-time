import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { StudentForm } from "../forms/student-form"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import type { StudentFormValues } from "@/schemas/student-validation"
import {
  useStudentProgramsForModal,
  useStudentTermTypesForModal,
  useAvailableUsersForModal
} from "@/hooks/use-students"
import { createStudent } from "@/services/student-service"

interface StudentModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for modal open state changes */
  onOpenChange: (open: boolean) => void
  /** Success callback - called after successful create */
  onSuccess?: () => void
}

export function StudentModal({
  isOpen,
  onOpenChange,
  onSuccess
}: StudentModalProps) {
  const [hasChanges, setHasChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<StudentFormValues | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch modal data with fresh data when modal opens
  const { data: programs = [], isLoading: isLoadingPrograms } = useStudentProgramsForModal(isOpen)
  const { data: termTypes = [], isLoading: isLoadingTerms } = useStudentTermTypesForModal(isOpen)
  const { data: usersResponse, isLoading: isLoadingUsers } = useAvailableUsersForModal(isOpen, { limit: 100 })

  const users = usersResponse?.data || []
  const isLoadingData = isLoadingPrograms || isLoadingTerms || isLoadingUsers

  const handleSubmit = async (values: StudentFormValues) => {
    try {
      setIsSubmitting(true)

      // Transform form values to match API format
      const studentData: {
        user_id: string
        student_id: string
        admission_term_id?: number
        initial_program?: {
          program_id: number
          start_date: string
        }
      } = {
        user_id: values.user_id || '',
        student_id: values.student_id,
        admission_term_id: values.admission_term_id || undefined
      }

      // Only include initial_program if both program_id and start_date are provided
      if (values.initial_program?.program_id && values.initial_program?.start_date) {
        studentData.initial_program = {
          program_id: values.initial_program.program_id,
          start_date: values.initial_program.start_date.toISOString().split('T')[0]
        }
      }

      // Call API to create student
      const response = await createStudent(studentData)

      if (!response.success) {
        throw new Error(response.message || 'Failed to create student')
      }

      toast.success('Student registered successfully', {
        description: `Student ${values.student_id} has been added to the system.`
      })
      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      toast.error('Failed to register student', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error('Failed to register student:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleFormSubmit = async (values: StudentFormValues) => {
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

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onOpenChange={handleClose}
        title="Register New Student"
        description="Register a new student to the system with their basic information and initial program."
        footer={
          <Button
            type="submit"
            form="student-form"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registering...
              </>
            ) : (
              "Register Student"
            )}
          </Button>
        }
      >
        <StudentForm
          onSubmit={handleFormSubmit}
          isLoading={isSubmitting}
          formId="student-form"
          onChangesDetected={handleChangesDetected}
          users={users}
          termTypes={termTypes}
          programs={programs}
          isLoadingData={isLoadingData}
        />
      </BaseModal>

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title="Register Student?"
        message="This will register a new student to the system."
        confirmLabel="Register"
        onConfirm={handleConfirmSave}
        onCancel={() => setShowSaveConfirmation(false)}
        isProcessing={isSubmitting}
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
