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
import { DatePickerInput } from "@/components/ui/date-picker-input"
import {
  termFormSchema,
  transformFormDataForAPI,
  type TermFormValues,
  type CreateTermInput,
} from "@/schemas/term-validation"

interface TermFormProps {
  defaultValues?: Partial<TermFormValues>
  onSubmit: (values: CreateTermInput) => void | Promise<void>
  isLoading?: boolean
  formId?: string
  onChangesDetected?: (hasChanges: boolean) => void
}

export function TermForm({
  defaultValues,
  onSubmit,
  isLoading = false,
  formId,
  onChangesDetected
}: TermFormProps) {
  const form = useForm<TermFormValues>({
    resolver: zodResolver(termFormSchema),
    defaultValues: {
      name: "",
      start_date: undefined,
      end_date: undefined,
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

  const handleSubmit = async (values: TermFormValues) => {
    // Transform form values to match API format
    const termData = transformFormDataForAPI(values)
    await onSubmit(termData)
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
          <h3 className="text-lg font-medium">Term Information</h3>

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Term Name *
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g., 2024-2025 Fall Semester"
                    disabled={isLoading}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="start_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start Date *</FormLabel>
                  <FormControl>
                    <DatePickerInput
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="dd/mm/yyyy"
                      disabled={isLoading}
                      dateFormat="dd/MM/yyyy"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="end_date"
              render={({ field }) => {
                const startDate = form.watch('start_date')

                return (
                  <FormItem>
                    <FormLabel>End Date *</FormLabel>
                    <FormControl>
                      <DatePickerInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="dd/mm/yyyy"
                        disabled={isLoading}
                        dateFormat="dd/MM/yyyy"
                        minDate={startDate || undefined}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )
              }}
            />
          </div>

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
                    placeholder="Brief description of the term..."
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
