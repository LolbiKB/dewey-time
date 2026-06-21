import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Trash2, UserCog, Building2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { format, parseISO, formatISO } from "date-fns"
import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SelectFilterHeader,
  DateFilterHeader,
  UserCell,
  TwoLineTextCell,
  RolesCell,
  BadgeCell,
  DropdownMenuFilterHeader,
  FilterSection,
  IDCell
} from "../ui/table-components"
import { PositionHistoryModal } from "./modals/position-history-modal"
import { useEmployeePositionTypes, useEmployeeDepartmentTypes } from "../../hooks/use-employees"
import { useAuth } from "../../hooks/use-auth"
import { PERMISSIONS } from "../../lib/permissions"

// Callback functions for column actions and filters
interface ColumnCallbacks {
  onDeleteEmployee?: (employee: Employee) => void
  onManageRoles?: (employee: Employee) => void
  onManagePositions?: (employee: Employee) => void
  onFilterByRole?: (role: string) => void
  onFilterByStatus?: (status: string) => void
  onFilterByHireTerm?: (term: string) => void
  onFilterByCreatedDate?: (date: string) => void // ISO date string or empty string
  onUpdateFilters?: (updates: { position_type_id?: number | undefined; department_id?: number | undefined }) => void
  currentRoleFilter?: string
  currentStatusFilter?: string
  currentHireTermFilter?: string
  currentCreatedDateFilter?: string // ISO date string for the selected date
  currentPositionFilter?: string
  currentDepartmentFilter?: string
}

// Employee type based on database schema
export interface Employee {
  id: number
  employee_id: string
  user_id: string
  hire_term_id?: number
  created_at: string
  updated_at: string

  // Related user data
  users: {
    id: string
    email: string
    first_name: string
    last_name: string
    khmer_first_name?: string
    khmer_last_name?: string
    phone?: string
    avatar_url?: string
    date_of_birth?: string
    gender?: 'male' | 'female' | 'other'
    address?: string
    // Role assignments nested under users
    user_roles: Array<{
      id: number
      role_id: number
      status: 'active' | 'inactive'
      created_at: string
      roles: {
        id: number
        name: string
        description?: string
      }
    }>
  }

  // Current active positions
  employee_positions: Array<{
    id: number
    position_type_id: number
    department_type_id: number | null
    start_date: string
    end_date?: string
    status: 'active' | 'inactive'
    position_types: {
      id: number
      name: string
      description?: string
    }
    department_types: {
      id: number
      name: string
      description?: string
    } | null
  }>

  // Hire term info
  term_types?: {
    id: number
    name: string
    start_date?: string
    end_date?: string
    is_current: boolean
  }
}

// Status Cell Component
function StatusCell({ employee }: { employee: Employee }) {
  const hasActivePosition = employee.employee_positions?.some(pos => pos.status === 'active') || false
  const status = hasActivePosition ? "active" : "inactive"

  return (
    <BadgeCell
      value={status}
      variant={hasActivePosition ? "default" : "secondary"}
      transform="capitalize"
    />
  )
}

// Position Cell Component with Modal
function PositionCell({ employee }: { employee: Employee }) {
  const [showPositionHistory, setShowPositionHistory] = useState(false)

  const activePositions = employee.employee_positions?.filter(pos => pos.status === 'active') || []
  const totalPositions = employee.employee_positions?.length || 0
  const hasMultiplePositions = totalPositions > 1

  if (activePositions.length === 0) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPositionHistory(true)}
        >
          <span className="text-muted-foreground">No active position</span>
        </Button>
        <PositionHistoryModal
          isOpen={showPositionHistory}
          onOpenChange={setShowPositionHistory}
          employee={employee}
        />
      </>
    )
  }

  const primaryPosition = activePositions[0]

  // Create a Badge component for the main icon
  const PositionCountBadge = hasMultiplePositions
    ? ({ className }: { className?: string }) => (
      <Badge
        variant="outline"
        className={`w-4 h-4 p-0 text-xs rounded-full ${className || ''}`}
      >
        {totalPositions}
      </Badge>
    )
    : undefined

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="cursor-pointer"
        onClick={() => setShowPositionHistory(true)}
      >
        <TwoLineTextCell
          mainText={primaryPosition.position_types.name}
          mainIcon={PositionCountBadge}
          secondaryText={primaryPosition.department_types?.name}
          secondaryIcon={Building2}
          spacing="tight"
        />
      </Button>
      <PositionHistoryModal
        isOpen={showPositionHistory}
        onOpenChange={setShowPositionHistory}
        employee={employee}
      />
    </>
  )
}

