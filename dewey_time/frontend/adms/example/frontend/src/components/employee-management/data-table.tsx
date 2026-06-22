import { useState } from "react"
import { UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GenericDataTable, type BaseTableMeta } from "@/components/ui/generic-data-table"
import { EmployeeModal, ManagePositionsModal, ManageRolesModal, DeleteEmployeeModal } from "./modals"
import { createEmployeeColumns, type Employee } from "./columns"
import {
  useDeleteEmployee,
  useAvailableUsers,
  useEmployeePositionTypes,
  useEmployeeDepartmentTypes
} from "@/hooks/use-employees"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"

interface EmployeeFilters {
  search?: string
  page?: number
  limit?: number
  sort?: string
  order?: 'asc' | 'desc'
  department_id?: number
  position_type_id?: number
  status?: 'active' | 'inactive'
  role?: string
  hire_term?: string
  created_date?: string
}

interface DataTableProps {
  data: Employee[]
  meta?: BaseTableMeta
  loading?: boolean

  // Server-side operations
  filters: EmployeeFilters
  onFiltersChange: (filters: EmployeeFilters) => void
  onRefresh?: () => void

  onCreateEmployee?: () => void

  // Filter data for dropdowns
  roles?: Array<{ id: number; name: string; description?: string }>
  termTypes?: Array<{ id: number; name: string; start_date?: string; end_date?: string; is_current: boolean }>
  isLoadingRoles?: boolean
  isLoadingTermTypes?: boolean
}

export function DataTable({
  data,
  meta,
  loading = false,
  filters,
  onFiltersChange,
  onRefresh,
  onCreateEmployee,
  roles,
  termTypes,
  isLoadingRoles = false,
  isLoadingTermTypes = false
}: DataTableProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isManagePositionsModalOpen, setIsManagePositionsModalOpen] = useState(false)
  const [isManageRolesModalOpen, setIsManageRolesModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>()
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | undefined>()

  // Permission checking
  const { hasPermission } = useAuth()

  // Use the delete employee hook
  const deleteEmployeeMutation = useDeleteEmployee()

  // Fetch data for employee creation modal
  const { data: availableUsersData, isLoading: isLoadingUsers } = useAvailableUsers({ limit: 100 })
  const { data: positionTypes, isLoading: isLoadingPositionTypes } = useEmployeePositionTypes()
  const { data: departmentTypes, isLoading: isLoadingDepartmentTypes } = useEmployeeDepartmentTypes()

  const handleCreateEmployee = () => {
    setIsCreateModalOpen(true)
    onCreateEmployee?.()
  }

  const handleManagePositions = (employee: Employee) => {
    setSelectedEmployee(employee)
    setIsManagePositionsModalOpen(true)
  }

  const handleManageRoles = (employee: Employee) => {
    setSelectedEmployee(employee)
    setIsManageRolesModalOpen(true)
  }

  const handleDeleteEmployee = (employee: Employee) => {
    setEmployeeToDelete(employee)
    setIsDeleteModalOpen(true)
  }

  const handleConfirmDeleteEmployee = async (employeeId: string) => {
    try {
      await deleteEmployeeMutation.mutateAsync(parseInt(employeeId))
      onRefresh?.()
    } catch (error) {
      console.error('Failed to delete employee:', error)
      throw error // Let the modal handle the error display
    }
  }

  const handleModalSuccess = () => {
    onRefresh?.()
  }

  // Create columns with callbacks and filter functionality
  const columns = createEmployeeColumns({
    onManagePositions: handleManagePositions,
    onManageRoles: handleManageRoles,
    onDeleteEmployee: handleDeleteEmployee,
    onFilterByRole: (role: string) => onFiltersChange({ ...filters, role, page: 1 }),
    onFilterByStatus: (status: string) => onFiltersChange({ ...filters, status: status as 'active' | 'inactive', page: 1 }),
    onFilterByHireTerm: (term: string) => onFiltersChange({ ...filters, hire_term: term, page: 1 }),
    onFilterByCreatedDate: (date: string) => onFiltersChange({ ...filters, created_date: date, page: 1 }),
    onUpdateFilters: (updates: { position_type_id?: number | undefined; department_id?: number | undefined }) => {
      onFiltersChange({
        ...filters,
        ...updates,
        page: 1
      })
    },
    currentRoleFilter: filters.role || "",
    currentStatusFilter: filters.status || "",
    currentHireTermFilter: filters.hire_term || "",
    currentCreatedDateFilter: filters.created_date || "",
    currentPositionFilter: filters.position_type_id?.toString() || undefined,
    currentDepartmentFilter: filters.department_id?.toString() || undefined
  }, {
    roles,
    termTypes,
    isLoadingRoles,
    isLoadingTermTypes
  })

  return (
    <>
      <GenericDataTable
        columns={columns}
        data={data}
        meta={meta}
        loading={loading}
        filters={filters}
        onFiltersChange={onFiltersChange}
        config={{
          entityName: "employees",
          entityNameSingular: "employee",
          searchPlaceholder: "Search employees...",
        }}
        actions={{
          onRefresh: onRefresh
        }}
        toolbarActions={
          hasPermission(PERMISSIONS.EMPLOYEE_MANAGEMENT.CREATE) && (
            <Button onClick={handleCreateEmployee}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add
            </Button>
          )
        }
      />

      {/* Add Employee Modal */}
      <EmployeeModal
        isOpen={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={handleModalSuccess}
        users={availableUsersData?.data || []}
        termTypes={termTypes}
        positionTypes={positionTypes || []}
        departmentTypes={departmentTypes || []}
        isLoadingData={
          isLoadingUsers ||
          isLoadingPositionTypes ||
          isLoadingDepartmentTypes ||
          isLoadingRoles ||
          isLoadingTermTypes
        }
      />

      {/* Manage Positions Modal */}
      <ManagePositionsModal
        isOpen={isManagePositionsModalOpen}
        onOpenChange={setIsManagePositionsModalOpen}
        employeeId={selectedEmployee?.id}
        onSuccess={handleModalSuccess}
      />

      {/* Manage Roles Modal */}
      <ManageRolesModal
        isOpen={isManageRolesModalOpen}
        onOpenChange={setIsManageRolesModalOpen}
        employeeId={selectedEmployee?.id}
        onSuccess={handleModalSuccess}
      />

      {/* Delete Employee Modal */}
      <DeleteEmployeeModal
        employee={employeeToDelete || null}
        isOpen={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        onConfirmDelete={handleConfirmDeleteEmployee}
        isDeleting={deleteEmployeeMutation.isPending}
      />
    </>
  )
}