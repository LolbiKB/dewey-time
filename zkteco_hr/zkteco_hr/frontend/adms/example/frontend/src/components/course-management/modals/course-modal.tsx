import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { CourseForm } from "../forms/course-form"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  useCreateCourse,
  useUpdateCourse,
  useCourseForModal,
  useCourseDepartmentTypesForModal
} from "@/hooks/use-courses"
import type { CourseFormData } from "@/schemas/course-validation"
import type { Course } from "../columns"

interface CourseModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for modal open state changes */
  onOpenChange: (open: boolean) => void
  /** Success callback - called after successful create/update */
  onSuccess?: () => void
  /** Course to edit (if provided, switches to edit mode) */
  course?: Course | null
  /** Modal mode */
  mode?: 'create' | 'edit'
}

export function CourseModal({
  isOpen,
  onOpenChange,
  onSuccess,
  course = null,
  mode = course ? 'edit' : 'create'
}: CourseModalProps) {
  const [hasChanges, setHasChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<CourseFormData | null>(null)

  // Fetch fresh course data for edit mode
  const { data: fetchedCourse, isLoading: isFetchingCourse } = useCourseForModal(
    course?.id,
    mode === 'edit' && !!course?.id && isOpen
  )

  // Fetch dropdown data - always fresh when modal opens
  const { data: departmentTypesData, isLoading: isLoadingDepartments } = useCourseDepartmentTypesForModal(isOpen)

  // Use the create/update course hooks
  const createCourseMutation = useCreateCourse()
  const updateCourseMutation = useUpdateCourse()

  // Use fetched course data in edit mode, fallback to prop
  const courseData = mode === 'edit' && fetchedCourse ? fetchedCourse : course

  // Ensure we have the correct course data loaded (prevent stale data from showing)
  const isCorrectCourseLoaded = mode !== 'edit' || !course?.id || (courseData && courseData.id === course.id)

  const isLoadingData = isLoadingDepartments || isFetchingCourse
  const isMutating = createCourseMutation.isPending || updateCourseMutation.isPending

  const handleSubmit = async (values: CourseFormData) => {
    try {
      if (mode === 'edit' && courseData) {
        // Update existing course
        await updateCourseMutation.mutateAsync({
          id: courseData.id,
          course: {
            course_code: values.course_code,
            course_name: values.course_name,
            description: values.description,
            credits: values.credits,
            department_type_id: values.department_type_id,
            status: values.status,
          }
        })

        toast.success('Course updated successfully', {
          description: `${values.course_name} has been updated.`
        })
      } else {
        // Create new course
        await createCourseMutation.mutateAsync({
          course_code: values.course_code,
          course_name: values.course_name,
          description: values.description,
          credits: values.credits,
          department_type_id: values.department_type_id,
          status: values.status,
        })

        toast.success('Course created successfully', {
          description: `${values.course_name} has been added to the system.`
        })
      }

      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      const action = mode === 'edit' ? 'update' : 'add'
      toast.error(`Failed to ${action} course`, {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
      console.error(`Failed to ${action} course:`, error)
    }
  }

  const handleFormSubmit = async (values: CourseFormData) => {
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

  // Prepare default values for edit mode
  const defaultValues: Partial<CourseFormData> | undefined = courseData ? {
    course_code: courseData.course_code,
    course_name: courseData.course_name,
    description: courseData.description || "",
    credits: courseData.credits,
    department_type_id: courseData.department_type_id ?? undefined,
    status: (courseData.status as 'active' | 'inactive' | 'archived') || 'active',
  } : undefined

  // Show loading state while fetching course data OR if we have stale data from a different course
  if (mode === 'edit' && (isFetchingCourse || !isCorrectCourseLoaded)) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Loading..."
        description="Please wait while we load the course data."
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading course data...</p>
        </div>
      </BaseModal>
    )
  }

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onOpenChange={handleClose}
        title={mode === 'edit' ? 'Edit Course' : 'Add New Course'}
        description={
          mode === 'edit'
            ? 'Update the course information.'
            : 'Add a new course to the system.'
        }
        footer={
          <Button
            type="submit"
            form="course-form"
            disabled={isMutating || (mode === 'edit' && !hasChanges)}
            title={mode === 'edit' && !hasChanges ? "Make changes to enable saving" : undefined}
          >
            {isMutating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {mode === 'edit' ? 'Updating...' : 'Adding...'}
              </>
            ) : (
              mode === 'edit'
                ? (hasChanges ? 'Save Changes' : 'No Changes')
                : 'Add Course'
            )}
          </Button>
        }
      >
        <CourseForm
          key={courseData?.id ?? 'create'}
          defaultValues={defaultValues}
          onSubmit={handleFormSubmit}
          isLoading={isMutating}
          formId="course-form"
          onChangesDetected={handleChangesDetected}
          departmentTypes={departmentTypesData || []}
          isLoadingData={isLoadingData}
        />
      </BaseModal>

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title={mode === 'edit' ? 'Update Course?' : 'Add Course?'}
        message={
          mode === 'edit'
            ? 'This will update the course information.'
            : 'This will add a new course to the system.'
        }
        confirmLabel={mode === 'edit' ? 'Update' : 'Add'}
        onConfirm={handleConfirmSave}
        onCancel={() => setShowSaveConfirmation(false)}
        isProcessing={isMutating}
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
