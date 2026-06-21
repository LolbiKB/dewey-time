import { useState } from "react"
import { MainLayout } from "@/components/layout/main-layout"
import { DataTable } from "@/components/program-management/data-table"
import { createProgramColumns, type Program } from "@/components/program-management/columns"
import { ProgramModal } from "@/components/program-management/modals/program-modal"
import { usePrograms, useDeleteProgram } from "@/hooks/use-programs"
import type { ProgramFilters } from "@/services/program-service"
import { DeleteConfirmationModal } from "@/components/ui/delete-confirmation-modal"

export function ProgramManagement() {
  const [filters, setFilters] = useState<ProgramFilters>({
    page: 1,
    limit: 20,
    sort: "major",
    order: "asc",
  })

  // Use the program management hooks
  const {
    data: programs,
    isLoading,
    isFetching,
    isError,
    error,
    refetch: refetchPrograms,
  } = usePrograms(filters)

  // State for modals (will be implemented later)
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // Create columns with callbacks
  const columns = createProgramColumns({
    onEditProgram: (program: Program) => {
      setSelectedProgram(program)
      setIsEditModalOpen(true)
    },
    onDeleteProgram: (program: Program) => {
      setSelectedProgram(program)
      setIsDeleteModalOpen(true)
    },
    onFilterByDegree: (degreeId: string) => {
      setFilters({
        ...filters,
        degree_id: degreeId ? Number(degreeId) : undefined,
        page: 1, // Reset to first page when filtering
      })
    },
    onFilterByDepartment: (departmentId: string) => {
      setFilters({
        ...filters,
        department_id: departmentId ? Number(departmentId) : undefined,
        page: 1, // Reset to first page when filtering
      })
    },
    currentDegreeFilter: filters.degree_id?.toString(),
    currentDepartmentFilter: filters.department_id?.toString(),
  })

  const handleFiltersChange = (newFilters: ProgramFilters) => {
    setFilters(newFilters)
  }

  const handleRefresh = () => {
    refetchPrograms()
  }

  const handleCreateProgram = () => {
    setIsCreateModalOpen(true)
  }

  const handleModalSuccess = () => {
    // Refresh the program list after successful create/update
    refetchPrograms()
  }

  // Delete program mutation
  const deleteProgram = useDeleteProgram()

  const handleDeleteProgram = async () => {
    if (!selectedProgram) return

    try {
      await deleteProgram.mutateAsync(selectedProgram.id)
      setIsDeleteModalOpen(false)
      setSelectedProgram(null)
      refetchPrograms()
    } catch (error) {
      console.error('Failed to delete program:', error)
      throw error // Let the modal handle the error display
    }
  }

  // Handle error state
  if (isError) {
    console.error("Program fetch error:", error)
  }

  return (
    <MainLayout
      breadcrumb={{
        items: [{ label: "Academic" }, { label: "Program Management" }],
      }}
    >
      <DataTable
        columns={columns}
        data={programs?.data || []}
        meta={programs?.meta}
        loading={isLoading || isFetching}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onRefresh={handleRefresh}
        onCreateProgram={handleCreateProgram}
      />

      {/* Create Program Modal */}
      <ProgramModal
        isOpen={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={handleModalSuccess}
      />

      {/* Edit Program Modal */}
      <ProgramModal
        isOpen={isEditModalOpen}
        onOpenChange={(open) => {
          setIsEditModalOpen(open)
          if (!open) {
            setSelectedProgram(null)
          }
        }}
        program={selectedProgram}
        mode="edit"
        onSuccess={handleModalSuccess}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        item={selectedProgram ? {
          id: selectedProgram.id.toString(),
          displayName: selectedProgram.major,
          subtitle: selectedProgram.description || 'No description',
          showAvatar: false
        } : null}
        isOpen={isDeleteModalOpen}
        onOpenChange={(open) => {
          setIsDeleteModalOpen(open)
          if (!open) {
            setSelectedProgram(null)
          }
        }}
        onConfirmDelete={handleDeleteProgram}
        isDeleting={deleteProgram.isPending}
        config={{
          title: 'Delete Program',
          description: 'This action cannot be undone. This will permanently delete the program and remove all associated data.',
          entityName: 'program',
          successMessage: 'Program {name} deleted successfully',
          errorMessage: 'Failed to delete program',
          confirmationText: selectedProgram?.major || '',
          confirmationInstruction: `Type the program name to confirm deletion.`
        }}
      />
    </MainLayout>
  )
}

export default ProgramManagement
