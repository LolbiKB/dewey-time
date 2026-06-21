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
import { Trash2, Plus, Building2 } from "lucide-react"
import { DatePickerInput } from "@/components/ui/date-picker-input"

import { PositionTypeCombobox, DepartmentTypeCombobox } from "@/components/employee-management/shared/form-comboboxes"
import { positionManagementSchema, type PositionManagementFormValues } from "@/schemas/employee-validation"

interface PositionType {
  id: number
  name: string
  description?: string
}

interface DepartmentType {
  id: number
  name: string
  description?: string
}

interface PositionFormProps {
  defaultValues?: Partial<PositionManagementFormValues>
  onSubmit: (values: PositionManagementFormValues) => void | Promise<void>
  isLoading?: boolean
  formId?: string
  onChangesDetected?: (hasChanges: boolean) => void

  // Data props
  positionTypes?: PositionType[]
  departmentTypes?: DepartmentType[]
  isLoadingPositionTypes?: boolean
  isLoadingDepartmentTypes?: boolean
}

export function PositionForm({
  defaultValues,
  onSubmit,
  isLoading = false,
  formId,
  onChangesDetected,
  positionTypes = [],
  departmentTypes = [],
  isLoadingPositionTypes = false,
  isLoadingDepartmentTypes = false
}: PositionFormProps) {

  const form = useForm<PositionManagementFormValues>({
    resolver: zodResolver(positionManagementSchema),
    defaultValues: defaultValues || {
      positions: [],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "positions"
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

  const handleSubmit = async (values: PositionManagementFormValues) => {
    console.log('Form submitted with values:', values)
    console.log('Form errors:', form.formState.errors)
    await onSubmit(values)
  }

  const addPosition = () => {
    append({
      position_type_id: 0,
      department_type_id: undefined,
      start_date: undefined as any,
      status: 'active'
    })
  }

  const canRemovePosition = () => {
    const positions = form.getValues('positions')
    // Allow removing any position, including the last one
    // Employee can have no active positions (retired/terminated employees)
    return positions.length > 1
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
                <CardTitle>Position Timeline</CardTitle>
                <CardDescription>
                  Manage employee position history
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={addPosition}
                disabled={isLoading}
                size="sm"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Position
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {fields.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No positions found. Add a position to get started.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {fields.map((field, index) => (
                  <div key={field.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-medium">
                        Position {index + 1}
                        {form.watch(`positions.${index}.status`) === 'active' && (
                          <Badge variant="secondary" className="ml-2">Active</Badge>
                        )}
                      </h4>

                      {canRemovePosition() && (
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
                      {/* Position Type Selection */}
                      <FormField
                        control={form.control}
                        name={`positions.${index}.position_type_id`}
                        render={() => {
                          const currentValue = form.watch(`positions.${index}.position_type_id`)
                          return (
                            <FormItem>
                              <FormLabel>Position *</FormLabel>
                              <FormControl>
                                <PositionTypeCombobox
                                  value={currentValue > 0 ? currentValue : undefined}
                                  onValueChange={(value) => {
                                    form.setValue(`positions.${index}.position_type_id`, value || 0, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                      shouldTouch: true
                                    })
                                  }}
                                  disabled={isLoading || isLoadingPositionTypes}
                                  positionTypes={positionTypes}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )
                        }}
                      />

                      {/* Department Type Selection */}
                      <FormField
                        control={form.control}
                        name={`positions.${index}.department_type_id`}
                        render={() => {
                          const currentValue = form.watch(`positions.${index}.department_type_id`)
                          return (
                            <FormItem>
                              <FormLabel>Department</FormLabel>
                              <FormControl>
                                <DepartmentTypeCombobox
                                  value={currentValue || undefined}
                                  onValueChange={(value) => {
                                    form.setValue(`positions.${index}.department_type_id`, value, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                      shouldTouch: true
                                    })
                                  }}
                                  disabled={isLoading || isLoadingDepartmentTypes}
                                  departmentTypes={departmentTypes}
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
                            name={`positions.${index}.start_date`}
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
                            name={`positions.${index}.end_date`}
                            render={({ field }) => {
                              const startDate = form.watch(`positions.${index}.start_date`)

                              return (
                                <FormItem>
                                  <FormLabel>End Date</FormLabel>
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
                            name={`positions.${index}.status`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Status *</FormLabel>
                                <FormControl>
                                  <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                    disabled={isLoading}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="active">Active</SelectItem>
                                      <SelectItem value="inactive">Inactive</SelectItem>
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