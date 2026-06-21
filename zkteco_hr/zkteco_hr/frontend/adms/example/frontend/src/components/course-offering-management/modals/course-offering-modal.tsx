import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { BaseModal, ConfirmationDialog } from "@/components/ui/base-modal"
import { TabBaseModal } from "@/components/ui/tab-base-modal"
import { useCourseOfferingForm } from "../forms/course-offering-form"
import { BasicInfoTab } from "../forms/tabs/basic-info-tab"
import { ScheduleTab } from "../forms/tabs/schedule-tab"
import { GoogleClassroomTab } from "../forms/tabs/google-classroom-tab"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { parse, format } from "date-fns"
import type { CourseOfferingFormData } from "@/schemas/course-offering-validation"
import {
  useCourseOfferingForModal,
  useCourseOfferingCoursesForModal,
  useCourseOfferingTermsForModal,
  useCourseOfferingInstructorsForModal,
  useCreateCourseOffering,
  useUpdateCourseOffering
} from "@/hooks/use-course-offerings"

interface CourseOfferingModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Handler for modal open state changes */
  onOpenChange: (open: boolean) => void
  /** Success callback - called after successful create/update */
  onSuccess?: () => void
  /** Course offering to edit (if provided, switches to edit mode) */
  courseOffering?: any | null
  /** Modal mode */
  mode?: 'create' | 'edit'
}

