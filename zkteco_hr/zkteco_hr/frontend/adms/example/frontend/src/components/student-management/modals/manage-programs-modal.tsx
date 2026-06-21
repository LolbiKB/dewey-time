import { useState, useEffect, useMemo } from "react"
import { formatISO } from "date-fns"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { UserInfoCard } from "@/components/shared/user-info-card"
import { useStudentForModal, useStudentProgramsForModal, useUpdateStudentPrograms } from "@/hooks/use-students"
import { ProgramForm } from "../forms/program-form"
import type { ProgramManagementFormValues } from "@/schemas/student-validation"

interface ManageProgramsModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  studentId?: number
  onSuccess?: () => void
}

export function ManageProgramsModal({
  isOpen,
  onOpenChange,
  studentId,
  onSuccess
}: ManageProgramsModalProps) {
  const [hasChanges, setHasChanges] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<ProgramManagementFormValues | null>(null)

  // Hook for updating programs
  const updateProgramsMutation = useUpdateStudentPrograms()

  // Hook for fetching student data (self-fetching)
  const {
    data: student,
    isLoading: isFetchingStudent
  } = useStudentForModal(studentId || 0, isOpen)

  // Hook for fetching programs (self-fetching)
  const { data: programs = [], isLoading: isLoadingPrograms } = useStudentProgramsForModal(isOpen)

  // Ensure we have the correct student data loaded (prevent stale data from showing)
  const isCorrectStudentLoaded = !studentId || (student?.data && student.data.id === studentId)

  // Default values for the form - memoized to prevent unnecessary resets
  const defaultValues: Partial<ProgramManagementFormValues> = useMemo(() => ({
    programs: student?.data?.student_program_history && isCorrectStudentLoaded ?
      student.data.student_program_history.map((prog: any) => ({
        id: prog.id,
        program_id: prog.program_id,
        start_date: prog.start_date ? new Date(prog.start_date + 'T00:00:00') : new Date(),
        end_date: prog.end_date ? new Date(prog.end_date + 'T00:00:00') : undefined,
        status: prog.status
      })) : []
  }), [student?.data?.student_program_history, isCorrectStudentLoaded])

  const handleSubmit = async (values: ProgramManagementFormValues) => {
    if (!student?.data) return

    setIsLoading(true)
    try {
      // Convert programs to API format
      const programsToSave = values.programs.map(prog => ({
        id: prog.id,
        program_id: prog.program_id,
        start_date: prog.start_date ? formatISO(prog.start_date).split('T')[0] : '',
        end_date: prog.end_date ? formatISO(prog.end_date).split('T')[0] : undefined,
        status: prog.status
      }))

      await updateProgramsMutation.mutateAsync({
        studentId: student.data.id,
        programs: { programs: programsToSave }
      })

      toast.success('Programs updated successfully', {
        description: `Program history for ${student.data.users.first_name} ${student.data.users.last_name} has been updated.`
      })
      setHasChanges(false)
      onSuccess?.()
      onOpenChange(false)
    } catch (error: any) {
      toast.error('Failed to update programs', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error('Failed to save programs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFormSubmit = async (values: ProgramManagementFormValues) => {
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

  // Show loading state while fetching student data OR if we have stale data from a different student
  if (isFetchingStudent || !isCorrectStudentLoaded) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Loading..."
        description="Please wait while we load the student data."
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading student data...</p>
        </div>
      </BaseModal>
    )
  }

  if (!student?.data) return null

  const studentData = student.data

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onOpenChange={handleClose}
        title="Manage Programs"
        description={`Update program history for ${studentData.users.first_name} ${studentData.users.last_name}`}
        footer={
          <Button
            type="submit"
            form="program-form"
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
          {/* Student Info Header */}
          <UserInfoCard
            firstName={studentData.users.first_name}
            lastName={studentData.users.last_name}
            khmerFirstName={studentData.users.khmer_first_name}
            khmerLastName={studentData.users.khmer_last_name}
            email={studentData.users.email}
            avatarUrl={studentData.users.avatar_url}
            idLabel="ID:"
            idValue={studentData.student_id}
          />

          {/* Program Form */}
          {studentData?.student_program_history !== undefined && (
            <ProgramForm
              key={`program-form-${studentData.id}-${studentData.student_program_history.length}`}
              defaultValues={defaultValues}
              onSubmit={handleFormSubmit}
              isLoading={isLoading}
              formId="program-form"
              onChangesDetected={handleChangesDetected}
              programs={programs}
              isLoadingPrograms={isLoadingPrograms}
            />
          )}
        </div>
      </BaseModal>

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title="Save Changes?"
        message="This will update the student's program history."
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
