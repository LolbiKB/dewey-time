import { useState } from "react"
import { UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GenericDataTable, type BaseTableMeta } from "@/components/ui/generic-data-table"
import { createStudentColumns, type Student } from "./columns"
import { DeleteStudentModal } from "./modals/delete-student-modal"
import { ManageProgramsModal } from "./modals/manage-programs-modal"
import { useAuth } from "@/hooks/use-auth"
import { PERMISSIONS } from "@/lib/permissions"
import type { StudentFilters } from "@/services/student-service"
import { useDeleteStudent } from "@/hooks/use-students"

interface DataTableProps {
  data: Student[]
  meta?: BaseTableMeta
  loading?: boolean

  // Server-side operations
  filters: StudentFilters
  onFiltersChange: (filters: StudentFilters) => void
  onRefresh?: () => void

  onCreateStudent?: () => void

  // Filter data for dropdowns
  termTypes?: Array<{ id: number; name: string; start_date?: string; end_date?: string; is_current: boolean }>
  isLoadingTermTypes?: boolean
}

export function DataTable({
  data,
  meta,
  loading = false,
  filters,
  onFiltersChange,
  onRefresh,
  onCreateStudent,
  termTypes,
  isLoadingTermTypes = false
}: DataTableProps) {
  // State for modals
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null)
  const [isManageProgramsModalOpen, setIsManageProgramsModalOpen] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<Student | undefined>()

  // Permission checking
  const { hasPermission } = useAuth()

  // Use the delete student hook
  const deleteStudentMutation = useDeleteStudent()

  const handleCreateStudent = () => {
    onCreateStudent?.()
  }

  const handleManagePrograms = (student: Student) => {
    setSelectedStudent(student)
    setIsManageProgramsModalOpen(true)
  }

  const handleDeleteStudent = (student: Student) => {
    setStudentToDelete(student)
    setIsDeleteModalOpen(true)
  }

  const handleConfirmDeleteStudent = async (studentId: string) => {
    try {
      await deleteStudentMutation.mutateAsync(parseInt(studentId))
      onRefresh?.()
    } catch (error) {
      console.error('Failed to delete student:', error)
      throw error // Let the modal handle the error display
    }
  }

  // Create columns with callbacks and filter functionality
  const columns = createStudentColumns({
    onManagePrograms: handleManagePrograms,
    onDeleteStudent: handleDeleteStudent,
    onFilterByStatus: (status: string) => onFiltersChange({ ...filters, status: status as 'active' | 'inactive' | undefined, page: 1 }),
    onFilterByAdmissionTerm: (term: string) => onFiltersChange({ ...filters, admission_term: term, page: 1 }),
    onFilterByCreatedDate: (date: string) => onFiltersChange({ ...filters, created_date: date, page: 1 }),
    onUpdateFilters: (updates: { program_id?: number | undefined }) => {
      onFiltersChange({
        ...filters,
        ...updates,
        page: 1
      })
    },
    currentStatusFilter: filters.status || "",
    currentAdmissionTermFilter: filters.admission_term || "",
    currentCreatedDateFilter: filters.created_date || "",
    currentProgramFilter: filters.program_id?.toString() || undefined
  }, {
    termTypes,
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
          entityName: "students",
          entityNameSingular: "student",
          searchPlaceholder: "Search students...",
        }}
        actions={{
          onRefresh: onRefresh
        }}
        toolbarActions={
          hasPermission(PERMISSIONS.STUDENT_MANAGEMENT.CREATE) && (
            <Button onClick={handleCreateStudent}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add
            </Button>
          )
        }
      />

      {/* Delete Student Modal */}
      <DeleteStudentModal
        isOpen={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        student={studentToDelete}
        onConfirmDelete={handleConfirmDeleteStudent}
      />

      {/* Manage Programs Modal */}
      <ManageProgramsModal
        isOpen={isManageProgramsModalOpen}
        onOpenChange={setIsManageProgramsModalOpen}
        studentId={selectedStudent?.id}
        onSuccess={onRefresh}
      />
    </>
  )
}
