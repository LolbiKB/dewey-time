import type { UseFormReturn } from "react-hook-form"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { RolesSelector } from "@/components/employee-management/shared/roles-selector"
import type { EmployeeFormValues } from "@/schemas/employee-validation"

interface RolesTabProps {
  form: UseFormReturn<EmployeeFormValues>
  isLoading?: boolean
  isLoadingData?: boolean
}

export function RolesTab({
  form,
  isLoading = false,
  isLoadingData = false
}: RolesTabProps) {
  return (
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
  )
}
