import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { X, Shield } from "lucide-react"
import { cn } from "@/lib/utils"
import { MultiSelectCombobox, type ComboboxOption } from "@/components/ui/searchable-combobox"
import { useAssignableRolesForModal } from "@/hooks/use-employees"

// Types
interface Role {
  id: number
  name: string
  description?: string
}

interface RolesSelectorProps {
  selectedRoleIds: number[]
  onRoleIdsChange: (roleIds: number[]) => void
  modalOpen?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
}

export function RolesSelector({
  selectedRoleIds,
  onRoleIdsChange,
  modalOpen = true,
  disabled = false,
  placeholder = "Select roles...",
  className
}: RolesSelectorProps) {
  // Fetch assignable roles based on current user's permissions (smart caching for modals)
  const { data: roles = [], isLoading, error } = useAssignableRolesForModal(modalOpen)

  const selectedRoles = selectedRoleIds.map(id =>
    roles.find((role: Role) => role.id === id)
  ).filter(Boolean) as Role[]

  const removeRole = (roleId: number) => {
    onRoleIdsChange(selectedRoleIds.filter(id => id !== roleId))
  }

  if (error) {
    return (
      <div className="text-sm text-destructive">
        Failed to load roles: {error.message}
      </div>
    )
  }

  // Convert roles to ComboboxOptions
  const roleOptions: ComboboxOption[] = roles.map((role: Role) => ({
    value: role.id,
    label: role.name,
    description: role.description,
    icon: Shield
  }))

  return (
    <div className={cn("space-y-3", className)}>
      {/* Selected roles display */}
      {selectedRoles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedRoles.map((role) => (
            <Badge
              key={role.id}
              variant="secondary"
              className="flex items-center gap-1 px-3 py-1"
            >
              <Shield className="h-3 w-3" />
              <span className="text-xs font-medium">{role.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => removeRole(role.id)}
                disabled={disabled || isLoading}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      {/* Role selection using MultiSelectCombobox */}
      <MultiSelectCombobox
        values={selectedRoleIds}
        onValuesChange={(values: (string | number)[]) => onRoleIdsChange(values as number[])}
        options={roleOptions}
        disabled={disabled || isLoading}
        isLoading={isLoading}
        placeholder={isLoading ? "Loading roles..." : placeholder}
        searchPlaceholder="Search roles..."
        emptyMessage="No roles found."
        allowClear={true}
        maxDisplayItems={0} // Don't show selected items in combobox since we display them above
      />
    </div>
  )
}