import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useEffect, useMemo } from "react"

import { courseOfferingFormSchema, type CourseOfferingFormData } from "@/schemas/course-offering-validation"

interface UseCourseOfferingFormProps {
  defaultValues?: Partial<CourseOfferingFormData>
  onSubmit: (values: CourseOfferingFormData) => void | Promise<void>
  onChangesDetected?: (hasChanges: boolean) => void
  enrollmentCount?: number
  mode?: 'create' | 'edit'
}

/**
 * Hook for managing course offering form state
 */
export function useCourseOfferingForm({
  defaultValues,
  onSubmit,
  onChangesDetected,
  enrollmentCount,
  mode = 'create'
}: UseCourseOfferingFormProps) {
  // Create dynamic schema based on enrollment count in edit mode
  const validationSchema = useMemo(() => {
    if (mode === 'edit' && enrollmentCount !== undefined) {
      return courseOfferingFormSchema.refine(
        (data) => {
          // In edit mode, max_enrollment must be >= current enrollment count
          if (data.max_enrollment !== null && data.max_enrollment !== undefined) {
            return data.max_enrollment >= enrollmentCount
          }
          return true
        },
        {
          message: `Maximum enrollment cannot be less than current enrollment (${enrollmentCount} students)`,
          path: ['max_enrollment']
        }
      )
    }
    return courseOfferingFormSchema
  }, [mode, enrollmentCount])

  const form = useForm<CourseOfferingFormData>({
    resolver: zodResolver(validationSchema),
    defaultValues: {
      course_id: undefined,
      term_id: undefined,
      section: "",
      instructor_id: null,
      location: null,
      min_enrollment: null,
      max_enrollment: null,
      status: "active",
      schedules: [],
      google_classroom_id: null,
      ...defaultValues,
    },
  })

  // Track form changes
  const { isDirty } = form.formState
  const hasChanges = useMemo(() => isDirty, [isDirty])

  // Define the base default values
  const baseDefaults = useMemo(() => ({
    course_id: undefined,
    term_id: undefined,
    section: "",
    instructor_id: null,
    location: null,
    min_enrollment: null,
    max_enrollment: null,
    status: "active" as const,
    schedules: [],
    google_classroom_id: null,
  }), [])

  // Reset form when defaultValues change (important for edit mode when data loads)
  // Use JSON.stringify to create a stable dependency
  const defaultValuesJson = JSON.stringify(defaultValues)
  useEffect(() => {
    form.reset({
      ...baseDefaults,
      ...defaultValues,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValuesJson]) // Use stringified version to prevent infinite loops

  // Report changes back to parent modal
  useEffect(() => {
    if (onChangesDetected) {
      onChangesDetected(hasChanges)
    }
  }, [hasChanges, onChangesDetected])

  const handleSubmit = async (values: CourseOfferingFormData) => {
    await onSubmit(values)
  }

  return { form, handleSubmit, hasChanges }
}
