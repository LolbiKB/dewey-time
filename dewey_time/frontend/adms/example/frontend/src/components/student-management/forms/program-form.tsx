import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useFieldArray } from "react-hook-form"
import { useEffect, useMemo } from "react"

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Plus, GraduationCap } from "lucide-react"
import { DatePickerInput } from "@/components/ui/date-picker-input"

import { ProgramCombobox } from "@/components/student-management/shared/form-comboboxes"
import { programManagementSchema, type ProgramManagementFormValues } from "@/schemas/student-validation"

interface Program {
  id: number
  major: string
  description?: string
  degree: {
    id: number
    name: string
    abbreviation?: string
  }
  department_type_id?: number
}

interface ProgramFormProps {
  defaultValues?: Partial<ProgramManagementFormValues>
  onSubmit: (values: ProgramManagementFormValues) => void | Promise<void>
  isLoading?: boolean
  formId?: string
  onChangesDetected?: (hasChanges: boolean) => void

  // Data props
  programs?: Program[]
  isLoadingPrograms?: boolean
}

export function ProgramForm({
  defaultValues,
  onSubmit,
  isLoading = false,
  formId,
  onChangesDetected,
  programs = [],
  isLoadingPrograms = false
}: ProgramFormProps) {

  const form = useForm<ProgramManagementFormValues>({
    resolver: zodResolver(programManagementSchema),
    defaultValues: defaultValues || {
      programs: [],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "programs"
  })

  // Track form changes
  const { isDirty, errors } = form.formState
  const hasChanges = useMemo(() => isDirty, [isDirty])

  // Debug: log errors when they change
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      console.log('Form validation errors:', errors)
    }
  }, [errors])

  // Report changes back to parent modal
  useEffect(() => {
    if (onChangesDetected) {
      onChangesDetected(hasChanges)
    }
  }, [hasChanges, onChangesDetected])

  const handleSubmit = async (values: ProgramManagementFormValues) => {
    console.log('Form submitted with values:', values)
    console.log('Form errors:', form.formState.errors)
    await onSubmit(values)
  }

  const addProgram = () => {
    append({
      program_id: 0,
      start_date: undefined as any,
      status: 'active'
    })
  }

  const canRemoveProgram = () => {
    const programs = form.getValues('programs')
    // Allow removing any program, including the last one
    // Students can have no active programs (e.g., withdrawn, graduated)
    return programs.length > 0
  }

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6"
        noValidate
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Academic Program Timeline</CardTitle>
                <CardDescription>
                  Manage student's program enrollment history
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={addProgram}
                disabled={isLoading}
                size="sm"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Program
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {fields.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                <GraduationCap className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No programs enrolled. Add a program to get started.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {fields.map((field, index) => (
                  <div key={field.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-medium">
                        Program {index + 1}
                        {form.watch(`programs.${index}.status`) === 'active' && (
                          <Badge variant="secondary" className="ml-2">Active</Badge>
                        )}
                        {form.watch(`programs.${index}.status`) === 'completed' && (
                          <Badge variant="default" className="ml-2">Completed</Badge>
                        )}
                      </h4>

                      {canRemoveProgram() && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => remove(index)}
                          disabled={isLoading}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="space-y-4">
                      {/* Program Selection */}
                      <FormField
                        control={form.control}
                        name={`programs.${index}.program_id`}
                        render={() => {
                          const currentValue = form.watch(`programs.${index}.program_id`)
                          return (
                            <FormItem>
                              <FormLabel>Program *</FormLabel>
                              <FormControl>
                                <ProgramCombobox
                                  value={currentValue > 0 ? currentValue : undefined}
                                  onValueChange={(value) => {
                                    form.setValue(`programs.${index}.program_id`, value || 0, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                      shouldTouch: true
                                    })
                                  }}
                                  disabled={isLoading || isLoadingPrograms}
                                  programs={programs}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )
                        }}
                      />

                      {/* Date and Status Grid */}
                      <div className="space-y-4">
                        {/* Start and End Date - Share space in grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name={`programs.${index}.start_date`}
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
                            name={`programs.${index}.end_date`}
                            render={({ field }) => {
                              const currentStatus = form.watch(`programs.${index}.status`)
                              const isRequired = currentStatus === 'completed'
                              const startDate = form.watch(`programs.${index}.start_date`)

                              return (
                                <FormItem>
                                  <FormLabel>
                                    End Date
                                    {isRequired && <span>*</span>}
                                  </FormLabel>
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

                        {/* Status - Half width */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name={`programs.${index}.status`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Status *</FormLabel>
                                <FormControl>
                                  <Select
                                    value={field.value}
                                    onValueChange={(value) => {
                                      field.onChange(value)
                                      // Trigger validation on end_date when status changes
                                      form.trigger(`programs.${index}.end_date`)
                                    }}
                                    disabled={isLoading}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="active">Active</SelectItem>
                                      <SelectItem value="inactive">Inactive</SelectItem>
                                      <SelectItem value="completed">Completed</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </form>
    </Form>
  )
}
