import { useState } from 'react'
import { MainLayout } from '../../components/layout/main-layout'
import { DataTable } from '../../components/department-management/data-table'
import { createColumns, type Department } from '../../components/department-management/columns'
import { DepartmentModal } from '../../components/department-management/modals/department-modal'
import { DeleteConfirmationModal } from '../../components/ui/delete-confirmation-modal'
import { useDepartments, useDeleteDepartment } from '../../hooks/use-departments'
import { DataLoadErrorState } from '../../components/ui/error-state-variants'
import type { DepartmentFilters } from '../../services/department-service'

export function DepartmentManagement() {
  const [filters, setFilters] = useState<DepartmentFilters>({
    page: 1,
    limit: 20,
    sort: 'name',
    order: 'asc',
  })

  // Use the department management hooks
  const {
    data: departments,
    isLoading,
    isFetching,
    isError,
    error,
    refetch: refetchDepartments
  } = useDepartments(filters)

  // Delete department mutation
  const deleteDepartment = useDeleteDepartment()

  // State for modals (will be implemented later)
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Create columns with callbacks
  const columns = createColumns({
    onEditDepartment: (department: Department) => {
      setSelectedDepartment(department)
      setIsEditModalOpen(true)
    },
    onDeleteDepartment: (department: Department) => {
      setSelectedDepartment(department)
      setIsDeleteModalOpen(true)
    },
  })

  const handleFiltersChange = (newFilters: DepartmentFilters) => {
    setFilters(newFilters)
  }

  const handleRefresh = () => {
    refetchDepartments()
  }

  const handleCreateDepartment = () => {
    setIsCreateModalOpen(true)
  }

  const handleModalSuccess = () => {
    // Refresh the department list after successful create/update
    refetchDepartments()
  }

  const handleDeleteDepartment = async (departmentId: string) => {
    await deleteDepartment.mutateAsync(parseInt(departmentId))
    // Refresh the department list after successful delete
    refetchDepartments()
  }

  // Handle error state
  if (isError) {
    console.error('Department fetch error:', error)
    return (
      <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "Departments" }] }}>
        <DataLoadErrorState
          dataType="departments"
          customMessage="There was an error loading the department data. Please try again."
          onRetry={handleRefresh}
        />
      </MainLayout>
    )
  }

  return (
    <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "Departments" }] }}>
      <DataTable
        columns={columns}
        data={departments?.data || []}
        meta={departments?.meta}
        loading={isLoading || isFetching}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onRefresh={handleRefresh}
        onCreateDepartment={handleCreateDepartment}
      />

      {/* Department Modals */}
      <DepartmentModal
        mode="create"
        isOpen={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={handleModalSuccess}
      />

      <DepartmentModal
        mode="edit"
        departmentId={selectedDepartment?.id}
        isOpen={isEditModalOpen}
        onOpenChange={(open) => {
          setIsEditModalOpen(open)
          if (!open) {
            setSelectedDepartment(null)
          }
        }}
        onSuccess={handleModalSuccess}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        item={selectedDepartment ? {
          id: selectedDepartment.id.toString(),
          displayName: selectedDepartment.name,
          subtitle: selectedDepartment.description || 'No description',
          showAvatar: false
        } : null}
        isOpen={isDeleteModalOpen}
        onOpenChange={(open) => {
          setIsDeleteModalOpen(open)
          if (!open) {
            setSelectedDepartment(null)
          }
        }}
        onConfirmDelete={handleDeleteDepartment}
        isDeleting={deleteDepartment.isPending}
        config={{
          title: 'Delete Department',
          description: 'This action will permanently remove the department record.',
          entityName: 'department',
          successMessage: 'Department {name} deleted successfully',
          errorMessage: 'Failed to delete department',
          confirmationText: selectedDepartment?.name || '',
          confirmationInstruction: `Type the department name to confirm deletion.`
        }}
      />
    </MainLayout>
  )
}