// Dynamic data for filter options
interface FilterData {
  roles?: Array<{ id: number; name: string; description?: string }>
  termTypes?: Array<{ id: number; name: string; start_date?: string; end_date?: string; is_current: boolean }>
  isLoadingRoles?: boolean
  isLoadingTermTypes?: boolean
}

// Function to create columns with optional callbacks and dynamic filter data
export function createEmployeeColumns(callbacks?: ColumnCallbacks, filterData?: FilterData): ColumnDef<Employee>[] {
  return [
    // Employee photo and name (no filter)
    {
      id: "employee",
      accessorKey: "users.first_name",
      header: "Employee",
      cell: ({ row }) => {
        const employee = row.original
        // Convert to UserCell format
        const user = {
          id: employee.users.id,
          email: employee.users.email,
          first_name: employee.users.first_name,
          last_name: employee.users.last_name,
          khmer_first_name: employee.users.khmer_first_name,
          khmer_last_name: employee.users.khmer_last_name,
          avatar_url: employee.users.avatar_url
        }
        return <UserCell user={user} />
      },
    },

    // Employee ID (no filter)
    {
      accessorKey: "employee_id",
      header: "Employee ID",
      cell: ({ row }) => (
        <IDCell id={row.getValue("employee_id")} />
      ),
    },

    // Department and Position
    {
      id: "position",
      accessorKey: "employee_positions",
      header: () => {
        // Fetch actual position and department types
        const { data: positionTypes, isLoading: isLoadingPositions } = useEmployeePositionTypes()
        const { data: departmentTypes, isLoading: isLoadingDepartments } = useEmployeeDepartmentTypes()

        // Convert to dropdown options format
        const positionOptions = positionTypes?.map(position => ({
          value: position.id.toString(),
          label: position.name
        })) || []

        const departmentOptions = departmentTypes?.map(department => ({
          value: department.id.toString(),
          label: department.name
        })) || []

        const hasActiveFilters = !!(callbacks?.currentPositionFilter || callbacks?.currentDepartmentFilter)

        return (
          <DropdownMenuFilterHeader
            title="Positions & Departments"
            hasActiveFilters={hasActiveFilters}
            onClearAllFilters={() => {
              callbacks?.onUpdateFilters?.({
                position_type_id: undefined,
                department_id: undefined
              })
            }}
          >
            <FilterSection>
              <SelectFilterHeader
                title="Positions"
                options={positionOptions}
                currentFilter={callbacks?.currentPositionFilter}
                onFilterChange={(value) => {
                  callbacks?.onUpdateFilters?.({
                    position_type_id: value ? parseInt(value) : undefined
                  })
                }}
                onClearFilter={() => {
                  callbacks?.onUpdateFilters?.({
                    position_type_id: undefined
                  })
                }}
                disabled={isLoadingPositions}
              />
            </FilterSection>

            <FilterSection>
              <SelectFilterHeader
                title="Departments"
                options={departmentOptions}
                currentFilter={callbacks?.currentDepartmentFilter}
                onFilterChange={(value) => {
                  callbacks?.onUpdateFilters?.({
                    department_id: value ? parseInt(value) : undefined
                  })
                }}
                onClearFilter={() => {
                  callbacks?.onUpdateFilters?.({
                    department_id: undefined
                  })
                }}
                disabled={isLoadingDepartments}
              />
            </FilterSection>
          </DropdownMenuFilterHeader>
        )
      },
      cell: ({ row }) => {
        const employee = row.original
        return <PositionCell employee={employee} />
      },
    },

    // Role Assignments with filter
    {
      id: "roles",
      accessorKey: "user_roles",
      header: () => {
        if (!callbacks?.onFilterByRole) {
          return <span className="font-medium">Roles</span>
        }

        return (
          <SelectFilterHeader
            title="Roles"
            options={filterData?.roles?.map(role => ({
              value: role.name,
              label: role.name
            })) || []}
            currentFilter={callbacks?.currentRoleFilter}
            onFilterChange={(value) => callbacks?.onFilterByRole?.(value)}
            onClearFilter={() => callbacks?.onFilterByRole?.("")}
            disabled={filterData?.isLoadingRoles}
          />
        )
      },
      cell: ({ row }) => {
        const employee = row.original
        const activeRoles = employee.users?.user_roles?.filter(role => role.status === 'active') || []

        // Convert to RolesCell format
        const roles = activeRoles.map(roleAssignment => ({
          name: roleAssignment.roles.name,
          status: roleAssignment.status
        }))

        return <RolesCell roles={roles} maxDisplay={2} />
      },
    },

    // Status with filter
    {
      id: "status",
      accessorKey: "employee_positions",
      header: () => {
        if (!callbacks?.onFilterByStatus) {
          return <span className="font-medium">Status</span>
        }

        return (
          <SelectFilterHeader
            title="Statuses"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" }
            ]}
            currentFilter={callbacks?.currentStatusFilter}
            onFilterChange={(value) => callbacks?.onFilterByStatus?.(value)}
            onClearFilter={() => callbacks?.onFilterByStatus?.("")}
          />
        )
      },
      cell: ({ row }) => {
        const employee = row.original
        return <StatusCell employee={employee} />
      },
    },

    // Hire Term with filter
    {
      id: "hire_term",
      accessorKey: "term_types.name",
      header: () => {
        if (!callbacks?.onFilterByHireTerm) {
          return <span className="font-medium">Hire Term</span>
        }

        return (
          <SelectFilterHeader
            title="Hire Terms"
            options={filterData?.termTypes?.map(termType => ({
              value: termType.name,
              label: termType.name
            })) || []}
            currentFilter={callbacks?.currentHireTermFilter}
            onFilterChange={(value) => callbacks?.onFilterByHireTerm?.(value)}
            onClearFilter={() => callbacks?.onFilterByHireTerm?.("")}
            disabled={filterData?.isLoadingTermTypes}
          />
        )
      },
      cell: ({ row }) => {
        const employee = row.original
        if (!employee.term_types) {
          return <span className="text-muted-foreground">—</span>
        }

        return (employee.term_types.name)
      },
    },

    // Hired Date with filter
    {
      accessorKey: "created_at",
      header: () => {
        if (!callbacks?.onFilterByCreatedDate) {
          return <span className="font-medium">Hired Date</span>
        }

        // Convert string date filter to Date object for DateFilterHeader
        const currentDateFilter = callbacks?.currentCreatedDateFilter
          ? new Date(callbacks.currentCreatedDateFilter)
          : undefined

        return (
          <DateFilterHeader
            title="Created Dates"
            currentFilter={currentDateFilter}
            onFilterChange={(date) => {
              if (date) {
                callbacks?.onFilterByCreatedDate?.(formatISO(date))
              } else {
                callbacks?.onFilterByCreatedDate?.("")
              }
            }}
            maxDate={new Date()}
          />
        )
      },
      cell: ({ row }) => {
        const date = row.getValue("created_at") as string
        if (!date) return <span className="text-muted-foreground">—</span>

        try {
          return format(parseISO(date), "MMM dd, yyyy")
        } catch {
          return <span className="text-muted-foreground">Invalid date</span>
        }
      },
    },

    // Actions
    {
      id: "actions",
      enableHiding: false,
      cell: ({ row }) => {
        const employee = row.original
        const { hasPermission } = useAuth()

        // Check if user has any permissions for employee actions
        const canWrite = hasPermission(PERMISSIONS.EMPLOYEE_MANAGEMENT.WRITE)
        const canDelete = hasPermission(PERMISSIONS.EMPLOYEE_MANAGEMENT.DELETE)
        const hasAnyActionPermission = canWrite || canDelete

        // Don't render anything if user has no permissions
        if (!hasAnyActionPermission) {
          return null
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>

              {/* Manage Positions - Requires WRITE access */}
              {canWrite && (
                <DropdownMenuItem onClick={() => callbacks?.onManagePositions?.(employee)}>
                  <Building2 className="mr-2 h-4 w-4" />
                  Manage Positions
                </DropdownMenuItem>
              )}

              {/* Manage Roles - Requires USER_ADMINISTRATION WRITE access */}
              {canWrite && (
                <DropdownMenuItem onClick={() => callbacks?.onManageRoles?.(employee)}>
                  <UserCog className="mr-2 h-4 w-4" />
                  Manage Roles
                </DropdownMenuItem>
              )}

              {/* Delete Employee - Requires DELETE access */}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => callbacks?.onDeleteEmployee?.(employee)}
                  variant="destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
}

// Default export for backward compatibility
export const employeeColumns = createEmployeeColumns()