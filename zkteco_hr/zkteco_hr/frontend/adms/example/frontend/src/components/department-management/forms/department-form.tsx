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
import type { Department } from "@/services/department-service"
import {
  departmentFormSchema,
  transformFormDataForAPI,
  type DepartmentFormValues,
} from "@/schemas/department-validation"

type CreateDepartmentInput = Omit<Department, 'id'>

interface DepartmentFormProps {
  defaultValues?: Partial<DepartmentFormValues>
  onSubmit: (values: CreateDepartmentInput) => void | Promise<void>
  isLoading?: boolean
  formId?: string
  onChangesDetected?: (hasChanges: boolean) => void
}

export function DepartmentForm({
  defaultValues,
  onSubmit,
  isLoading = false,
  formId,
  onChangesDetected
}: DepartmentFormProps) {
  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentFormSchema),
    defaultValues: {
      name: "",
      description: "",
      ...defaultValues,
    },
  })

  // Track form changes
  const { isDirty } = form.formState

  // Calculate if there are any changes
  const hasChanges = useMemo(() => {
    return isDirty
  }, [isDirty])

  // Report changes back to parent modal
  useEffect(() => {
    if (onChangesDetected) {
      onChangesDetected(hasChanges)
    }
  }, [hasChanges, onChangesDetected])

  const handleSubmit = async (values: DepartmentFormValues) => {
    // Transform form values to match API format
    const departmentData = transformFormDataForAPI(values)
    await onSubmit(departmentData)
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
          <h3 className="text-lg font-medium">Department Information</h3>

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Department Name *
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g., Business Administration"
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
                <FormLabel>
                  Description
                </FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Brief description of the department..."
                    className="min-h-[100px] resize-none"
                    disabled={isLoading}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </form>
    </Form>
  )
}