export function CourseOfferingModal({
  isOpen,
  onOpenChange,
  onSuccess,
  courseOffering = null,
  mode = courseOffering ? 'edit' : 'create'
}: CourseOfferingModalProps) {
  const [hasChanges, setHasChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false)
  const [pendingSubmissionData, setPendingSubmissionData] = useState<CourseOfferingFormData | null>(null)
  const [activeTab, setActiveTab] = useState<string>('basic') // Track active tab

  // Fetch fresh course offering data for edit mode (always fresh when modal opens)
  const { data: fetchedCourseOffering, isLoading: isFetchingCourseOffering } = useCourseOfferingForModal(
    courseOffering?.id,
    mode === 'edit' && !!courseOffering?.id && isOpen
  )

  // Fetch dropdown data - always fresh when modal opens
  const { data: coursesData = [], isLoading: isLoadingCourses } = useCourseOfferingCoursesForModal(isOpen)
  const { data: termsData = [], isLoading: isLoadingTerms } = useCourseOfferingTermsForModal(isOpen)
  const { data: instructorsData = [], isLoading: isLoadingInstructors } = useCourseOfferingInstructorsForModal(isOpen)

  // Mutations
  const createCourseOfferingMutation = useCreateCourseOffering()
  const updateCourseOfferingMutation = useUpdateCourseOffering()

  // Use fetched course offering data in edit mode, fallback to prop
  const courseOfferingData = mode === 'edit' && fetchedCourseOffering?.data
    ? fetchedCourseOffering.data
    : courseOffering

  // Ensure we have the correct course offering data loaded (prevent stale data from showing)
  const isCorrectCourseOfferingLoaded = mode !== 'edit' || !courseOffering?.id || (courseOfferingData && courseOfferingData.id === courseOffering.id)

  const isLoadingData = isLoadingCourses || isLoadingTerms || isLoadingInstructors || isFetchingCourseOffering
  const isMutating = createCourseOfferingMutation.isPending || updateCourseOfferingMutation.isPending

  const handleSubmit = async (values: CourseOfferingFormData) => {
    try {
      if (mode === 'edit' && courseOfferingData) {
        // Update existing course offering
        await updateCourseOfferingMutation.mutateAsync({
          id: courseOfferingData.id,
          data: values
        })

        toast.success('Course offering updated successfully')
      } else {
        // Create new course offering
        await createCourseOfferingMutation.mutateAsync(values)

        toast.success('Course offering created successfully')
      }

      onSuccess?.()
      onOpenChange(false)
    } catch (error) {
      const action = mode === 'edit' ? 'update' : 'create'
      toast.error(`Failed to ${action} course offering`, {
        description: error instanceof Error ? error.message : 'An unexpected error occurred'
      })
    }
  }

  const handleFormSubmit = async (values: CourseOfferingFormData) => {
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

  // Helper to format time from backend (HH:mm:ss) to form format (HH:mm)
  const formatTime = (time: string): string => {
    if (!time) return '00:00'

    try {
      // Try parsing as HH:mm:ss first
      if (time.includes(':')) {
        const parts = time.split(':')
        if (parts.length >= 2) {
          // Return first two parts (HH:mm)
          return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
        }
      }

      // Try parsing with date-fns as fallback
      const parsedTime = parse(time, time.length > 5 ? 'HH:mm:ss' : 'HH:mm', new Date())
      return format(parsedTime, 'HH:mm')
    } catch {
      // If all parsing fails, return default
      return '00:00'
    }
  }

  // Prepare default values for edit mode
  const defaultValues = courseOfferingData ? {
    course_id: courseOfferingData.course_id,
    term_id: courseOfferingData.term_id,
    section: courseOfferingData.section,
    instructor_id: courseOfferingData.instructor_id,
    location: courseOfferingData.location,
    min_enrollment: courseOfferingData.min_enrollment,
    max_enrollment: courseOfferingData.max_enrollment,
    status: courseOfferingData.status,
    // Transform course_schedules to schedules format (remove id, ensure HH:mm format)
    schedules: (courseOfferingData.course_schedules || []).map((schedule: any) => ({
      day_of_week: schedule.day_of_week,
      start_time: formatTime(schedule.start_time),
      end_time: formatTime(schedule.end_time),
    })),
    google_classroom_id: courseOfferingData.google_classroom_id,
  } : undefined

  // IMPORTANT: Call form hook BEFORE any conditional returns (React hooks rule)
  const { form, handleSubmit: onFormSubmit } = useCourseOfferingForm({
    defaultValues,
    onSubmit: handleFormSubmit,
    onChangesDetected: handleChangesDetected,
    enrollmentCount: mode === 'edit' ? courseOfferingData?.enrollment_count : undefined,
    mode
  })

  // Reset form and state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setHasChanges(false)
      setActiveTab('basic') // Reset to first tab when modal closes
      // Reset form to initial values when modal closes
      form.reset()
    }
  }, [isOpen, form])

  // Show loading state while fetching course offering data OR if we have stale data from a different course offering
  if (mode === 'edit' && (isFetchingCourseOffering || !isCorrectCourseOfferingLoaded)) {
    return (
      <BaseModal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title="Loading..."
        description="Please wait while we load the course offering data."
      >
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading course offering data...</p>
        </div>
      </BaseModal>
    )
  }

  // Define tabs for TabBaseModal - wrapped in Form context
  const tabs = [
    {
      value: 'basic',
      label: 'Basic Info',
      content: (
        <Form {...form}>
          <BasicInfoTab
            form={form}
            courses={coursesData}
            terms={termsData}
            instructors={instructorsData}
            isLoading={isMutating}
            isLoadingData={isLoadingData}
            enrollmentCount={mode === 'edit' ? courseOfferingData?.enrollment_count : undefined}
            mode={mode}
          />
        </Form>
      )
    },
    {
      value: 'schedule',
      label: 'Schedule',
      content: (
        <Form {...form}>
          <ScheduleTab form={form} />
        </Form>
      )
    },
    {
      value: 'google',
      label: 'Google Classroom',
      content: (
        <Form {...form}>
          <GoogleClassroomTab
            form={form}
            isLoading={isMutating}
            mode={mode}
          />
        </Form>
      )
    }
  ]

  return (
    <>
      <TabBaseModal
        key={courseOfferingData?.id ?? 'create'} // Key to reset form when switching between create/edit
        isOpen={isOpen}
        onOpenChange={handleClose}
        title={mode === 'edit' ? 'Edit Course Offering' : 'Create Course Offering'}
        description={
          mode === 'edit'
            ? 'Update the course offering information.'
            : 'Create a new course offering for the academic term.'
        }
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        footer={
          <Button
            type="submit"
            onClick={form.handleSubmit(onFormSubmit)}
            disabled={isMutating || (mode === 'edit' && !hasChanges)}
            title={mode === 'edit' && !hasChanges ? "Make changes to enable saving" : undefined}
          >
            {isMutating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {mode === 'edit' ? 'Updating...' : 'Creating...'}
              </>
            ) : (
              mode === 'edit'
                ? (hasChanges ? 'Save Changes' : 'No Changes')
                : 'Create Offering'
            )}
          </Button>
        }
      />

      {/* Save Confirmation */}
      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title={mode === 'edit' ? 'Update Course Offering?' : 'Create Course Offering?'}
        message={
          mode === 'edit'
            ? 'This will update the course offering information.'
            : 'This will create a new course offering in the system.'
        }
        confirmLabel={mode === 'edit' ? 'Update' : 'Create'}
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
