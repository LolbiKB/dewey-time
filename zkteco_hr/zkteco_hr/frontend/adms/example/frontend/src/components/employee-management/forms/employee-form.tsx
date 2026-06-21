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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { UserCombobox } from "@/components/shared/user-combobox"
import {
  TermTypeCombobox,
  PositionTypeCombobox,
  DepartmentTypeCombobox
} from "@/components/employee-management/shared/form-comboboxes"
import { RolesSelector } from "@/components/employee-management/shared/roles-selector"
import { employeeFormSchema, type EmployeeFormValues } from "@/schemas/employee-validation"
import { fetchAvailableUsers } from "@/services/employee-service"

// Mock data interfaces (replace with real API calls)
interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  khmerFirstName?: string
  khmerLastName?: string
  avatarUrl?: string
}

interface TermType {
  id: number
  name: string
  start_date?: string
  end_date?: string
  is_current: boolean
}

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

interface EmployeeFormProps {
  defaultValues?: Partial<EmployeeFormValues>
  onSubmit: (values: EmployeeFormValues) => void | Promise<void>
  isLoading?: boolean
  formId?: string
  onChangesDetected?: (hasChanges: boolean) => void

  // Data props
  users?: User[]
  termTypes?: TermType[]
  positionTypes?: PositionType[]
  departmentTypes?: DepartmentType[]
  isLoadingData?: boolean
}

// Helper function to transform employee ID input
export const transformEmployeeId = (value: string): string => {
  if (!value) return value

  const trimmed = value.trim()

  // Case 1: Just numbers (1-6 digits) - transform to E-DIU-XXXXXX
  const numbersOnly = trimmed.match(/^\d{1,6}$/)
  if (numbersOnly) {
    return `E-DIU-${trimmed.padStart(6, '0')}`
  }

  // Case 2: E-DIU- followed by 1-6 digits - pad the numbers
  const partialFormat = trimmed.match(/^[eE]-[dD][iI][uU]-(\d{1,6})$/)
  if (partialFormat) {
    const number = partialFormat[1]
    return `E-DIU-${number.padStart(6, '0')}`
  }

  // Case 3: Lowercase format - convert to uppercase
  const lowercaseFormat = trimmed.match(/^[eE]-[dD][iI][uU]-(\d{6})$/)
  if (lowercaseFormat) {
    return `E-DIU-${lowercaseFormat[1]}`
  }

  return trimmed
}

interface UseEmployeeFormProps {
  defaultValues?: Partial<EmployeeFormValues>
  onSubmit: (values: EmployeeFormValues) => void | Promise<void>
  onChangesDetected?: (hasChanges: boolean) => void
}

/**
 * Hook for managing employee form state
 */
export function useEmployeeForm({
  defaultValues,
  onSubmit,
  onChangesDetected,
}: UseEmployeeFormProps) {
  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      user_id: "",
      employee_id: "",
      hire_term_id: undefined,
      initial_position: {
        position_type_id: undefined,
        department_type_id: undefined,
        start_date: new Date()
      },
      role_ids: [],
      ...defaultValues,
    },
  })

  // Track form changes
  const { isDirty } = form.formState
  const hasChanges = useMemo(() => isDirty, [isDirty])

  // Reset form when modal closes/opens
  const baseDefaults = useMemo(() => ({
    user_id: "",
    employee_id: "",
    hire_term_id: undefined,
    initial_position: {
      position_type_id: undefined,
      department_type_id: undefined,
      start_date: new Date()
    },
    role_ids: [] as number[],
  }), [])

  const defaultValuesJson = JSON.stringify(defaultValues)
  useEffect(() => {
    form.reset({
      ...baseDefaults,
      ...defaultValues,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValuesJson])

  // Report changes back to parent modal
  useEffect(() => {
    if (onChangesDetected) {
      onChangesDetected(hasChanges)
    }
  }, [hasChanges, onChangesDetected])

  const handleSubmit = async (values: EmployeeFormValues) => {
    await onSubmit(values)
  }

  return { form, handleSubmit, hasChanges }
}

export function EmployeeForm({
  defaultValues,
  onSubmit,
  isLoading = false,
  formId,
  onChangesDetected,
  users = [],
  termTypes = [],
  positionTypes = [],
  departmentTypes = [],
  isLoadingData = false
}: EmployeeFormProps) {

  const { form, handleSubmit } = useEmployeeForm({
    defaultValues,
    onSubmit,
    onChangesDetected,
  })

  // Handle employee ID blur event for instant transformation
  const handleEmployeeIdBlur = (value: string) => {
    const transformed = transformEmployeeId(value)
    if (transformed !== value) {
      form.setValue('employee_id', transformed, { shouldValidate: true })
    }
  }



  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6"
        noValidate
      >
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="roles">Access Roles</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Employee Details</CardTitle>
                <CardDescription>
                  Set up new employee record
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="user_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Select User *</FormLabel>
                        <FormControl>
                          <UserCombobox
                            value={field.value}
                            onValueChange={field.onChange}
                            disabled={isLoading || isLoadingData}
                            users={users}
                            fetchUsers={fetchAvailableUsers}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="employee_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employee ID *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="E-DIU-000001"
                            disabled={isLoading}
                            {...field}
                            onBlur={(e) => {
                              handleEmployeeIdBlur(e.target.value)
                              field.onBlur()
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="hire_term_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hire Term *</FormLabel>
                        <FormControl>
                          <TermTypeCombobox
                            value={field.value}
                            onValueChange={field.onChange}
                            disabled={isLoading || isLoadingData}
                            termTypes={termTypes}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Initial Position Section */}
                  <FormField
                    control={form.control}
                    name="initial_position.position_type_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Position *</FormLabel>
                        <FormControl>
                          <PositionTypeCombobox
                            value={field.value}
                            onValueChange={field.onChange}
                            disabled={isLoading || isLoadingData}
                            positionTypes={positionTypes}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="initial_position.department_type_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Department</FormLabel>
                        <FormControl>
                          <DepartmentTypeCombobox
                            value={field.value}
                            onValueChange={field.onChange}
                            disabled={isLoading || isLoadingData}
                            departmentTypes={departmentTypes}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="roles" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Access Roles</CardTitle>
                <CardDescription>
                  Assign access roles to define employee permissions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="role_ids"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign role(s)</FormLabel>
                      <FormControl>
                        <RolesSelector
                          selectedRoleIds={field.value || []}
                          onRoleIdsChange={field.onChange}
                          modalOpen={true}
                          disabled={isLoading || isLoadingData}
                          placeholder="Select roles..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  )
}