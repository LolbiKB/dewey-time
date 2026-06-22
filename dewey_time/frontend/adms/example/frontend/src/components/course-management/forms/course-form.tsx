import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useEffect, useMemo } from "react"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { courseValidationSchema, type CourseFormData } from "@/schemas/course-validation"
import { DepartmentTypeCombobox } from "../../program-management/comboboxes/degree-type-combobox"

interface DepartmentType {
  id: number
  name: string
  description: string | null
}

interface CourseFormProps {
  defaultValues?: Partial<CourseFormData>
  onSubmit: (values: CourseFormData) => void | Promise<void>
  isLoading?: boolean
  formId?: string
  onChangesDetected?: (hasChanges: boolean) => void

  // Data props
  departmentTypes?: DepartmentType[]
  isLoadingData?: boolean
}

export function CourseForm({
  defaultValues,
  onSubmit,
  isLoading = false,
  formId,
  onChangesDetected,
  departmentTypes = [],
  isLoadingData = false
}: CourseFormProps) {

  const form = useForm<CourseFormData>({
    resolver: zodResolver(courseValidationSchema) as any,
    defaultValues: {
      course_code: "",
      course_name: "",
      description: "",
      credits: undefined,
      department_type_id: undefined,
      status: "active",
      ...defaultValues, // Apply default values from props (for edit mode)
    },
  })

  // Track form changes
  const { isDirty } = form.formState
  const hasChanges = useMemo(() => isDirty, [isDirty])

  // Report changes back to parent modal
  useEffect(() => {
    if (onChangesDetected) {
      onChangesDetected(hasChanges)
    }
  }, [hasChanges, onChangesDetected])

  const handleSubmit = async (values: CourseFormData) => {
    // Transform course_code to uppercase and convert undefined to null for API
    const submissionData = {
      ...values,
      course_code: values.course_code.toUpperCase(),
      department_type_id: values.department_type_id ?? null
    }
    await onSubmit(submissionData as CourseFormData)
  }

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6"
        noValidate
      >
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Course Information</h3>

          <FormField
            control={form.control}
            name="course_code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Course Code *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g., CS101"
                    disabled={isLoading}
                    {...field}
                    className="font-mono"
                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="course_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Course Name *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g., Introduction to Computer Science"
                    disabled={isLoading}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Brief description of the course..."
                    className="min-h-[100px] resize-none"
                    disabled={isLoading}
                    {...field}
                    value={field.value || ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="credits"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Credits *</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0-12"
                      disabled={isLoading}
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const value = e.target.value
                        if (value === '') {
                          field.onChange(undefined)
                        } else if (/^\d+$/.test(value)) {
                          const numValue = parseInt(value, 10)
                          if (numValue >= 0 && numValue <= 12) {
                            field.onChange(numValue)
                          }
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status *</FormLabel>
                  <Select
                    disabled={isLoading}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="department_type_id"
            render={() => {
              const currentValue = form.watch('department_type_id')
              return (
                <FormItem>
                  <FormLabel>Department</FormLabel>
                  <FormControl>
                    <DepartmentTypeCombobox
                      value={currentValue ?? undefined}
                      onValueChange={(value) => {
                        form.setValue('department_type_id', value ?? undefined, {
                          shouldDirty: true,
                          shouldValidate: true,
                          shouldTouch: true
                        })
                      }}
                      disabled={isLoading || isLoadingData}
                      departmentTypes={departmentTypes}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )
            }}
          />
        </div>
      </form>
    </Form>
  )
}
