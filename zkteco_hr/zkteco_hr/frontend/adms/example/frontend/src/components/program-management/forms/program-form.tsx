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
import { programFormSchema, type ProgramFormValues } from "@/schemas/program-validation"
import { DegreeTypeCombobox } from "../comboboxes/degree-type-combobox"
import { DepartmentTypeCombobox } from "../comboboxes/degree-type-combobox"

interface DegreeType {
  id: number
  name: string
  abbreviation: string | null
}

interface DepartmentType {
  id: number
  name: string
  description?: string | null
}

interface ProgramFormProps {
  defaultValues?: Partial<ProgramFormValues>
  onSubmit: (values: ProgramFormValues) => void | Promise<void>
  isLoading?: boolean
  formId?: string
  onChangesDetected?: (hasChanges: boolean) => void

  // Data props
  degreeTypes?: DegreeType[]
  departmentTypes?: DepartmentType[]
  isLoadingData?: boolean
}

export function ProgramForm({
  defaultValues,
  onSubmit,
  isLoading = false,
  formId,
  onChangesDetected,
  degreeTypes = [],
  departmentTypes = [],
  isLoadingData = false
}: ProgramFormProps) {

  const form = useForm<ProgramFormValues>({
    resolver: zodResolver(programFormSchema),
    defaultValues: {
      major: "",
      description: "",
      degree_id: undefined,
      department_type_id: undefined,
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

  const handleSubmit = async (values: ProgramFormValues) => {
    // Transform undefined department_type_id to null for API
    const submissionData = {
      ...values,
      department_type_id: values.department_type_id ?? null
    }
    await onSubmit(submissionData as ProgramFormValues)
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
          <h3 className="text-lg font-medium">Program Information</h3>

          <FormField
            control={form.control}
            name="major"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Program Name *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g., Computer Science"
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
                    placeholder="Brief description of the program..."
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

          <FormField
            control={form.control}
            name="degree_id"
            render={() => {
              const currentValue = form.watch('degree_id')
              return (
                <FormItem>
                  <FormLabel>Degree Type *</FormLabel>
                  <FormControl>
                    <DegreeTypeCombobox
                      value={currentValue}
                      onValueChange={(value) => {
                        form.setValue('degree_id', value, {
                          shouldDirty: true,
                          shouldValidate: true,
                          shouldTouch: true
                        })
                      }}
                      disabled={isLoading || isLoadingData}
                      degreeTypes={degreeTypes}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )
            }}
          />

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
