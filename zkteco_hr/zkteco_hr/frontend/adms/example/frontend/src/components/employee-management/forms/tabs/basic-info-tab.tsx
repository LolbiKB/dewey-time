import type { UseFormReturn } from "react-hook-form"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { UserCombobox } from "@/components/shared/user-combobox"
import {
  TermTypeCombobox,
  PositionTypeCombobox,
  DepartmentTypeCombobox
} from "@/components/employee-management/shared/form-comboboxes"
import { fetchAvailableUsers } from "@/services/employee-service"
import { transformEmployeeId } from "../employee-form"
import type { EmployeeFormValues } from "@/schemas/employee-validation"

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

interface BasicInfoTabProps {
  form: UseFormReturn<EmployeeFormValues>
  users?: User[]
  termTypes?: TermType[]
  positionTypes?: PositionType[]
  departmentTypes?: DepartmentType[]
  isLoading?: boolean
  isLoadingData?: boolean
}

export function BasicInfoTab({
  form,
  users = [],
  termTypes = [],
  positionTypes = [],
  departmentTypes = [],
  isLoading = false,
  isLoadingData = false
}: BasicInfoTabProps) {
  // Handle employee ID blur event for instant transformation
  const handleEmployeeIdBlur = (value: string) => {
    const transformed = transformEmployeeId(value)
    if (transformed !== value) {
      form.setValue('employee_id', transformed, { shouldValidate: true })
    }
  }

  return (
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
  )
}
