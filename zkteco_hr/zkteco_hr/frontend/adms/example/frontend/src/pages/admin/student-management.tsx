import { useState } from 'react'
import { MainLayout } from '../../components/layout/main-layout'
import { DataTable } from '../../components/student-management/data-table'
import { StudentModal } from '../../components/student-management/modals/student-modal'
import { useStudents, useStudentTermTypes } from '../../hooks/use-students'
import type { StudentFilters } from '../../services/student-service'

export function StudentManagement() {
  const [filters, setFilters] = useState<StudentFilters>({
    page: 1,
    limit: 20,
    sort: 'created_at',
    order: 'desc',
  })

  const [showStudentModal, setShowStudentModal] = useState(false)

  // Fetch students with filters
  const {
    data: studentsResponse,
    isLoading,
    isFetching,
    refetch
  } = useStudents(filters)

  // Fetch filter options
  const { data: termTypes, isLoading: isLoadingTermTypes } = useStudentTermTypes()

  const handleFiltersChange = (newFilters: StudentFilters) => {
    setFilters(newFilters)
  }

  const handleRefresh = () => {
    refetch()
  }

  const handleCreateStudent = () => {
    setShowStudentModal(true)
  }

  const handleStudentCreated = () => {
    refetch()
  }

  const students = studentsResponse?.data || []
  const meta = studentsResponse?.meta || {
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  }

  return (
    <MainLayout breadcrumb={{ items: [{ label: "Administration" }, { label: "Student Management" }] }}>
      <div className="h-full">
        <DataTable
          data={students}
          meta={meta}
          loading={isLoading || isFetching}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onRefresh={handleRefresh}
          onCreateStudent={handleCreateStudent}
          termTypes={termTypes}
          isLoadingTermTypes={isLoadingTermTypes}
        />

        <StudentModal
          isOpen={showStudentModal}
          onOpenChange={setShowStudentModal}
          onSuccess={handleStudentCreated}
        />
      </div>
    </MainLayout>
  )
}

export default StudentManagement
